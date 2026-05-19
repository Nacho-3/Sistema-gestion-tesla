﻿import express from "express"
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

    // Datos asociados
    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("id, nombre, estado, fecha_inicio")
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })

    if (obrasError) throw obrasError

    const { data: presupuestos, error: presupuestosError } = await db
      .from("presupuestos")
      .select("id, numero, fecha, estado, total, obra_id")
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })

    if (presupuestosError) throw presupuestosError

    const { data: movimientosCaja, error: movimientosCajaError } = await db
      .from("movimientos_caja")
      .select("fecha, detalle, monto_total, observaciones")
      .eq("cliente_id", id)
      .eq("tipo", "ingreso")
      .order("fecha", { ascending: true })

    if (movimientosCajaError) throw movimientosCajaError

    const obrasList = obras || []
    const presupuestosList = presupuestos || []
    const movimientosList = movimientosCaja || []

    const obraNombrePorId = new Map(obrasList.map((obra) => [Number(obra.id), obra.nombre || "Sin obra"]))
    const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase())

    const totalObras = obrasList.length
    const obrasActivas = obrasList.filter((obra) => obra.estado === "activa").length
    const obrasFinalizadas = obrasList.filter((obra) => obra.estado !== "activa").length

    const totalPresupuestos = presupuestosList.length
    const presupuestosAceptados = presupuestosList.filter(isAceptado).length
    const presupuestosPendientes = totalPresupuestos - presupuestosAceptados

    // start content a bit lower to avoid overlapping long headers
    let cursorY = headerBottom + 48

    const footerSafe = 80
    const ensureSpace = (requiredHeight = 30) => {
      if (cursorY + requiredHeight <= doc.page.height - footerSafe) return
      doc.addPage()
      cursorY = 60
    }

    const drawSectionTitle = (title) => {
      ensureSpace(34)
      doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
      doc.text(title, 45, cursorY)
      cursorY += 18
      doc.moveTo(45, cursorY).lineTo(pageWidth - 45, cursorY).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke()
      cursorY += 10
      doc.fillColor(PDF_COLORS.ink)
    }

    const drawRowCard = (rows = []) => {
      ensureSpace(80)
      const cardHeight = 56
      doc.roundedRect(45, cursorY, pageWidth - 90, cardHeight, 6).fill(PDF_COLORS.card)
      doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10)
      // render three columns evenly
      const availableWidth = pageWidth - 90
      const colW = Math.floor(availableWidth / Math.max(rows.length, 1))
      rows.forEach((item, idx) => {
        const x = 45 + idx * colW + 12
        doc.text(item, x, cursorY + 14, { width: colW - 20 })
      })
      doc.fillColor(PDF_COLORS.ink)
      cursorY += cardHeight + 12
    }

    const drawSimpleRows = (entries) => {
      entries.forEach((entry) => {
        ensureSpace(22)
        doc.font(entry.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(PDF_COLORS.ink)
        doc.text(entry.text, 45, cursorY, { width: pageWidth - 90 })
        cursorY += 18
      })
      cursorY += 8
    }

    const drawTable = ({
      columns,
      rows,
      emptyText,
      rowHeight = 22,
    }) => {
      ensureSpace(30)

      const drawHeader = () => {
        doc.rect(45, cursorY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
        doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
        columns.forEach((col) => {
          doc.text(col.label, col.x, cursorY + 8, { width: col.width, align: col.align || "left" })
        })
        doc.fillColor(PDF_COLORS.ink)
        cursorY += 24
      }

      drawHeader()

      if (!rows.length) {
        ensureSpace(24)
        doc.font("Helvetica").fontSize(10).text(emptyText, 45, cursorY + 6)
        cursorY += 26
        return
      }

      rows.forEach((row, idx) => {
        ensureSpace(rowHeight + 6)
        const fill = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, cursorY, pageWidth - 90, rowHeight).fill(fill)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.2)
        columns.forEach((col) => {
          const text = String(row[col.key] ?? "-")
          doc.text(text, col.x, cursorY + 7, { width: col.width, align: col.align || "left", ellipsis: true })
        })
        cursorY += rowHeight
      })

      cursorY += 12
    }

    drawSectionTitle("DATOS DEL CLIENTE")
    drawSimpleRows([
      { text: `Razón social: ${cliente.razon_social || "-"}`, bold: true },
      { text: `CUIT: ${cliente.cuit || "-"}` },
      { text: `Email: ${cliente.email || "-"}` },
      { text: `Dirección: ${cliente.direccion || "-"}` },
      { text: `Teléfono: ${cliente.telefono || "-"}` },
      { text: `IVA: ${cliente.iva || "-"}` },
    ])

    // Resumen retirado por solicitud — se omite para diseño más compacto

    drawSectionTitle("OBRAS ASOCIADAS")
    drawTable({
      columns: [
        { key: "nombre", label: "NOMBRE", x: 55, width: 250 },
        { key: "estado", label: "ESTADO", x: 315, width: 90 },
        { key: "fecha_inicio", label: "FECHA INICIO", x: 410, width: 140 },
      ],
      rows: obrasList.map((obra) => ({
        nombre: obra.nombre || "Sin nombre",
        estado: normalizeEstado(obra.estado),
        fecha_inicio: obra.fecha_inicio ? new Date(obra.fecha_inicio).toLocaleDateString("es-AR") : "-",
      })),
      emptyText: "No hay obras asociadas a este cliente.",
    })

    drawSectionTitle("PRESUPUESTOS")
    drawTable({
      columns: [
        { key: "numero", label: "NUMERO", x: 55, width: 70 },
        { key: "obra", label: "OBRA", x: 130, width: 190 },
        { key: "estado", label: "ESTADO", x: 325, width: 85 },
        { key: "fecha", label: "FECHA", x: 415, width: 70 },
        { key: "total", label: "TOTAL", x: 490, width: 60, align: "right" },
      ],
      rows: presupuestosList.map((p) => ({
        numero: `#${p.numero || "-"}`,
        obra: obraNombrePorId.get(Number(p.obra_id)) || "Sin obra",
        estado: String(p.estado || "-").toUpperCase(),
        fecha: p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-",
        total: Number(p.total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 }),
      })),
      emptyText: "No hay presupuestos asociados a este cliente.",
    })

    drawSectionTitle("MOVIMIENTOS DE CAJA (INGRESOS)")
    // Columns: Fecha | Detalle |       Monto |    Observaciones
    drawTable({
      columns: [
        { key: "fecha", label: "FECHA", x: 55, width: 80 },
        { key: "detalle", label: "DETALLE", x: 140, width: 260 },
        // move MONTO further left and give it more width
        { key: "monto", label: "MONTO", x: 300, width: 130, align: "right" },
        // start OBSERVACIONES further right and increase width
        { key: "observaciones", label: "OBSERVACIONES", x: 460, width: pageWidth - 460 - 45 },
      ],
      rows: movimientosList.map((mov) => ({
        fecha: mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-AR") : "-",
        detalle: mov.detalle || "-",
        monto: Number(mov.monto_total || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 }),
        observaciones: mov.observaciones || "-",
      })),
      emptyText: "No hay movimientos de caja asociados a este cliente.",
      rowHeight: 22,
    })

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

// Eliminar cliente (compatible con [db.js](http://_vscodecontentref_/0) local)
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id)

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID de cliente invalido." })
    }

    // En este proyecto existe single(), no maybeSingle()
    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("id, razon_social")
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado." })
    }

    // El wrapper [db.js](http://_vscodecontentref_/1) no soporta count/head estilo Supabase
    const obrasCountResult = await db.query(
      "SELECT COUNT(*)::int AS total FROM obras WHERE cliente_id = $1",
      [id]
    )
    const presupuestosCountResult = await db.query(
      "SELECT COUNT(*)::int AS total FROM presupuestos WHERE cliente_id = $1",
      [id]
    )

    const totalObras = Number(obrasCountResult.rows?.[0]?.total || 0)
    const totalPresupuestos = Number(presupuestosCountResult.rows?.[0]?.total || 0)

    if (totalObras > 0 || totalPresupuestos > 0) {
      return res.status(409).json({
        error: "No se puede eliminar el cliente porque tiene registros asociados.",
        detalle: {
          obras: totalObras,
          presupuestos: totalPresupuestos
        }
      })
    }

    const { error: deleteError } = await db
      .from("clientes")
      .delete()
      .eq("id", id)

    if (deleteError) {
      const isForeignKeyViolation = deleteError.code === "23503"
      return res.status(isForeignKeyViolation ? 409 : 500).json({
        error: isForeignKeyViolation
          ? "No se puede eliminar el cliente porque tiene registros asociados."
          : "Error al eliminar el cliente.",
        detalle: deleteError.message || null,
        codigo: deleteError.code || null
      })
    }

    const folderCleanup = await deleteClientFolder(cliente.razon_social)

    getIo()?.emit("clientes:changed")

    return res.json({
      message: "Cliente eliminado correctamente.",
      advertencia: folderCleanup.ok
        ? null
        : "El cliente se elimino en base de datos, pero hubo un problema limpiando su carpeta.",
      detalle_folder: folderCleanup.ok ? null : folderCleanup.error
    })
  } catch (err) {
    return handleInternalError(res, err, "eliminar_cliente")
  }
})


// Funcion para eliminar la carpeta de un cliente
const deleteClientFolder = async (clientName) => {
  try {
    const mainFolderPath = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "clientes");
    const safeClientName = sanitizeFileText(String(clientName || ""));

    if (!safeClientName) {
      return { ok: true, skipped: true };
    }

    const clientFolderPath = path.join(mainFolderPath, safeClientName);

    const folderExists = await fs
      .access(clientFolderPath)
      .then(() => true)
      .catch(() => false);

    if (!folderExists) {
      return { ok: true, skipped: true };
    }

    await fs.rm(clientFolderPath, { recursive: true, force: true });
    console.log("Carpeta del cliente eliminada: " + clientFolderPath);

    return { ok: true, skipped: false };
  } catch (error) {
    console.error("Error al eliminar la carpeta del cliente:", error);
    return {
      ok: false,
      error: error?.message || "Error desconocido al eliminar carpeta",
    };
  }
};

/**
 * Guarda un presupuesto o listado de materiales en la subcarpeta específica del cliente.
 * Estructura solicitada: clientes/RAZON_SOCIAL/Presupuestos (EMPRESA)/archivo.pdf
 */
export const saveBudgetToClientFolder = async (client, fileName, buffer) => {
  try {
    const clientName = sanitizeFileText(client.razon_social || "Cliente Sin Nombre");
    const companyName = sanitizeFileText(client.empresa || client.razon_social || "Empresa");

    const baseDir = "C:\\Users\\usuario\\Desktop\\GESTION TESLA\\clientes";
    // Creamos la ruta: .../clientes/Razon Social/Presupuestos (Empresa)
    const budgetSubfolder = path.join(baseDir, clientName, `Presupuestos (${companyName})`);

    await fs.mkdir(budgetSubfolder, { recursive: true });

    const filePath = path.join(budgetSubfolder, fileName);
    await fs.writeFile(filePath, buffer);
    console.log(`[FileSave] Archivo guardado correctamente en: ${filePath}`);
  } catch (error) {
    console.error("[FileSave] Error al guardar archivo de presupuesto:", error);
    // No lanzamos el error para no bloquear la respuesta al usuario (descarga del navegador)
  }
};

export const saveFileToClientFolder = async (clientName, fileName, buffer, clientData) => {
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