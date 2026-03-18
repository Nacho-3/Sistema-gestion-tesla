import express from "express"
import db from "../db.js"
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, sanitizeFileText, PDF_COLORS } from "../pdf/premiumTheme.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")

const router = express.Router()

const normalizeEstado = (estado = "") => {
  if (estado === "activa") return "Activa"
  if (estado === "finalizada") return "Finalizada"
  if (estado === "cerrada") return "Cerrada"
  return estado || "-"
}

// Listar todos los clientes activos
router.get("/", async (req, res) => {
  try {
    const { data, error } = await db
      .from("clientes")
      .select("*")
      .eq("activo", true)
      .order("created_at", { ascending: false })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Obtener un cliente por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db
      .from("clientes")
      .select("*")
      .eq("id", id)
      .single()

    if (error) return res.status(404).json({ error: "Cliente no encontrado" })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Descargar ficha del cliente en PDF
router.get("/:id/ficha-pdf", async (req, res) => {
  try {
    const { id } = req.params

    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("*")
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" })
    }

    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("*")
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })

    if (obrasError) {
      return res.status(400).json({ error: obrasError.message })
    }

    const ahora = new Date()
    const fechaTexto = ahora.toLocaleDateString("es-AR")
    const fechaArchivo = ahora.toISOString().slice(0, 10)
    const nombreCliente = sanitizeFileText(cliente.razon_social || "Cliente")
    const nombreArchivo = `Ficha ${nombreCliente} actualizada ${fechaArchivo}.pdf`

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
      res.send(pdfBuffer)
    })

    const pageWidth = doc.page.width
    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Documento interno" })

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Ficha de cliente",
      accentText: cliente.razon_social || "",
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    doc.font("Helvetica-Bold")
      .fontSize(11)
      .text(`Actualizada al ${fechaTexto}`, 45, headerBottom + 8, { align: "right", width: pageWidth - 90 })

    doc.moveTo(45, headerBottom + 28).lineTo(pageWidth - 45, headerBottom + 28).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke()
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12).text("DATOS DEL CLIENTE", 45, headerBottom + 36)

    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(13).text(`Cliente: ${cliente.razon_social || "-"}`, 45, headerBottom + 54)
    doc.font("Helvetica").fontSize(10)
    doc.text(`CUIT: ${cliente.cuit || "-"}`, 45, headerBottom + 76)
    doc.text(`Email: ${cliente.email || "-"}`, 45, headerBottom + 94)
    doc.text(`Direccion: ${cliente.direccion || "-"}`, 45, headerBottom + 112)
    doc.text(`Telefono: ${cliente.telefono || "-"}`, 45, headerBottom + 130)

    // Resumen
    const totalObras = obras?.length || 0
    const obrasActivas = (obras || []).filter((obra) => obra.estado === "activa").length
    const obrasFinalizadas = (obras || []).filter((obra) => obra.estado !== "activa").length

    const resumenY = headerBottom + 154
    doc.roundedRect(45, resumenY, pageWidth - 90, 48, 6).fill(PDF_COLORS.card)
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10)
    doc.text(`Total obras: ${totalObras}`, 60, resumenY + 18)
    doc.text(`Activas: ${obrasActivas}`, 230, resumenY + 18)
    doc.text(`Finalizadas: ${obrasFinalizadas}`, 360, resumenY + 18)
    doc.fillColor(PDF_COLORS.ink)

    // Tabla de obras
    let currentY = resumenY + 72
    doc.font("Helvetica-Bold").fontSize(12).fillColor(PDF_COLORS.navy).text("OBRAS ASOCIADAS", 45, currentY)
    currentY += 22

    const drawTableHeader = () => {
      doc.rect(45, currentY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
      doc.text("NOMBRE", 55, currentY + 8, { width: 250 })
      doc.text("ESTADO", 315, currentY + 8, { width: 90 })
      doc.text("FECHA INICIO", 410, currentY + 8, { width: 140 })
      doc.fillColor(PDF_COLORS.ink)
      currentY += 24
    }

    drawTableHeader()

    if (!obras || obras.length === 0) {
      doc.font("Helvetica").fontSize(10.5).text("No hay obras asociadas a este cliente.", 45, currentY + 12)
    } else {
      obras.forEach((obra, index) => {
        if (currentY > doc.page.height - 90) {
          doc.addPage()
          currentY = 60
          drawTableHeader()
        }

        const fechaInicio = obra.fecha_inicio
          ? new Date(obra.fecha_inicio).toLocaleDateString("es-AR")
          : "-"

        const fill = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, currentY, pageWidth - 90, 22).fill(fill)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
        doc.text(obra.nombre || "Sin nombre", 55, currentY + 7, { width: 250, ellipsis: true })
        doc.text(normalizeEstado(obra.estado), 315, currentY + 7, { width: 90 })
        doc.text(fechaInicio, 410, currentY + 7, { width: 140 })

        currentY += 22
      })
    }

    doc.end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear cliente
router.post("/", async (req, res) => {
  try {
    const { razon_social, cuit, direccion, telefono, email } = req.body

    if (!razon_social) {
      return res.status(400).json({ error: "La razon social es obligatoria" })
    }

    const { data, error } = await db
      .from("clientes")
      .insert([{ razon_social, cuit, direccion, telefono, email, activo: true }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar cliente
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { razon_social, cuit, direccion, telefono, email } = req.body

    const { data, error } = await db
      .from("clientes")
      .update({ razon_social, cuit, direccion, telefono, email })
      .eq("id", id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Borrado logico (desactivar cliente)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db
      .from("clientes")
      .update({ activo: false })
      .eq("id", id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router