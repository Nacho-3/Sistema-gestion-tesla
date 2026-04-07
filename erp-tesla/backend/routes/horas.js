import fs from "fs/promises";
const HORAS_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "horas");

const saveResumenHorasPdf = async ({ mes, anio, nombreArchivo, pdfBuffer }) => {
  const mesInt = parseInt(mes)
  const anioInt = parseInt(anio)
  if (!Number.isFinite(mesInt) || !Number.isFinite(anioInt) || !pdfBuffer) return

  const subfolder = path.join(HORAS_FOLDER, `${anioInt}_${String(mesInt).padStart(2, "0")}`)
  await fs.mkdir(subfolder, { recursive: true })
  const filePath = path.join(subfolder, nombreArchivo)
  await fs.writeFile(filePath, pdfBuffer)
}

// Guarda o actualiza el archivo resumen mensual de horas
const saveResumenHorasMes = async (mes, anio) => {
  await fs.mkdir(HORAS_FOLDER, { recursive: true });
  // Obtener todas las horas del mes
  const mesInt = parseInt(mes);
  const anioInt = parseInt(anio);
  if (!Number.isFinite(mesInt) || !Number.isFinite(anioInt)) return;
  const inicio = new Date(anioInt, mesInt - 1, 1).toISOString().split("T")[0];
  const fin = new Date(anioInt, mesInt, 0).toISOString().split("T")[0];
  const { data: horasData } = await db.from("horas").select("*").gte("fecha", inicio).lte("fecha", fin);
  if (!horasData) return;
  // Obtener empleados y obras para nombres
  const { data: empleados } = await db.from("empleados").select("id, nombre, apellido");
  const { data: obras } = await db.from("obras").select("id, nombre");
  // Generar resumen por empleado
  const resumenPorEmpleado = {};
  horasData.forEach((h) => {
    const emp = empleados?.find((e) => e.id === h.empleado_id);
    const nombreEmp = emp ? `${emp.nombre} ${emp.apellido}` : `Empleado ${h.empleado_id}`;
    if (!resumenPorEmpleado[nombreEmp]) resumenPorEmpleado[nombreEmp] = 0;
    resumenPorEmpleado[nombreEmp] += getCantidadHoras(h);
  });
  // Generar resumen por obra
  const resumenPorObra = {};
  horasData.forEach((h) => {
    const obra = obras?.find((o) => o.id === h.obra_id);
    const nombreObra = obra ? obra.nombre : `Obra ${h.obra_id}`;
    if (!resumenPorObra[nombreObra]) resumenPorObra[nombreObra] = 0;
    resumenPorObra[nombreObra] += getCantidadHoras(h);
  });
  // Contenido del archivo
  let content = `Resumen mensual de horas\nMes: ${mes}/${anio}\n\n`;
  content += `Total de registros: ${horasData.length}\n`;
  content += `\n--- Horas por empleado ---\n`;
  Object.entries(resumenPorEmpleado).forEach(([emp, hs]) => {
    content += `  - ${emp}: ${formatHoursAsClock(hs)} hs\n`;
  });
  content += `\n--- Horas por obra ---\n`;
  Object.entries(resumenPorObra).forEach(([obra, hs]) => {
    content += `  - ${obra}: ${formatHoursAsClock(hs)} hs\n`;
  });
  // Guardar archivo dentro de la carpeta del mes correspondiente
  const subfolder = path.join(HORAS_FOLDER, `${anioInt}_${String(mesInt).padStart(2, "0")}`);
  await fs.mkdir(subfolder, { recursive: true });
  const nombreArchivo = `horas_${anioInt}_${String(mesInt).padStart(2, "0")}.txt`;
  const filePath = path.join(subfolder, nombreArchivo);
  await fs.writeFile(filePath, content);
};
import express from "express"
import db from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js"
import { formatHoursAsClock, parseHoursInput } from "../utils/hourFormat.js"

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

const getCantidadHoras = (registro = {}) => {
  const valor =
    registro.cantidad_horas ??
    registro.horas_trabajadas ??
    registro.cantidad_hora ??
    registro.horas ??
    registro.cantidad ??
    0

  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const normalizeTipoHoraExtra = (tipoHoraExtra) => {
  const normalizado = String(tipoHoraExtra || "").trim()
  if (normalizado === "100") return "100"
  if (normalizado === "50") return "50"
  return null
}

const getTipoHora = ({ es_hora_extra, tipo_hora_extra, es_prestada }) => {
  if (es_hora_extra === true) {
    return normalizeTipoHoraExtra(tipo_hora_extra) === "100" ? "extra_100" : "extra_50"
  }
  if (es_prestada === true) return "prestada"
  return "normal"
}

const normalizeNullableId = (value) => {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

const parseFlexibleNumber = (value) => {
  return parseHoursInput(value)
}

const resolveClienteObraRelacion = async ({ clienteId, obraId }) => {
  if (!obraId) {
    return { clienteId: clienteId ?? null, obraId: null }
  }

  const { data: obra, error } = await db
    .from("obras")
    .select("id, cliente_id")
    .eq("id", obraId)
    .single()

  if (error || !obra) {
    throw new Error("La obra seleccionada no existe")
  }

  if (clienteId && Number(clienteId) !== Number(obra.cliente_id)) {
    throw new Error("La obra seleccionada no pertenece al cliente indicado")
  }

  return {
    clienteId: obra.cliente_id ? Number(obra.cliente_id) : (clienteId ?? null),
    obraId: Number(obra.id),
  }
}

const roundHoras = (value) => {
  const numero = Number(value)
  if (!Number.isFinite(numero)) return 0
  return Math.round(numero * 100) / 100
}

const parseLocalDateOnly = (dateValue) => {
  if (!dateValue) return null
  const [year, month, day] = String(dateValue).split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

const isSaturdayDate = (dateValue) => {
  const parsedDate = parseLocalDateOnly(dateValue)
  return Boolean(parsedDate) && parsedDate.getDay() === 6
}

const isSundayDate = (dateValue) => {
  const parsedDate = parseLocalDateOnly(dateValue)
  return Boolean(parsedDate) && parsedDate.getDay() === 0
}

const resolveHorasExtraDetalle = ({
  fecha,
  horasComputadas,
  es_hora_extra = false,
  tipo_hora_extra = null,
  cantidad_horas_extra = null,
  cantidad_horas_extra_50 = null,
  cantidad_horas_extra_100 = null,
}) => {
  let horasExtra50 = 0
  let horasExtra100 = 0

  const extra50Numerica = parseFlexibleNumber(cantidad_horas_extra_50)
  const extra100Numerica = parseFlexibleNumber(cantidad_horas_extra_100)

  if (Number.isFinite(extra50Numerica) && extra50Numerica > 0) {
    horasExtra50 = roundHoras(extra50Numerica)
  }

  if (Number.isFinite(extra100Numerica) && extra100Numerica > 0) {
    horasExtra100 = roundHoras(extra100Numerica)
  }

  if (horasExtra50 === 0 && horasExtra100 === 0) {
    const esExtraLegacy = es_hora_extra === true || normalizeTipoHoraExtra(tipo_hora_extra) !== null
    const tipoLegacy = normalizeTipoHoraExtra(tipo_hora_extra) || "50"
    const cantidadExtraLegacy = parseFlexibleNumber(cantidad_horas_extra)
    const horasExtraLegacy = esExtraLegacy ? roundHoras(cantidadExtraLegacy ?? horasComputadas) : 0

    if (tipoLegacy === "100") {
      horasExtra100 = horasExtraLegacy
    } else {
      horasExtra50 = horasExtraLegacy
    }
  }

  const horasExtraTotales = roundHoras(horasExtra50 + horasExtra100)

  if (horasExtraTotales > horasComputadas) {
    throw new Error("La suma de las horas extra (50% + 100%) no puede superar el total de horas cargadas")
  }

  if (horasExtra100 > 0 && !isSaturdayDate(fecha)) {
    throw new Error("Las horas extra al 100% solo corresponden a sábados")
  }

  return {
    horasExtra50,
    horasExtra100,
    horasExtraTotales,
    horasBaseFinal: roundHoras(horasComputadas - horasExtraTotales),
  }
}

const buildHoraPayload = ({
  empleado_id,
  cliente_id,
  obra_id,
  fecha,
  hora_inicio = null,
  hora_fin = null,
  horas_trabajadas,
  cantidad_horas,
  es_hora_extra = false,
  tipo_hora_extra = null,
  observaciones = "",
  es_prestada = false,
  grupo_origen_id = null,
  grupo_destino_id = null,
}) => ({
  empleado_id,
  cliente_id: cliente_id ?? null,
  obra_id: obra_id ?? null,
  fecha,
  hora_inicio,
  hora_fin,
  horas_trabajadas: parseFloat(roundHoras(horas_trabajadas)),
  cantidad_horas: parseFloat(roundHoras(cantidad_horas)),
  es_hora_extra,
  tipo_hora_extra,
  observaciones: String(observaciones || "").trim(),
  es_prestada,
  tipo: getTipoHora({ es_hora_extra, tipo_hora_extra, es_prestada }),
  grupo_origen_id: es_prestada ? grupo_origen_id : null,
  grupo_destino_id: es_prestada ? grupo_destino_id : null,
})

const getRangoMes = (mes, anio) => {
  if (!mes || !anio) return null
  const mesInt = parseInt(mes)
  const anioInt = parseInt(anio)
  if (!Number.isFinite(mesInt) || !Number.isFinite(anioInt)) return null
  const inicio = new Date(anioInt, mesInt - 1, 1).toISOString().split("T")[0]
  const fin = new Date(anioInt, mesInt, 0).toISOString().split("T")[0]
  return { inicio, fin }
}

const ADMIN_GROUP_REGEX = /admin/i

const isAdministrativeObra = (obra, grupos = []) => {
  if (!obra) return false
  if (ADMIN_GROUP_REGEX.test(String(obra.nombre || ""))) return true
  const grupo = grupos.find((g) => String(g.id) === String(obra.grupo_id))
  return ADMIN_GROUP_REGEX.test(String(grupo?.nombre || ""))
}

const resolveGrupoForHora = ({ hora, obras = [], empleados = [], grupos = [] }) => {
  const obra = obras.find((o) => String(o.id) === String(hora?.obra_id))
  const grupoId = obra?.grupo_id ?? empleados.find((e) => String(e.id) === String(hora?.empleado_id))?.grupo_id ?? null
  const grupo = grupos.find((g) => String(g.id) === String(grupoId))
  return {
    grupoId: grupoId ? Number(grupoId) : null,
    grupoNombre: grupo?.nombre || "Sin grupo",
    obra,
  }
}

// Resolver automáticamente la obra para empleados administrativos
const resolveObraForAdministrativeEmpleado = async (empleadoId) => {
  const { data: empleado } = await db
    .from("empleados")
    .select("id, grupo_id")
    .eq("id", empleadoId)
    .single()

  if (!empleado?.grupo_id) return null

  const { data: grupo } = await db
    .from("grupos")
    .select("id, nombre")
    .eq("id", empleado.grupo_id)
    .single()

  const isAdminGrupo = ADMIN_GROUP_REGEX.test(String(grupo?.nombre || ""))
  if (!isAdminGrupo) return null

  // Buscar obra administrativa para este grupo
  const { data: obras } = await db
    .from("obras")
    .select("id, nombre")
    .eq("grupo_id", empleado.grupo_id)

  if (!obras || obras.length === 0) {
    return null
  }

  // Retornar primera obra administrativa o la que tenga nombre con "admin"
  const obraAdmin = obras.find((o) => ADMIN_GROUP_REGEX.test(String(o.nombre || ""))) || obras[0]
  return obraAdmin?.id || null
}

router.get("/resumen/pdf", async (req, res) => {
  try {
    const { mes, anio } = req.query
    const rango = getRangoMes(mes, anio)

    if (!rango) {
      return res.status(400).json({ error: "Mes y año válidos son obligatorios" })
    }

    const { data: horasData, error: horasError } = await db
      .from("horas")
      .select("*")
      .gte("fecha", rango.inicio)
      .lte("fecha", rango.fin)
      .order("fecha", { ascending: false })

    if (horasError) return res.status(400).json({ error: horasError.message })

    const [empleadosRes, obrasRes, gruposRes, clientesRes] = await Promise.all([
      db.from("empleados").select("id, nombre, apellido, grupo_id"),
      db.from("obras").select("id, nombre, grupo_id, cliente_id"),
      db.from("grupos").select("id, nombre"),
      db.from("clientes").select("id, empresa, razon_social")
    ])

    const empleadosData = empleadosRes.data || []
    const obrasData = obrasRes.data || []
    const gruposData = gruposRes.data || []
    const clientesData = clientesRes.data || []
    const horas = horasData || []

    const resumenEmpleado = {}
    const resumenObra = {}
    const resumenGrupo = {}
    const prestamosEntreGrupos = {}

    horas.forEach((h) => {
      const hs = getCantidadHoras(h)

      const emp = empleadosData.find((e) => e.id === h.empleado_id)
      const { obra, grupoNombre: grupoLabel } = resolveGrupoForHora({
        hora: h,
        obras: obrasData,
        empleados: empleadosData,
        grupos: gruposData,
      })
      const grupoEmpleado = gruposData.find((g) => g.id === emp?.grupo_id)
      const esAdministrativo = /admin/i.test(String(grupoEmpleado?.nombre || ""))

      const clienteId = obra?.cliente_id ?? h?.cliente_id ?? null
      const cliente = clientesData.find((c) => c.id === clienteId)
      const clienteNombre = cliente?.empresa || cliente?.razon_social || null

      const empLabel = emp ? `${emp.nombre} ${emp.apellido}` : `Empleado ${h.empleado_id}`
      const obraLabel = esAdministrativo
        ? "Administracion"
        : (obra
          ? (clienteNombre ? `${obra.nombre} - ${clienteNombre}` : obra.nombre)
          : (clienteNombre || "Sin obra"))
      const obraKey = esAdministrativo
        ? "administracion"
        : (obra?.id ? `obra_${obra.id}` : (clienteId ? `cliente_${clienteId}` : "sin_obra"))

      if (!resumenEmpleado[empLabel]) resumenEmpleado[empLabel] = 0
      if (!resumenObra[obraKey]) resumenObra[obraKey] = { label: obraLabel, value: 0 }
      if (!resumenGrupo[grupoLabel]) resumenGrupo[grupoLabel] = 0

      resumenEmpleado[empLabel] += hs
      resumenObra[obraKey].value += hs
      resumenGrupo[grupoLabel] += hs

      const esPrestada = h.es_prestada === true || String(h.tipo || "").toLowerCase() === "prestada"
      if (esPrestada) {
        const grupoOrigen = String(gruposData.find((g) => g.id === h.grupo_origen_id)?.nombre || "Sin grupo origen").trim()
        const grupoDestino = String(gruposData.find((g) => g.id === h.grupo_destino_id)?.nombre || "Sin grupo destino").trim()
        const key = `${grupoOrigen.toLowerCase()}|||${grupoDestino.toLowerCase()}`

        if (!prestamosEntreGrupos[key]) {
          prestamosEntreGrupos[key] = {
            origen: grupoOrigen,
            destino: grupoDestino,
            horas: 0,
          }
        }
        prestamosEntreGrupos[key].horas += hs
      }
    })

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const mesesNombre = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    const mesNombre = mesesNombre[Math.max(0, Number(mes) - 1)] || `Mes ${mes}`
    const nombreArchivo = `Resumen Horas ${sanitizeFileText(mesNombre)} ${sanitizeFileText(anio)}.pdf`
    const pageWidth = doc.page.width

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(chunks)
      try {
        await saveResumenHorasPdf({ mes, anio, nombreArchivo, pdfBuffer })
      } catch (fileErr) {
        console.error("[HORAS PDF] Error guardando resumen en disco:", fileErr)
      }
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen mensual de horas" })

    const FOOTER_SAFE_SPACE = 42

    const getBottomLimit = (requiredHeight = 0) => {
      return doc.page.height - doc.page.margins.bottom - FOOTER_SAFE_SPACE - requiredHeight
    }

    const ensureSpace = (minHeight = 90) => {
      if (doc.y > getBottomLimit(minHeight)) {
        doc.addPage()
        doc.y = 60
      }
    }

    const drawSectionTitle = (title, minHeight = 90) => {
      ensureSpace(minHeight)
      doc.moveDown(0.5)
      const titleY = doc.y
      doc.font("Helvetica-Bold").fontSize(11.5).fillColor(PDF_COLORS.ink)
      doc.text(title, 45, titleY, {
        width: pageWidth - 90,
        align: "left",
      })
      const lineY = doc.y + 2
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, lineY).lineTo(pageWidth - 45, lineY).stroke()
      doc.y = lineY + 8
    }

    const drawList = (items, leftLabel, rightLabel) => {
      ensureSpace(110)

      const drawTableHeader = () => {
        const headerY = doc.y
        doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
        doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
        doc.text(leftLabel, 55, headerY + 7, { width: 350, align: "left" })
        doc.text(rightLabel, 410, headerY + 7, { width: 120, align: "right" })
        doc.fillColor(PDF_COLORS.ink)
        doc.y = headerY + 22
      }

      drawTableHeader()
      let y = doc.y

      if (!items.length) {
        doc.font("Helvetica").fontSize(10).text("Sin datos para este período", 55, y)
        doc.y = y + 18
        return
      }

      items.forEach((it, idx) => {
        if (y > getBottomLimit(20)) {
          doc.addPage()
          doc.y = 60
          drawTableHeader()
          y = doc.y
        }
        const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, y, pageWidth - 90, 20).fill(bg)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
        doc.text(it.label, 55, y + 6, { width: 350, ellipsis: true, align: "left" })
        doc.text(`${formatHoursAsClock(it.value)} hs`, 410, y + 6, { width: 120, align: "right" })
        y += 20
      })
      doc.y = y + 4
    }

    const drawTransferSummary = (items) => {
      drawSectionTitle("Horas prestadas entre grupos", 140)
      ensureSpace(120)

      const tableX = 45
      const tableWidth = pageWidth - 90
      const horasWidth = 120
      const detalleWidth = tableWidth - horasWidth

      const drawTransferHeader = () => {
        const headerY = doc.y
        doc.rect(tableX, headerY, tableWidth, 24).fill(PDF_COLORS.navy)
        doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
        doc.text("TRANSFERENCIA", tableX + 10, headerY + 8, { width: detalleWidth - 20, align: "left" })
        doc.text("HORAS", tableX + detalleWidth, headerY + 8, { width: horasWidth - 10, align: "right" })
        doc.fillColor(PDF_COLORS.ink)
        doc.y = headerY + 24
      }

      drawTransferHeader()
      let y = doc.y

      if (!items.length) {
        doc.rect(tableX, y, tableWidth, 20).fill(PDF_COLORS.light)
        doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.ink)
        doc.text("Sin horas prestadas entre grupos en este período", tableX + 10, y + 6, { width: tableWidth - 20, align: "left" })
        doc.y = y + 24
        return
      }

      items.forEach((item, idx) => {
        if (y > getBottomLimit(22)) {
          doc.addPage()
          doc.y = 60
          drawSectionTitle("Horas prestadas entre grupos", 140)
          drawTransferHeader()
          y = doc.y
        }
        const bg = idx % 2 === 0 ? "#f8fafc" : "#eef2f7"
        doc.rect(tableX, y, tableWidth, 22).fill(bg)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.4)
        doc.text(`${item.origen} prestó a ${item.destino}`, tableX + 10, y + 7, { width: detalleWidth - 20, align: "left", ellipsis: true })
        doc.font("Helvetica-Bold")
        doc.text(`${formatHoursAsClock(item.horas)} hs`, tableX + detalleWidth, y + 7, { width: horasWidth - 10, align: "right" })
        y += 22
      })
      doc.y = y + 4
    }

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Resumen mensual de horas",
      accentText: `${mesNombre} ${anio}`,
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 15

    const totalHorasMes = horas.reduce((sum, h) => sum + getCantidadHoras(h), 0)
    const totalRegistros = horas.length
    const totalPrestadas = Object.values(prestamosEntreGrupos).reduce((sum, item) => sum + Number(item.horas || 0), 0)

    const resumenY = doc.y
    doc.roundedRect(45, resumenY, pageWidth - 90, 66, 6).fill(PDF_COLORS.card)
    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("REGISTROS", 58, resumenY + 10, { width: 110 })
    doc.text("HORAS PRESTADAS", 250, resumenY + 10, { width: 140 })
    doc.text("TOTAL HORAS DEL MES", 430, resumenY + 10, { width: 110, align: "right" })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(14)
    doc.text(String(totalRegistros), 58, resumenY + 24, { width: 110 })
    doc.text(`${formatHoursAsClock(totalPrestadas)} hs`, 250, resumenY + 24, { width: 140 })
    doc.text(`${formatHoursAsClock(totalHorasMes)} hs`, 430, resumenY + 24, { width: 110, align: "right" })

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, resumenY + 46).lineTo(pageWidth - 58, resumenY + 46).stroke()

    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(9)
    doc.text(`Período seleccionado: ${mesNombre} ${anio}`, 58, resumenY + 51, { width: pageWidth - 116 })
    doc.fillColor(PDF_COLORS.ink)
    doc.y = resumenY + 76

    drawSectionTitle("Horas por empleado")
    drawList(
      Object.entries(resumenEmpleado)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      "EMPLEADO",
      "TOTAL"
    )

    drawSectionTitle("Horas por obra")
    drawList(
      Object.values(resumenObra)
        .map((item) => ({ label: item.label, value: item.value }))
        .sort((a, b) => b.value - a.value),
      "OBRA",
      "TOTAL"
    )

    drawSectionTitle("Horas por grupo")
    drawList(
      Object.entries(resumenGrupo)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      "GRUPO",
      "TOTAL"
    )

    drawTransferSummary(
      Object.values(prestamosEntreGrupos)
        .map((item) => ({
          origen: item.origen,
          destino: item.destino,
          horas: Number(item.horas || 0),
        }))
        .sort((a, b) => b.horas - a.horas)
    )

    doc.end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Listar horas con filtros
router.get("/", async (req, res) => {
  try {
    const { mes, anio, empleado_id, obra_id } = req.query

    let query = db.from("horas").select("*")

    // Filtros opcionales
    if (mes && anio) {
      const inicio = new Date(anio, mes - 1, 1).toISOString().split("T")[0]
      const fin = new Date(anio, mes, 0).toISOString().split("T")[0]
      query = query.gte("fecha", inicio).lte("fecha", fin)
    }

    if (empleado_id) {
      query = query.eq("empleado_id", empleado_id)
    }

    if (obra_id) {
      query = query.eq("obra_id", obra_id)
    }

    const { data, error } = await query.order("fecha", { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear registro de horas
router.post("/", async (req, res) => {
  try {
    const {
      empleado_id,
      cliente_id,
      obra_id,
      fecha,
      hora_inicio,
      hora_fin,
      cantidad_horas,
      cantidad_horas_extra,
      cantidad_horas_extra_50,
      cantidad_horas_extra_100,
      horas_trabajadas,
      es_hora_extra = false,
      tipo_hora_extra,
      observaciones,
      es_prestada = false,
      grupo_origen_id,
      grupo_destino_id
    } = req.body

    // Validar campos obligatorios
    if (!empleado_id || !fecha) {
      return res.status(400).json({
        error: "Empleado y fecha son obligatorios"
      })
    }

    if (isSundayDate(fecha)) {
      return res.status(400).json({ error: "No se pueden registrar horas los domingos" })
    }

    // Resolver obra automáticamente si no viene en el request y el empleado es administrativo
    let clienteIdFinal = normalizeNullableId(cliente_id) ?? null
    let obraIdFinal = normalizeNullableId(obra_id) ?? null
    if (!obraIdFinal && !clienteIdFinal) {
      obraIdFinal = await resolveObraForAdministrativeEmpleado(empleado_id)
    }

    ;({ clienteId: clienteIdFinal, obraId: obraIdFinal } = await resolveClienteObraRelacion({
      clienteId: clienteIdFinal,
      obraId: obraIdFinal,
    }))

    const cantidadNumerica = parseFlexibleNumber(cantidad_horas)
    const tieneCantidadValida = Number.isFinite(cantidadNumerica) && cantidadNumerica > 0

    if (!tieneCantidadValida && (!hora_inicio || !hora_fin)) {
      return res.status(400).json({
        error: "Debe proveer cantidad_horas o ambas hora_inicio y hora_fin"
      })
    }

    let horasComputadas = tieneCantidadValida ? cantidadNumerica : null
    if (!horasComputadas && hora_inicio && hora_fin) {
      const inicio = new Date(`2000-01-01 ${hora_inicio}`)
      const fin = new Date(`2000-01-01 ${hora_fin}`)
      horasComputadas = (fin - inicio) / (1000 * 60 * 60)
    }

    const horasTrabajadasNumericas = parseFlexibleNumber(horas_trabajadas)
    const horasTrabajadasFinal = Number.isFinite(horasTrabajadasNumericas) && horasTrabajadasNumericas > 0
      ? horasTrabajadasNumericas
      : horasComputadas

    if (!Number.isFinite(horasComputadas) || horasComputadas <= 0) {
      return res.status(400).json({ error: "La cantidad de horas debe ser mayor a 0" })
    }

    const {
      horasExtra50,
      horasExtra100,
      horasExtraTotales,
      horasBaseFinal,
    } = resolveHorasExtraDetalle({
      fecha,
      horasComputadas,
      es_hora_extra,
      tipo_hora_extra,
      cantidad_horas_extra,
      cantidad_horas_extra_50,
      cantidad_horas_extra_100,
    })

    const registrosParaInsertar = []

    if (horasExtraTotales === 0 || horasBaseFinal > 0) {
      registrosParaInsertar.push(
        buildHoraPayload({
          empleado_id,
          cliente_id: clienteIdFinal,
          obra_id: obraIdFinal,
          fecha,
          hora_inicio,
          hora_fin,
          horas_trabajadas: horasExtraTotales > 0 ? horasBaseFinal : horasTrabajadasFinal,
          cantidad_horas: horasExtraTotales > 0 ? horasBaseFinal : horasComputadas,
          es_hora_extra: false,
          tipo_hora_extra: null,
          observaciones,
          es_prestada: horasExtraTotales > 0 ? es_prestada : es_prestada,
          grupo_origen_id,
          grupo_destino_id,
        })
      )
    }

    if (horasExtra50 > 0) {
      registrosParaInsertar.push(
        buildHoraPayload({
          empleado_id,
          cliente_id: clienteIdFinal,
          obra_id: obraIdFinal,
          fecha,
          hora_inicio: null,
          hora_fin: null,
          horas_trabajadas: horasExtra50,
          cantidad_horas: horasExtra50,
          es_hora_extra: true,
          tipo_hora_extra: "50",
          observaciones,
          es_prestada: false,
          grupo_origen_id: null,
          grupo_destino_id: null,
        })
      )
    }

    if (horasExtra100 > 0) {
      registrosParaInsertar.push(
        buildHoraPayload({
          empleado_id,
          cliente_id: clienteIdFinal,
          obra_id: obraIdFinal,
          fecha,
          hora_inicio: null,
          hora_fin: null,
          horas_trabajadas: horasExtra100,
          cantidad_horas: horasExtra100,
          es_hora_extra: true,
          tipo_hora_extra: "100",
          observaciones,
          es_prestada: false,
          grupo_origen_id: null,
          grupo_destino_id: null,
        })
      )
    }

    const { data, error } = await db
      .from("horas")
      .insert(registrosParaInsertar)
      .select("*")

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('horas:changed')
    // Guardar/actualizar resumen mensual
    const fechaObj = new Date((data?.[0] || {}).fecha || fecha)
    const mes = fechaObj.getMonth() + 1
    const anio = fechaObj.getFullYear()
    await saveResumenHorasMes(mes, anio)
    res.status(201).json(registrosParaInsertar.length === 1 ? (data?.[0] || null) : { registros: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar registro de horas
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const {
      empleado_id,
      cliente_id,
      obra_id,
      fecha,
      hora_inicio,
      hora_fin,
      cantidad_horas,
      cantidad_horas_extra,
      cantidad_horas_extra_50,
      cantidad_horas_extra_100,
      horas_trabajadas,
      es_hora_extra,
      tipo_hora_extra,
      observaciones,
      es_prestada,
      grupo_origen_id,
      grupo_destino_id
    } = req.body

    const { data: actual, error: actualError } = await db
      .from("horas")
      .select("id, empleado_id, obra_id, cliente_id, fecha")
      .eq("id", id)
      .single()

    if (actualError || !actual) {
      return res.status(404).json({ error: "Registro de horas no encontrado" })
    }

    const empleadoIdResolved = empleado_id || actual.empleado_id
    let clienteIdResolved = cliente_id !== undefined ? normalizeNullableId(cliente_id) : actual.cliente_id
    let obraIdResolved = obra_id !== undefined ? (obra_id || null) : actual.obra_id

    // Si no hay obra, intentar resolver automáticamente para empleados administrativos
    if (!obraIdResolved && !clienteIdResolved) {
      obraIdResolved = await resolveObraForAdministrativeEmpleado(empleadoIdResolved)
    }

    ;({ clienteId: clienteIdResolved, obraId: obraIdResolved } = await resolveClienteObraRelacion({
      clienteId: clienteIdResolved,
      obraId: normalizeNullableId(obraIdResolved),
    }))

    const cantidadNumerica = parseFlexibleNumber(cantidad_horas)
    const tieneCantidadValida = Number.isFinite(cantidadNumerica) && cantidadNumerica > 0
    let horasComputadas = tieneCantidadValida ? cantidadNumerica : null

    if (!horasComputadas && hora_inicio && hora_fin) {
      const inicio = new Date(`2000-01-01 ${hora_inicio}`)
      const fin = new Date(`2000-01-01 ${hora_fin}`)
      horasComputadas = (fin - inicio) / (1000 * 60 * 60)
    }

    const horasTrabajadasNumericas = parseFlexibleNumber(horas_trabajadas)
    const horasTrabajadasFinal = Number.isFinite(horasTrabajadasNumericas) && horasTrabajadasNumericas > 0
      ? horasTrabajadasNumericas
      : horasComputadas

    if (!Number.isFinite(horasComputadas) || horasComputadas <= 0) {
      return res.status(400).json({ error: "Debe proveer cantidad_horas válida o ambas horas (inicio/fin)" })
    }

    const fechaResolved = fecha || actual.fecha

    if (isSundayDate(fechaResolved)) {
      return res.status(400).json({ error: "No se pueden registrar horas los domingos" })
    }

    const {
      horasExtra50,
      horasExtra100,
      horasExtraTotales,
      horasBaseFinal,
    } = resolveHorasExtraDetalle({
      fecha: fechaResolved,
      horasComputadas,
      es_hora_extra,
      tipo_hora_extra,
      cantidad_horas_extra,
      cantidad_horas_extra_50,
      cantidad_horas_extra_100,
    })

    const payloadsToPersist = []

    if (horasExtraTotales === 0 || horasBaseFinal > 0) {
      payloadsToPersist.push(
        buildHoraPayload({
          empleado_id: empleadoIdResolved,
          cliente_id: clienteIdResolved,
          obra_id: obraIdResolved,
          fecha: fechaResolved,
          hora_inicio,
          hora_fin,
          horas_trabajadas: horasExtraTotales > 0 ? horasBaseFinal : horasTrabajadasFinal,
          cantidad_horas: horasExtraTotales > 0 ? horasBaseFinal : horasComputadas,
          es_hora_extra: false,
          tipo_hora_extra: null,
          observaciones: observaciones !== undefined ? String(observaciones || "").trim() : undefined,
          es_prestada: es_prestada,
          grupo_origen_id,
          grupo_destino_id,
        })
      )
    }

    if (horasExtra50 > 0) {
      payloadsToPersist.push(
        buildHoraPayload({
          empleado_id: empleadoIdResolved,
          cliente_id: clienteIdResolved,
          obra_id: obraIdResolved,
          fecha: fechaResolved,
          hora_inicio: null,
          hora_fin: null,
          horas_trabajadas: horasExtra50,
          cantidad_horas: horasExtra50,
          es_hora_extra: true,
          tipo_hora_extra: "50",
          observaciones: observaciones !== undefined ? String(observaciones || "").trim() : undefined,
          es_prestada: false,
          grupo_origen_id: null,
          grupo_destino_id: null,
        })
      )
    }

    if (horasExtra100 > 0) {
      payloadsToPersist.push(
        buildHoraPayload({
          empleado_id: empleadoIdResolved,
          cliente_id: clienteIdResolved,
          obra_id: obraIdResolved,
          fecha: fechaResolved,
          hora_inicio: null,
          hora_fin: null,
          horas_trabajadas: horasExtra100,
          cantidad_horas: horasExtra100,
          es_hora_extra: true,
          tipo_hora_extra: "100",
          observaciones: observaciones !== undefined ? String(observaciones || "").trim() : undefined,
          es_prestada: false,
          grupo_origen_id: null,
          grupo_destino_id: null,
        })
      )
    }

    let data = null
    let error = null

    const [payloadPrincipal, ...payloadsAdicionales] = payloadsToPersist

    const updateResult = await db
      .from("horas")
      .update(payloadPrincipal)
      .eq("id", id)
      .select("*")
      .single()

    data = updateResult.data
    error = updateResult.error
    if (error) return res.status(400).json({ error: error.message })

    if (payloadsAdicionales.length > 0) {
      const { error: insertError } = await db
        .from("horas")
        .insert(payloadsAdicionales)
        .select("*")

      if (insertError) return res.status(400).json({ error: insertError.message })
    }

    getIo()?.emit('horas:changed')
    // Guardar/actualizar resumen mensual
    const fechaObj = new Date(data.fecha)
    const mes = fechaObj.getMonth() + 1
    const anio = fechaObj.getFullYear()
    await saveResumenHorasMes(mes, anio)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar registro de horas
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Obtener la fecha antes de eliminar
    const { data: horaData, error: errorGet } = await db.from("horas").select("fecha").eq("id", id).single();
    const { data, error } = await db.from("horas").delete().eq("id", id).select().single()

    if (error) return res.status(400).json({ error: error.message })
    // Actualizar resumen mensual si se obtuvo la fecha
    if (horaData && horaData.fecha) {
      const fechaObj = new Date(horaData.fecha);
      const mes = fechaObj.getMonth() + 1;
      const anio = fechaObj.getFullYear();
      await saveResumenHorasMes(mes, anio);
    }
    getIo()?.emit('horas:changed')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Resumen de horas por empleado
router.get("/resumen/empleado", async (req, res) => {
  try {
    const { mes, anio } = req.query

    let query = db.from("horas").select("*")

    if (mes && anio) {
      const mesInt = parseInt(mes)
      const anoInt = parseInt(anio)
      const inicio = new Date(anoInt, mesInt - 1, 1).toISOString().split("T")[0]
      const fin = new Date(anoInt, mesInt, 0).toISOString().split("T")[0]
      query = query.gte("fecha", inicio).lte("fecha", fin)
    }

    const { data: horasData, error: horasError } = await query

    if (horasError) return res.status(400).json({ error: horasError.message })
    if (!horasData || horasData.length === 0) return res.json([])

    // Obtener empleados para mapear nombres
    const { data: empleadosData } = await db.from("empleados").select("id, nombre, apellido")

    // Agrupar por empleado
    const resumen = {}
    horasData.forEach((h) => {
      if (!resumen[h.empleado_id]) {
        const emp = empleadosData?.find((e) => e.id === h.empleado_id)
        const nombreCompleto = emp ? `${emp.nombre} ${emp.apellido}` : `Empleado ${h.empleado_id}`
        resumen[h.empleado_id] = { empleado: nombreCompleto, total_horas: 0 }
      }
      resumen[h.empleado_id].total_horas += getCantidadHoras(h)
    })

    const resultado = Object.values(resumen).sort((a, b) => b.total_horas - a.total_horas)

    res.json(resultado)
  } catch (err) {
    console.error("Error en resumen/empleado:", err)
    res.status(500).json({ error: err.message })
  }
})

// Resumen de horas por obra
router.get("/resumen/obra", async (req, res) => {
  try {
    const { mes, anio } = req.query

    let query = db.from("horas").select("*")

    if (mes && anio) {
      const mesInt = parseInt(mes)
      const anoInt = parseInt(anio)
      const inicio = new Date(anoInt, mesInt - 1, 1).toISOString().split("T")[0]
      const fin = new Date(anoInt, mesInt, 0).toISOString().split("T")[0]
      query = query.gte("fecha", inicio).lte("fecha", fin)
    }

    const { data, error } = await query

    if (error) return res.status(400).json({ error: error.message })

    const [obrasDataRes, empleadosDataRes, gruposDataRes, clientesDataRes] = await Promise.all([
      db.from("obras").select("id, nombre, grupo_id"),
      db.from("empleados").select("id, grupo_id"),
      db.from("grupos").select("id, nombre"),
      db.from("clientes").select("id, empresa, razon_social")
    ])

    const obrasData = obrasDataRes.data || []
    const empleadosData = empleadosDataRes.data || []
    const gruposData = gruposDataRes.data || []
    const clientesData = clientesDataRes.data || []

    // Agrupar manualmente por obra, pero las horas del grupo administrativo van a "Administracion"
    const resumen = {}
    data.forEach((h) => {
      const empleado = empleadosData.find((e) => e.id === h.empleado_id)
      const grupoEmpleado = gruposData.find((g) => g.id === empleado?.grupo_id)
      const esAdministrativo = /admin/i.test(String(grupoEmpleado?.nombre || ""))

      const cliente = clientesData.find((c) => c.id === h.cliente_id)
      const clienteNombre = cliente?.empresa || cliente?.razon_social || "Sin cliente"

      const claveResumen = esAdministrativo
        ? "administracion"
        : (h.obra_id
          ? `obra_${h.obra_id}`
          : (h.cliente_id ? `cliente_${h.cliente_id}` : "sin_obra"))
      if (!resumen[claveResumen]) {
        resumen[claveResumen] = {
          obra_id: esAdministrativo ? null : (h.obra_id ? Number(h.obra_id) : null),
          obra_nombre: esAdministrativo
            ? "Administracion"
            : (h.obra_id
              ? (obrasData.find((o) => o.id === h.obra_id)?.nombre || "Sin obra")
              : (h.cliente_id ? clienteNombre : "Sin obra")),
          total_horas: 0
        }
      }
      resumen[claveResumen].total_horas += getCantidadHoras(h)
    })

    const resultado = Object.values(resumen).sort((a, b) => Number(b.total_horas || 0) - Number(a.total_horas || 0))

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Resumen de horas por grupo
router.get("/resumen/grupo", async (req, res) => {
  try {
    const { mes, anio } = req.query

    let query = db.from("horas").select("*")

    if (mes && anio) {
      const mesInt = parseInt(mes)
      const anoInt = parseInt(anio)
      const inicio = new Date(anoInt, mesInt - 1, 1).toISOString().split("T")[0]
      const fin = new Date(anoInt, mesInt, 0).toISOString().split("T")[0]
      query = query.gte("fecha", inicio).lte("fecha", fin)
    }

    const { data: horasData, error: horasError } = await query

    if (horasError) return res.status(400).json({ error: horasError.message })
    if (!horasData || horasData.length === 0) return res.json([])

    // Obtener obras y empleados para mapear grupo
    const [{ data: obrasData }, { data: empleadosData }] = await Promise.all([
      db.from("obras").select("id, grupo_id"),
      db.from("empleados").select("id, grupo_id"),
    ])

    // Agrupar por grupo (obra primero, grupo del empleado como fallback)
    const resumen = {}
    horasData.forEach((h) => {
      const { grupoId } = resolveGrupoForHora({
        hora: h,
        obras: obrasData || [],
        empleados: empleadosData || [],
        grupos: [],
      })

      if (grupoId) {
        if (!resumen[grupoId]) {
          resumen[grupoId] = 0
        }
        resumen[grupoId] += getCantidadHoras(h)
      }
    })

    const resultado = Object.entries(resumen).map(([grupoId, totalHoras]) => ({
      grupo_id: Number(grupoId),
      total_horas: totalHoras
    })).sort((a, b) => Number(b.total_horas || 0) - Number(a.total_horas || 0))

    res.json(resultado)
  } catch (err) {
    console.error("Error en resumen/grupo:", err)
    res.status(500).json({ error: err.message })
  }
})

// Resumen de horas prestadas
router.get("/resumen/prestadas", async (req, res) => {
  try {
    const { mes, anio } = req.query

    let query = db.from("horas").select("*")

    if (mes && anio) {
      const mesInt = parseInt(mes)
      const anoInt = parseInt(anio)
      const inicio = new Date(anoInt, mesInt - 1, 1).toISOString().split("T")[0]
      const fin = new Date(anoInt, mesInt, 0).toISOString().split("T")[0]
      query = query.gte("fecha", inicio).lte("fecha", fin)
    }

    let horasData = []
    let horasError = null

    ;({ data: horasData, error: horasError } = await query.eq("es_prestada", true).order("fecha", { ascending: false }))

    if (horasError && String(horasError.message || "").toLowerCase().includes("es_prestada")) {
      return res.json([])
    }

    if (horasError) return res.status(400).json({ error: horasError.message })
    if (!horasData || horasData.length === 0) return res.json([])

    // Obtener datos relacionados
    const { data: empleadosData } = await db.from("empleados").select("id, nombre, apellido")
    const { data: gruposData } = await db.from("grupos").select("id, nombre")

    // Mapear con nombres completos
    const resultado = horasData.map((h) => {
      const empleado = empleadosData?.find((e) => e.id === h.empleado_id)
      const grupoOrigen = gruposData?.find((g) => g.id === h.grupo_origen_id)
      const grupoDestino = gruposData?.find((g) => g.id === h.grupo_destino_id)

      return {
        empleado: empleado ? `${empleado.nombre} ${empleado.apellido}` : `Empleado ${h.empleado_id}`,
        grupo_origen: grupoOrigen?.nombre || "Sin grupo origen",
        grupo_destino: grupoDestino?.nombre || "Sin grupo destino",
        cantidad_horas: getCantidadHoras(h),
        fecha: h.fecha
      }
    })

    res.json(resultado)
  } catch (err) {
    console.error("Error en resumen/prestadas:", err)
    res.status(500).json({ error: err.message })
  }
})

export default router
