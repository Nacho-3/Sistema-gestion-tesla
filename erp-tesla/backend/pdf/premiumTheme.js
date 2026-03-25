import fs from "fs"

export const PDF_COLORS = {
  ink: "#111111",
  slate: "#333333",
  muted: "#4a4a4a",
  navy: "#111111",
  navySoft: "#111111",
  light: "#ffffff",
  lightAlt: "#ffffff",
  card: "#ffffff",
  line: "#222222",
  accent: "#111111",
}

export const sanitizeFileText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()

export const setupPremiumFooter = (doc, { leftText }) => {
  const pageWidth = doc.page.width
  let pageNumber = 1

  const drawFooter = (num) => {
    const lineY = doc.page.height - doc.page.margins.bottom - 22
    const textY = lineY + 8

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, lineY).lineTo(pageWidth - 45, lineY).stroke()

    doc.font("Helvetica")
      .fontSize(8)
      .fillColor(PDF_COLORS.muted)
      .text(leftText, 45, textY, {
        align: "left",
        width: pageWidth - 90,
        lineBreak: false,
      })

    doc.font("Helvetica")
      .fontSize(8)
      .fillColor(PDF_COLORS.muted)
      .text(`Pagina ${num}`, 45, textY, {
        align: "right",
        width: pageWidth - 90,
        lineBreak: false,
      })

    doc.fillColor(PDF_COLORS.ink)
  }

  drawFooter(pageNumber)
  doc.on("pageAdded", () => {
    pageNumber += 1
    drawFooter(pageNumber)
  })
}

export const drawPremiumHeader = (doc, { title, subtitle, accentText, logoPath }) => {
  const pageWidth = doc.page.width
  const top = 45

  doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(16).text(title, 45, top + 10, { width: 390 })
  doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.slate).text(subtitle, 45, top + 34, { width: 390 })
  if (accentText) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(PDF_COLORS.muted).text(accentText, 45, top + 50, { width: 390 })
  }

  if (logoPath && fs.existsSync(logoPath)) {
    const logoX = pageWidth - 45 - 72
    doc.image(logoPath, logoX, top + 6, { fit: [66, 60] })
  }

  const lineY = top + 78
  doc.strokeColor(PDF_COLORS.line).lineWidth(1).moveTo(45, lineY).lineTo(pageWidth - 45, lineY).stroke()

  doc.fillColor(PDF_COLORS.ink)
  return lineY + 8
}

export const drawPremiumSectionTitle = (doc, title) => {
  if (doc.y > doc.page.height - 90) doc.addPage()
  doc.moveDown(0.6)
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(PDF_COLORS.ink).text(title)
  const y = doc.y + 2
  doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, y).lineTo(doc.page.width - 45, y).stroke()
  doc.y = y + 6
}
