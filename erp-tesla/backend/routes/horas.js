import express from "express"
import db from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js"

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")

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

    const [empleadosRes, obrasRes, gruposRes] = await Promise.all([
      db.from("empleados").select("id, nombre, apellido"),
      db.from("obras").select("id, nombre, grupo_id"),
      db.from("grupos").select("id, nombre")
    ])

    const empleadosData = empleadosRes.data || []
    const obrasData = obrasRes.data || []
    const gruposData = gruposRes.data || []
    const horas = horasData || []

    const resumenEmpleado = {}
    const resumenObra = {}
    const resumenGrupo = {}
    const prestadasDetalle = []
    const prestamosEntreGrupos = {}

    horas.forEach((h) => {
      const hs = getCantidadHoras(h)

      const emp = empleadosData.find((e) => e.id === h.empleado_id)
      const obra = obrasData.find((o) => o.id === h.obra_id)
      const grupo = gruposData.find((g) => g.id === obra?.grupo_id)

      const empLabel = emp ? `${emp.nombre} ${emp.apellido}` : `Empleado ${h.empleado_id}`
      const obraLabel = isAdministrativeObra(obra, gruposData) ? "Administración" : (obra?.nombre || "Obra sin nombre")
      const grupoLabel = grupo?.nombre || "Sin grupo"

      if (!resumenEmpleado[empLabel]) resumenEmpleado[empLabel] = 0
      if (!resumenObra[obraLabel]) resumenObra[obraLabel] = 0
      if (!resumenGrupo[grupoLabel]) resumenGrupo[grupoLabel] = 0

      resumenEmpleado[empLabel] += hs
      resumenObra[obraLabel] += hs
      resumenGrupo[grupoLabel] += hs

      const esPrestada = h.es_prestada === true || String(h.tipo || "").toLowerCase() === "prestada"
      if (esPrestada) {
        const grupoOrigen = gruposData.find((g) => g.id === h.grupo_origen_id)?.nombre || "Sin grupo origen"
        const grupoDestino = gruposData.find((g) => g.id === h.grupo_destino_id)?.nombre || "Sin grupo destino"

        prestadasDetalle.push({
          empleado: empLabel,
          grupo_origen: grupoOrigen,
          grupo_destino: grupoDestino,
          fecha: h.fecha,
          horas: hs
        })

        const key = `${grupoOrigen}|||${grupoDestino}`
        if (!prestamosEntreGrupos[key]) prestamosEntreGrupos[key] = 0
        prestamosEntreGrupos[key] += hs
      }
    })

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const mesesNombre = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
    const mesNombre = mesesNombre[Math.max(0, Number(mes) - 1)] || `Mes ${mes}`
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const nombreArchivo = `Resumen Horas ${sanitizeFileText(mesNombre)} ${sanitizeFileText(anio)} ${fechaArchivo}.pdf`
    const pageWidth = doc.page.width

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen mensual de horas" })

    const drawSectionTitle = (title) => {
      drawPremiumSectionTitle(doc, title)
    }

    const drawList = (items, leftLabel, rightLabel) => {
      if (doc.y > doc.page.height - 110) doc.addPage()

      const drawTableHeader = () => {
        const headerY = doc.y
        doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
        doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
        doc.text(leftLabel, 55, headerY + 7, { width: 350 })
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
        if (y > doc.page.height - 70) {
          doc.addPage()
          doc.y = 60
          drawTableHeader()
          y = doc.y
        }
        const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, y, pageWidth - 90, 20).fill(bg)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
        doc.text(it.label, 55, y + 6, { width: 350, ellipsis: true })
        doc.text(`${it.value.toFixed(2)} hs`, 410, y + 6, { width: 120, align: "right" })
        y += 20
      })
      doc.y = y + 2
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
    const totalPrestadas = prestadasDetalle.reduce((sum, p) => sum + p.horas, 0)

    const resumenY = doc.y
    doc.roundedRect(45, resumenY, pageWidth - 90, 66, 6).fill(PDF_COLORS.card)
    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("REGISTROS", 58, resumenY + 10, { width: 110 })
    doc.text("HORAS PRESTADAS", 250, resumenY + 10, { width: 140 })
    doc.text("TOTAL HORAS DEL MES", 430, resumenY + 10, { width: 110, align: "right" })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(14)
    doc.text(String(totalRegistros), 58, resumenY + 24, { width: 110 })
    doc.text(`${totalPrestadas.toFixed(2)} hs`, 250, resumenY + 24, { width: 140 })
    doc.text(`${totalHorasMes.toFixed(2)} hs`, 430, resumenY + 24, { width: 110, align: "right" })

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
      Object.entries(resumenObra)
        .map(([label, value]) => ({ label, value }))
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

    drawSectionTitle("Detalle de horas prestadas")
    drawList(
      prestadasDetalle
        .map((p) => ({
          label: `${p.grupo_origen} -> ${p.grupo_destino} (${new Date(p.fecha).toLocaleDateString("es-AR")})`,
          value: p.horas
        }))
        .sort((a, b) => b.value - a.value),
      "DETALLE",
      "HORAS"
    )

    drawSectionTitle("Resumen entre grupos")
    drawList(
      Object.entries(prestamosEntreGrupos)
        .map(([key, value]) => {
          const [origen, destino] = key.split("|||")
          return { label: `${origen} prestó horas a ${destino}`, value }
        })
        .sort((a, b) => b.value - a.value),
      "TRANSFERENCIA",
      "HORAS"
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
      obra_id,
      fecha,
      hora_inicio,
      hora_fin,
      cantidad_horas,
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

    // Resolver obra automáticamente si no viene en el request y el empleado es administrativo
    let obraIdFinal = obra_id || null
    if (!obraIdFinal) {
      obraIdFinal = await resolveObraForAdministrativeEmpleado(empleado_id)
    }

    const cantidadNumerica = Number(cantidad_horas)
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

    const horasTrabajadasNumericas = Number(horas_trabajadas)
    const horasTrabajadasFinal = Number.isFinite(horasTrabajadasNumericas) && horasTrabajadasNumericas > 0
      ? horasTrabajadasNumericas
      : horasComputadas

    if (!Number.isFinite(horasComputadas) || horasComputadas <= 0) {
      return res.status(400).json({ error: "La cantidad de horas debe ser mayor a 0" })
    }

    const esHoraExtraFinal = es_hora_extra === true || normalizeTipoHoraExtra(tipo_hora_extra) !== null
    const tipoHoraExtraFinal = esHoraExtraFinal ? (normalizeTipoHoraExtra(tipo_hora_extra) || "50") : null

    const { data, error } = await db
      .from("horas")
      .insert([
        {
          empleado_id,
          obra_id: obraIdFinal,
          fecha,
          hora_inicio,
          hora_fin,
          horas_trabajadas: parseFloat(horasTrabajadasFinal),
          cantidad_horas: parseFloat(horasComputadas),
          es_hora_extra: esHoraExtraFinal,
          tipo_hora_extra: tipoHoraExtraFinal,
          observaciones: String(observaciones || "").trim(),
          es_prestada,
          tipo: getTipoHora({ es_hora_extra: esHoraExtraFinal, tipo_hora_extra: tipoHoraExtraFinal, es_prestada }),
          grupo_origen_id: es_prestada ? grupo_origen_id : null,
          grupo_destino_id: es_prestada ? grupo_destino_id : null
        }
      ])
      .select("*")
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('horas:changed')
    res.status(201).json(data)
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
      obra_id,
      fecha,
      hora_inicio,
      hora_fin,
      cantidad_horas,
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
      .select("id, empleado_id, obra_id")
      .eq("id", id)
      .single()

    if (actualError || !actual) {
      return res.status(404).json({ error: "Registro de horas no encontrado" })
    }

    const empleadoIdResolved = empleado_id || actual.empleado_id
    let obraIdResolved = obra_id !== undefined ? (obra_id || null) : actual.obra_id

    // Si no hay obra, intentar resolver automáticamente para empleados administrativos
    if (!obraIdResolved) {
      obraIdResolved = await resolveObraForAdministrativeEmpleado(empleadoIdResolved)
    }

    const cantidadNumerica = Number(cantidad_horas)
    const tieneCantidadValida = Number.isFinite(cantidadNumerica) && cantidadNumerica > 0
    let horasComputadas = tieneCantidadValida ? cantidadNumerica : null

    if (!horasComputadas && hora_inicio && hora_fin) {
      const inicio = new Date(`2000-01-01 ${hora_inicio}`)
      const fin = new Date(`2000-01-01 ${hora_fin}`)
      horasComputadas = (fin - inicio) / (1000 * 60 * 60)
    }

    const horasTrabajadasNumericas = Number(horas_trabajadas)
    const horasTrabajadasFinal = Number.isFinite(horasTrabajadasNumericas) && horasTrabajadasNumericas > 0
      ? horasTrabajadasNumericas
      : horasComputadas

    if (!Number.isFinite(horasComputadas) || horasComputadas <= 0) {
      return res.status(400).json({ error: "Debe proveer cantidad_horas válida o ambas horas (inicio/fin)" })
    }

    const esHoraExtraFinal = es_hora_extra === true || normalizeTipoHoraExtra(tipo_hora_extra) !== null
    const tipoHoraExtraFinal = esHoraExtraFinal ? (normalizeTipoHoraExtra(tipo_hora_extra) || "50") : null

    const { data, error } = await db
      .from("horas")
      .update({
        empleado_id: empleadoIdResolved,
        obra_id: obraIdResolved,
        fecha,
        hora_inicio,
        hora_fin,
        horas_trabajadas: parseFloat(horasTrabajadasFinal),
        cantidad_horas: parseFloat(horasComputadas),
        es_hora_extra: esHoraExtraFinal,
        tipo_hora_extra: tipoHoraExtraFinal,
        observaciones: observaciones !== undefined ? String(observaciones || "").trim() : undefined,
        es_prestada,
        tipo: getTipoHora({ es_hora_extra: esHoraExtraFinal, tipo_hora_extra: tipoHoraExtraFinal, es_prestada }),
        grupo_origen_id: es_prestada ? grupo_origen_id : null,
        grupo_destino_id: es_prestada ? grupo_destino_id : null
      })
      .eq("id", id)
      .select("*")
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('horas:changed')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar registro de horas
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db.from("horas").delete().eq("id", id).select().single()

    if (error) return res.status(400).json({ error: error.message })
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

    const [obrasDataRes, empleadosDataRes, gruposDataRes] = await Promise.all([
      db.from("obras").select("id, nombre, grupo_id"),
      db.from("empleados").select("id, grupo_id"),
      db.from("grupos").select("id, nombre")
    ])

    const obrasData = obrasDataRes.data || []
    const empleadosData = empleadosDataRes.data || []
    const gruposData = gruposDataRes.data || []

    // Agrupar manualmente por obra, pero las horas del grupo administrativo van a "Administración"
    const resumen = {}
    data.forEach((h) => {
      const empleado = empleadosData.find((e) => e.id === h.empleado_id)
      const grupoEmpleado = gruposData.find((g) => g.id === empleado?.grupo_id)
      const esAdministrativo = /admin/i.test(String(grupoEmpleado?.nombre || ""))

      const claveResumen = esAdministrativo ? "administracion" : String(h.obra_id || "sin_obra")
      if (!resumen[claveResumen]) {
        resumen[claveResumen] = {
          obra_id: esAdministrativo ? null : (h.obra_id ? Number(h.obra_id) : null),
          obra_nombre: esAdministrativo
            ? "Administración"
            : (obrasData.find((o) => o.id === h.obra_id)?.nombre || "Sin obra"),
          total_horas: 0
        }
      }
      resumen[claveResumen].total_horas += getCantidadHoras(h)
    })

    const resultado = Object.values(resumen)

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

    // Obtener obras para mapear grupo
    const { data: obrasData } = await db.from("obras").select("id, grupo_id")

    // Agrupar por grupo
    const resumen = {}
    horasData.forEach((h) => {
      const obra = obrasData?.find((o) => o.id === h.obra_id)
      const grupoId = obra?.grupo_id

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
    }))

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
