import express from "express"
import db, { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js"

const router = express.Router()
const MEDIOS_PAGO = ["efectivo", "transferencia", "cheque", "echeq", "retencion"]
const CATEGORIAS_CAJA = ["mano_obra", "materiales"]
const LABEL_MEDIO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  echeq: "Echeq",
  retencion: "Retencion",
}
const LABEL_CATEGORIA = {
  mano_obra: "Mano de obra",
  materiales: "Materiales",
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")

let detalleColumnCache = null
let detallesSchemaCache = null

const formatoMoneda = (valor) => {
  const numero = Number(valor) || 0
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numero)
}

const formatoFecha = (valor) => {
  if (!valor) return "-"
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return String(valor)
  return fecha.toLocaleDateString("es-AR")
}

async function getDetalleColumn() {
  if (detalleColumnCache) return detalleColumnCache

  const result = await pool.query(
    `
      SELECT a.attname AS column_name
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('movimientos_caja')
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname IN ('detalle', 'descripcion', 'concepto')
    `
  )

  const columns = result.rows.map((row) => row.column_name)
  if (columns.includes("detalle")) {
    detalleColumnCache = "detalle"
  } else if (columns.includes("concepto")) {
    detalleColumnCache = "concepto"
  } else if (columns.includes("descripcion")) {
    detalleColumnCache = "descripcion"
  } else {
    detalleColumnCache = "detalle"
  }
  return detalleColumnCache
}

function normalizarMovimiento(movimiento) {
  if (!movimiento) return movimiento

  const detallesNormalizados = normalizarDetalles(movimiento.detalles_medio_pago || [])

  return {
    ...movimiento,
    detalle: movimiento.detalle ?? movimiento.concepto ?? movimiento.descripcion ?? "",
    categoria: CATEGORIAS_CAJA.includes(String(movimiento.categoria || "")) ? movimiento.categoria : null,
    con_iva: Boolean(movimiento.con_iva),
    cliente_id: movimiento.cliente_id ?? null,
    presupuesto_id: movimiento.presupuesto_id ?? null,
    detalles_medio_pago: detallesNormalizados,
  }
}

function normalizarBoolean(valor, defaultValue = false) {
  if (valor === undefined || valor === null || valor === "") return defaultValue
  if (typeof valor === "boolean") return valor
  if (typeof valor === "number") return valor !== 0
  const normalizado = String(valor).trim().toLowerCase()
  return ["true", "1", "si", "sí", "con_iva", "con iva"].includes(normalizado)
}

async function getDetallesSchema() {
  if (detallesSchemaCache) return detallesSchemaCache

  const result = await pool.query(
    `
      SELECT a.attname AS column_name
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('detalles_medio_pago')
        AND a.attnum > 0
        AND NOT a.attisdropped
    `
  )

  const columns = result.rows.map((row) => row.column_name)
  if (columns.includes("medio_pago") && columns.includes("monto")) {
    detallesSchemaCache = { mode: "filas" }
  } else {
    detallesSchemaCache = { mode: "columnas" }
  }

  return detallesSchemaCache
}

function normalizarDetalles(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) return []

  const primerDetalle = detalles[0]
  if (Object.prototype.hasOwnProperty.call(primerDetalle, "medio_pago") && Object.prototype.hasOwnProperty.call(primerDetalle, "monto")) {
    return detalles
      .filter((item) => item.medio_pago)
      .map((item) => ({
        ...item,
        medio_pago: String(item.medio_pago).toLowerCase(),
        monto: parseFloat(item.monto || 0),
      }))
  }

  return MEDIOS_PAGO
    .map((medio) => ({
      medio_pago: medio,
      monto: parseFloat(primerDetalle[medio] || 0),
    }))
    .filter((item) => item.monto > 0)
}

async function obtenerMovimientosYTotales({ fecha_inicio, fecha_fin, tipo } = {}) {
  await getDetallesSchema()

  let query = db.from("movimientos_caja").select(`
    *,
    detalles_medio_pago(*)
  `)

  if (fecha_inicio) {
    query = query.gte("fecha", fecha_inicio)
  }

  if (fecha_fin) {
    const fechaFinAjustada = new Date(fecha_fin)
    fechaFinAjustada.setDate(fechaFinAjustada.getDate() + 1)
    query = query.lt("fecha", fechaFinAjustada.toISOString().split("T")[0])
  }

  if (tipo) {
    query = query.eq("tipo", tipo)
  }

  const { data, error } = await query.order("fecha", { ascending: false })
  if (error) throw error

  const totales = {
    totalIngresos: 0,
    totalEgresos: 0,
    desglose: {
      efectivo: 0,
      transferencia: 0,
      cheque: 0,
      echeq: 0,
      retencion: 0,
    },
  }

  const movimientos = (data || []).map(normalizarMovimiento)

  movimientos.forEach((mov) => {
    const montoTotal = parseFloat(mov.monto_total || 0)
    if (mov.tipo === "ingreso") {
      totales.totalIngresos += montoTotal
    } else {
      totales.totalEgresos += montoTotal
    }

    mov.detalles_medio_pago?.forEach((detalle) => {
      const medio = String(detalle.medio_pago || "").toLowerCase()
      if (totales.desglose[medio] !== undefined) {
        totales.desglose[medio] += parseFloat(detalle.monto || 0)
      }
    })
  })

  return { movimientos, totales }
}

// Listar movimientos de caja con filtros
router.get("/", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, tipo } = req.query
    const { movimientos, totales } = await obtenerMovimientosYTotales({ fecha_inicio, fecha_fin, tipo })

    res.json({
      movimientos,
      totales
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/resumen/pdf", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, tipo } = req.query
    const { movimientos, totales } = await obtenerMovimientosYTotales({ fecha_inicio, fecha_fin, tipo })

    const balance = (totales.totalIngresos || 0) - (totales.totalEgresos || 0)
    const cantidadMovimientos = movimientos.length

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const nombreArchivo = `Resumen Caja ${fechaArchivo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen de caja" })

    const drawSectionTitle = (title) => {
      drawPremiumSectionTitle(doc, title)
    }

    const filtroPeriodo = [
      fecha_inicio ? `Desde ${formatoFecha(fecha_inicio)}` : "",
      fecha_fin ? `Hasta ${formatoFecha(fecha_fin)}` : "",
      tipo ? `Tipo ${tipo}` : "Todos los tipos",
    ].filter(Boolean).join(" - ")

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Resumen completo de caja",
      accentText: filtroPeriodo || "Sin filtros",
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 15

    const resumenY = doc.y
    doc.roundedRect(45, resumenY, pageWidth - 90, 82, 6).fill(PDF_COLORS.card)
    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("MOVIMIENTOS", 58, resumenY + 10, { width: 100 })
    doc.text("INGRESOS", 185, resumenY + 10, { width: 120 })
    doc.text("EGRESOS", 320, resumenY + 10, { width: 120 })
    doc.text("BALANCE", 430, resumenY + 10, { width: 110, align: "right" })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(13)
    doc.text(String(cantidadMovimientos), 58, resumenY + 24, { width: 100 })
    doc.text(formatoMoneda(totales.totalIngresos), 185, resumenY + 24, { width: 120 })
    doc.text(formatoMoneda(totales.totalEgresos), 320, resumenY + 24, { width: 120 })
    doc.text(formatoMoneda(balance), 430, resumenY + 24, { width: 110, align: "right" })

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, resumenY + 48).lineTo(pageWidth - 58, resumenY + 48).stroke()
    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(9)
    doc.text(`Generado: ${formatoFecha(new Date())}`, 58, resumenY + 56, { width: pageWidth - 116 })
    doc.fillColor(PDF_COLORS.ink)
    doc.y = resumenY + 92

    drawSectionTitle("Desglose por medio de pago")

    const desgloseItems = MEDIOS_PAGO.map((medio) => ({
      label: LABEL_MEDIO[medio],
      value: parseFloat(totales.desglose?.[medio] || 0),
    }))

    const drawDesgloseHeader = () => {
      const headerY = doc.y
      doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
      doc.text("MEDIO", 55, headerY + 7, { width: 280 })
      doc.text("MONTO", 410, headerY + 7, { width: 120, align: "right" })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = headerY + 22
    }

    drawDesgloseHeader()
    let yDesglose = doc.y
    desgloseItems.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
      doc.rect(45, yDesglose, pageWidth - 90, 20).fill(bg)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
      doc.text(item.label, 55, yDesglose + 6, { width: 280 })
      doc.text(formatoMoneda(item.value), 410, yDesglose + 6, { width: 120, align: "right" })
      yDesglose += 20
    })
    doc.y = yDesglose + 6

    drawSectionTitle("Detalle de movimientos")

    const drawMovHeader = () => {
      const headerY = doc.y
      doc.rect(45, headerY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
      doc.text("FECHA", 50, headerY + 8, { width: 68 })
      doc.text("TIPO", 120, headerY + 8, { width: 60 })
      doc.text("DETALLE", 182, headerY + 8, { width: 170 })
      doc.text("MEDIOS", 354, headerY + 8, { width: 100 })
      doc.text("MONTO", 456, headerY + 8, { width: 44, align: "right" })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = headerY + 24
    }

    drawMovHeader()
    let yMov = doc.y

    if (movimientos.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("No hay movimientos para los filtros seleccionados", 55, yMov)
      doc.fillColor("#111827")
    } else {
      movimientos.forEach((mov, idx) => {
        if (yMov > doc.page.height - 74) {
          doc.addPage()
          doc.y = 60
          drawMovHeader()
          yMov = doc.y
        }

        const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, yMov, pageWidth - 90, 22).fill(bg)

        const medios = (mov.detalles_medio_pago || [])
          .filter((d) => parseFloat(d.monto || 0) > 0)
          .map((d) => `${LABEL_MEDIO[d.medio_pago] || d.medio_pago}: ${formatoMoneda(d.monto)}`)
          .join(" | ")

        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
        doc.text(formatoFecha(mov.fecha), 50, yMov + 7, { width: 68 })
        doc.text(mov.tipo === "ingreso" ? "Ingreso" : "Egreso", 120, yMov + 7, { width: 60 })
        doc.text(String(mov.detalle || "-"), 182, yMov + 7, { width: 170, ellipsis: true })
        doc.text(medios || "-", 354, yMov + 7, { width: 100, ellipsis: true })
        doc.text(formatoMoneda(mov.monto_total), 456, yMov + 7, { width: 44, align: "right" })
        yMov += 22
      })
    }

    doc.end()
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params
    await getDetallesSchema()

    const { data, error } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Movimiento no encontrado" })

    const movimiento = normalizarMovimiento(data)
    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const nombreArchivo = `Movimiento Caja ${id} ${fechaArchivo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Comprobante de movimiento de caja" })

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Comprobante de movimiento de caja",
      accentText: `Movimiento #${movimiento.id}`,
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 16

    const infoY = doc.y
    doc.roundedRect(45, infoY, pageWidth - 90, 98, 6).fill(PDF_COLORS.card)

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("FECHA", 58, infoY + 12, { width: 100 })
    doc.text("TIPO", 170, infoY + 12, { width: 100 })
    doc.text("MONTO", 282, infoY + 12, { width: 120 })
    doc.text("DETALLE", 58, infoY + 52, { width: 420 })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
    doc.text(formatoFecha(movimiento.fecha), 58, infoY + 26, { width: 100 })
    doc.text(movimiento.tipo === "ingreso" ? "Ingreso" : "Egreso", 170, infoY + 26, { width: 100 })
    doc.text(formatoMoneda(movimiento.monto_total), 282, infoY + 26, { width: 140 })
    doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.ink)
    doc.text(movimiento.detalle || "-", 58, infoY + 66, { width: pageWidth - 116 })

    doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.slate)
    doc.text(`Categoria: ${LABEL_CATEGORIA[movimiento.categoria] || "-"}`, 58, infoY + 84, { width: 180 })
    doc.text(`IVA: ${movimiento.con_iva ? "Con IVA" : "Sin IVA"}`, 250, infoY + 84, { width: 120 })
    doc.text(`Cliente ID: ${movimiento.cliente_id || "-"}`, 360, infoY + 84, { width: 85 })
    doc.text(`Presupuesto ID: ${movimiento.presupuesto_id || "-"}`, 448, infoY + 84, { width: 90, align: "right" })

    doc.y = infoY + 132
    doc.moveDown(0.4)
    doc.font("Helvetica-Bold").fontSize(12).fillColor(PDF_COLORS.navy).text("Desglose por medio de pago")
    doc.moveDown(0.25)

    const detalles = (movimiento.detalles_medio_pago || []).filter((d) => parseFloat(d.monto || 0) > 0)
    const desgloseItems = (detalles.length > 0 ? detalles : MEDIOS_PAGO.map((medio) => ({ medio_pago: medio, monto: 0 })))

    const headerY = doc.y
    doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
    doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
    doc.text("MEDIO", 55, headerY + 7, { width: 280 })
    doc.text("MONTO", 410, headerY + 7, { width: 120, align: "right" })
    doc.fillColor(PDF_COLORS.ink)

    let y = headerY + 22
    desgloseItems.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
      doc.rect(45, y, pageWidth - 90, 20).fill(bg)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
      doc.text(LABEL_MEDIO[item.medio_pago] || item.medio_pago, 55, y + 6, { width: 280 })
      doc.text(formatoMoneda(item.monto), 410, y + 6, { width: 120, align: "right" })
      y += 20
    })

    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8)
    doc.text(`Generado ${formatoFecha(new Date())}`, 45, doc.page.height - doc.page.margins.bottom - 6, { width: pageWidth - 90, align: "right" })

    doc.end()
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Obtener movimiento por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await getDetallesSchema()

    const { data, error } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Movimiento no encontrado" })

    res.json(normalizarMovimiento(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear movimiento de caja
router.post("/", async (req, res) => {
  try {
    const { fecha, tipo, detalle, monto_total, desglose, categoria, con_iva, cliente_id, presupuesto_id } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()

    // Validaciones
    if (!fecha || !tipo || !detalle || !monto_total) {
      return res.status(400).json({ error: "Campos requeridos: fecha, tipo, detalle, monto_total" })
    }

    if (!["ingreso", "egreso"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }

    if (categoria && !CATEGORIAS_CAJA.includes(categoria)) {
      return res.status(400).json({ error: "Categoria inválida. Debe ser 'mano_obra' o 'materiales'" })
    }

    if (monto_total <= 0) {
      return res.status(400).json({ error: "Monto total debe ser mayor a 0" })
    }

    // Validar desglose
    if (!desglose || Object.keys(desglose).length === 0) {
      return res.status(400).json({ error: "Debe incluir al menos un medio de pago" })
    }

    // Calcular suma de desglose y validar que sea igual al monto_total
    const sumaDesglose = Object.values(desglose).reduce((sum, val) => sum + parseFloat(val || 0), 0)
    if (Math.abs(sumaDesglose - monto_total) > 0.01) { // Tolerancia de 0.01
      return res.status(400).json({ 
        error: `La suma del desglose (${sumaDesglose}) no coincide con el monto total (${monto_total})` 
      })
    }

    // Crear movimiento (solo los campos básicos, sin desglose)
    const { data: movimiento, error: errorMovimiento } = await db
      .from("movimientos_caja")
      .insert([
        {
          fecha: fecha,
          tipo: tipo,
          [detalleColumn]: detalle,
          monto_total: parseFloat(monto_total),
          categoria: categoria || null,
          con_iva: normalizarBoolean(con_iva, true),
          cliente_id: cliente_id || null,
          presupuesto_id: presupuesto_id || null,
        }
      ])
      .select()

    if (errorMovimiento) {
      console.error("Error al insertar movimiento:", errorMovimiento)
      return res.status(400).json({ error: errorMovimiento.message })
    }

    const movimientoId = movimiento[0].id

    // Crear detalles de medio de pago por separado
    let errorDetalles = null
    if (detallesSchema.mode === "filas") {
      const detalles = Object.entries(desglose)
        .filter(([_, monto]) => parseFloat(monto) > 0)
        .map(([medio_pago, monto]) => ({
          movimiento_id: movimientoId,
          medio_pago,
          monto: parseFloat(monto),
        }))

      if (detalles.length > 0) {
        const resultDetalles = await db.from("detalles_medio_pago").insert(detalles)
        errorDetalles = resultDetalles.error
      }
    } else {
      const detalleFila = {
        movimiento_id: movimientoId,
        efectivo: parseFloat(desglose.efectivo) || 0,
        transferencia: parseFloat(desglose.transferencia) || 0,
        cheque: parseFloat(desglose.cheque) || 0,
        echeq: parseFloat(desglose.echeq) || 0,
        retencion: parseFloat(desglose.retencion) || 0,
      }
      const resultDetalles = await db.from("detalles_medio_pago").insert([detalleFila])
      errorDetalles = resultDetalles.error
    }

    if (errorDetalles) {
      console.error("Error al insertar detalles:", errorDetalles)
      await db.from("movimientos_caja").delete().eq("id", movimientoId)
      return res.status(400).json({ error: "Error al registrar detalles de pago: " + errorDetalles.message })
    }

    // Retornar movimiento completo
    const { data: movimientoCompleto } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", movimientoId)
      .single()

    getIo()?.emit('caja:changed')
    res.status(201).json(normalizarMovimiento(movimientoCompleto))
  } catch (err) {
    console.error("Error en POST /caja:", err)
    res.status(500).json({ error: err.message })
  }
})

// Actualizar movimiento
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { fecha, tipo, detalle, monto_total, desglose, categoria, con_iva, cliente_id, presupuesto_id } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()

    // Validaciones básicas
    if (tipo && !["ingreso", "egreso"].includes(tipo)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }

    if (monto_total && monto_total <= 0) {
      return res.status(400).json({ error: "Monto total debe ser mayor a 0" })
    }

    if (categoria !== undefined && categoria !== null && categoria !== "" && !CATEGORIAS_CAJA.includes(categoria)) {
      return res.status(400).json({ error: "Categoria inválida. Debe ser 'mano_obra' o 'materiales'" })
    }

    // Actualizar movimiento
    const actualizaciones = {}
    if (fecha !== undefined) actualizaciones.fecha = fecha
    if (tipo !== undefined) actualizaciones.tipo = tipo
    if (detalle !== undefined) actualizaciones[detalleColumn] = detalle
    if (monto_total !== undefined) actualizaciones.monto_total = monto_total
    if (categoria !== undefined) actualizaciones.categoria = categoria || null
    if (con_iva !== undefined) actualizaciones.con_iva = normalizarBoolean(con_iva, true)
    if (cliente_id !== undefined) actualizaciones.cliente_id = cliente_id || null
    if (presupuesto_id !== undefined) actualizaciones.presupuesto_id = presupuesto_id || null

    const { data: movimientoActualizado, error: errorActualizacion } = await db
      .from("movimientos_caja")
      .update(actualizaciones)
      .eq("id", id)
      .select()

    if (errorActualizacion) return res.status(400).json({ error: errorActualizacion.message })
    if (movimientoActualizado.length === 0) return res.status(404).json({ error: "Movimiento no encontrado" })

    // Actualizar detalles si se proporciona desglose
    if (desglose) {
      // Eliminar detalles anteriores
      await db.from("detalles_medio_pago").delete().eq("movimiento_id", id)

      if (detallesSchema.mode === "filas") {
        const detalles = Object.entries(desglose)
          .filter(([_, monto]) => parseFloat(monto) > 0)
          .map(([medio_pago, monto]) => ({
            movimiento_id: id,
            medio_pago,
            monto: parseFloat(monto),
          }))

        if (detalles.length > 0) {
          const { error: errorDetalles } = await db.from("detalles_medio_pago").insert(detalles)
          if (errorDetalles) return res.status(400).json({ error: errorDetalles.message })
        }
      } else {
        const detalleFila = {
          movimiento_id: id,
          efectivo: parseFloat(desglose.efectivo) || 0,
          transferencia: parseFloat(desglose.transferencia) || 0,
          cheque: parseFloat(desglose.cheque) || 0,
          echeq: parseFloat(desglose.echeq) || 0,
          retencion: parseFloat(desglose.retencion) || 0,
        }

        const { error: errorDetalles } = await db.from("detalles_medio_pago").insert([detalleFila])
        if (errorDetalles) return res.status(400).json({ error: errorDetalles.message })
      }
    }

    // Retornar movimiento actualizado
    const { data: movimientoFinal } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    getIo()?.emit('caja:changed')
    res.json(normalizarMovimiento(movimientoFinal))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar movimiento (cascade delete de detalles)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Eliminar detalles primero
    await db.from("detalles_medio_pago").delete().eq("movimiento_id", id)

    // Eliminar movimiento
    const { data, error } = await db
      .from("movimientos_caja")
      .delete()
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Movimiento no encontrado" })

    getIo()?.emit('caja:changed')
    res.json({ mensaje: "Movimiento eliminado", data: data[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
