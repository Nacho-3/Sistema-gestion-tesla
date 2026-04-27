import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url"
import PDFDocument from "pdfkit"
import { drawPremiumHeader, setupPremiumFooter, sanitizeFileText, PDF_COLORS } from "../pdf/premiumTheme.js"

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")

const handleInternalError = (res, err, context) => {
  console.error(`[obras] ${context}:`, err)
  return res.status(500).json({
    error: "Error interno del servidor",
    context,
  })
}

const ADMIN_REGEX = /admin/i

const OBRAS_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "obras");
const ACTIVE_OBRAS_FOLDER = path.join(OBRAS_FOLDER, "obras_activas");
const FINISHED_OBRAS_FOLDER = path.join(OBRAS_FOLDER, "obras_finalizadas");

const ensureObrasFoldersExist = async () => {
  await fs.mkdir(ACTIVE_OBRAS_FOLDER, { recursive: true });
  await fs.mkdir(FINISHED_OBRAS_FOLDER, { recursive: true });
};

const saveObraFile = async (obra, folder) => {
  try {
    const { data: clienteData } = await db
      .from("clientes")
      .select("razon_social")
      .eq("id", obra.cliente_id)
      .single();

    const { data: grupoData } = await db
      .from("grupos")
      .select("nombre")
      .eq("id", obra.grupo_id)
      .single();

    const clienteNombre = clienteData?.razon_social || "-";
    const grupoNombre = grupoData?.nombre || "-";

    const formattedFechaInicio = obra.fecha_inicio
      ? new Date(obra.fecha_inicio).toLocaleDateString("es-AR")
      : "-";

    const obraContent = `Nombre: ${obra.nombre || "-"}\nCliente: ${clienteNombre}\nGrupo: ${grupoNombre}\nFecha Inicio: ${formattedFechaInicio}\nEstado: ${obra.estado || "-"}`;

    const filePath = path.join(folder, `${obra.nombre}.txt`);
    await fs.writeFile(filePath, obraContent);
  } catch (error) {
    console.error("Error al guardar los datos de la obra:", error);
    throw error;
  }
};

const deleteObraFile = async (obra) => {
  const folder = obra.estado === "finalizada" ? FINISHED_OBRAS_FOLDER : ACTIVE_OBRAS_FOLDER;
  const obraFilePath = path.join(folder, `${obra.nombre}.txt`);
  try {
    await fs.unlink(obraFilePath);
  } catch (err) {
    console.error(`Error al eliminar el archivo de la obra: ${obraFilePath}`, err);
  }
};

const moveObraFile = async (obra, newEstado) => {
  const oldFolder = obra.estado === "finalizada" ? FINISHED_OBRAS_FOLDER : ACTIVE_OBRAS_FOLDER;
  const newFolder = newEstado === "finalizada" ? FINISHED_OBRAS_FOLDER : ACTIVE_OBRAS_FOLDER;
  const oldFilePath = path.join(oldFolder, `${obra.nombre}.txt`);
  const newFilePath = path.join(newFolder, `${obra.nombre}.txt`);

  try {
    await fs.rename(oldFilePath, newFilePath);
    console.log(`Archivo de la obra movido de ${oldFolder} a ${newFolder}`);
  } catch (err) {
    console.error(`Error al mover el archivo de la obra: ${oldFilePath} a ${newFilePath}`, err);
  }
};

// Listar todas las obras (opcionalmente filtrar por estado)
router.get("/", async (req, res) => {
  try {
    const { estado } = req.query
    let query = db.from("obras").select("*").order("created_at", { ascending: false })
    if (estado) query = query.eq("estado", estado)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })

    // Filtrar obras administrativas
    const { data: grupos } = await db.from("grupos").select("id, nombre")
    const gruposMap = new Map((grupos || []).map((g) => [g.id, g]))
    const obrasVisibles = (data || []).filter((o) => {
      if (ADMIN_REGEX.test(String(o.nombre || ""))) return false
      const grupo = gruposMap.get(o.grupo_id)
      return !ADMIN_REGEX.test(String(grupo?.nombre || ""))
    })

    res.json(obrasVisibles)
  } catch (err) {
    return handleInternalError(res, err, "listar_obras")
  }
})

// Obtener una obra por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db
      .from("obras")
      .select("*")
      .eq("id", id)
      .single()

    if (error) return res.status(404).json({ error: "Obra no encontrada" })
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "obtener_obra")
  }
})

// Crear obra
router.post("/", async (req, res) => {
  try {
    const { nombre, cliente_id, grupo_id, fecha_inicio, horas_presupuestadas } = req.body

    if (!nombre || !cliente_id || !grupo_id) {
      return res.status(400).json({
        error: "Nombre, cliente y grupo son obligatorios"
      })
    }

    const { data, error } = await db
      .from("obras")
      .insert([
        {
          nombre,
          cliente_id,
          grupo_id,
          fecha_inicio,
          horas_presupuestadas,
          estado: "activa"
        }
      ])
      .select("*")
      .single()

    if (error) return res.status(400).json({ error: error.message })

    await ensureObrasFoldersExist();
    await saveObraFile(data, ACTIVE_OBRAS_FOLDER);

    getIo()?.emit('obras:changed')
    res.status(201).json(data)
  } catch (err) {
    return handleInternalError(res, err, "crear_obra")
  }
})

// Actualizar obra
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, cliente_id, grupo_id, estado, fecha_inicio, horas_presupuestadas } = req.body

    const { data: oldObra, error: fetchError } = await db
      .from("obras")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !oldObra) {
      return res.status(404).json({ error: "Obra no encontrada" });
    }

    const { data, error } = await db
      .from("obras")
      .update({ nombre, cliente_id, grupo_id, estado, fecha_inicio, horas_presupuestadas })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (oldObra.estado !== estado) {
      await moveObraFile(oldObra, estado);
    } else {
      const folder = estado === "finalizada" ? FINISHED_OBRAS_FOLDER : ACTIVE_OBRAS_FOLDER;
      await saveObraFile(data, folder);
    }

    getIo()?.emit('obras:changed')
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "actualizar_obra")
  }
})

// Cambiar estado de obra (activa/cerrada)
router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    if (!["activa", "finalizada", "cerrada"].includes(estado)) {
      return res.status(400).json({
        error: "Estado inválido"
      })
    }

    const { data: obra, error: obraError } = await db
      .from("obras")
      .select("*")
      .eq("id", id)
      .single();

    if (obraError || !obra) {
      return res.status(404).json({ error: "Obra no encontrada" });
    }

    const { data, error } = await db
      .from("obras")
      .update({ estado })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (obra.estado !== estado) {
      await moveObraFile(obra, estado);
    }

    getIo()?.emit("obras:changed");
    res.json(data);
  } catch (err) {
    return handleInternalError(res, err, "actualizar_estado_obra");
  }
})

// Eliminar obra (solo si no tiene movimientos asociados)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data: obra, error: obraError } = await db
      .from("obras")
      .select("*")
      .eq("id", id)
      .single();

    if (obraError || !obra) {
      return res.status(404).json({ error: "Obra no encontrada" });
    }

    const { error } = await db.from("obras").delete().eq("id", id);

    if (error) {
      return res.status(500).json({ error: "Error al eliminar la obra." });
    }

    await deleteObraFile(obra);

    getIo()?.emit('obras:changed')
    res.json({ mensaje: "Obra eliminada correctamente." });
  } catch (err) {
    return handleInternalError(res, err, "eliminar_obra")
  }
})

// Obtener nombres de cliente y grupo
const getClienteGrupo = async (obra) => {
  const { data: clienteData, error: clienteError } = await db
    .from("clientes")
    .select("razon_social")
    .eq("id", obra.cliente_id)
    .single();

  const { data: grupoData, error: grupoError } = await db
    .from("grupos")
    .select("nombre")
    .eq("id", obra.grupo_id)
    .single();

  const clienteNombre = clienteData?.razon_social || "-";
  const grupoNombre = grupoData?.nombre || "-";

  // Formatear la fecha de inicio a formato día/mes/año
  const formattedFechaInicio = obra.fecha_inicio
    ? new Date(obra.fecha_inicio).toLocaleDateString("es-AR")
    : "-";

  // Generar contenido del archivo .txt
  const obraDataContent = `Nombre: ${obra.nombre || "-"}\nCliente: ${clienteNombre}\nGrupo: ${grupoNombre}\nFecha Inicio: ${formattedFechaInicio}\nEstado: ${obra.estado || "-"}`;

  // Mover archivo de obra al cambiar estado a finalizada
  if (obra.estado === "finalizada") {
    const oldFilePath = path.join(ACTIVE_OBRAS_FOLDER, `${obra.nombre}.txt`);
    const newFilePath = path.join(FINISHED_OBRAS_FOLDER, `${obra.nombre}.txt`);
    try {
      await fs.rename(oldFilePath, newFilePath);
      console.log(`Archivo de la obra movido a la carpeta de obras finalizadas: ${newFilePath}`);
    } catch (err) {
      console.error(`Error al mover el archivo de la obra: ${oldFilePath} a ${newFilePath}`, err);
    }
  }

  return { clienteNombre, grupoNombre, obraDataContent };
};


router.get("/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const { mes, anio } = req.query;
    const ahora = new Date();
    const fechaTexto = ahora.toLocaleDateString("es-AR");

    let horasQuery = db.from("horas").select("cantidad_horas, horas_trabajadas").eq("obra_id", id);
    if (mes && anio) {
      const inicio = new Date(Number(anio), Number(mes) - 1, 1).toISOString().split("T")[0];
      const fin = new Date(Number(anio), Number(mes), 0).toISOString().split("T")[0];
      horasQuery = horasQuery.gte("fecha", inicio).lte("fecha", fin);
    }

    const [obraRes, horasRes] = await Promise.all([
      db.from("obras").select("*").eq("id", id).single(),
      horasQuery
    ]);

    const { data: obra, error: obraErr } = obraRes;
    if (obraErr || !obra) return res.status(404).json({ error: "Obra no encontrada" });

    const { data: cliente } = await db.from("clientes").select("razon_social").eq("id", obra.cliente_id).single();

    const totalReales = (horasRes.data || []).reduce((acc, h) => 
      acc + (Number(h.cantidad_horas ?? h.horas_trabajadas) || 0), 0
    );

    const doc = new PDFDocument({ size: "A4", margin: 45 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Resumen-Obra-${sanitizeFileText(obra.nombre)}.pdf"`);
      res.send(pdfBuffer);
    });

    const pageWidth = doc.page.width;
    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen Operativo de Obra" });
    const periodoSeleccionado = mes && anio
      ? `${String(mes).padStart(2, "0")}/${anio}`
      : "Periodo completo";

    const headerBottom = drawPremiumHeader(doc, {
      title: obra.nombre,
      subtitle: "Resumen de Control de Obra",
      accentText: `${cliente?.razon_social || "Cliente no especificado"} - ${periodoSeleccionado}`,
      logoPath: LOGO_PATH,
    });

    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(11)
       .text(`Emitido el ${fechaTexto}`, 45, headerBottom + 8, { align: "right", width: pageWidth - 90 });

    doc.moveTo(45, headerBottom + 28).lineTo(pageWidth - 45, headerBottom + 28).strokeColor(PDF_COLORS.line).lineWidth(0.8).stroke();

    const statsY = headerBottom + 45;
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12).text("ESTADO DE HORAS TRABAJADAS", 45, statsY);
    
    const colW = (pageWidth - 100) / 3;
    const cardH = 50;
    const cardY = statsY + 20;

    doc.roundedRect(45, cardY, colW, cardH, 6).fill(PDF_COLORS.card);
    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8).text("PRESUPUESTADAS", 55, cardY + 12);
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(14).text(`${Number(obra.horas_presupuestadas || 0).toFixed(2)} hs`, 55, cardY + 25);

    doc.roundedRect(45 + colW + 5, cardY, colW, cardH, 6).fill(PDF_COLORS.card);
    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8).text("REALES CARGADAS", 50 + colW + 5, cardY + 12);
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(14).text(`${totalReales.toFixed(2)} hs`, 50 + colW + 5, cardY + 25);

    const hPresu = Number(obra.horas_presupuestadas) || 1; // evitar division por cero
    const porcentaje = (totalReales / hPresu) * 100;
    const colorAlerta = porcentaje > 100 ? "#ef4444" : PDF_COLORS.navy;

    doc.roundedRect(45 + (colW + 5) * 2, cardY, colW, cardH, 6).fill(porcentaje > 100 ? "#fee2e2" : PDF_COLORS.card);
    doc.fillColor(porcentaje > 100 ? "#b91c1c" : PDF_COLORS.slate).font("Helvetica").fontSize(8).text("CONSUMO %", 50 + (colW + 5) * 2, cardY + 12);
    doc.fillColor(colorAlerta).font("Helvetica-Bold").fontSize(14).text(`${porcentaje.toFixed(1)}%`, 50 + (colW + 5) * 2, cardY + 25);

    let currentY = cardY + cardH + 30;
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12).text("INFORMACIÓN DE OBRA", 45, currentY);
    currentY += 20;

    const infoRows = [
      { label: "Estado Actual:", value: String(obra.estado).toUpperCase() },
      { label: "Fecha de Inicio:", value: obra.fecha_inicio ? new Date(obra.fecha_inicio).toLocaleDateString("es-AR") : "No definida" },
      { label: "ID de Registro:", value: `#${obra.id}` }
    ];

    infoRows.forEach(row => {
      doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(10).text(row.label, 45, currentY);
      doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10).text(row.value, 150, currentY);
      currentY += 18;
    });

    currentY += 15;
    const barWidth = pageWidth - 90;
    const progressWidth = Math.min(barWidth, (porcentaje / 100) * barWidth);
    
    doc.fillColor(PDF_COLORS.slate).font("Helvetica-Bold").fontSize(9).text("PROGRESO DE CONSUMO DE HORAS", 45, currentY);
    currentY += 12;
    
    doc.roundedRect(45, currentY, barWidth, 12, 3).fill("#f1f5f9");
    if (progressWidth > 0) {
      doc.roundedRect(45, currentY, progressWidth, 12, 3).fill(porcentaje > 90 ? "#ef4444" : "#3b82f6");
    }

    doc.end();
  } catch (err) {
    console.error("Error PDF Obra:", err);
    res.status(500).json({ error: "Error interno al generar PDF" });
  }
});


export default router
