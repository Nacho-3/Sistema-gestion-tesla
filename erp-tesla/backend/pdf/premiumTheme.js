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

const normalizeSingleLineText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()

const truncateSingleLineText = (doc, value, maxWidth) => {
  const source = normalizeSingleLineText(value)
  if (!source) return ""

  if (doc.widthOfString(source) <= maxWidth) return source

  const ellipsis = "..."
  let current = source
  while (current.length > 0 && doc.widthOfString(current + ellipsis) > maxWidth) {
    current = current.slice(0, -1)
  }

  return current ? `${current}${ellipsis}` : ellipsis
}

const fitSingleLineText = (doc, value, maxWidth, baseSize = 9, minSize = 7) => {
  const source = normalizeSingleLineText(value)
  if (!source) return { text: "", fontSize: baseSize }

  for (let size = baseSize; size >= minSize; size -= 0.5) {
    doc.fontSize(size)
    if (doc.widthOfString(source) <= maxWidth) {
      return { text: source, fontSize: size }
    }
  }

  doc.fontSize(minSize)
  return { text: truncateSingleLineText(doc, source, maxWidth), fontSize: minSize }
}

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
  const logoBoxWidth = 72
  const logoReservedGap = 10
  const logoLeftX = pageWidth - 45 - logoBoxWidth
  const contentWidth = logoPath && fs.existsSync(logoPath)
    ? Math.max(220, logoLeftX - logoReservedGap - 45)
    : pageWidth - 90

  doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(16).text(title, 45, top + 45, { width: contentWidth })
  doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.slate).text(subtitle, 45, top + 69, { width: contentWidth })
  if (accentText) {
    doc.font("Helvetica-Bold").fillColor(PDF_COLORS.muted)
    const fitted = fitSingleLineText(doc, accentText, contentWidth, 9, 7)
    doc.fontSize(fitted.fontSize)
    doc.text(fitted.text, 45, top + 65, { lineBreak: false })
  }

  if (logoPath && fs.existsSync(logoPath)) {
    const logoX = pageWidth - 45 - logoBoxWidth
    doc.image(logoPath, logoX, top + 6, { fit: [66, 60] })
  }

  const lineY = top + 85
  doc.strokeColor(PDF_COLORS.line).lineWidth(1).moveTo(45, lineY).lineTo(pageWidth - 45, lineY).stroke()

  doc.fillColor(PDF_COLORS.ink)
  return lineY + 3
}

export const drawPremiumSectionTitle = (doc, title) => {
  if (doc.y > doc.page.height - 90) doc.addPage()
  doc.moveDown(0.6)
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(PDF_COLORS.ink).text(title)
  const y = doc.y + 2
  doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, y).lineTo(doc.page.width - 45, y).stroke()
  doc.y = y + 6
}
