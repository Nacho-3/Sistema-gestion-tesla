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

const GASTOS_FIJOS_CATALOGO_DEFAULT = {
  tesla: [
    "Mutual nobis (EMP)",
    "Mutual nobis (GUI)",
    "Caja previsión (GERA)",
    "Inmobiliaria BS AS",
    "Abono celular",
    "Seguros el norte",
    "Imp.Municipal (TASA COM)",
    "Agosti martin (Contador)",
    "Sueldos",
    "IERIC",
    "IERIC (RENOV.ANUAL)",
    "UOCRA",
    "VEP Cargas sociales",
    "VEP IVA",
    "VEP INGS BTS",
    "VEP PREVENCIÓN",
    "Cese laboral",
    "Aguinaldos",
    "Monotributos",
    "Autonomos",
    "Luz deposito",
    "Internet",
    "Pablo Amadio (Seg e H)",
    "Ropa de trabajo",
    "Herramientas",
    "Nafta Camionetas",
    "Imp.Vehiculos",
    "Nafta gera y guille",
    "Sueldo gera y guille",
    "Estacionamiento medido",
    "Productos limpieza",
    "Gastos limpieza",
    "Agua",
    "Expensas G3",
    "Seguro Rio Uruguay GUILLE",
    "Librería",
    "Supermercado",
    "Cartucho y toner impresora",
    "Resma hojas",
  ],
  facu: [
    "Herramientas",
    "Alimento balanceado",
    "Nafta hidro",
    "Nafta camioneta",
    "FCT La tuerca",
    "Mutual Facu",
    "Monotributo Facu",
    "Monotributo Guido",
    "Mutual Guido",
    "Seguro camioneta (El norte)",
    "Sueldo Guido",
    "Sueldo fabian",
    "Seguro Accidentes personales",
    "Ropa de trabajo",
    "Varios",
  ],
  juani: [
    "Herramientas",
    "Nafta",
    "Estacionamiento medido",
    "Mutual Juan",
    "Mutual German",
    "Monotributo Juan",
    "Monotributo Germán",
    "Sueldo Germán",
    "Seguros El Norte",
    "Ropa de trabajo",
    "Seguro Accidentes personales",
    "Varios",
  ],
};

const GASTOS_FIJOS_CATALOGO_LEGACY = {
  tesla: ["Alquiler", "Internet", "Seguros", "Combustible", "Servicios", "Honorarios"],
  facu: ["Alquiler", "Internet", "Combustible", "Servicios", "Cuota prestamo", "Telefonia"],
  juani: ["Alquiler", "Internet", "Combustible", "Servicios", "Seguros", "Telefonia"],
};

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

const normalizeTipo = (value = "") => {
  const tipo = String(value || "").toLowerCase().trim();
  return TIPOS_GASTOS.some((item) => item.key === tipo) ? tipo : null;
};

const normalizeDescripcion = (value = "") => String(value || "").trim();

const normalizeDescripcionKey = (value = "") => String(value || "").toLowerCase().trim();

const ensureCatalogoFijosTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS gastos_fijos_catalogo (
      id SERIAL PRIMARY KEY,
      tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('tesla', 'facu', 'juani')),
      descripcion TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gastos_fijos_catalogo_tipo_descripcion
    ON gastos_fijos_catalogo (tipo, LOWER(BTRIM(descripcion)))
    WHERE activo = TRUE
  `);
};

const seedCatalogoFijosDefaults = async (client) => {
  for (const tipoInfo of TIPOS_GASTOS) {
    const tipo = tipoInfo.key;
    const legacy = new Set((GASTOS_FIJOS_CATALOGO_LEGACY[tipo] || []).map((item) => normalizeDescripcionKey(item)));
    const defaults = GASTOS_FIJOS_CATALOGO_DEFAULT[tipo] || [];

    const activosResult = await client.query(
      `
        SELECT id, descripcion
        FROM gastos_fijos_catalogo
        WHERE tipo = $1 AND activo = TRUE
      `,
      [tipo]
    );

    const activos = activosResult.rows || [];
    const activosSet = new Set(activos.map((row) => normalizeDescripcionKey(row.descripcion)));
    const detectedLegacy =
      activos.length === legacy.size &&
      [...legacy].every((item) => activosSet.has(item));

    //Solo resembrar en dos cosas:
    // 1) instalación vacia
    // 2) catalogo Legacy detectado

    if (activos.length > 0 && !detectedLegacy) {
      continue;
    }

    if (detectedLegacy) {
      await client.query(
        `
          UPDATE gastos_fijos_catalogo
          SET activo = FALSE, updated_at = NOW()
          WHERE tipo = $1 AND activo = TRUE
        `,
        [tipo]
      );
    }

    for (const descripcion of defaults) {
      await client.query(
        `
          INSERT INTO gastos_fijos_catalogo (tipo, descripcion, activo)
          VALUES ($1, $2, TRUE)
          ON CONFLICT DO NOTHING
        `,
        [tipo, descripcion]
      );
    }
  }
};

const fetchCatalogoFijos = async (client, tipo = null) => {
  const params = [];
  let sql = `
    SELECT id, tipo, descripcion
    FROM gastos_fijos_catalogo
    WHERE activo = TRUE
  `;

  if (tipo) {
    params.push(tipo);
    sql += ` AND tipo = $1`;
  }

  sql += ` ORDER BY tipo ASC, id ASC`;

  const result = await client.query(sql, params);
  return result.rows || [];
};

const buildCatalogoResponse = (rows = []) => {
  const response = { tesla: [], facu: [], juani: [] };
  for (const row of rows) {
    if (!response[row.tipo]) continue;
    response[row.tipo].push({ id: row.id, descripcion: row.descripcion });
  }
  return response;
};

const fixedDescriptionsSetFromRows = (rows = [], tipo) => {
  const set = new Set();
  for (const row of rows) {
    if (row.tipo !== tipo) continue;
    set.add(normalizeDescripcionKey(row.descripcion));
  }
  return set;
};

const buildCategoria = (fixedSet, descripcion) =>
  fixedSet.has(normalizeDescripcionKey(descripcion)) ? "fijo" : "temporal";

const normalizeGastoRow = (row = {}, fixedSet = new Set()) => {
  return {
    ...row,
    iva_impuesto: toNumber(row.iva_impuesto),
    subtotal: toNumber(row.subtotal),
    total: toNumber(row.total),
    pago_tesla: toNumber(row.pago_tesla),
    categoria: buildCategoria(fixedSet, row.descripcion),
  };
};

const resolveTiposSeleccionados = (tiposRaw) => {
  const allowed = new Set(TIPOS_GASTOS.map((tipo) => tipo.key));
  const requested = String(tiposRaw || "")
    .split(",")
    .map((tipo) => tipo.trim().toLowerCase())
    .filter((tipo) => allowed.has(tipo));

  return requested.length ? requested : TIPOS_GASTOS.map((tipo) => tipo.key);
};

router.get("/catalogo-fijos", async (_req, res) => {
  try {
    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);
    const rows = await fetchCatalogoFijos(pool);
    res.json(buildCatalogoResponse(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el catalogo de gastos fijos" });
  }
});

router.post("/catalogo-fijos", async (req, res) => {
  const tipo = normalizeTipo(req.body?.tipo);
  const descripcion = normalizeDescripcion(req.body?.descripcion);

  if (!tipo) return res.status(400).json({ error: "Tipo invalido" });
  if (!descripcion) return res.status(400).json({ error: "Descripcion obligatoria" });

  try {
    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);

    const result = await pool.query(
      `
        INSERT INTO gastos_fijos_catalogo (tipo, descripcion, activo)
        VALUES ($1, $2, TRUE)
        RETURNING id, tipo, descripcion
      `,
      [tipo, descripcion]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: "Ese gasto fijo ya existe para el tipo seleccionado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al crear gasto fijo" });
  }
});

router.put("/catalogo-fijos/:id", async (req, res) => {
  const id = Number(req.params.id);
  const tipo = normalizeTipo(req.body?.tipo);
  const descripcion = normalizeDescripcion(req.body?.descripcion);

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID invalido" });
  if (!tipo) return res.status(400).json({ error: "Tipo invalido" });
  if (!descripcion) return res.status(400).json({ error: "Descripcion obligatoria" });

  const client = await pool.connect();
  try {
    await ensureCatalogoFijosTable(client);
    await seedCatalogoFijosDefaults(client);
    await client.query("BEGIN");

    const previoResult = await client.query(
      `SELECT id, tipo, descripcion FROM gastos_fijos_catalogo WHERE id = $1 AND activo = TRUE FOR UPDATE`,
      [id]
    );

    if (!previoResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Gasto fijo no encontrado" });
    }

    const previo = previoResult.rows[0];
    const updated = await client.query(
      `
        UPDATE gastos_fijos_catalogo
        SET tipo = $1, descripcion = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, tipo, descripcion
      `,
      [tipo, descripcion, id]
    );

    await client.query(
      `
        UPDATE gastos
        SET tipo = $1, descripcion = $2
        WHERE tipo = $3
          AND LOWER(REGEXP_REPLACE(BTRIM(descripcion), '\\s+', ' ', 'g')) =
          LOWER(REGEXP_REPLACE(BTRIM($4), '\\s+', ' ', 'g'))
      `,
      [tipo, descripcion, previo.tipo, previo.descripcion]
    );

    await client.query("COMMIT");
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      return res.status(400).json({ error: "Ese gasto fijo ya existe para el tipo seleccionado" });
    }
    console.error(err);
    res.status(500).json({ error: "Error al actualizar gasto fijo" });
  } finally {
    client.release();
  }
});

router.delete("/catalogo-fijos/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID invalido" });

  const client = await pool.connect();
  try {
    await ensureCatalogoFijosTable(client);
    await client.query("BEGIN");

    const actual = await client.query(
      `
        SELECT id, tipo, descripcion
        FROM gastos_fijos_catalogo
        WHERE id = $1 AND activo = TRUE
        FOR UPDATE
      `,
      [id]
    );

    if (!actual.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Gasto fijo no encontrado" });
    }

    const result = await client.query(
      `
        UPDATE gastos_fijos_catalogo
        SET activo = FALSE, updated_at = NOW()
        WHERE id = $1 AND activo = TRUE
        RETURNING id
      `,
      [id]
    );

    const row = actual.rows[0];
    await client.query(
      `
        DELETE FROM gastos
        WHERE tipo = $1
          AND LOWER(REGEXP_REPLACE(BTRIM(descripcion), '\\s+', ' ', 'g')) =
          LOWER(REGEXP_REPLACE(BTRIM($2), '\\s+', ' ', 'g'))
      `,
      [row.tipo, row.descripcion]
    );

    await client.query("COMMIT");

    if (!result.rowCount) return res.status(404).json({ error: "Gasto fijo no encontrado" });
    res.json({ message: "Gasto fijo eliminado correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Error al eliminar gasto fijo" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  const tipo = normalizeTipo(req.query.tipo);
  const mes = Number(req.query.mes);
  const anio = Number(req.query.anio);

  if (!tipo) return res.status(400).json({ error: "Tipo invalido" });
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return res.status(400).json({ error: "Mes invalido" });
  if (!Number.isInteger(anio)) return res.status(400).json({ error: "Año invalido" });

  try {
    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);
    const catalogoRows = await fetchCatalogoFijos(pool, tipo);
    const fixedSet = fixedDescriptionsSetFromRows(catalogoRows, tipo);

    const result = await pool.query(
      `SELECT * FROM gastos WHERE tipo = $1 AND mes = $2 AND anio = $3 ORDER BY id ASC`,
      [tipo, mes, anio]
    );
    res.json((result.rows || []).map((row) => normalizeGastoRow(row, fixedSet)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener los gastos" });
  }
});

router.post("/bulk", async (req, res) => {
  const tipo = normalizeTipo(req.body?.tipo);
  const mes = Number(req.body?.mes);
  const anio = Number(req.body?.anio);
  const fijos = Array.isArray(req.body?.fijos) ? req.body.fijos : [];
  const temporales = Array.isArray(req.body?.temporales) ? req.body.temporales : [];

  if (!tipo) return res.status(400).json({ error: "Tipo invalido" });
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return res.status(400).json({ error: "Mes invalido" });
  if (!Number.isInteger(anio)) return res.status(400).json({ error: "Año invalido" });

  const client = await pool.connect();

  try {
    await ensureCatalogoFijosTable(client);
    await seedCatalogoFijosDefaults(client);

    const catalogoRows = await fetchCatalogoFijos(client, tipo);
    const fixedSet = fixedDescriptionsSetFromRows(catalogoRows, tipo);
    const catalogoMap = new Map(
      catalogoRows.map((item) => [normalizeDescripcionKey(item.descripcion), item.descripcion])
    );

    await client.query("BEGIN");

    const existentesResult = await client.query(
      `SELECT * FROM gastos WHERE tipo = $1 AND mes = $2 AND anio = $3 ORDER BY id ASC`,
      [tipo, mes, anio]
    );
    const existentes = existentesResult.rows || [];

    const existentesFijosMap = new Map();
    const existentesTemporales = [];

    for (const row of existentes) {
      const descripcionNormalizada = normalizeDescripcionKey(row.descripcion);
      if (fixedSet.has(descripcionNormalizada)) {
        if (!existentesFijosMap.has(descripcionNormalizada)) {
          existentesFijosMap.set(descripcionNormalizada, row);
        }
      } else {
        existentesTemporales.push(row);
      }
    }

    for (const item of fijos) {
      const descripcionInput = normalizeDescripcion(item?.descripcion);
      if (!descripcionInput) continue;

      const key = normalizeDescripcionKey(descripcionInput);
      if (!fixedSet.has(key)) continue;

      const descripcionCanonica = catalogoMap.get(key) || descripcionInput;
      const values = [
        toNumber(item?.iva_impuesto),
        toNumber(item?.subtotal),
        toNumber(item?.total),
        toNumber(item?.pago_tesla),
      ];

      const existente = existentesFijosMap.get(key);
      if (existente) {
        await client.query(
          `
            UPDATE gastos
            SET descripcion = $1, iva_impuesto = $2, subtotal = $3, total = $4, pago_tesla = $5
            WHERE id = $6
          `,
          [descripcionCanonica, values[0], values[1], values[2], values[3], existente.id]
        );
      } else {
        await client.query(
          `
            INSERT INTO gastos (tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [tipo, mes, anio, descripcionCanonica, values[0], values[1], values[2], values[3]]
        );
      }
    }

    const idsTemporalesConservar = new Set();
    for (const item of temporales) {
      const descripcion = normalizeDescripcion(item?.descripcion);
      if (!descripcion) continue;
      if (fixedSet.has(normalizeDescripcionKey(descripcion))) continue;

      const values = [
        toNumber(item?.iva_impuesto),
        toNumber(item?.subtotal),
        toNumber(item?.total),
        toNumber(item?.pago_tesla),
      ];

      const id = Number(item?.id || 0);
      const existeTemporal = id > 0 && existentesTemporales.some((row) => Number(row.id) === id);

      if (existeTemporal) {
        await client.query(
          `
            UPDATE gastos
            SET descripcion = $1, iva_impuesto = $2, subtotal = $3, total = $4, pago_tesla = $5
            WHERE id = $6
          `,
          [descripcion, values[0], values[1], values[2], values[3], id]
        );
        idsTemporalesConservar.add(id);
      } else {
        const insertTemporal = await client.query(
          `
            INSERT INTO gastos (tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `,
          [tipo, mes, anio, descripcion, values[0], values[1], values[2], values[3]]
        );
        idsTemporalesConservar.add(Number(insertTemporal.rows[0]?.id || 0));
      }
    }

    for (const row of existentesTemporales) {
      if (!idsTemporalesConservar.has(Number(row.id))) {
        await client.query(`DELETE FROM gastos WHERE id = $1`, [row.id]);
      }
    }

    await client.query("COMMIT");

    const result = await pool.query(
      `SELECT * FROM gastos WHERE tipo = $1 AND mes = $2 AND anio = $3 ORDER BY id ASC`,
      [tipo, mes, anio]
    );
    res.json((result.rows || []).map((row) => normalizeGastoRow(row, fixedSet)));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Error al sincronizar gastos del periodo" });
  } finally {
    client.release();
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
    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);
    const catalogoRows = await fetchCatalogoFijos(pool);
    const fixedSetByTipo = {
      tesla: fixedDescriptionsSetFromRows(catalogoRows, "tesla"),
      facu: fixedDescriptionsSetFromRows(catalogoRows, "facu"),
      juani: fixedDescriptionsSetFromRows(catalogoRows, "juani"),
    };

    const gastosPorTipo = {};
    for (const tipoInfo of TIPOS_GASTOS) {
      if (!tiposSeleccionados.includes(tipoInfo.key)) {
        gastosPorTipo[tipoInfo.key] = [];
        continue;
      }

      const result = await pool.query(
        `SELECT * FROM gastos WHERE tipo = $1 AND mes = $2 AND anio = $3 ORDER BY id ASC`,
        [tipoInfo.key, mesInt, anioInt]
      );
      gastosPorTipo[tipoInfo.key] = (result.rows || []).map((row) =>
        normalizeGastoRow(row, fixedSetByTipo[tipoInfo.key] || new Set())
      );
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

    const getBottomLimit = (requiredHeight = 0) => doc.page.height - doc.page.margins.bottom - FOOTER_SAFE_SPACE - requiredHeight;

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

router.post("/", async (req, res) => {
  const tipo = normalizeTipo(req.body?.tipo);
  const mes = Number(req.body?.mes);
  const anio = Number(req.body?.anio);
  const descripcion = normalizeDescripcion(req.body?.descripcion);

  if (!tipo) return res.status(400).json({ error: "Tipo invalido" });
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return res.status(400).json({ error: "Mes invalido" });
  if (!Number.isInteger(anio)) return res.status(400).json({ error: "Año invalido" });
  if (!descripcion) return res.status(400).json({ error: "Descripcion obligatoria" });

  try {
    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);
    const catalogoRows = await fetchCatalogoFijos(pool, tipo);
    const fixedSet = fixedDescriptionsSetFromRows(catalogoRows, tipo);

    const result = await pool.query(
      `
        INSERT INTO gastos (tipo, mes, anio, descripcion, iva_impuesto, subtotal, total, pago_tesla)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        tipo,
        mes,
        anio,
        descripcion,
        toNumber(req.body?.iva_impuesto),
        toNumber(req.body?.subtotal),
        toNumber(req.body?.total),
        toNumber(req.body?.pago_tesla),
      ]
    );
    res.json(normalizeGastoRow(result.rows[0], fixedSet));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el gasto" });
  }
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const descripcion = normalizeDescripcion(req.body?.descripcion);

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID invalido" });
  if (!descripcion) return res.status(400).json({ error: "Descripcion obligatoria" });

  try {
    const result = await pool.query(
      `
        UPDATE gastos
        SET descripcion = $1, iva_impuesto = $2, subtotal = $3, total = $4, pago_tesla = $5
        WHERE id = $6
        RETURNING *
      `,
      [
        descripcion,
        toNumber(req.body?.iva_impuesto),
        toNumber(req.body?.subtotal),
        toNumber(req.body?.total),
        toNumber(req.body?.pago_tesla),
        id,
      ]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Gasto no encontrado" });

    await ensureCatalogoFijosTable(pool);
    await seedCatalogoFijosDefaults(pool);
    const tipo = normalizeTipo(result.rows[0]?.tipo);
    const catalogoRows = await fetchCatalogoFijos(pool, tipo);
    const fixedSet = fixedDescriptionsSetFromRows(catalogoRows, tipo);

    res.json(normalizeGastoRow(result.rows[0], fixedSet));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el gasto" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID invalido" });

  try {
    await pool.query(`DELETE FROM gastos WHERE id = $1`, [id]);
    res.json({ message: "Gasto eliminado correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el gasto" });
  }
});

export default router;
