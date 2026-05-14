import fs from "fs"
import path from "path"
import PDFDocument from "pdfkit"
import { fileURLToPath } from "url"

import { drawPremiumHeader, drawPremiumSectionTitle, PDF_COLORS, setupPremiumFooter } from "../pdf/premiumTheme.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, "..")
const logoPath = path.join(backendDir, "assets", "logo_presupuesto.png")
const outputDir = path.join(backendDir, "tmp")
const outputPath = path.join(outputDir, "caja-resumen-preview.pdf")

const formatoMoneda = (valor) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(valor) || 0)

const formatoFecha = (valor) => {
  const fecha = valor instanceof Date ? valor : new Date(valor)
  return fecha.toLocaleDateString("es-AR")
}

const pageMargin = 45
const data = {
  titulo: "Resumen semanal Caja Tesla",
  filtro: "Caja Tesla - Desde 05/05/2026 - Hasta 09/05/2026 - Todos los tipos",
  periodo: "05/05/2026 al 09/05/2026",
  caja: {
    saldoInicial: 1250000,
    ingresos: 3482500,
    egresos: 1923700,
    saldoFinal: 2808800,
    saldoInicialEfectivo: 620000,
    saldoInicialCheques: 630000,
    saldoFinalEfectivo: 1764000,
    saldoFinalCheques: 1044800,
  },
  movimientos: {
    cantidad: 22,
    ingresos: 13,
    egresos: 9,
    balance: 1558800,
  },
  banco: {
    saldoInformado: 4185000,
    pendienteEcheq: 1275000,
    transferenciasCobradas: 2148000,
    transferenciasPagadas: 932000,
    retenciones: 286000,
  },
  desglose: [
    { medio: "Efectivo", ingresos: 950000, egresos: 630000, total: 320000 },
    { medio: "Transferencia", ingresos: 2148000, egresos: 932000, total: 1216000 },
    { medio: "Cheque", ingresos: 184500, egresos: 0, total: 184500 },
    { medio: "Echeq", ingresos: 200000, egresos: 361700, total: -161700 },
    { medio: "Retencion", ingresos: 286000, egresos: 0, total: 286000 },
  ],
  detalle: [
    { fecha: "2026-05-05", caja: "Caja Tesla / Ingreso", detalle: "Cobro anticipo obra Barrio Norte", medios: "Transferencia: $ 1.250.000,00", monto: 1250000 },
    { fecha: "2026-05-05", caja: "Caja Tesla / Egreso", detalle: "Pago materiales electricos", medios: "Efectivo: $ 320.000,00\nCheque (A-1932): $ 180.000,00", monto: 500000 },
    { fecha: "2026-05-06", caja: "Caja Tesla / Ingreso", detalle: "Cobro certificacion avance", medios: "Transferencia: $ 898.000,00\nRetencion: $ 286.000,00", monto: 1184000 },
    { fecha: "2026-05-07", caja: "Caja Tesla / Egreso", detalle: "Pago mano de obra contratista", medios: "Transferencia: $ 612.000,00", monto: 612000 },
    { fecha: "2026-05-08", caja: "Caja Tesla / Egreso", detalle: "Gastos varios y movilidad", medios: "Efectivo: $ 143.700,00", monto: 143700 },
  ],
}

const doc = new PDFDocument({ size: "A4", margin: pageMargin })
await fs.promises.mkdir(outputDir, { recursive: true })
doc.pipe(fs.createWriteStream(outputPath))

setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Vista previa resumen de caja" })

const pageWidth = doc.page.width

const drawSectionTitle = (title) => {
  drawPremiumSectionTitle(doc, title)
}

const drawKpiCard = ({ x, y, width, title, value, detailLines = [], highlight = false }) => {
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

const drawSummaryBand = () => {
  const resumenY = doc.y
  doc.roundedRect(45, resumenY, pageWidth - 90, 82, 6).fill(PDF_COLORS.card)
  const balanceTexto = formatoMoneda(data.movimientos.balance)
  const balanceInicioX = 430 + 110 - doc.font("Helvetica-Bold").fontSize(13).widthOfString(balanceTexto)

  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
  doc.text("MOVIMIENTOS", 58, resumenY + 10, { width: 100 })
  doc.text("INGRESOS", 185, resumenY + 10, { width: 120 })
  doc.text("EGRESOS", 320, resumenY + 10, { width: 120 })
  doc.text("BALANCE", balanceInicioX, resumenY + 10, { width: 110, align: "left" })

  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(13)
  doc.text(String(data.movimientos.cantidad), 58, resumenY + 24, { width: 100 })
  doc.text(String(data.movimientos.ingresos), 185, resumenY + 24, { width: 120 })
  doc.text(String(data.movimientos.egresos), 320, resumenY + 24, { width: 120 })
  doc.text(balanceTexto, 430, resumenY + 24, { width: 110, align: "right" })

  doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, resumenY + 48).lineTo(pageWidth - 58, resumenY + 48).stroke()
  doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(9)
  doc.text(`Generado: ${formatoFecha(new Date())}`, 58, resumenY + 56, { width: pageWidth - 116 })
  doc.fillColor(PDF_COLORS.ink)
  doc.y = resumenY + 92
}

const drawBankBox = () => {
  drawSectionTitle("Resumen bancario")

  const metrics = [
    { label: "Saldo banco informado", value: data.banco.saldoInformado },
    { label: "Pendiente eCheqs", value: data.banco.pendienteEcheq },
    { label: "Retenciones", value: data.banco.retenciones },
    { label: "Transferencias cobradas", value: data.banco.transferenciasCobradas },
    { label: "Transferencias pagadas", value: data.banco.transferenciasPagadas },
    { label: "Neto bancario", value: data.banco.transferenciasCobradas - data.banco.transferenciasPagadas + data.banco.retenciones },
  ]

  const tableLeft = 45
  const tableRight = pageWidth - 45
  const colConceptoX = 55
  const colValorX = 360
  const colConceptoWidth = 280
  const colValorWidth = 135

  const drawVerticalSeparator = (y, height) => {
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
    doc.moveTo(colValorX - 12, y).lineTo(colValorX - 12, y + height).stroke()
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

  const headerY = doc.y
  doc.rect(tableLeft, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
  drawVerticalSeparator(headerY, 22)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
  doc.text("CONCEPTO", colConceptoX, headerY + 7, { width: colConceptoWidth })
  doc.text("VALOR", colValorX, headerY + 7, { width: colValorWidth, align: "right", lineBreak: false })
  drawHorizontalSeparator(headerY + 22)
  doc.fillColor(PDF_COLORS.ink)

  const tableTopY = headerY
  let y = headerY + 22
  metrics.forEach((item, index) => {
    const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
    doc.rect(tableLeft, y, pageWidth - 90, 20).fill(bg)
    drawVerticalSeparator(y, 20)
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.8)
    doc.text(item.label, colConceptoX, y + 6, { width: colConceptoWidth, lineBreak: false })
    doc.text(formatoMoneda(item.value), colValorX, y + 6, { width: colValorWidth, align: "right", lineBreak: false })
    drawHorizontalSeparator(y + 20)
    y += 20
  })

  drawTableBorders(tableTopY, y)
  doc.fillColor(PDF_COLORS.ink)
  doc.y = y + 10
}

const drawDesgloseTable = () => {
  drawSectionTitle("Desglose por medio de pago")

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

  const headerY = doc.y
  doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
  drawVerticalSeparators(headerY, 22)
  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
  doc.text("MEDIO", colMedioX, headerY + 7, { width: colMedioWidth })
  doc.text("INGRESOS", colIngresosX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text("EGRESOS", colEgresosX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text("TOTAL", colTotalX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  drawHorizontalSeparator(headerY + 22)
  doc.fillColor(PDF_COLORS.ink)

  const tableTopY = headerY
  let y = headerY + 22
  data.desglose.forEach((item, index) => {
    const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
    doc.rect(45, y, pageWidth - 90, 20).fill(bg)
    drawVerticalSeparators(y, 20)
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.8)
    doc.text(item.medio, colMedioX, y + 6, { width: colMedioWidth, lineBreak: false })
    doc.text(formatoMoneda(item.ingresos), colIngresosX, y + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(item.egresos), colEgresosX, y + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(item.total), colTotalX, y + 6, { width: colMontoWidth, align: "right", lineBreak: false })
    drawHorizontalSeparator(y + 20)
    y += 20
  })

  doc.rect(45, y, pageWidth - 90, 22).fill(PDF_COLORS.card)
  drawVerticalSeparators(y, 22)
  doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(9.2)
  doc.text("TOTAL GENERAL", colMedioX, y + 7, { width: colMedioWidth })
  doc.text(formatoMoneda(data.caja.ingresos), colIngresosX, y + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text(formatoMoneda(data.caja.egresos), colEgresosX, y + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  doc.text(formatoMoneda(data.movimientos.balance), colTotalX, y + 7, { width: colMontoWidth, align: "right", lineBreak: false })
  drawHorizontalSeparator(y)
  y += 22
  drawHorizontalSeparator(y)
  drawTableBorders(tableTopY, y)
  doc.fillColor(PDF_COLORS.ink)
  doc.y = y + 10
}

const drawDetalleHeader = () => {
  const detalleHeaderBottom = drawPremiumHeader(doc, {
    title: "TESLA MONTAJES ELECTRICOS",
    subtitle: "Detalle de movimientos de caja",
    accentText: data.filtro,
    logoPath,
  })
  doc.fillColor(PDF_COLORS.ink)
  doc.y = detalleHeaderBottom + 14
}

const drawMovHeader = () => {
  drawSectionTitle("Detalle de movimientos")
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
}

const headerBottom = drawPremiumHeader(doc, {
  title: "TESLA MONTAJES ELECTRICOS",
  subtitle: data.titulo,
  accentText: data.filtro,
  logoPath,
})

doc.fillColor(PDF_COLORS.ink)
doc.y = headerBottom + 15

const periodoY = doc.y
doc.roundedRect(45, periodoY, pageWidth - 90, 42, 6).fill("#dbeafe")
doc.fillColor("#1e3a8a").font("Helvetica-Bold").fontSize(9)
doc.text("SEMANA IMPRESA", 58, periodoY + 10, { width: 140 })
doc.font("Helvetica").fontSize(11)
doc.text(data.periodo, 180, periodoY + 9, { width: pageWidth - 240, align: "right" })
doc.fillColor(PDF_COLORS.ink)
doc.y = periodoY + 54

const semanalY = doc.y
const semanalHeight = 138
const cardWidth = (pageWidth - 110) / 4
doc.roundedRect(45, semanalY, pageWidth - 90, semanalHeight, 8).fill(PDF_COLORS.card)
doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
doc.text("Caja semanal", 58, semanalY + 10, { width: 180 })
doc.font("Helvetica-Bold").fontSize(11)
doc.text(data.periodo, 58, semanalY + 28, { width: 220 })
doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8.8)
doc.text("La portada prioriza lectura ejecutiva. El desglose por medio de pago baja a la segunda pagina, antes del detalle de movimientos.", 58, semanalY + 46, { width: pageWidth - 116 })

const cardsY = semanalY + 88
drawKpiCard({ x: 58, y: cardsY, width: cardWidth, title: "Saldo inicial", value: data.caja.saldoInicial, detailLines: [`EFECTIVO: ${formatoMoneda(data.caja.saldoInicialEfectivo)}`, `CHEQUES: ${formatoMoneda(data.caja.saldoInicialCheques)}`] })
drawKpiCard({ x: 58 + (cardWidth + 4), y: cardsY, width: cardWidth, title: "Ingresos semana", value: data.caja.ingresos })
drawKpiCard({ x: 58 + (cardWidth + 4) * 2, y: cardsY, width: cardWidth, title: "Egresos semana", value: data.caja.egresos })
drawKpiCard({ x: 58 + (cardWidth + 4) * 3, y: cardsY, width: cardWidth, title: "Saldo final", value: data.caja.saldoFinal, detailLines: [`EFECTIVO: ${formatoMoneda(data.caja.saldoFinalEfectivo)}`, `CHEQUES: ${formatoMoneda(data.caja.saldoFinalCheques)}`], highlight: true })
doc.fillColor(PDF_COLORS.ink)
doc.y = semanalY + semanalHeight + 14

drawSummaryBand()
drawBankBox()

doc.addPage()
drawDetalleHeader()
drawDesgloseTable()
drawMovHeader()

let yMov = doc.y
data.detalle.forEach((mov, index) => {
  const contenidoHeight = Math.max(
    doc.heightOfString(formatoFecha(mov.fecha), { width: 68 }),
    doc.heightOfString(mov.caja, { width: 72 }),
    doc.heightOfString(mov.detalle, { width: 135 }),
    doc.heightOfString(mov.medios || "-", { width: 150 }),
    doc.heightOfString(formatoMoneda(mov.monto), { width: 60, align: "right" }),
  )
  const rowHeight = Math.max(26, contenidoHeight + 12)

  if (yMov + rowHeight > doc.page.height - 74) {
    doc.addPage()
    drawDetalleHeader()
    drawMovHeader()
    yMov = doc.y
  }

  const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
  doc.rect(45, yMov, pageWidth - 90, rowHeight).fill(bg)
  doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
  doc.text(formatoFecha(mov.fecha), 50, yMov + 6, { width: 68 })
  doc.text(mov.caja, 120, yMov + 6, { width: 72 })
  doc.text(mov.detalle, 185, yMov + 6, { width: 135 })
  doc.text(mov.medios || "-", 320, yMov + 6, { width: 150 })
  doc.text(formatoMoneda(mov.monto), 456, yMov + 6, { width: 60, align: "right" })
  doc.strokeColor(PDF_COLORS.line).lineWidth(0.5).moveTo(60, yMov + rowHeight).lineTo(pageWidth - 60, yMov + rowHeight).stroke()
  yMov += rowHeight + 4
})

doc.end()

console.log(`Vista previa generada en: ${outputPath}`)