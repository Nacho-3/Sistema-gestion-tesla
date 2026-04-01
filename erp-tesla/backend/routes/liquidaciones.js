import express from "express"
import fs from "fs/promises"
// import path from "path" (duplicado eliminado)
import db from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, sanitizeFileText, PDF_COLORS } from "../pdf/premiumTheme.js"

const router = express.Router()

// === SUELDOS TXT EXPORT ===
const SUELDOS_BASE_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "Sueldos")
async function saveSueldoTxtPorEmpleadoMes(mes, anio) {
  try {
    await fs.mkdir(SUELDOS_BASE_FOLDER, { recursive: true })
    const { inicioISO, finISO } = getPeriodo(mes, anio)
    // Obtener liquidaciones y empleados
    const [{ data: liquidaciones }, { data: empleados }, { data: pagos }] = await Promise.all([
      db.from("liquidaciones").select("*",).gte("periodo_inicio", inicioISO).lte("periodo_fin", finISO),
      db.from("empleados").select("id, nombre, apellido"),
      db.from("pagos_sueldo").select("*"),
    ])
    if (!liquidaciones || !empleados) return
    // Agrupar pagos por liquidacion
    const pagosPorLiq = {}
    for (const p of pagos || []) {
      if (!pagosPorLiq[p.liquidacion_id]) pagosPorLiq[p.liquidacion_id] = []
      pagosPorLiq[p.liquidacion_id].push(p)
    }
    // Por cada empleado, generar archivo
    for (const emp of empleados) {
      const liq = (liquidaciones || []).find(l => l.empleado_id === emp.id)
      if (!liq) continue
      const pagosEmp = pagosPorLiq[liq.id] || []
      const nombreEmp = `${emp.nombre || ''} ${emp.apellido || ''}`.trim() || `Empleado_${emp.id}`
      const nombreArchivo = `${nombreEmp.replace(/[^a-zA-Z0-9_\- ]/g, "_")}.txt`
      const subfolder = path.join(SUELDOS_BASE_FOLDER, `${anio}_${String(mes).padStart(2, "0")}`)
      await fs.mkdir(subfolder, { recursive: true })
      let content = `Liquidación de sueldo - ${nombreEmp}\nMes: ${mes}/${anio}\n\n`
      content += `Total neto: $${liq.monto_neto}\nEstado: ${liq.estado}\n\n`
      content += `--- Pagos ---\n`
      if (pagosEmp.length === 0) {
        content += `  Sin pagos registrados\n`
      } else {
        for (const p of pagosEmp) {
          content += `  - ${p.fecha_pago || p.created_at || ""}: $${p.monto} (${p.medio_pago || "-"})\n`
        }
      }
      content += `\n--- Detalle ---\n`
      content += `  Horas: ${liq.total_horas}\n  Valor hora: $${liq.valor_hora}\n  Importe horas: $${liq.importe_horas}\n  Presentismo: $${liq.presentismo}\n  Horas extra 50%: $${liq.importe_horas_extra}\n  Horas extra 100%: $${liq.importe_horas_extra_100}\n  No remunerativo: $${liq.no_remunerativo}\n  Aguinaldo: $${liq.aguinaldo}\n  Vacaciones: $${liq.vacaciones}\n  Feriados: $${liq.importe_feriados}\n  Adelantos: $${liq.adelantos}\n  Días no trabajados: $${liq.dias_no_trabajados}\n  Descuento días no trabajados: $${liq.descuento_dias_no_trabajados}\n  Adicional: $${liq.adicional}\n\n  Observaciones: ${liq.observaciones || ""}\n`
      const filePath = path.join(subfolder, nombreArchivo)
      await fs.writeFile(filePath, content)
    }
  } catch (err) {
    console.error("[SUELDOS TXT] Error exportando sueldos:", err.message)
  }
}

const triggerSueldoTxtExport = (mes, anio) => {
  const mesNum = Number(mes)
  const anioNum = Number(anio)

  if (!Number.isInteger(mesNum) || !Number.isInteger(anioNum) || mesNum < 1 || mesNum > 12) return

  setTimeout(() => {
    saveSueldoTxtPorEmpleadoMes(mesNum, anioNum).catch((err) => {
      console.error(`[SUELDOS TXT] Error exportando ${mesNum}/${anioNum}:`, err.message)
    })
  }, 0)
}

const triggerSueldoTxtExportFromPeriodo = (periodoInicio) => {
  if (!periodoInicio) return

  const periodo = new Date(periodoInicio)
  if (Number.isNaN(periodo.getTime())) return

  triggerSueldoTxtExport(periodo.getMonth() + 1, periodo.getFullYear())
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PRESUPUESTO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")
const PDF_LOGO_PATH = path.resolve(LOGO_PRESUPUESTO_PATH)

const getPeriodo = (mes, anio) => {
  const mesInt = parseInt(mes)
  const anioInt = parseInt(anio)
  const inicio = new Date(anioInt, mesInt - 1, 1)
  const fin = new Date(anioInt, mesInt, 0)
  return {
    mesInt,
    anioInt,
    inicioISO: inicio.toISOString().split("T")[0],
    finISO: fin.toISOString().split("T")[0],
  }
}

const roundMoney = (valor) => {
  const numero = Number(valor)
  if (!Number.isFinite(numero)) return 0
  return Math.round(numero * 100) / 100
}

const parseObservacionesData = (observacionesRaw) => {
  const raw = String(observacionesRaw || "").trim()
  if (!raw) return { nota: "", meta: {} }

  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.__liquidacion_meta === true && typeof parsed === "object") {
      return {
        nota: String(parsed.nota || ""),
        meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {},
      }
    }
  } catch {
    // Si no es JSON, se interpreta como nota legacy
  }

  return { nota: raw, meta: {} }
}

const buildObservacionesData = (nota = "", meta = {}) => JSON.stringify({
  __liquidacion_meta: true,
  nota: String(nota || ""),
  meta,
})

const getLiquidacionMeta = (liq = {}) => parseObservacionesData(liq?.observaciones).meta || {}

const getHorasComputadas = (registro = {}) => {
  const valor =
    registro.cantidad_horas ??
    registro.horas_trabajadas ??
    registro.cantidad_hora ??
    registro.horas ??
    0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const getHorasTrabajadas = (registro = {}) => {
  const valor =
    registro.horas_trabajadas ??
    registro.cantidad_horas ??
    registro.cantidad_hora ??
    registro.horas ??
    0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const getConceptosFromLiquidacion = (liq = {}, valorHora = 0) => {
  const { meta } = parseObservacionesData(liq?.observaciones)

  const preferColumn = (columnValue, metaValue, fallback = 0) => {
    const hasColumn = columnValue !== undefined && columnValue !== null && columnValue !== ""
    const hasMeta = metaValue !== undefined && metaValue !== null && metaValue !== ""

    // Compatibilidad: si la columna quedó en 0 tras migración pero el valor legacy existe en meta,
    // usar meta para no perder conceptos históricos.
    if (hasColumn) {
      const col = roundMoney(columnValue)
      const met = hasMeta ? roundMoney(metaValue) : null
      if (col === 0 && hasMeta && met !== 0) {
        return met
      }
      return col
    }
    if (hasMeta) {
      return roundMoney(metaValue)
    }
    return roundMoney(fallback)
  }

  const presentismo = preferColumn(liq.presentismo, meta.presentismo)
  const noRemunerativo = preferColumn(liq.no_remunerativo, meta.no_remunerativo)
  const aguinaldo = preferColumn(liq.aguinaldo, meta.aguinaldo)
  const vacaciones = preferColumn(liq.vacaciones, meta.vacaciones)
  const adelantos = preferColumn(liq.adelantos, meta.adelantos, liq?.descuentos)
  const horasExtraCantidad = preferColumn(liq.horas_extra_cantidad, meta.horas_extra_cantidad)
  const horasExtra100Cantidad = preferColumn(liq.horas_extra_100_cantidad, meta.horas_extra_100_cantidad)
  const feriadosCantidad = preferColumn(liq.feriados_cantidad, meta.feriados_cantidad)
  const diasNoTrabajados = preferColumn(liq.dias_no_trabajados, meta.dias_no_trabajados)
  // Treat `adicional` as a standard column (fallback to 0). Do not prefer legacy meta.
  const adicional = roundMoney(liq.adicional ?? 0)

  const importeHorasExtra = roundMoney(horasExtraCantidad * valorHora * 1.5)
  const importeHorasExtra100 = roundMoney(horasExtra100Cantidad * valorHora * 2)
  const importeFeriados = roundMoney(feriadosCantidad * 8 * valorHora)
  const descuentoDiasNoTrabajados = roundMoney(diasNoTrabajados * 8 * valorHora)

  return {
    presentismo,
    no_remunerativo: noRemunerativo,
    aguinaldo,
    vacaciones,
    adelantos,
    horas_extra_cantidad: horasExtraCantidad,
    horas_extra_100_cantidad: horasExtra100Cantidad,
    feriados_cantidad: feriadosCantidad,
    dias_no_trabajados: diasNoTrabajados,
    importe_horas_extra: importeHorasExtra,
    importe_horas_extra_100: importeHorasExtra100,
    importe_feriados: importeFeriados,
    descuento_dias_no_trabajados: descuentoDiasNoTrabajados,
    adicional,
  }
}

const mapLiquidacion = (liq, totalPagado = 0) => {
  const periodo = liq?.periodo_inicio ? new Date(liq.periodo_inicio) : null
  const mes = periodo ? periodo.getMonth() + 1 : null
  const anio = periodo ? periodo.getFullYear() : null
  const { nota, meta } = parseObservacionesData(liq?.observaciones)
  const importeHoras = Number(liq?.monto_bruto ?? 0)
  const totalHoras = Number(liq?.total_horas ?? 0)
  const valorHora = totalHoras > 0 ? importeHoras / totalHoras : 0
  const horasTrabajadasReales = roundMoney(meta?.horas_trabajadas_reales ?? totalHoras)
  const conceptos = getConceptosFromLiquidacion(liq, valorHora)
  const totalCalculado =
    importeHoras +
    conceptos.presentismo +
    conceptos.no_remunerativo +
    conceptos.aguinaldo +
    conceptos.vacaciones +
    conceptos.importe_horas_extra +
    conceptos.importe_horas_extra_100 +
    conceptos.importe_feriados +
    conceptos.adicional -
    conceptos.adelantos -
    conceptos.descuento_dias_no_trabajados
  const total = Number(liq?.monto_neto ?? totalCalculado)
  const estado = totalPagado >= total ? "pagada" : "pendiente"

  return {
    ...liq,
    mes,
    anio,
    horas_computadas: totalHoras,
    horas_trabajadas_reales: horasTrabajadasReales,
    base_manual: meta?.base_manual === true,
    valor_hora: valorHora,
    importe_horas: importeHoras,
    presentismo: conceptos.presentismo,
    importe_horas_extra: conceptos.importe_horas_extra,
    importe_horas_extra_100: conceptos.importe_horas_extra_100,
    no_remunerativo: conceptos.no_remunerativo,
    aguinaldo: conceptos.aguinaldo,
    vacaciones: conceptos.vacaciones,
    adelantos: conceptos.adelantos,
    horas_extra_cantidad: conceptos.horas_extra_cantidad,
    horas_extra_100_cantidad: conceptos.horas_extra_100_cantidad,
    feriados_cantidad: conceptos.feriados_cantidad,
    dias_no_trabajados: conceptos.dias_no_trabajados,
    importe_feriados: conceptos.importe_feriados,
    descuento_dias_no_trabajados: conceptos.descuento_dias_no_trabajados,
    total,
    total_pagado: totalPagado,
    estado,
    observaciones: nota,
    adicional: conceptos.adicional,
  }
}

const formatoMoneda = (valor) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(valor || 0))
}

const formatoHoras = (valor) => roundMoney(valor).toFixed(2)
const formatoCantidad = (valor) => String(Math.round(Number(valor || 0)))

const getCantidadHoras = (registro = {}) => {
  const valor =
    registro.cantidad_horas ??
    registro.horas_trabajadas ??
    registro.cantidad_hora ??
    registro.horas ??
    0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const syncLiquidacionesPeriodo = async (mes, anio) => {
  try {
    if (!mes || !anio) return

    const { inicioISO, finISO } = getPeriodo(mes, anio)

    const [{ data: empleados }, { data: horasPeriodo }, { data: existentes }] = await Promise.all([
      db.from("empleados").select("id, valor_hora").eq("activo", true),
      db.from("horas").select("*").gte("fecha", inicioISO).lte("fecha", finISO),
      db.from("liquidaciones").select("*").eq("periodo_inicio", inicioISO).eq("periodo_fin", finISO),
    ])

    const empleadosData = empleados || []
    const horasData = horasPeriodo || []
    const liquidaciones = [...(existentes || [])]

    const horasTrabajadasPorEmpleado = {}
    const horasExtra50PorEmpleado = {}
    const horasExtra100PorEmpleado = {}
    for (const h of horasData) {
      if (!horasTrabajadasPorEmpleado[h.empleado_id]) horasTrabajadasPorEmpleado[h.empleado_id] = 0
      if (!horasExtra50PorEmpleado[h.empleado_id]) horasExtra50PorEmpleado[h.empleado_id] = 0
      if (!horasExtra100PorEmpleado[h.empleado_id]) horasExtra100PorEmpleado[h.empleado_id] = 0
      horasTrabajadasPorEmpleado[h.empleado_id] += getHorasTrabajadas(h)
      if (h.es_hora_extra === true) {
        if (String(h.tipo_hora_extra || "") === "100" || String(h.tipo || "") === "extra_100") {
          horasExtra100PorEmpleado[h.empleado_id] += getHorasTrabajadas(h)
        } else {
          horasExtra50PorEmpleado[h.empleado_id] += getHorasTrabajadas(h)
        }
      }
    }

    const byEmpleado = new Map(liquidaciones.map((l) => [l.empleado_id, l]))

    for (const emp of empleadosData) {
      if (!byEmpleado.has(emp.id)) {
        const { data: creada } = await db
          .from("liquidaciones")
          .insert([
            {
              empleado_id: emp.id,
              periodo_inicio: inicioISO,
              periodo_fin: finISO,
              total_horas: 0,
              monto_bruto: 0,
              presentismo: 0,
              horas_extra_cantidad: 0,
              importe_horas_extra: 0,
              horas_extra_100_cantidad: 0,
              importe_horas_extra_100: 0,
              no_remunerativo: 0,
              aguinaldo: 0,
              vacaciones: 0,
              feriados_cantidad: 0,
              importe_feriados: 0,
              dias_no_trabajados: 0,
              descuento_dias_no_trabajados: 0,
              adelantos: 0,
              adicional: 0,
              descuentos: 0,
              monto_neto: 0,
              estado: "pendiente",
              observaciones: "",
            },
          ])
          .select()
        if (creada?.[0]) {
          byEmpleado.set(emp.id, creada[0])
          liquidaciones.push(creada[0])
        }
      }
    }

    const liquidacionIds = liquidaciones.map((l) => l.id)
    let pagosPorLiquidacion = {}

    if (liquidacionIds.length > 0) {
      const { data: pagos } = await db
        .from("pagos_sueldo")
        .select("liquidacion_id, monto")

      for (const p of pagos || []) {
        if (!liquidacionIds.includes(p.liquidacion_id)) continue
        if (!pagosPorLiquidacion[p.liquidacion_id]) pagosPorLiquidacion[p.liquidacion_id] = 0
        pagosPorLiquidacion[p.liquidacion_id] += Number(p.monto || 0)
      }
    }

    for (const emp of empleadosData) {
      const liq = byEmpleado.get(emp.id)
      if (!liq) continue

      const metaActual = getLiquidacionMeta(liq)
      const horasTrabajadas = roundMoney(horasTrabajadasPorEmpleado[emp.id] || 0)
      const horasExtra50Automaticas = roundMoney(horasExtra50PorEmpleado[emp.id] || 0)
      const horasExtra100Automaticas = roundMoney(horasExtra100PorEmpleado[emp.id] || 0)
      const valorHora = Number(emp.valor_hora || 0)
      const totalHoras = roundMoney(liq.total_horas || 0)
      const montoBruto = roundMoney(liq.monto_bruto || 0)
      const conceptos = getConceptosFromLiquidacion(liq, valorHora)
      const conceptosActualizados = {
        ...conceptos,
        horas_extra_cantidad: horasExtra50Automaticas,
        importe_horas_extra: roundMoney(horasExtra50Automaticas * valorHora * 1.5),
        horas_extra_100_cantidad: horasExtra100Automaticas,
        importe_horas_extra_100: roundMoney(horasExtra100Automaticas * valorHora * 2),
      }
      const montoNeto = roundMoney(Math.max(
        0,
        montoBruto +
          conceptosActualizados.presentismo +
          conceptosActualizados.no_remunerativo +
          conceptosActualizados.aguinaldo +
          conceptosActualizados.vacaciones +
          conceptosActualizados.importe_horas_extra +
          conceptosActualizados.importe_horas_extra_100 +
          conceptosActualizados.adicional +
          conceptosActualizados.importe_feriados -
          conceptosActualizados.adelantos -
          conceptosActualizados.descuento_dias_no_trabajados
      ))
      const totalPagado = Number(pagosPorLiquidacion[liq.id] || 0)
      const estado = totalPagado >= montoNeto ? "pagada" : "pendiente"

      const { nota } = parseObservacionesData(liq.observaciones)
      const observacionesActualizadas = buildObservacionesData(nota, {
        ...metaActual,
        horas_trabajadas_reales: horasTrabajadas,
      })

      await db
        .from("liquidaciones")
        .update({
          total_horas: totalHoras,
          monto_bruto: roundMoney(montoBruto),
          presentismo: conceptosActualizados.presentismo,
          horas_extra_cantidad: conceptosActualizados.horas_extra_cantidad,
          importe_horas_extra: conceptosActualizados.importe_horas_extra,
          horas_extra_100_cantidad: conceptosActualizados.horas_extra_100_cantidad,
          importe_horas_extra_100: conceptosActualizados.importe_horas_extra_100,
          no_remunerativo: conceptosActualizados.no_remunerativo,
          aguinaldo: conceptosActualizados.aguinaldo,
          vacaciones: conceptosActualizados.vacaciones,
          feriados_cantidad: conceptosActualizados.feriados_cantidad,
          importe_feriados: conceptosActualizados.importe_feriados,
          dias_no_trabajados: conceptosActualizados.dias_no_trabajados,
          descuento_dias_no_trabajados: conceptosActualizados.descuento_dias_no_trabajados,
          adelantos: conceptosActualizados.adelantos,
          adicional: conceptosActualizados.adicional,
          descuentos: conceptosActualizados.adelantos,
          monto_neto: montoNeto,
          estado,
          observaciones: observacionesActualizadas,
        })
        .eq("id", liq.id)
    }
  } catch (err) {
    console.error("⚠️ Error sincronizando liquidaciones del período:", err.message)
  }
}

const withTimeout = async (promise, ms = 5000) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

// Obtener liquidaciones (con filtros opcionales)
router.get("/", async (req, res) => {
  try {
    const { mes, anio, empleado_id } = req.query
    
    let query = db.from("liquidaciones").select("*")

    if (mes && anio) {
      await withTimeout(syncLiquidacionesPeriodo(mes, anio), 5000)
      const { inicioISO, finISO } = getPeriodo(mes, anio)
      query = query.gte("periodo_inicio", inicioISO).lte("periodo_fin", finISO)
    }
    if (empleado_id) query = query.eq("empleado_id", empleado_id)

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) {
      console.error("❌ Error al obtener liquidaciones:", error)
      return res.status(400).json({ error: error.message })
    }

    // Obtener empleados para enriquecer la respuesta
    const { data: empleadosData } = await db.from("empleados").select("id, nombre, apellido")
    const empleadosMap = new Map((empleadosData || []).map((e) => [e.id, e]))
    
    // Calcular total pagado para cada liquidación
    const liquidacionesConEstado = await Promise.all(
      (data || []).map(async (liq) => {
        const { data: pagos } = await db
          .from("pagos_sueldo")
          .select("monto")
          .eq("liquidacion_id", liq.id)
        
        const totalPagado = pagos ? pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0) : 0
        const mapped = mapLiquidacion(liq, totalPagado)
        const emp = empleadosMap.get(liq.empleado_id)
        if (emp) {
          mapped.empleado_nombre = emp.nombre
          mapped.empleado_apellido = emp.apellido
        }
        return mapped
      })
    )
    
    res.json(liquidacionesConEstado)
  } catch (err) {
    console.error("❌ Error en try-catch GET liquidaciones:", err)
    res.status(500).json({ error: err.message })
  }
})

// Obtener liquidación por ID
router.get("/:id", async (req, res) => {
  try {
    const { data: liq, error } = await db
      .from("liquidaciones")
      .select("*")
      .eq("id", req.params.id)
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const { data: pagos } = await db
      .from("pagos_sueldo")
      .select("monto")
      .eq("liquidacion_id", req.params.id)

    const totalPagado = pagos ? pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0) : 0
    res.json(mapLiquidacion(liq, totalPagado))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PDF de liquidación (dos copias: empresa y empleado)
router.get("/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params

    const { data: liq, error: liqError } = await db
      .from("liquidaciones")
      .select("*")
      .eq("id", id)
      .single()

    if (liqError || !liq) {
      return res.status(404).json({ error: "Liquidación no encontrada" })
    }

    const [{ data: pagosRaw }, { data: empleado }] = await Promise.all([
      db.from("pagos_sueldo").select("monto, medio_pago, fecha_pago").eq("liquidacion_id", id).order("fecha_pago", { ascending: true }),
      db.from("empleados").select("nombre, apellido, dni, cuit, alias").eq("id", liq.empleado_id).single(),
    ])

    const pagos = pagosRaw || []
    const totalPagado = pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0)
    const liquidacion = mapLiquidacion(liq, totalPagado)
    const faltaPagar = Math.max(0, roundMoney(liquidacion.total - liquidacion.total_pagado))

    const nombreEmpleado = [empleado?.nombre, empleado?.apellido].filter(Boolean).join(" ") || `Empleado ${liq.empleado_id}`
    const periodo = `${String(liquidacion.mes || "").padStart(2, "0")}/${liquidacion.anio || ""}`
    const fileName = `Liquidacion ${sanitizeFileText(nombreEmpleado)} ${String(periodo).replace("/", "-")}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    doc.pipe(res)
    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Documento interno" })

    const drawCopy = (copyTitle) => {
      const pageWidth = doc.page.width
      const headerBottom = drawPremiumHeader(doc, {
        title: "TESLA MONTAJES ELECTRICOS",
        subtitle: "Resumen de liquidacion mensual",
        accentText: `${copyTitle} · Periodo ${periodo}`,
        logoPath: PDF_LOGO_PATH,
      })

      let y = headerBottom + 8

      const drawSectionHeader = (title, yPos) => {
        doc.strokeColor(PDF_COLORS.line).lineWidth(0.7).moveTo(45, yPos + 11).lineTo(pageWidth - 45, yPos + 11).stroke()
        doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10.2).text(title, 52, yPos)
        return yPos + 20
      }

      // Bloque de identificacion
      const infoTop = y
      doc.rect(45, infoTop, pageWidth - 90, 56).lineWidth(0.9).strokeColor(PDF_COLORS.line).stroke()
      y = infoTop + 8
      doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(12).text(nombreEmpleado, 52, y)
      y += 16
      doc.font("Helvetica").fontSize(9.4)
      doc.text(`Alias: ${empleado?.alias || "-"}`, 52, y, { width: 180 })
      doc.text(`DNI: ${empleado?.dni || "-"}`, 230, y, { width: 130 })
      doc.text(`CUIT: ${empleado?.cuit || "-"}`, 360, y, { width: 130 })
      y += 14
      doc.font("Helvetica-Bold").fontSize(9.4).text(`Estado: ${String(liquidacion.estado || "").toUpperCase()}`, 52, y)

      // Resumen ejecutivo
      y = infoTop + 70
      y = drawSectionHeader("RESUMEN EJECUTIVO", y)

      const resumenTop = y
      const colGap = 8
      const colW = (pageWidth - 90 - colGap * 2) / 3
      const resumenH = 42

      const resumenCols = [
        { label: "Total liquidacion", value: formatoMoneda(liquidacion.total) },
        { label: "Total pagado", value: formatoMoneda(liquidacion.total_pagado) },
        { label: "Saldo pendiente", value: formatoMoneda(faltaPagar) },
      ]

      resumenCols.forEach((item, idx) => {
        const x = 45 + idx * (colW + colGap)
        doc.rect(x, resumenTop, colW, resumenH).lineWidth(0.8).strokeColor(PDF_COLORS.line).stroke()
        doc.font("Helvetica").fontSize(8.8).fillColor(PDF_COLORS.slate).text(item.label, x + 8, resumenTop + 7, { width: colW - 16 })
        doc.font("Helvetica-Bold").fontSize(10.8).fillColor(PDF_COLORS.ink).text(item.value, x + 8, resumenTop + 20, { width: colW - 16 })
      })

      y = resumenTop + resumenH + 12
      y = drawSectionHeader("DETALLE BASE", y)
      doc.rect(45, y, pageWidth - 90, 26).lineWidth(0.7).strokeColor(PDF_COLORS.line).stroke()
      doc.font("Helvetica").fontSize(9.6).fillColor(PDF_COLORS.ink)
      doc.text(`Horas trabajadas: ${formatoHoras(liquidacion.total_horas)} hs`, 52, y + 8)
      doc.text(`Valor hora: ${formatoMoneda(liquidacion.valor_hora)}`, 220, y + 8)
      doc.text(`Importe horas: ${formatoMoneda(liquidacion.importe_horas)}`, 360, y + 8, { width: 140, align: "right" })

      y += 38
      y = drawSectionHeader("CONCEPTOS ADICIONALES", y)

      doc.rect(45, y, pageWidth - 90, 18).lineWidth(0.8).strokeColor(PDF_COLORS.line).stroke()
      doc.font("Helvetica-Bold").fontSize(9).fillColor(PDF_COLORS.ink)
      doc.text("Concepto", 52, y + 5)
      doc.text("Importe", pageWidth - 160, y + 5, { width: 108, align: "right" })
      y += 18

      const rows = [
        ["Presentismo", formatoMoneda(liquidacion.presentismo)],
        [
          `Horas extra 50% (${formatoCantidad(liquidacion.horas_extra_cantidad)} hs)`,
          formatoMoneda(liquidacion.importe_horas_extra),
        ],
        [
          `Horas extra 100% (${formatoCantidad(liquidacion.horas_extra_100_cantidad)} hs)`,
          formatoMoneda(liquidacion.importe_horas_extra_100),
        ],
        [
          `Feriados (${formatoCantidad(liquidacion.feriados_cantidad)} dias)`,
          formatoMoneda(liquidacion.importe_feriados),
        ],
        ["No remunerativo", formatoMoneda(liquidacion.no_remunerativo)],
        ["Aguinaldo", formatoMoneda(liquidacion.aguinaldo)],
        ["Vacaciones", formatoMoneda(liquidacion.vacaciones)],
        ["Adicional", formatoMoneda(liquidacion.adicional)],
        ["Adelantos", `-${formatoMoneda(liquidacion.adelantos)}`],
        [
          `Dias no trabajados (${formatoCantidad(liquidacion.dias_no_trabajados)})`,
          `-${formatoMoneda(liquidacion.descuento_dias_no_trabajados)}`,
        ],
      ]

      rows.forEach(([label, value]) => {
        doc.rect(45, y, pageWidth - 90, 16).lineWidth(0.5).strokeColor(PDF_COLORS.line).stroke()
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.4)
        doc.text(label, 52, y + 4, { width: 340 })
        doc.text(value, pageWidth - 160, y + 4, { width: 108, align: "right" })
        y += 16
      })

      y += 10
      y = drawSectionHeader("PAGOS REGISTRADOS", y)

      doc.rect(45, y, pageWidth - 90, 18).lineWidth(0.8).strokeColor(PDF_COLORS.line).stroke()
      doc.font("Helvetica-Bold").fontSize(9).fillColor(PDF_COLORS.ink)
      doc.text("Fecha", 52, y + 5)
      doc.text("Medio", 240, y + 5)
      doc.text("Monto", pageWidth - 160, y + 5, { width: 108, align: "right" })
      y += 18

      doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.ink)
      if (pagos.length === 0) {
        doc.rect(45, y, pageWidth - 90, 16).lineWidth(0.5).strokeColor(PDF_COLORS.line).stroke()
        doc.text("Sin pagos registrados", 52, y + 4)
        y += 16
      } else {
        pagos.forEach((p, idx) => {
          const fecha = p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString("es-AR") : "-"
          const medio = p.medio_pago || "-"
          doc.rect(45, y, pageWidth - 90, 16).lineWidth(0.5).strokeColor(PDF_COLORS.line).stroke()
          doc.text(`${idx + 1}. ${fecha}`, 52, y + 4)
          doc.text(medio, 240, y + 4)
          doc.text(formatoMoneda(p.monto), pageWidth - 160, y + 4, { width: 108, align: "right" })
          y += 16
        })
      }

      if (liquidacion.observaciones) {
        y += 10
        y = drawSectionHeader("OBSERVACIONES", y)
        doc.rect(45, y, pageWidth - 90, 58).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke()
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.8).text(liquidacion.observaciones, 52, y + 8, {
          width: pageWidth - 104,
          height: 42,
        })
      }

      const firmaY = doc.page.height - doc.page.margins.bottom - 62
      const firmaLineY = firmaY - 10
      const firmaWidth = 220
      const firmaX = (pageWidth - firmaWidth) / 2

      doc.strokeColor(PDF_COLORS.line).lineWidth(0.9)
      doc.moveTo(firmaX, firmaLineY).lineTo(firmaX + firmaWidth, firmaLineY).stroke()

      doc.font("Helvetica").fontSize(8.6).fillColor(PDF_COLORS.slate)
      doc.text("Firma empleado", firmaX, firmaY, { width: firmaWidth, align: "center" })

      doc.font("Helvetica").fontSize(7.8).fillColor(PDF_COLORS.muted)
      doc.text("Aclaracion y DNI", firmaX, firmaY + 11, { width: firmaWidth, align: "center" })
    }

    drawCopy("Original")
    doc.addPage()
    drawCopy("Empleado")

    doc.end()
  } catch (err) {
    console.error("Error generando PDF de liquidacion:", err)
    res.status(500).json({ error: err.message })
  }
})

// Crear liquidación (calcula automáticamente total_horas e importe_horas)
router.post("/", async (req, res) => {
  try {
    const { empleado_id, mes, anio } = req.body
    
    // Validar datos de entrada
    if (!empleado_id || !mes || !anio) {
      return res.status(400).json({ error: "Faltan parámetros requeridos" })
    }

    const { inicioISO, finISO } = getPeriodo(mes, anio)

    // Validar que no exista liquidación para este empleado en este período
    const { data: existente, error: existError } = await db
      .from("liquidaciones")
      .select("id")
      .eq("empleado_id", empleado_id)
      .eq("periodo_inicio", inicioISO)
      .eq("periodo_fin", finISO)

    if (existError) {
      console.error("❌ Error al verificar liquidación existente:", existError)
      return res.status(400).json({ error: existError.message })
    }

    if (existente && existente.length > 0) {
      return res.status(200).json(mapLiquidacion(existente[0], 0))
    }

    // Obtener datos del empleado
    const { data: empleados, error: empError } = await db
      .from("empleados")
      .select("id, valor_hora, nombre, apellido, activo")
      .eq("activo", true)
    
    if (empError) {
      console.error("❌ Error obteniendo empleados:", empError)
      return res.status(400).json({ error: `Error al obtener empleados: ${empError.message}` })
    }
    
    const empleado = empleados?.find(e => e.id === empleado_id)
    
    if (!empleado) {
      return res.status(400).json({ error: `Empleado con ID ${empleado_id} no encontrado` })
    }
    
    // Calcular total de horas del mes (incluye horas prestadas)
    const fechaInicio = inicioISO
    const fechaFin = finISO

    const { data: horas, error: horasError } = await db
      .from("horas")
      .select("*")
      .eq("empleado_id", empleado_id)
      .gte("fecha", fechaInicio)
      .lte("fecha", fechaFin)

    if (horasError) {
      console.error("❌ Error al obtener horas:", horasError)
    }

    const total_horas = 0
    const horas_trabajadas_reales = horas ? horas.reduce((sum, h) => sum + getHorasTrabajadas(h), 0) : 0
    const horas_extra_cantidad = horas
      ? horas.reduce((sum, h) => sum + (
        h.es_hora_extra === true && String(h.tipo_hora_extra || "") !== "100" && String(h.tipo || "") !== "extra_100"
          ? getHorasTrabajadas(h)
          : 0
      ), 0)
      : 0
    const horas_extra_100_cantidad = horas
      ? horas.reduce((sum, h) => sum + (
        h.es_hora_extra === true && (String(h.tipo_hora_extra || "") === "100" || String(h.tipo || "") === "extra_100")
          ? getHorasTrabajadas(h)
          : 0
      ), 0)
      : 0
    const importe_horas = 0

    // Crear liquidación
    const { data, error } = await db.from("liquidaciones").insert([
      {
        empleado_id,
        periodo_inicio: fechaInicio,
        periodo_fin: fechaFin,
        total_horas,
        monto_bruto: importe_horas,
        presentismo: 0,
        horas_extra_cantidad: roundMoney(horas_extra_cantidad),
        importe_horas_extra: roundMoney(horas_extra_cantidad * Number(empleado.valor_hora || 0) * 1.5),
        horas_extra_100_cantidad: roundMoney(horas_extra_100_cantidad),
        importe_horas_extra_100: roundMoney(horas_extra_100_cantidad * Number(empleado.valor_hora || 0) * 2),
        no_remunerativo: 0,
        aguinaldo: 0,
        vacaciones: 0,
        feriados_cantidad: 0,
        importe_feriados: 0,
        dias_no_trabajados: 0,
        descuento_dias_no_trabajados: 0,
        adelantos: 0,
        adicional: 0,
        descuentos: 0,
        monto_neto: importe_horas,
        estado: "pendiente",
        observaciones: buildObservacionesData("", {
          horas_trabajadas_reales: roundMoney(horas_trabajadas_reales),
        })
      }
    ]).select()

    if (error) {
      console.error("❌ Error al insertar liquidación:", error)
      return res.status(400).json({ error: `Error de BD: ${error.message}` })
    }

    const creada = Array.isArray(data) ? data[0] : data
    getIo()?.emit('liquidaciones:changed')
    triggerSueldoTxtExport(mes, anio)
    res.status(201).json(mapLiquidacion(creada, 0))
  } catch (err) {
    console.error("❌ Error en try-catch:", err)
    res.status(500).json({ error: `Error del servidor: ${err.message}` })
  }
})

// Actualizar liquidación (conceptos manuales y total)
router.put("/:id", async (req, res) => {
  try {
    const {
      total_horas,
      monto_bruto,
      presentismo,
      horas_extra_cantidad,
      horas_extra_100_cantidad,
      no_remunerativo,
      aguinaldo,
      vacaciones,
      feriados_cantidad,
      dias_no_trabajados,
      adelantos,
      adicional,
      observaciones,
    } = req.body

    // Obtener liquidación actual para recalcular total
    const { data: liquidacion } = await db
      .from("liquidaciones")
      .select("empleado_id, total_horas, monto_bruto, observaciones, presentismo, horas_extra_cantidad, horas_extra_100_cantidad, no_remunerativo, aguinaldo, vacaciones, feriados_cantidad, dias_no_trabajados, adelantos, adicional")
      .eq("id", req.params.id)
      .single()

    if (!liquidacion) return res.status(400).json({ error: "Liquidación no encontrada" })

    const { data: empleado } = await db
      .from("empleados")
      .select("valor_hora")
      .eq("id", liquidacion.empleado_id)
      .single()

    const totalHorasFinal = total_horas !== undefined
      ? roundMoney(total_horas)
      : roundMoney(liquidacion.total_horas || 0)
    const montoBrutoFinal = monto_bruto !== undefined
      ? roundMoney(monto_bruto)
      : roundMoney(liquidacion.monto_bruto || 0)

    const valorHoraCalculado = Number(totalHorasFinal || 0) > 0
      ? Number(montoBrutoFinal || 0) / Number(totalHorasFinal || 1)
      : Number(empleado?.valor_hora || 0)

    const conceptosActuales = getConceptosFromLiquidacion(liquidacion, valorHoraCalculado)

    const conceptos = {
      presentismo: roundMoney(presentismo ?? conceptosActuales.presentismo),
      horas_extra_cantidad: roundMoney(horas_extra_cantidad ?? conceptosActuales.horas_extra_cantidad),
      horas_extra_100_cantidad: roundMoney(horas_extra_100_cantidad ?? conceptosActuales.horas_extra_100_cantidad),
      no_remunerativo: roundMoney(no_remunerativo ?? conceptosActuales.no_remunerativo),
      aguinaldo: roundMoney(aguinaldo ?? conceptosActuales.aguinaldo),
      vacaciones: roundMoney(vacaciones ?? conceptosActuales.vacaciones),
      feriados_cantidad: roundMoney(feriados_cantidad ?? conceptosActuales.feriados_cantidad),
      dias_no_trabajados: roundMoney(dias_no_trabajados ?? conceptosActuales.dias_no_trabajados),
      adelantos: roundMoney(adelantos ?? conceptosActuales.adelantos),
      adicional: roundMoney(adicional ?? conceptosActuales.adicional ?? 0),
    }

    const importeHorasExtra = roundMoney(conceptos.horas_extra_cantidad * valorHoraCalculado * 1.5)
    const importeHorasExtra100 = roundMoney(conceptos.horas_extra_100_cantidad * valorHoraCalculado * 2)
    const importeFeriados = roundMoney(conceptos.feriados_cantidad * 8 * valorHoraCalculado)
    const descuentoDiasNoTrabajados = roundMoney(conceptos.dias_no_trabajados * 8 * valorHoraCalculado)

    // Calcular total
    const total = roundMoney(
      montoBrutoFinal +
      conceptos.presentismo +
      conceptos.no_remunerativo +
      conceptos.aguinaldo +
      conceptos.vacaciones +
      importeHorasExtra +
      importeHorasExtra100 +
      importeFeriados +
      conceptos.adicional -
      conceptos.adelantos -
      descuentoDiasNoTrabajados
    )

    const { nota: notaActual, meta: metaActual } = parseObservacionesData(liquidacion.observaciones)
    const observacionesFinal = String(observaciones ?? notaActual ?? "")
    // Evitar duplicar 'adicional' en meta cuando se guarda en columna
    const metaSanitized = { ...metaActual }
    const observacionesPayload = buildObservacionesData(observacionesFinal, {
      ...metaSanitized,
      base_manual: total_horas !== undefined || monto_bruto !== undefined
        ? true
        : metaSanitized?.base_manual === true,
      horas_trabajadas_reales: roundMoney(metaSanitized?.horas_trabajadas_reales ?? liquidacion.total_horas ?? 0),
    })

    const { data: pagosExistentes } = await db
      .from("pagos_sueldo")
      .select("monto")
      .eq("liquidacion_id", req.params.id)

    const totalPagado = (pagosExistentes || []).reduce((sum, p) => sum + Number(p.monto || 0), 0)
    const estadoActualizado = totalPagado >= Math.max(0, total) ? "pagada" : "pendiente"

    const { data: updatedRows, error } = await db
      .from("liquidaciones")
      .update({
        total_horas: totalHorasFinal,
        monto_bruto: montoBrutoFinal,
        presentismo: conceptos.presentismo,
        horas_extra_cantidad: conceptos.horas_extra_cantidad,
        importe_horas_extra: importeHorasExtra,
        horas_extra_100_cantidad: conceptos.horas_extra_100_cantidad,
        importe_horas_extra_100: importeHorasExtra100,
        no_remunerativo: conceptos.no_remunerativo,
        aguinaldo: conceptos.aguinaldo,
        vacaciones: conceptos.vacaciones,
        feriados_cantidad: conceptos.feriados_cantidad,
        importe_feriados: importeFeriados,
        dias_no_trabajados: conceptos.dias_no_trabajados,
        descuento_dias_no_trabajados: descuentoDiasNoTrabajados,
        adicional: conceptos.adicional,
        adelantos: conceptos.adelantos,
        descuentos: conceptos.adelantos,
        monto_neto: Math.max(0, total),
        estado: estadoActualizado,
        observaciones: observacionesPayload
      })
      .eq("id", req.params.id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('liquidaciones:changed')
    triggerSueldoTxtExportFromPeriodo(updatedRows[0]?.periodo_inicio)
    res.json(mapLiquidacion(updatedRows[0], 0))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar liquidación (y sus pagos asociados)
router.delete("/:id", async (req, res) => {
  try {
    const liquidacionId = req.params.id
    const { data: liquidacionAntesDeEliminar } = await db
      .from("liquidaciones")
      .select("periodo_inicio")
      .eq("id", liquidacionId)
      .single()
    
    // Primero, eliminar todos los pagos asociados
    const { error: errorPagos } = await db
      .from("pagos_sueldo")
      .delete()
      .eq("liquidacion_id", liquidacionId)
    
    if (errorPagos) {
      console.error("❌ Error al eliminar pagos:", errorPagos)
      return res.status(400).json({ error: `Error al eliminar pagos: ${errorPagos.message}` })
    }
    
    // Luego, eliminar la liquidación
    const { error } = await db
      .from("liquidaciones")
      .delete()
      .eq("id", liquidacionId)

    if (error) {
      console.error("❌ Error al eliminar liquidación:", error)
      return res.status(400).json({ error: error.message })
    }
    
    console.log("✅ Liquidación eliminada")
    getIo()?.emit('liquidaciones:changed')
    triggerSueldoTxtExportFromPeriodo(liquidacionAntesDeEliminar?.periodo_inicio)
    res.json({ message: "Liquidación y sus pagos eliminados correctamente" })
  } catch (err) {
    console.error("❌ Error en try-catch DELETE:", err)
    res.status(500).json({ error: err.message })
  }
})

// ========== PAGOS DE LIQUIDACIONES ==========

// Obtener pagos de una liquidación
router.get("/:liquidacion_id/pagos", async (req, res) => {
  try {
    const { data: pagosRaw, error } = await db
      .from("pagos_sueldo")
      .select("*")
      .eq("liquidacion_id", req.params.liquidacion_id)
      .order("fecha_pago", { ascending: false })

    if (error) return res.status(400).json({ error: error.message })

    const pagos = (pagosRaw || []).map((p) => ({
      ...p,
      fecha: p.fecha_pago || (p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : null),
    }))
    res.json(pagos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear pago de liquidación
router.post("/:liquidacion_id/pagos", async (req, res) => {
  try {
    const { monto, medio_pago, fecha } = req.body
    const liquidacion_id = req.params.liquidacion_id

    // Validar que el monto no exceda el adeudado
    const { data: liquidacion } = await db
      .from("liquidaciones")
      .select("monto_neto, periodo_inicio")
      .eq("id", liquidacion_id)
      .single()

    if (!liquidacion) return res.status(400).json({ error: "Liquidación no encontrada" })

    // Obtener total pagado hasta ahora
    const { data: pagosExistentes } = await db
      .from("pagos_sueldo")
      .select("monto")
      .eq("liquidacion_id", liquidacion_id)

    const totalPagado = pagosExistentes ? pagosExistentes.reduce((sum, p) => sum + Number(p.monto || 0), 0) : 0
    const montoNetoNum = Number(liquidacion.monto_neto || 0)
    const aDeudarseRaw = montoNetoNum - totalPagado

    // Normalizar valores numéricos
    const montoNum = Number(monto || 0)
    const aDeudarse = Number.isFinite(aDeudarseRaw) ? Math.round(aDeudarseRaw * 100) / 100 : 0

    // DEBUG: log valores para analizar discrepancias
    console.log(`[PAGOS] liquidacion_id=${liquidacion_id} monto_neto=${montoNetoNum} totalPagado=${totalPagado} aDeudarse=${aDeudarse} montoRecibido=${montoNum}`)

    // Permitir una pequeña tolerancia por redondeo (hasta 1 centavo)
    const TOLERANCIA = 0.01

    if (aDeudarse <= TOLERANCIA) {
      return res.status(400).json({ error: "La liquidación ya no tiene saldo pendiente." })
    }

    // Si el monto es mayor al adeudado (por error de usuario o intención), lo ajustamos al restante
    if (montoNum > aDeudarse + TOLERANCIA) {
      console.info(`[PAGOS] Monto pedido ${montoNum} mayor al restante ${aDeudarse}, se ajustará al restante (liquidacion_id=${liquidacion_id})`)
    }

    // Si el monto es ligeramente mayor al adeudado por redondeo, ajustarlo al restante
    let montoFinal = montoNum
    if (Math.abs(montoNum - aDeudarse) <= TOLERANCIA) {
      montoFinal = aDeudarse
    }
    // Si intentan pagar más que lo adeudado, capear al restante (evita rechazo)
    if (montoFinal > aDeudarse) {
      console.info(`[PAGOS] Ajustando monto pedido ${montoFinal} al restante ${aDeudarse} (liquidacion_id=${liquidacion_id})`)
      montoFinal = aDeudarse
    }

    // Crear pago
    const { data, error } = await db
      .from("pagos_sueldo")
      .insert([
        {
          liquidacion_id,
          monto: montoFinal,
          medio_pago,
          fecha_pago: fecha || new Date().toISOString().split("T")[0]
        }
      ])
      .select()

    if (error) return res.status(400).json({ error: error.message })

    getIo()?.emit('liquidaciones:changed')
    triggerSueldoTxtExportFromPeriodo(liquidacion?.periodo_inicio)

    // Informar si el pago fue ajustado
    if (montoFinal !== montoNum) {
      return res.status(201).json({ message: `Pago ajustado a ${montoFinal} (restante)`, data: data[0] })
    }

    res.status(201).json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar pago
router.delete("/pagos/:id", async (req, res) => {
  try {
    const { data: pago } = await db
      .from("pagos_sueldo")
      .select("liquidacion_id")
      .eq("id", req.params.id)
      .single()

    const { error } = await db.from("pagos_sueldo").delete().eq("id", req.params.id)

    if (error) return res.status(400).json({ error: error.message })

    getIo()?.emit('liquidaciones:changed')

    if (pago?.liquidacion_id) {
      const { data: liq } = await db
        .from("liquidaciones")
        .select("periodo_inicio")
        .eq("id", pago.liquidacion_id)
        .single()
      triggerSueldoTxtExportFromPeriodo(liq?.periodo_inicio)
    }

    res.json({ message: "Pago eliminado" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
