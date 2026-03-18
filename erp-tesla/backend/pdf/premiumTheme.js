import fs from "fs"

export const PDF_COLORS = {
  ink: "#111827",
  slate: "#475569",
  muted: "#64748b",
  navy: "#0f172a",
  navySoft: "#1e293b",
  light: "#f8fafc",
  lightAlt: "#eef2f7",
  card: "#f1f5f9",
  line: "#cbd5e1",
  accent: "#93c5fd",
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
  const height = 84

  doc.rect(45, top, pageWidth - 90, height).fill(PDF_COLORS.navy)
  doc.strokeColor(PDF_COLORS.navySoft).lineWidth(1).rect(45, top, pageWidth - 90, height).stroke()

  doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(15).text(title, 60, 60, { width: 370 })
  doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1").text(subtitle, 60, 83, { width: 370 })
  if (accentText) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(PDF_COLORS.accent).text(accentText, 60, 101, { width: 370 })
  }

  if (logoPath && fs.existsSync(logoPath)) {
    const logoX = pageWidth - 45 - 82
    doc.image(logoPath, logoX, 52, { fit: [75, 68] })
  }

  doc.fillColor(PDF_COLORS.ink)
  return top + height
}

export const drawPremiumSectionTitle = (doc, title) => {
  if (doc.y > doc.page.height - 90) doc.addPage()
  doc.moveDown(0.6)
  doc.font("Helvetica-Bold").fontSize(12).fillColor(PDF_COLORS.navy).text(title)
  doc.moveDown(0.2)
}
