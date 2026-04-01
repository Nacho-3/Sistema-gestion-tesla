import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, sanitizeFileText, PDF_COLORS } from "../pdf/premiumTheme.js"
import fs from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")

const router = express.Router()

const handleInternalError = (res, err, context) => {
  console.error(`[clientes] ${context}:`, err)
  return res.status(500).json({
    error: "Error interno del servidor",
    context,
  })
}

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
    const clientesVisibles = (data || []).filter(
      (c) => String(c?.razon_social || "").trim().toUpperCase() !== "ADMINISTRACION INTERNA"
    )
    res.json(clientesVisibles)
  } catch (err) {
    return handleInternalError(res, err, "listar_clientes")
  }
})

// Obtener un cliente por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("razon_social, cuit, direccion, telefono, email, iva") // Aseguramos que 'iva' esté incluido
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" })
    }

    res.json(cliente)
  } catch (err) {
    return handleInternalError(res, err, "obtener_cliente")
  }
})

// Descargar ficha del cliente en PDF
router.get("/:id/ficha-pdf", async (req, res) => {
  try {
    const { id } = req.params

    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("razon_social, empresa, cuit, direccion, telefono, email, iva")
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" })
    }

    const ahora = new Date()
    const fechaTexto = ahora.toLocaleDateString("es-AR")
    const fechaArchivo = ahora.toISOString().slice(0, 10)
    const nombreEmpresa = sanitizeFileText(cliente.empresa || "-")
    const nombreCliente = sanitizeFileText(cliente.razon_social || "Cliente")
    const nombreArchivo = `Ficha ${nombreCliente} ${fechaArchivo}.pdf`

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(chunks)

      // Guardar el archivo PDF y el archivo de datos del cliente
      await saveFileToClientFolder(nombreCliente, nombreArchivo, pdfBuffer, cliente)

      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
      res.send(pdfBuffer)
    })

    const pageWidth = doc.page.width
    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Documento interno" })

    // Mostrar la empresa como título principal
    const headerBottom = drawPremiumHeader(doc, {
      title: cliente.empresa || "-",
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

    // Mostrar razón social como subtítulo destacado
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(13).text(`Razón social: ${cliente.razon_social || "-"}`, 45, headerBottom + 54)
    doc.font("Helvetica").fontSize(10)
    doc.text(`CUIT: ${cliente.cuit || "-"}`, 45, headerBottom + 74)
    doc.text(`Email: ${cliente.email || "-"}`, 45, headerBottom + 94)
    doc.text(`Dirección: ${cliente.direccion || "-"}`, 45, headerBottom + 114)
    doc.text(`Teléfono: ${cliente.telefono || "-"}`, 45, headerBottom + 134)
    doc.text(`IVA: ${cliente.iva || "-"}`, 45, headerBottom + 154)

    // Resumen
    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("*")
      .eq("cliente_id", id)
      .order("created_at", { ascending: false });

    if (obrasError) {
      console.error("Error al obtener obras:", obrasError);
      return res.status(500).json({ error: "Error al obtener las obras del cliente." });
    }

    const totalObras = obras?.length || 0
    const obrasActivas = (obras || []).filter((obra) => obra.estado === "activa").length
    const obrasFinalizadas = (obras || []).filter((obra) => obra.estado !== "activa").length

    const resumenY = headerBottom + 176
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
    return handleInternalError(res, err, "ficha_pdf_cliente")
  }
})

// Crear nuevo cliente
router.post("/", async (req, res) => {
  try {
    const {
      razon_social,
      empresa,
      cuit,
      direccion,
      telefono,
      email,
      iva,
    } = req.body;

    const razonSocialFinal = razon_social?.trim() || "-";
    const empresaFinal = empresa?.trim() || "-";
    const cuitFinal = cuit?.trim() || "-";
    const direccionFinal = direccion?.trim() || "-";
    const telefonoFinal = telefono?.trim() || "-";
    const emailFinal = email?.trim() || "-";
    const ivaFinal = iva?.trim() || "-";

    const { data, error } = await db
      .from("clientes")
      .insert([
        {
          razon_social: razonSocialFinal,
          empresa: empresaFinal,
          cuit: cuitFinal,
          direccion: direccionFinal,
          telefono: telefonoFinal,
          email: emailFinal,
          iva: ivaFinal,
          activo: true,
        },
      ])
      .select();

    if (error) return res.status(400).json({ error: error.message });

    getIo()?.emit("clientes:changed");
    res.status(201).json(data[0]);
  } catch (err) {
    return handleInternalError(res, err, "crear_cliente");
  }
});

// Actualizar cliente
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      razon_social,
      empresa,
      cuit,
      direccion,
      telefono,
      email,
      iva,
    } = req.body;

    const actualizaciones = {};
    if (razon_social !== undefined) actualizaciones.razon_social = (razon_social ?? "").trim() || "-";
    if (empresa !== undefined) actualizaciones.empresa = (empresa ?? "").trim() || "-";
    if (cuit !== undefined) actualizaciones.cuit = (cuit ?? "").trim() || "-";
    if (direccion !== undefined) actualizaciones.direccion = (direccion ?? "").trim() || "-";
    if (telefono !== undefined) actualizaciones.telefono = (telefono ?? "").trim() || "-";
    if (email !== undefined) actualizaciones.email = (email ?? "").trim() || "-";
    if (iva !== undefined) actualizaciones.iva = (iva ?? "").trim() || "-";

    const { data, error } = await db
      .from("clientes")
      .update(actualizaciones)
      .eq("id", id)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    if (data.length === 0) return res.status(404).json({ error: "Cliente no encontrado" });

    getIo()?.emit("clientes:changed");
    res.json(data[0]);
  } catch (err) {
    return handleInternalError(res, err, "actualizar_cliente");
  }
});

// Eliminar cliente (borrado fisico con validacion de dependencias)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("razon_social")
      .eq("id", id)
      .single();

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    const { error } = await db.from("clientes").delete().eq("id", id);

    if (error) {
      return res.status(500).json({ error: "Error al eliminar el cliente." });
    }

    // Eliminar la carpeta del cliente
    await deleteClientFolder(cliente.razon_social);

    res.json({ message: "Cliente eliminado correctamente." });
  } catch (err) {
    console.error("Error al eliminar el cliente:", err);
    res.status(500).send("Error al eliminar el cliente.");
  }
});

// Función para eliminar la carpeta de un cliente
const deleteClientFolder = async (clientName) => {
  try {
    const mainFolderPath = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "clientes");
    const clientFolderPath = path.join(mainFolderPath, clientName);

    // Verificar si la carpeta del cliente existe
    const folderExists = await fs.access(clientFolderPath).then(() => true).catch(() => false);

    if (folderExists) {
      await fs.rm(clientFolderPath, { recursive: true, force: true });
      console.log(`Carpeta del cliente eliminada: ${clientFolderPath}`);
    }
  } catch (error) {
    console.error("Error al eliminar la carpeta del cliente:", error);
    throw error;
  }
};

const saveFileToClientFolder = async (clientName, fileName, buffer, clientData) => {
  try {
    const mainFolderPath = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "clientes");
    const clientFolderPath = path.join(mainFolderPath, clientName);

    // Crear la carpeta principal si no existe
    await fs.mkdir(mainFolderPath, { recursive: true });

    // Crear la carpeta del cliente si no existe
    await fs.mkdir(clientFolderPath, { recursive: true });

    // Guardar el archivo PDF en la carpeta del cliente
    const filePath = path.join(clientFolderPath, fileName);
    await fs.writeFile(filePath, buffer);

    // Generar un archivo .txt con los datos del cliente
    const clientDataFileName = `Datos (${clientName}).txt`;
    const clientDataFilePath = path.join(clientFolderPath, clientDataFileName);
    const clientDataContent = `Datos del Cliente:\n\nNombre: ${clientData.razon_social || "-"}\nCUIT: ${clientData.cuit || "-"}\nEmail: ${clientData.email || "-"}\nDirección: ${clientData.direccion || "-"}\nTeléfono: ${clientData.telefono || "-"}\nIVA: ${clientData.iva || "-"}`;
    await fs.writeFile(clientDataFilePath, clientDataContent);

    console.log(`Archivos guardados en: ${clientFolderPath}`);
  } catch (error) {
    console.error("Error al guardar los archivos:", error);
    throw error;
  }
}

export default router