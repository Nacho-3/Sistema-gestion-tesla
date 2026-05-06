import express from "express";
import { pool } from "../db.js";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png");

const TIPOS_GASTOS = [
    { key: "tesla", titulo: "Gastos Tesla" },
    { key: "facu", titulo: "Gastos Facu" },
    { key: "juani", titulo: "Gastos Juani" },
];

const MESES_NOMBRE = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const toNumber = (value) => {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
};

const formatMoney = (value) =>
    `$ ${toNumber(value).toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

const resolveTiposSeleccionados = (tiposRaw) => {
    const allowed = new Set(TIPOS_GASTOS.map((tipo) => tipo.key));
    const requested = String(tiposRaw || "")
        .split(",")
        .map((tipo) => tipo.trim().toLowerCase())
        .filter((tipo) => allowed.has(tipo));

    return requested.length ? requested : TIPOS_GASTOS.map((tipo) => tipo.key);
};

router.get("/", async (req, res) => {
    const {tipo, mes, anio} = req.query;
    try {
        const result = await pool.query(
            `SELECT * FROM gastos WHERE tipo = $1 AND mes = $2 AND anio = $3 ORDER by ID ASC`,
            [tipo, mes, anio]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Error al obtener los gastos" });
    }
});

router.get("/resumen/pdf", async (req, res) => {
    const mesInt = Number(req.query.mes);
    const anioInt = Number(req.query.anio);
    const tiposSeleccionados = resolveTiposSeleccionados(req.query.tipos);

    if (!Number.isInteger(mesInt) || mesInt < 1 || mesInt > 12 || !Number.isInteger(anioInt)) {
        return res.status(400).json({ error: "Mes y año válidos son obligatorios" });
    }

    try {
        const gastosPorTipo = {};
        for (const tipoInfo of TIPOS_GASTOS) {
            if (!tiposSeleccionados.includes(tipoInfo.key)) {
                gastosPorTipo[tipoInfo.key] = [];
                continue;
            }

            const result = await pool.query(
                `SELECT *
                 FROM gastos
                 WHERE tipo = $1
                   AND mes = $2
                   AND anio = $3
                 ORDER BY id ASC`,
                [tipoInfo.key, mesInt, anioInt]
            );
            gastosPorTipo[tipoInfo.key] = result.rows || [];
        }

        const gastos = TIPOS_GASTOS.flatMap((tipoInfo) => gastosPorTipo[tipoInfo.key] || []);
        const mesNombre = MESES_NOMBRE[mesInt - 1] || `Mes ${mesInt}`;
        const nombreArchivo = `Resumen Gastos ${sanitizeFileText(mesNombre)} ${sanitizeFileText(String(anioInt))}.pdf`;
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        const chunks = [];
        const pageWidth = doc.page.width;
        const FOOTER_SAFE_SPACE = 42;

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => {
            const pdfBuffer = Buffer.concat(chunks);
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`);
            res.send(pdfBuffer);
        });

        setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen de gastos" });

        const getBottomLimit = (requiredHeight = 0) => {
            return doc.page.height - doc.page.margins.bottom - FOOTER_SAFE_SPACE - requiredHeight;
        };

        const ensureSpace = (minHeight = 90) => {
            if (doc.y > getBottomLimit(minHeight)) {
                doc.addPage();
                doc.y = 60;
            }
        };

        const calcTotales = (items) => items.reduce((acc, gasto) => {
            acc.iva += toNumber(gasto.iva_impuesto);
            acc.subtotal += toNumber(gasto.subtotal);
            acc.total += toNumber(gasto.total);
            acc.pagoTesla += toNumber(gasto.pago_tesla);
            return acc;
        }, { iva: 0, subtotal: 0, total: 0, pagoTesla: 0 });

        const totalesGenerales = calcTotales(gastos);

        const drawResumenCard = () => {
            const y = doc.y;
            doc.roundedRect(45, y, pageWidth - 90, 70, 6).fill(PDF_COLORS.card);
            doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5);
            doc.text("REGISTROS", 58, y + 10, { width: 70 });
            doc.text("IVA / IMP.", 140, y + 10, { width: 90, align: "right" });
            doc.text("SUBTOTAL", 245, y + 10, { width: 90, align: "right" });
            doc.text("TOTAL", 350, y + 10, { width: 90, align: "right" });
            doc.text("PAGO TESLA", 445, y + 10, { width: 95, align: "right" });

            doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10.5);
            doc.text(String(gastos.length), 58, y + 25, { width: 70, lineBreak: false });
            doc.text(formatMoney(totalesGenerales.iva), 140, y + 25, { width: 90, align: "right", lineBreak: false });
            doc.text(formatMoney(totalesGenerales.subtotal), 245, y + 25, { width: 90, align: "right", lineBreak: false });
            doc.text(formatMoney(totalesGenerales.total), 350, y + 25, { width: 90, align: "right", lineBreak: false });
            doc.text(formatMoney(totalesGenerales.pagoTesla), 445, y + 25, { width: 95, align: "right", lineBreak: false });

            doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, y + 48).lineTo(pageWidth - 58, y + 48).stroke();
            doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(9);
            doc.text(`Periodo seleccionado: ${mesNombre} ${anioInt}`, 58, y + 53, { width: pageWidth - 116 });
            doc.y = y + 82;
        };

        const drawTableHeader = () => {
            const y = doc.y;
            doc.rect(45, y, pageWidth - 90, 24).fill(PDF_COLORS.navy);
            doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.2);
            doc.text("DESCRIPCION", 53, y + 8, { width: 165 });
            doc.text("IVA / IMP.", 225, y + 8, { width: 75, align: "right" });
            doc.text("SUBTOTAL", 305, y + 8, { width: 75, align: "right" });
            doc.text("TOTAL", 385, y + 8, { width: 75, align: "right" });
            doc.text("PAGO TESLA", 465, y + 8, { width: 75, align: "right" });
            doc.fillColor(PDF_COLORS.ink);
            doc.y = y + 24;
        };

        const drawTipoTable = (tipoInfo, items) => {
            ensureSpace(95);
            drawPremiumSectionTitle(doc, tipoInfo.titulo);
            drawTableHeader();

            let y = doc.y;

            if (!items.length) {
                doc.rect(45, y, pageWidth - 90, 24).fill("#f4f6f8");
                doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.slate);
                doc.text("No hay gastos registrados", 53, y + 8, { width: pageWidth - 106 });
                doc.y = y + 34;
                return;
            }

            items.forEach((gasto, idx) => {
                const rowHeight = 26;
                if (y > getBottomLimit(rowHeight + 24)) {
                    doc.addPage();
                    doc.y = 60;
                    drawTableHeader();
                    y = doc.y;
                }

                doc.rect(45, y, pageWidth - 90, rowHeight).fill(idx % 2 === 0 ? "#f4f6f8" : "#ffffff");
                doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.2);
                doc.text(gasto.descripcion || "-", 53, y + 8, { width: 165, ellipsis: true });
                doc.text(formatMoney(gasto.iva_impuesto), 225, y + 8, { width: 75, align: "right", lineBreak: false });
                doc.text(formatMoney(gasto.subtotal), 305, y + 8, { width: 75, align: "right", lineBreak: false });
                doc.text(formatMoney(gasto.total), 385, y + 8, { width: 75, align: "right", lineBreak: false });
                doc.text(formatMoney(gasto.pago_tesla), 465, y + 8, { width: 75, align: "right", lineBreak: false });
                y += rowHeight;
            });

            const totales = calcTotales(items);
            doc.rect(45, y, pageWidth - 90, 26).fill("#e5e7eb");
            doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(8.2);
            doc.text("Totales", 53, y + 8, { width: 165 });
            doc.text(formatMoney(totales.iva), 225, y + 8, { width: 75, align: "right", lineBreak: false });
            doc.text(formatMoney(totales.subtotal), 305, y + 8, { width: 75, align: "right", lineBreak: false });
            doc.text(formatMoney(totales.total), 385, y + 8, { width: 75, align: "right", lineBreak: false });
            doc.text(formatMoney(totales.pagoTesla), 465, y + 8, { width: 75, align: "right", lineBreak: false });
            doc.y = y + 36;
        };

        const headerBottom = drawPremiumHeader(doc, {
            title: "TESLA MONTAJES ELECTRICOS",
            subtitle: "Resumen mensual de gastos",
            accentText: `${mesNombre} ${anioInt}`,
            logoPath: LOGO_PATH,
        });

        doc.y = headerBottom + 15;
        drawResumenCard();

        TIPOS_GASTOS
            .filter((tipo) => tiposSeleccionados.includes(tipo.key))
            .forEach((tipoInfo) => {
                drawTipoTable(tipoInfo, gastosPorTipo[tipoInfo.key] || []);
            });

        doc.end();
    } catch (err) {
        console.error("Error generando PDF de gastos:", err);
        res.status(500).json({ error: "Error al generar el PDF de gastos" });
    }
});

router.post ("/", async (req, res) => {
    const {tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla} = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO gastos (tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [tipo, mes, anio, descripcion, iva_impuesto || 0, subtotal || 0, total || 0, pago_tesla || 0]
        );
        res.json(result.rows[0]);
    } catch (err){
        console.error(err)
        res.status(500).json({ error: "Error al crear el gasto" });
    }
});

router.put("/:id", async (req, res) => {
    const {id} = req.params;
    const {tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla} = req.body;
    try {
        const result = await pool.query(
            `UPDATE gastos SET descripcion = $1, iva_impuesto = $2, subtotal = $3, total = $4, pago_tesla = $5
            WHERE id = $6 RETURNING *`,
            [descripcion, iva_impuesto || 0, subtotal || 0, total || 0, pago_tesla || 0, id]
        );
        res.json(result.rows[0]);
    } catch (err){
        console.error(err)
        res.status(500).json({ error: "Error al actualizar el gasto" });
    }
});

router.delete("/:id", async (req, res) => {
    const {id} = req.params;
    try {
        await pool.query(`DELETE FROM gastos WHERE id = $1`, [id]);
        res.json({ message: "Gasto eliminado correctamente" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al eliminar el gasto" });
    }
});

export default router;
