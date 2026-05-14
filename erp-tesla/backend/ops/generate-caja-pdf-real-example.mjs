import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import { fileURLToPath } from "url"

import db from "../db.js"
import { drawPremiumHeader, drawPremiumSectionTitle, PDF_COLORS, setupPremiumFooter } from "../pdf/premiumTheme.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, "..")
const logoPath = path.join(backendDir, "assets", "logo_presupuesto.png")
const outputDir = path.join(backendDir, "tmp")
const outputPath = path.join(outputDir, "caja-resumen-real-ejemplo.pdf")

const LABEL_CAJA = {
  tesla: "Caja Tesla",
  teslita: "Caja Teslita",
  juani: "Caja Juani",
}

const LABEL_MEDIO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  echeq: "Echeq",
  retencion: "Retencion",
}

const MEDIOS_PAGO = ["efectivo", "transferencia", "cheque", "echeq", "retencion"]

const formatoMoneda = (valor) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(valor) || 0)

const formatoFecha = (valor) => {
  if (!valor) return "-"
  const fecha = valor instanceof Date ? valor : new Date(`${String(valor).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(fecha.getTime())) return "-"
  return fecha.toLocaleDateString("es-AR")
}

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100

const normalizarFechaISO = (valor) => {
  if (!valor) return null

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear()
    const m = String(valor.getMonth() + 1).padStart(2, "0")
    const d = String(valor.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }

  const texto = String(valor).split("T")[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto
  }

  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null

  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const normalizarFechaArg = (value) => {
  if (!value) return null
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (match) {
    const day = String(match[1]).padStart(2, "0")
    const month = String(match[2]).padStart(2, "0")
    const year = match[3]
    return `${year}-${month}-${day}`
  }
  return null
}

const getArgValue = (flag) => {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

const normalizarCajaArg = (value) => {
  const raw = String(value || "").trim().toLowerCase()
  if (!raw) return null
  if (["tesla", "teslita", "juani"].includes(raw)) return raw
  return null
}

const extractMonto = (detalle) => roundMoney(detalle?.monto || detalle?.importe || 0)

const extractMovMediosText = (movimiento) => {
  const detalles = (movimiento?.detalles_medio_pago || [])
    .filter((d) => extractMonto(d) > 0)
    .map((d) => {
      const nombre = LABEL_MEDIO[String(d?.medio_pago || "").toLowerCase()] || String(d?.medio_pago || "-")
      const identificador = String(d?.identificador || "").trim()
      return identificador
        ? `${nombre} (${identificador}): ${formatoMoneda(extractMonto(d))}`
        : `${nombre}: ${formatoMoneda(extractMonto(d))}`
    })

  return detalles.join("\n") || "-"
}

const getMostFrequentCaja = (movimientos = []) => {
  const counter = new Map()
  movimientos.forEach((mov) => {
    const key = String(mov?.caja_codigo || "").toLowerCase()
    if (!key) return
    counter.set(key, (counter.get(key) || 0) + 1)
  })

  let winner = ""
  let max = -1
  for (const [key, qty] of counter.entries()) {
    if (qty > max) {
      max = qty
      winner = key
    }
  }
  return winner || "tesla"
}

const getDateRange = (movimientos = []) => {
  const fechas = movimientos
    .map((mov) => normalizarFechaISO(mov?.fecha))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()

  if (!fechas.length) return { desde: null, hasta: null }
  return { desde: fechas[0], hasta: fechas[fechas.length - 1] }
}

const actualizarSaldoPorMedio = (acumulador, movimiento) => {
  const signo = String(movimiento?.tipo || "").toLowerCase() === "egreso" ? -1 : 1
  let montoAplicado = 0
  const detalles = Array.isArray(movimiento?.detalles_medio_pago) ? movimiento.detalles_medio_pago : []

  detalles.forEach((detalle) => {
    const medio = String(detalle?.medio_pago || "").toLowerCase()
    const monto = Number(detalle?.monto || 0)
    if (!(monto > 0)) return

    if (medio === "efectivo") {
      acumulador.efectivo += signo * monto
      montoAplicado += monto
    }

    if (medio === "cheque") {
      acumulador.cheques += signo * monto
      montoAplicado += monto
    }
  })

  if (detalles.length === 0 && !(montoAplicado > 0)) {
    acumulador.efectivo += signo * Number(movimiento?.monto_total || 0)
  }
}

const drawSectionTitle = (doc, title) => {
  drawPremiumSectionTitle(doc, title)
}

const drawKpiCard = ({ doc, x, y, width, title, value, detailLines = [], highlight = false }) => {
  const height = detailLines.length > 0 ? 64 : 38
  doc.roundedRect(x, y, width, height, 6).fill(highlight ? "#dbeafe" : PDF_COLORS.lightAlt)
  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8)
  doc.text(String(title || "").toUpperCase(), x + 8, y + 7, { width: width - 16, lineBreak: false })
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10.2)
  doc.text(formatoMoneda(value), x + 8, y + 20, { width: width - 16, lineBreak: false })

  detailLines.forEach((line, index) => {
    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.2)
    doc.text(line, x + 8, y + 36 + index * 14, { width: width - 16, lineBreak: false })
  })

  doc.fillColor(PDF_COLORS.ink)
}

const run = async () => {
  const desdeArg = normalizarFechaArg(getArgValue("--desde"))
  const hastaArg = normalizarFechaArg(getArgValue("--hasta"))
  const cajaArgRaw = getArgValue("--caja")
  const cajaArg = normalizarCajaArg(cajaArgRaw)

  if ((getArgValue("--desde") && !desdeArg) || (getArgValue("--hasta") && !hastaArg)) {
    throw new Error("Formato de fecha invalido. Usa YYYY-MM-DD o DD/MM/YYYY")
  }

  if (desdeArg && hastaArg && desdeArg > hastaArg) {
    throw new Error("El rango indicado es invalido: desde es mayor a hasta")
  }

  if (cajaArgRaw && !cajaArg) {
    throw new Error("Caja invalida. Usa --caja tesla|teslita|juani")
  }

  let query = db
    .from("movimientos_caja")
    .select(`
      id,
      fecha,
      caja_codigo,
      tipo,
      detalle,
      destinatario,
      monto_total,
      detalles_medio_pago(*)
    `)
    .order("fecha", { ascending: false })

  if (desdeArg) {
    query = query.gte("fecha", desdeArg)
  }
  if (hastaArg) {
    query = query.lte("fecha", hastaArg)
  }
  if (cajaArg) {
    query = query.eq("caja_codigo", cajaArg)
  }

  const { data: rawMovimientos, error } = await db
    .from("movimientos_caja")
    .select(`
      id,
      fecha,
      caja_codigo,
      tipo,
      detalle,
      destinatario,
      monto_total,
      detalles_medio_pago(*)
    `)
    .order("fecha", { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`No se pudo validar la conexion: ${error.message}`)
  }

  const result = await query
  const rawMovimientosRango = result?.data
  const errorRango = result?.error

  if (errorRango) {
    throw new Error(`No se pudo leer movimientos reales: ${errorRango.message}`)
  }

  const movimientos = Array.isArray(rawMovimientosRango) ? rawMovimientosRango : []
  if (!movimientos.length) {
    if (desdeArg || hastaArg) {
      throw new Error(`No hay movimientos en la base para el rango solicitado (${desdeArg || "..."} a ${hastaArg || "..."})${cajaArg ? ` en ${cajaArg}` : ""}`)
    }
    throw new Error("No hay movimientos en la base para generar un ejemplo real")
  }

  const cajaSeleccionada = cajaArg || getMostFrequentCaja(movimientos)
  const source = movimientos.filter((mov) => String(mov?.caja_codigo || "").toLowerCase() === cajaSeleccionada)

  if (!source.length) {
    throw new Error(`No hay movimientos para la caja ${cajaSeleccionada} en el rango solicitado`)
  }

  const rangoDetectado = getDateRange(source)
  const rango = {
    desde: desdeArg || rangoDetectado.desde,
    hasta: hastaArg || rangoDetectado.hasta,
  }
  const cantidadMovimientos = source.length
  const cantidadIngresos = source.filter((mov) => mov.tipo === "ingreso").length
  const cantidadEgresos = source.filter((mov) => mov.tipo === "egreso").length

  const totalIngresos = roundMoney(
    source
      .filter((mov) => mov.tipo === "ingreso")
      .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0)
  )
  const totalEgresos = roundMoney(
    source
      .filter((mov) => mov.tipo === "egreso")
      .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0)
  )
  const balance = roundMoney(totalIngresos - totalEgresos)

  const desglose = MEDIOS_PAGO.map((medio) => ({
    medio,
    ingresos: 0,
    egresos: 0,
    total: 0,
  }))
  const byMedio = new Map(desglose.map((item) => [item.medio, item]))

  source.forEach((mov) => {
    ;(mov.detalles_medio_pago || []).forEach((detalle) => {
      const medio = String(detalle?.medio_pago || "").toLowerCase()
      const monto = extractMonto(detalle)
      const target = byMedio.get(medio)
      if (!target || !(monto > 0)) return
      if (mov.tipo === "ingreso") {
        target.ingresos = roundMoney(target.ingresos + monto)
      } else {
        target.egresos = roundMoney(target.egresos + monto)
      }
      target.total = roundMoney(target.ingresos - target.egresos)
    })
  })

  const transferenciasCobradas = roundMoney(desglose.find((d) => d.medio === "transferencia")?.ingresos || 0)
  const transferenciasPagadas = roundMoney(desglose.find((d) => d.medio === "transferencia")?.egresos || 0)
  const retenciones = roundMoney(desglose.find((d) => d.medio === "retencion")?.ingresos || 0)

  const { data: semanaData } = await db
    .from("cajas_semanales")
    .select("*")
    .eq("caja_codigo", cajaSeleccionada)
    .order("fecha_fin", { ascending: false })
    .limit(200)

  const semanaExacta = (semanaData || []).find((semana) => {
    const inicio = normalizarFechaISO(semana?.fecha_inicio)
    const fin = normalizarFechaISO(semana?.fecha_fin)
    return inicio === rango.desde && fin === rango.hasta
  })
  const semanaReferencia = semanaExacta || (semanaData || [])[0] || null

  const { data: historialMovimientos, error: historialError } = await db
    .from("movimientos_caja")
    .select(`
      id,
      fecha,
      tipo,
      monto_total,
      detalles_medio_pago(*)
    `)
    .eq("caja_codigo", cajaSeleccionada)
    .order("fecha", { ascending: true })

  if (historialError) {
    throw new Error(`No se pudo leer historial para saldo inicial: ${historialError.message}`)
  }

  const acumuladorPrevio = { efectivo: 0, cheques: 0 }
  ;(historialMovimientos || []).forEach((mov) => {
    const fechaMov = normalizarFechaISO(mov?.fecha)
    if (!fechaMov || !rango.desde) return
    if (fechaMov >= rango.desde) return
    actualizarSaldoPorMedio(acumuladorPrevio, mov)
  })

  const saldoInicialEfectivo = roundMoney(acumuladorPrevio.efectivo)
  const saldoInicialCheques = roundMoney(acumuladorPrevio.cheques)
  const saldoInicial = roundMoney(saldoInicialEfectivo + saldoInicialCheques)

  const acumuladorFinal = { efectivo: saldoInicialEfectivo, cheques: saldoInicialCheques }
  source.forEach((mov) => {
    actualizarSaldoPorMedio(acumuladorFinal, mov)
  })

  const saldoFinalEfectivo = roundMoney(acumuladorFinal.efectivo)
  const saldoFinalCheques = roundMoney(acumuladorFinal.cheques)
  const saldoFinal = roundMoney(saldoFinalEfectivo + saldoFinalCheques)

  const saldoBancoInformado = Number(semanaExacta?.saldo_banco ?? semanaReferencia?.saldo_banco ?? 0)
  const pendienteEcheq = Number(semanaExacta?.saldo_pendiente_echeq ?? semanaReferencia?.saldo_pendiente_echeq ?? 0)

  const doc = new PDFDocument({ size: "A4", margin: 45 })
  await fs.promises.mkdir(outputDir, { recursive: true })
  doc.pipe(fs.createWriteStream(outputPath))
  setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Ejemplo real resumen de caja" })

  const pageWidth = doc.page.width
  const filtro = [
    LABEL_CAJA[cajaSeleccionada] || "Caja",
    rango.desde ? `Desde ${formatoFecha(rango.desde)}` : "",
    rango.hasta ? `Hasta ${formatoFecha(rango.hasta)}` : "",
    "Todos los tipos",
  ].filter(Boolean).join(" - ")

  const headerBottom = drawPremiumHeader(doc, {
    title: "TESLA MONTAJES ELECTRICOS",
    subtitle: `Ejemplo real ${LABEL_CAJA[cajaSeleccionada] || "Caja"}`,
    accentText: filtro,
    logoPath,
  })

  doc.fillColor(PDF_COLORS.ink)
  doc.y = headerBottom + 12

  const gridLeft = 45
  const gridRight = pageWidth - 45
  const gridWidth = gridRight - gridLeft

  const drawH = (y) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.6).moveTo(gridLeft, y).lineTo(gridRight, y).stroke()
  }
  const drawV = (x, y, h) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.6).moveTo(x, y).lineTo(x, y + h).stroke()
  }

  doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10.5)
  const metaY = doc.y
  doc.text("RESUMEN SEMANAL", gridLeft, metaY, { width: 200 })
  doc.font("Helvetica").fontSize(9)
  doc.text(`${formatoFecha(rango.desde)} al ${formatoFecha(rango.hasta)}`, gridLeft + 205, metaY, { width: 170, align: "right", lineBreak: false })
  doc.text(`Caja: ${LABEL_CAJA[cajaSeleccionada] || cajaSeleccionada}`, gridLeft + 380, metaY, { width: 170, align: "right" })
  doc.y = metaY + 14

  // Tabla principal estilo planilla
  const t1Y = doc.y
  const t1HeaderH = 20
  const t1RowH = 18
  const t1Rows = [
    { c: "Saldo inicial", total: saldoInicial, efectivo: saldoInicialEfectivo, cheques: saldoInicialCheques },
    { c: "Ingresos semana", total: totalIngresos, efectivo: null, cheques: null },
    { c: "Egresos semana", total: totalEgresos, efectivo: null, cheques: null },
    { c: "Saldo final", total: saldoFinal, efectivo: saldoFinalEfectivo, cheques: saldoFinalCheques },
  ]
  const t1H = t1HeaderH + t1Rows.length * t1RowH
  const conceptWidth = 220
  const amountWidth = (gridWidth - conceptWidth) / 3
  const c1 = gridLeft
  const c2 = c1 + conceptWidth
  const c3 = c2 + amountWidth
  const c4 = c3 + amountWidth

  doc.rect(gridLeft, t1Y, gridWidth, t1HeaderH).fill(PDF_COLORS.navy)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
  doc.text("CONCEPTO", c1 + 8, t1Y + 6, { width: conceptWidth - 16 })
  doc.text("TOTAL", c2 + 8, t1Y + 6, { width: amountWidth - 16, align: "right", lineBreak: false })
  doc.text("EFECTIVO", c3 + 8, t1Y + 6, { width: amountWidth - 16, align: "right", lineBreak: false })
  doc.text("CHEQUES", c4 + 8, t1Y + 6, { width: amountWidth - 16, align: "right", lineBreak: false })

  drawV(c2, t1Y, t1H)
  drawV(c3, t1Y, t1H)
  drawV(c4, t1Y, t1H)
  drawH(t1Y + t1HeaderH)

  t1Rows.forEach((row, i) => {
    const y = t1Y + t1HeaderH + i * t1RowH
    if (i % 2 === 0) {
      doc.rect(gridLeft, y, gridWidth, t1RowH).fill("#f8fafc")
    }
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.6)
    doc.text(row.c, c1 + 8, y + 5, { width: conceptWidth - 16, lineBreak: false })
    doc.text(formatoMoneda(row.total), c2 + 8, y + 5, { width: amountWidth - 16, align: "right", lineBreak: false })
    doc.text(row.efectivo === null ? "-" : formatoMoneda(row.efectivo), c3 + 8, y + 5, { width: amountWidth - 16, align: "right", lineBreak: false })
    doc.text(row.cheques === null ? "-" : formatoMoneda(row.cheques), c4 + 8, y + 5, { width: amountWidth - 16, align: "right", lineBreak: false })
    drawH(y + t1RowH)
  })

  drawV(gridLeft, t1Y, t1H)
  drawV(gridRight, t1Y, t1H)
  doc.y = t1Y + t1H + 10

  // Tabla de indicadores
  const t2Y = doc.y
  const t2HeaderH = 20
  const t2RowH = 18
  const t2H = t2HeaderH + t2RowH
  const kpiWidth = gridWidth / 4
  const d1 = gridLeft
  const d2 = d1 + kpiWidth
  const d3 = d2 + kpiWidth
  const d4 = d3 + kpiWidth

  doc.rect(gridLeft, t2Y, gridWidth, t2HeaderH).fill(PDF_COLORS.navy)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
  doc.text("MOVIMIENTOS", d1 + 8, t2Y + 6, { width: kpiWidth - 16 })
  doc.text("INGRESOS", d2 + 8, t2Y + 6, { width: kpiWidth - 16 })
  doc.text("EGRESOS", d3 + 8, t2Y + 6, { width: kpiWidth - 16 })
  doc.text("BALANCE", d4 + 8, t2Y + 6, { width: kpiWidth - 16, align: "right", lineBreak: false })

  drawV(d2, t2Y, t2H)
  drawV(d3, t2Y, t2H)
  drawV(d4, t2Y, t2H)
  drawH(t2Y + t2HeaderH)

  doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10)
  doc.text(String(cantidadMovimientos), d1 + 8, t2Y + t2HeaderH + 4, { width: kpiWidth - 16 })
  doc.text(String(cantidadIngresos), d2 + 8, t2Y + t2HeaderH + 4, { width: kpiWidth - 16 })
  doc.text(String(cantidadEgresos), d3 + 8, t2Y + t2HeaderH + 4, { width: kpiWidth - 16 })
  doc.text(formatoMoneda(balance), d4 + 8, t2Y + t2HeaderH + 4, { width: kpiWidth - 16, align: "right", lineBreak: false })
  drawH(t2Y + t2H)
  drawV(gridLeft, t2Y, t2H)
  drawV(gridRight, t2Y, t2H)

  doc.y = t2Y + t2H + 10

  // Resumen bancario en tabla tipo planilla
  drawSectionTitle(doc, "Resumen bancario")
  const netoBancario = transferenciasCobradas - transferenciasPagadas + retenciones
  const bankRows = [
    { c: "Saldo banco informado", v: saldoBancoInformado },
    { c: "Pendiente eCheqs", v: pendienteEcheq },
    { c: "Transferencias cobradas", v: transferenciasCobradas },
    { c: "Transferencias pagadas", v: transferenciasPagadas },
    { c: "Retenciones", v: retenciones },
    { c: "Neto bancario", v: netoBancario },
  ]

  const bY = doc.y
  const bHeaderH = 20
  const bRowH = 18
  const bH = bHeaderH + bankRows.length * bRowH
  const bx1 = gridLeft
  const bx2 = bx1 + 340
  const bx3 = gridRight

  doc.rect(gridLeft, bY, gridWidth, bHeaderH).fill(PDF_COLORS.navy)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
  doc.text("CONCEPTO", bx1 + 8, bY + 6, { width: 320 })
  doc.text("VALOR", bx2 + 8, bY + 6, { width: 120, align: "right", lineBreak: false })
  drawV(bx2, bY, bH)
  drawH(bY + bHeaderH)

  bankRows.forEach((row, i) => {
    const y = bY + bHeaderH + i * bRowH
    if (i % 2 === 0) {
      doc.rect(gridLeft, y, gridWidth, bRowH).fill("#f8fafc")
    }
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.6)
    doc.text(row.c, bx1 + 8, y + 5, { width: 320, lineBreak: false })
    doc.text(formatoMoneda(row.v), bx2 + 8, y + 5, { width: 120, align: "right", lineBreak: false })
    drawH(y + bRowH)
  })

  drawV(gridLeft, bY, bH)
  drawV(gridRight, bY, bH)
  doc.y = bY + bH + 10

  doc.addPage()
  const detalleHeaderBottom = drawPremiumHeader(doc, {
    title: "TESLA MONTAJES ELECTRICOS",
    subtitle: "Detalle de movimientos de caja",
    accentText: filtro,
    logoPath,
  })
  doc.fillColor(PDF_COLORS.ink)
  doc.y = detalleHeaderBottom + 14

  drawSectionTitle(doc, "Desglose por medio de pago")
  const colMedioX = 55
  const colIngresosX = 190
  const colEgresosX = 315
  const colTotalX = 440
  const colMedioWidth = 120
  const colMontoWidth = 105
  const tableLeft = 45
  const tableRight = pageWidth - 45

  const drawVerticalSeparators = (y, height) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
    doc.moveTo(colEgresosX - 10, y).lineTo(colEgresosX - 10, y + height).stroke()
    doc.moveTo(colTotalX - 10, y).lineTo(colTotalX - 10, y + height).stroke()
  }
  const drawHorizontalSeparator = (y) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.6)
    doc.moveTo(tableLeft, y).lineTo(tableRight, y).stroke()
  }
  const drawTableBorders = (topY, bottomY) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
    doc.moveTo(tableLeft, topY).lineTo(tableLeft, bottomY).stroke()
    doc.moveTo(tableRight, topY).lineTo(tableRight, bottomY).stroke()
  }

  const tableTopY = doc.y
  doc.rect(45, tableTopY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
  drawVerticalSeparators(tableTopY, 22)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
  doc.text("MEDIO", colMedioX, tableTopY + 7, { width: colMedioWidth })
  doc.text("INGRESOS", colIngresosX, tableTopY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text("EGRESOS", colEgresosX, tableTopY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text("TOTAL", colTotalX, tableTopY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  drawHorizontalSeparator(tableTopY + 22)
  doc.fillColor(PDF_COLORS.ink)

  let yDesglose = tableTopY + 22
  desglose.forEach((item, index) => {
    const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
    doc.rect(45, yDesglose, pageWidth - 90, 20).fill(bg)
    drawVerticalSeparators(yDesglose, 20)
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.8)
    doc.text(LABEL_MEDIO[item.medio] || item.medio, colMedioX, yDesglose + 6, { width: colMedioWidth, lineBreak: false })
    doc.text(formatoMoneda(item.ingresos), colIngresosX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(item.egresos), colEgresosX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(item.total), colTotalX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    drawHorizontalSeparator(yDesglose + 20)
    yDesglose += 20
  })

  doc.rect(45, yDesglose, pageWidth - 90, 22).fill(PDF_COLORS.card)
  drawVerticalSeparators(yDesglose, 22)
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(9.2)
  doc.text("TOTAL GENERAL", colMedioX, yDesglose + 7, { width: colMedioWidth })
  doc.text(formatoMoneda(totalIngresos), colIngresosX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text(formatoMoneda(totalEgresos), colEgresosX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text(formatoMoneda(balance), colTotalX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  drawHorizontalSeparator(yDesglose)
  yDesglose += 22
  drawHorizontalSeparator(yDesglose)
  drawTableBorders(tableTopY, yDesglose)
  doc.fillColor(PDF_COLORS.ink)
  doc.y = yDesglose + 8

  drawSectionTitle(doc, "Detalle de movimientos")
  const headerY = doc.y
  doc.rect(45, headerY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
  doc.text("FECHA", 50, headerY + 8, { width: 68 })
  doc.text("CAJA", 120, headerY + 8, { width: 72 })
  doc.text("DETALLE", 194, headerY + 8, { width: 158 })
  doc.text("MEDIOS", 345, headerY + 8, { width: 150 })
  doc.text("MONTO", 456, headerY + 8, { width: 44, align: "right" })
  doc.fillColor(PDF_COLORS.ink)
  doc.y = headerY + 24

  let yMov = doc.y
  source.forEach((mov, index) => {
      const textoCaja = `${LABEL_CAJA[mov.caja_codigo] || mov.caja_codigo} / ${mov.tipo === "ingreso" ? "Ingreso" : "Egreso"}`
      const textoDetalle = String(mov.detalle || mov.destinatario || "-")
      const textoMedios = extractMovMediosText(mov)
      const textoMonto = formatoMoneda(mov.monto_total)

      const contenidoHeight = Math.max(
        doc.heightOfString(formatoFecha(mov.fecha), { width: 68 }),
        doc.heightOfString(textoCaja, { width: 72 }),
        doc.heightOfString(textoDetalle, { width: 135 }),
        doc.heightOfString(textoMedios, { width: 150 }),
        doc.heightOfString(textoMonto, { width: 60, align: "right" }),
      )
      const rowHeight = Math.max(26, contenidoHeight + 12)

      if (yMov + rowHeight > doc.page.height - 74) {
        doc.addPage()
        const newHeaderBottom = drawPremiumHeader(doc, {
          title: "TESLA MONTAJES ELECTRICOS",
          subtitle: "Detalle de movimientos de caja",
          accentText: filtro,
          logoPath,
        })
        doc.fillColor(PDF_COLORS.ink)
        doc.y = newHeaderBottom + 14
        drawSectionTitle(doc, "Detalle de movimientos")
        const hY = doc.y
        doc.rect(45, hY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
        doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
        doc.text("FECHA", 50, hY + 8, { width: 68 })
        doc.text("CAJA", 120, hY + 8, { width: 72 })
        doc.text("DETALLE", 194, hY + 8, { width: 158 })
        doc.text("MEDIOS", 345, hY + 8, { width: 150 })
        doc.text("MONTO", 456, hY + 8, { width: 44, align: "right" })
        doc.fillColor(PDF_COLORS.ink)
        yMov = hY + 24
      }

      const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
      doc.rect(45, yMov, pageWidth - 90, rowHeight).fill(bg)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
      doc.text(formatoFecha(mov.fecha), 50, yMov + 6, { width: 68 })
      doc.text(textoCaja, 120, yMov + 6, { width: 72 })
      doc.text(textoDetalle, 185, yMov + 6, { width: 135 })
      doc.text(textoMedios, 320, yMov + 6, { width: 150 })
      doc.text(textoMonto, 456, yMov + 6, { width: 60, align: "right" })
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.5).moveTo(60, yMov + rowHeight).lineTo(pageWidth - 60, yMov + rowHeight).stroke()
      yMov += rowHeight + 4
    })

  doc.end()
  await new Promise((resolve) => doc.on("end", resolve))

  console.log(`Ejemplo real generado en: ${outputPath}`)
  if (desdeArg || hastaArg) {
    console.log(`Rango usado: ${desdeArg || "..."} a ${hastaArg || "..."}`)
  }
  console.log(`Caja usada: ${cajaSeleccionada}`)
  console.log(`Movimientos incluidos: ${source.length}`)
  console.log(`Semana tomada para saldos bancarios: ${normalizarFechaISO(semanaExacta?.fecha_inicio) || "(fallback)"} - ${normalizarFechaISO(semanaExacta?.fecha_fin) || "(fallback)"}`)
}

run()
  .catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })