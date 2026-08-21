import express from "express"
import db from "../db.js"
import PDFDocument from "pdfkit"
import path from "path"
import {fileURLToPath} from "url"
import {
    drawPremiumHeader,
    setupPremiumFooter,
    PDF_COLORS,
    sanitizeFileText,
} from "../pdf/premiumTheme.js"

const router = express.Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

const LABEL_MEDIO = {
    efectivo: "Efectivo",
    transferencia: "Transferencia",
    banco: "Banco",
    cheque: "Cheque",
    echeq: "Echeq",
    retencion: "Retención",
}

const formatoFecha = (valor) => {
    if (!valor) return "-"
    try {
        let fechaStr = ""
        
        // Si es un objeto Date, convertir a ISO string
        if (valor instanceof Date) {
            fechaStr = valor.toISOString().substring(0, 10)
        } else {
            // Si es un string, extraer primeros 10 caracteres
            fechaStr = String(valor).substring(0, 10)
        }
        
        // Validar formato YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return "-"
        
        const [año, mes, día] = fechaStr.split("-")
        return `${día}/${mes}/${año}`
    } catch (err) {
        console.error("Error en formatoFecha:", err, "valor:", valor)
        return "-"
    }
}

const formatoMoneda = (valor) =>
    new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: 2,
    }).format(Number(valor || 0))

const formatearNumeroRecibo = (numero) => String(numero || 0).padStart(6, "0")

const sanitizeText = (value) => String(value || "").trim()

const buildMedioPagoResumen = (detalles = []) => {
    const items = (Array.isArray(detalles) ? detalles : []).filter((item) => Number(item.monto || 0) > 0)
    if (!items.length) return "Sin detalle"
    return items
        .map ((item) => `${LABEL_MEDIO[item.medio_pago] || item.medio_pago} : ${formatoMoneda(item.monto)}`)
        .join(", ")
    }

const sanitizeMediosPagoSnapshot = (detalles = []) => {
    return (Array.isArray(detalles) ? detalles : [])
        .filter((item) => Number(item?.monto || 0) > 0)
        .map((item) => ({
            medio_pago: String(item?.medio_pago || "").trim(),
            monto: Number(item?.monto || 0),
        }))
}

const sanitizePresupuestosIdsSnapshot = (ids = []) => {
  const seen = new Set()
  return (Array.isArray(ids) ? ids : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0)
    .filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
}

const parseBooleanFlag = (value, defaultValue = false) => {
  if (typeof value === "boolean") return value
  if (value === null || value === undefined) return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "si", "sí", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return defaultValue
}

let recibosSchemaReady = false
const ensureRecibosSchema = async () => {
  if (recibosSchemaReady) return

  await db.query(`
    ALTER TABLE recibos_caja
    ADD COLUMN IF NOT EXISTS mostrar_saldos_presupuestos BOOLEAN NOT NULL DEFAULT FALSE
  `)
  await db.query(`
    ALTER TABLE recibos_caja
    ADD COLUMN IF NOT EXISTS presupuestos_ids_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  `)

  await db.query(`DROP INDEX IF EXISTS idx_recibos_caja_movimiento`)
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recibos_caja_movimiento_emitido
    ON recibos_caja(movimiento_caja_id)
    WHERE estado = 'emitido'
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_recibos_caja_movimiento_hist
    ON recibos_caja(movimiento_caja_id)
  `)

  recibosSchemaReady = true
}

const cargarPresupuestoIdsDesdeMovimiento = async (movimientoId) => {
  const result = await db.query(
    `
      SELECT DISTINCT mcp.presupuesto_id
      FROM movimientos_caja_presupuestos mcp
      WHERE mcp.movimiento_id = $1
      ORDER BY mcp.presupuesto_id
    `,
    [movimientoId]
  )
  return (result.rows || []).map((row) => Number(row.presupuesto_id)).filter((id) => Number.isInteger(id) && id > 0)
}

const cargarSaldosRestantesPresupuestos = async (presupuestoIds = []) => {
  const ids = sanitizePresupuestosIdsSnapshot(presupuestoIds)
  if (!ids.length) return []

  const result = await db.query(
    `
      SELECT
        p.id,
        p.numero,
        COALESCE(p.total, 0) AS total,
        COALESCE(pc.total_pagado_caja, 0) AS total_pagado_caja,
        COALESCE(nc.total_notas_credito, 0) AS total_notas_credito
      FROM presupuestos p
      LEFT JOIN (
        SELECT
          mcp.presupuesto_id,
          SUM(COALESCE(NULLIF(mcp.monto_asignado, 0), mc.monto_total)) AS total_pagado_caja
        FROM movimientos_caja_presupuestos mcp
        INNER JOIN movimientos_caja mc ON mc.id = mcp.movimiento_id
        WHERE mc.tipo = 'ingreso'
        GROUP BY mcp.presupuesto_id
      ) pc ON pc.presupuesto_id = p.id
      LEFT JOIN (
        SELECT
          ncp.presupuesto_id,
          SUM(ncp.monto_asignado) AS total_notas_credito
        FROM notas_credito_cliente_presupuestos ncp
        INNER JOIN notas_credito_cliente nc2 ON nc2.id = ncp.nota_credito_id
        WHERE LOWER(TRIM(COALESCE(nc2.estado, 'activa'))) = 'activa'
        GROUP BY ncp.presupuesto_id
      ) nc ON nc.presupuesto_id = p.id
      WHERE p.id = ANY($1::int[])
      ORDER BY p.numero ASC
    `,
    [ids]
  )

  const byId = new Map((result.rows || []).map((row) => [Number(row.id), row]))
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => {
      const total = Number(row.total || 0)
      const totalPagadoCaja = Number(row.total_pagado_caja || 0)
      const totalNotasCredito = Number(row.total_notas_credito || 0)
      const totalExigible = Math.max(0, total - totalNotasCredito)
      const saldoRestante = Math.max(0, totalExigible - totalPagadoCaja)
      return {
        id: Number(row.id),
        numero: Number(row.numero || 0),
        total,
        total_pagado_caja: totalPagadoCaja,
        total_notas_credito: totalNotasCredito,
        total_exigible: totalExigible,
        saldo_restante: saldoRestante,
      }
    })
}

const cargarMovimientoIngreso = async (movimientoId) => {
    try {
        // Cargar movimiento
        const movResult = await db.query(
            `SELECT * FROM movimientos_caja WHERE id = $1 LIMIT 1`,
            [movimientoId]
        )
        
        if (!movResult.rows || movResult.rows.length === 0) {
            return null
        }
        
        const movimiento = movResult.rows[0]
        
        // Cargar detalles de medio de pago
        const detResult = await db.query(
            `SELECT id, medio_pago, monto FROM detalles_medio_pago WHERE movimiento_id = $1`,
            [movimientoId]
        )
        
        movimiento.detalles_medio_pago = detResult.rows || []
        return movimiento
    } catch (err) {
        console.error("Error en cargarMovimientoIngreso:", err.message)
        throw err
    }
}

const cargarRecibosPorMovimiento = async (movimientoId) => {
    const result = await db.query(
        `
        SELECT *
        FROM recibos_caja
        WHERE movimiento_caja_id = $1
    ORDER BY numero DESC, id DESC
        `,
        [movimientoId]
    )
  return result.rows || []
}

const seleccionarReciboPrincipal = (recibos = []) => {
  const lista = Array.isArray(recibos) ? recibos : []
  const emitido = lista.find((item) => String(item?.estado || "") === "emitido")
  if (emitido) return emitido
  return lista[0] || null
}

const cargarReciboPorId = async (reciboId) => {
    const result = await db.query(
        `
        SELECT *
        FROM recibos_caja
        WHERE id = $1
        LIMIT 1
        `,
        [reciboId]
    )
    return result.rows[0] || null
}

router.get("/", async (req, res) => {
  try {
    await ensureRecibosSchema()

    const clienteId = Number(req.query.cliente_id)
    const estado = String(req.query.estado || "").trim().toLowerCase()
    const limitInput = Number(req.query.limit)
    const limit = Number.isInteger(limitInput) && limitInput > 0
      ? Math.min(limitInput, 1000)
      : 200

    const where = []
    const params = []

    if (Number.isInteger(clienteId) && clienteId > 0) {
      params.push(clienteId)
      where.push("cliente_id = $" + params.length)
    }

    if (estado === "emitido" || estado === "anulado"){
      params.push(estado)
      where.push("estado = $" + params.length)
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : ""
    params.push(limit)

    const sql =
      "SELECT * FROM recibos_caja" +
      whereClause +
      " ORDER BY numero DESC LIMIT $" + params.length

    const result = await db.query(sql, params)
    return res.json({ recibos: result.rows || [] })
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo obtener los recibos" })
  }
})

router.post("/", async (req, res) => {
    try {
  await ensureRecibosSchema()
        const movimientoId = Number(req.body.movimiento_id)
        const pagadorNombre = sanitizeText(req.body.pagador_nombre)
        const conceptoPublico = sanitizeText(req.body.concepto_publico)
        const observacionesPublicas = sanitizeText(req.body.observaciones_publicas)
  const mostrarSaldosPresupuestos = parseBooleanFlag(req.body.mostrar_saldos_presupuestos, false)
  let presupuestosIdsSnapshot = sanitizePresupuestosIdsSnapshot(req.body.presupuestos_ids)

        if (!Number.isInteger(movimientoId) || movimientoId <= 0) {
            return res.status(400).json({ error: "ID de movimiento inválido" })
        }

        if (!pagadorNombre) {
            return res.status(400).json({ error: "El nombre del pagador es obligatorio" })
        }

        if (!conceptoPublico) {
            return res.status(400).json({ error: "El concepto público es obligatorio" })
        }

        const movimiento = await cargarMovimientoIngreso(movimientoId)
        if (!movimiento) {
            return res.status(404).json({ error: "Movimiento de caja no encontrado" })
        }

        if (String(movimiento.tipo || "").toLowerCase() !== "ingreso") {
            return res.status(400).json({ error: "El movimiento no es de tipo ingreso" })
        }

        if (Number(movimiento.monto_total || 0) <= 0) {
            return res.status(400).json({ error: "El monto del movimiento debe ser mayor a cero" })
        }

        const recibosExistentes = await cargarRecibosPorMovimiento(movimientoId)
        const reciboEmitidoExistente = recibosExistentes.find((item) => String(item?.estado || "") === "emitido")
        if (reciboEmitidoExistente) {
            return res.status(400).json({ 
                error: "Ya existe un recibo para este movimiento",
            recibo_id: reciboEmitidoExistente.id
            })
        }

        const detalles = Array.isArray(movimiento.detalles_medio_pago) ? movimiento.detalles_medio_pago : []
        const snapshot = sanitizeMediosPagoSnapshot(detalles)
        const medioPagoResumen = buildMedioPagoResumen(detalles)

        if (mostrarSaldosPresupuestos && presupuestosIdsSnapshot.length === 0) {
          presupuestosIdsSnapshot = await cargarPresupuestoIdsDesdeMovimiento(movimiento.id)
        }

        const hoy = new Date().toISOString().split('T')[0]
        const insertResult = await db.query(
      `
        INSERT INTO recibos_caja (
          movimiento_caja_id,
          cliente_id,
          pagador_nombre,
          fecha_emision,
          fecha_cobro,
          concepto_publico,
          observaciones_publicas,
          monto_total,
          medio_pago_resumen,
          medio_pago_snapshot,
          mostrar_saldos_presupuestos,
          presupuestos_ids_snapshot,
          emitido_por
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13
        )
        RETURNING *
      `,
        [
            movimiento.id,
            movimiento.cliente_id || null,
            pagadorNombre,
            hoy,
            hoy,
            conceptoPublico,
            observacionesPublicas || null,
            movimiento.monto_total,
            medioPagoResumen,
            JSON.stringify(snapshot),
            mostrarSaldosPresupuestos,
            JSON.stringify(presupuestosIdsSnapshot),
            req.user?.id || 1,
        ]
    )

    return res.status(201).json(insertResult.rows[0])
  } catch (error) {
    console.error("Error en POST /recibos:", error)
    return res.status(500).json({ 
      error: error.message || "No se pudo emitir el recibo",
      details: error.code || error.constraint || undefined
    })
  }
})


router.get("/por-movimiento/:movimientoId", async (req, res) => {
  try {
    await ensureRecibosSchema()
    const movimientoId = Number(req.params.movimientoId)
    if (!Number.isInteger(movimientoId) || movimientoId <= 0) {
      return res.status(400).json({ error: "ID de movimiento inválido" })
    }

    const recibos = await cargarRecibosPorMovimiento(movimientoId)
    const reciboPrincipal = seleccionarReciboPrincipal(recibos)
    return res.json({ recibo: reciboPrincipal || null, recibos })
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo obtener el recibo" })
  }
})

router.get("/:id/pdf", async (req, res) => {
  try {
    await ensureRecibosSchema()
    const reciboId = Number(req.params.id)
    if (!Number.isInteger(reciboId) || reciboId <= 0) {
      return res.status(400).json({ error: "id invalido" })
    }

    const recibo = await cargarReciboPorId(reciboId)
    if (!recibo) {
      return res.status(404).json({ error: "Recibo no encontrado" })
    }

    const detalles = Array.isArray(recibo.medio_pago_snapshot) ? recibo.medio_pago_snapshot : []
    let cliente = null
    if (recibo.cliente_id) {
      const clienteQ = await db.query(
        `SELECT razon_social, empresa, cuit, iva, direccion, telefono FROM clientes WHERE id = $1 LIMIT 1`,
        [recibo.cliente_id]
      )
      cliente = clienteQ.rows?.[0] || null
    }
    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const nombreArchivo = `Recibo-${formatearNumeroRecibo(recibo.numero)}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Recibo" })

    const left = 45
    const right = pageWidth - 45
    const width = right - left
    const lineColor = "#1f1f1f"
    const safe = (value) => sanitizeText(value) || "-"
    let headerY = 22

    doc.strokeColor(lineColor).lineWidth(1).moveTo(left, headerY + 50).lineTo(right, headerY + 50).stroke()
    doc.strokeColor("#7a7a7a").lineWidth(0.6).moveTo(left, headerY + 54).lineTo(right, headerY + 54).stroke()
    doc.font("Helvetica-Bold").fontSize(28).fillColor("#111")
    doc.text("RECIBO", left, headerY + 14, { width, align: "center" })

    headerY += 64
    const blockGap = 12
    const blockW = (width - blockGap) / 2
    const blockH = 116
    const logoBandW = 82
    doc.rect(left, headerY, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
    doc.image(LOGO_PATH, left + blockW - logoBandW - 4, headerY + 23, { fit: [78, 56], align: "center", valign: "center" })
    const empresaTextW = blockW - logoBandW - 14
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("EMPRESA", left + 8, headerY + 6)
    doc.font("Helvetica").fontSize(8.1)
    doc.text("Tesla Montajes Electricos", left + 8, headerY + 21, { width: empresaTextW, lineBreak: false })
    doc.text("CUIT: 30-71712557-2", left + 8, headerY + 34, { width: empresaTextW, lineBreak: false })
    doc.text("IVA: Responsable Inscripto", left + 8, headerY + 47, { width: empresaTextW, lineBreak: false })
    doc.text("Echeverria 197 - San Francisco (Cba.)", left + 8, headerY + 60, { width: empresaTextW, lineBreak: false })
    doc.text("03564-15642579/15573800/15586865", left + 8, headerY + 73, { width: empresaTextW, lineBreak: false })
    doc.text("teslamontajeselectricos@hotmail.com", left + 8, headerY + 86, { width: empresaTextW, lineBreak: false })
    doc.text("www.teslamontajeselectricos.com.ar", left + 8, headerY + 99, { width: empresaTextW, lineBreak: false })

    const rightBoxX = left + blockW + blockGap
    doc.rect(rightBoxX, headerY, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("CLIENTE", rightBoxX + 8, headerY + 6)
    doc.font("Helvetica").fontSize(8.4)
    doc.text(`Empresa: ${safe(cliente?.empresa || cliente?.razon_social || recibo.pagador_nombre)}`, rightBoxX + 8, headerY + 21, { width: blockW - 16, lineBreak: false })
    doc.text(`CUIT: ${safe(cliente?.cuit)}`, rightBoxX + 8, headerY + 34, { width: blockW - 16, lineBreak: false })
    doc.text(`IVA: ${safe(cliente?.iva)}`, rightBoxX + 8, headerY + 47, { width: blockW - 16, lineBreak: false })
    doc.text(`Direccion: ${safe(cliente?.direccion)}`, rightBoxX + 8, headerY + 60, { width: blockW - 16, lineBreak: false })
    doc.text(`Telefono: ${safe(cliente?.telefono)}`, rightBoxX + 8, headerY + 73, { width: blockW - 16, lineBreak: false })

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerY + blockH + 12

    // Información principal del recibo - RECUADRO GRANDE
    const infoY = doc.y
    const mainBoxHeight = 110
    doc.rect(45, infoY, pageWidth - 90, mainBoxHeight).fill("#f8fafc")
    doc.strokeColor(PDF_COLORS.navy).lineWidth(1.5).rect(45, infoY, pageWidth - 90, mainBoxHeight).stroke()

    // Fila 1: Encabezados
    doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8.5)
    doc.text("RECIBO NÚMERO", 55, infoY + 10, { width: 130 })
    doc.text("FECHA EMISIÓN", 205, infoY + 10, { width: 120 })
    doc.text("FECHA COBRO", 350, infoY + 10, { width: 120 })

    // Fila 2: Valores de la fila 1
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(13)
    doc.text(formatearNumeroRecibo(recibo.numero), 55, infoY + 24, { width: 130 })
    
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(11)
    const fechaEmision = recibo.fecha_emision ? formatoFecha(recibo.fecha_emision) : "-"
    const fechaCobro = recibo.fecha_cobro ? formatoFecha(recibo.fecha_cobro) : "-"
    doc.text(fechaEmision, 205, infoY + 24, { width: 120 })
    doc.text(fechaCobro, 350, infoY + 24, { width: 120 })

    // Línea separadora
    doc.strokeColor("#e2e8f0").lineWidth(0.5).moveTo(58, infoY + 40).lineTo(pageWidth - 58, infoY + 40).stroke()

    // Fila 3: Recibimos de | Importe | Concepto (encabezados)
    doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8.5)
    doc.text("RECIBIMOS DE:", 55, infoY + 52, { width: 130 })
    doc.text("IMPORTE", 205, infoY + 52, { width: 120 })
    doc.text("CONCEPTO", 350, infoY + 52, { width: 120 })

    // Fila 4: Valores
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(11)
    doc.text(recibo.pagador_nombre || "-", 55, infoY + 66, { width: 130 })
    doc.text(formatoMoneda(recibo.monto_total), 205, infoY + 66, { width: 120 })
    
    doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(10)
    // Renderizar concepto permitiendo múltiples líneas
    const conceptoLines = (recibo.concepto_publico || "-").split("\n")
    let conceptoY = infoY + 66
    for (const line of conceptoLines) {
      doc.text(line, 350, conceptoY, { width: 120 })
      conceptoY += 12 // Avanzar Y para la siguiente línea
    }

    doc.y = infoY + mainBoxHeight + 20

    // Observaciones - RECUADRO PEQUEÑO
    if (recibo.observaciones_publicas) {
      const obsY = doc.y
      doc.rect(45, obsY, pageWidth - 90, 40).fill("#ffffff")
      doc.strokeColor("#cbd5e1").lineWidth(0.8).rect(45, obsY, pageWidth - 90, 40).stroke()
      
      doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(7.5)
      doc.text("OBSERVACIONES", 58, obsY + 6)
      
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
      doc.text(recibo.observaciones_publicas, 58, obsY + 18, { width: pageWidth - 116 })
      
      doc.y = obsY + 50
    }

    // Recuadro de anulación si el recibo está anulado
    if (recibo.estado === "anulado") {
      const anulY = doc.y
      doc.rect(45, anulY, pageWidth - 90, 50).fill("#fef2f2")
      doc.strokeColor("#fca5a5").lineWidth(1.5).rect(45, anulY, pageWidth - 90, 50).stroke()
      
      doc.fillColor("#dc2626").font("Helvetica-Bold").fontSize(10)
      doc.text("RECIBO ANULADO", 58, anulY + 8)
      
      doc.fillColor("#7f1d1d").font("Helvetica").fontSize(8)
      doc.text(`Motivo: ${recibo.motivo_anulacion || "-"}`, 58, anulY + 25, { width: pageWidth - 116 })
      
      if (recibo.fecha_anulacion) {
        const fechaAnulacion = new Date(recibo.fecha_anulacion).toLocaleDateString("es-AR")
        doc.text(`Fecha: ${fechaAnulacion}`, 58, anulY + 38, { width: pageWidth - 116 })
      }
      
      doc.y = anulY + 55
    }

    // Medios de pago
    doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(7.5)
    doc.text("MEDIOS DE PAGO", 45, doc.y)

    const tableY = doc.y + 12
    doc.rect(45, tableY, pageWidth - 90, 18).fill(PDF_COLORS.navy)
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5)
    doc.text("MEDIO", 58, tableY + 5, { width: 160 })
    doc.text("MONTO", 330, tableY + 5, { width: 80, align: "right" })

    let rowY = tableY + 18
    ;(detalles.length ? detalles : [{ medio_pago: "sin_detalle", monto: recibo.monto_total }]).forEach((item, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#f8fafc"
      doc.rect(45, rowY, pageWidth - 90, 16).fill(bg)
      doc.strokeColor("#e2e8f0").lineWidth(0.5).rect(45, rowY, pageWidth - 90, 16).stroke()
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
      doc.text(LABEL_MEDIO[item.medio_pago] || item.medio_pago, 58, rowY + 4, { width: 160 })
      doc.text(formatoMoneda(item.monto), 330, rowY + 4, { width: 80, align: "right" })
      rowY += 16
    })

    // Fila TOTAL
    doc.rect(45, rowY, pageWidth - 90, 18).fill("#ffffff")
    doc.strokeColor("#cbd5e1").lineWidth(0.5).rect(45, rowY, pageWidth - 90, 18).stroke()
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(9)
    doc.text("TOTAL", 58, rowY + 4, { width: 160 })
    doc.text(formatoMoneda(recibo.monto_total), 330, rowY + 4, { width: 80, align: "right" })

    const mostrarSaldos = parseBooleanFlag(recibo.mostrar_saldos_presupuestos, false)
    let rowYFinal = rowY
    if (mostrarSaldos) {
      let presupuestoIds = sanitizePresupuestosIdsSnapshot(recibo.presupuestos_ids_snapshot)
      if (!presupuestoIds.length) {
        presupuestoIds = await cargarPresupuestoIdsDesdeMovimiento(Number(recibo.movimiento_caja_id))
      }

      if (presupuestoIds.length) {
        const saldosPresupuestos = await cargarSaldosRestantesPresupuestos(presupuestoIds)
        const neededHeight = 26 + 18 + (Math.max(1, saldosPresupuestos.length) * 16) + 8
        if ((rowYFinal + neededHeight) > (doc.page.height - 120)) {
          doc.addPage()
          rowYFinal = 60
        }

        const sectionY = rowYFinal + 24
        doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(7.5)
        doc.text("SALDO RESTANTE POR PRESUPUESTO", 45, sectionY)

        const saldosTableY = sectionY + 10
        doc.rect(45, saldosTableY, pageWidth - 90, 18).fill(PDF_COLORS.navy)
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5)
        doc.text("PRESUPUESTO", 58, saldosTableY + 5, { width: 200 })
        doc.text("SALDO RESTANTE", 310, saldosTableY + 5, { width: 100, align: "right" })

        let saldoRowY = saldosTableY + 18
        ;(saldosPresupuestos.length ? saldosPresupuestos : [{ numero: "-", saldo_restante: 0 }]).forEach((item, index) => {
          const bg = index % 2 === 0 ? "#ffffff" : "#f8fafc"
          doc.rect(45, saldoRowY, pageWidth - 90, 16).fill(bg)
          doc.strokeColor("#e2e8f0").lineWidth(0.5).rect(45, saldoRowY, pageWidth - 90, 16).stroke()
          doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
          doc.text(`Presupuesto #${item.numero}`, 58, saldoRowY + 4, { width: 200 })
          doc.text(formatoMoneda(item.saldo_restante), 310, saldoRowY + 4, { width: 100, align: "right" })
          saldoRowY += 16
        })

        rowYFinal = saldoRowY
      }
    }

    // Firmas - Posición dinámica basada en la cantidad de medios de pago y saldos
    const signY = rowYFinal + 55
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(70, signY).lineTo(250, signY).stroke()
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(320, signY).lineTo(500, signY).stroke()

    doc.font("Helvetica").fontSize(8).fillColor(PDF_COLORS.slate)
    doc.text("Firma", 70, signY + 8, { width: 180, align: "center" })
    doc.text("Aclaración", 320, signY + 8, { width: 180, align: "center" })

    if (recibo.estado === "anulado") {
      doc.save()
      doc.rotate(-20, { origin: [300, 320] })
      doc.font("Helvetica-Bold").fontSize(46).fillColor("#dc2626").opacity(0.2)
      doc.text("ANULADO", 150, 300)
      doc.restore()
      doc.opacity(1)
    }

    doc.end()
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo generar el PDF del recibo" })
  }
})

router.post("/:id/anular", async (req, res) => {
    try {
        const reciboId = Number(req.params.id)
        const motivo = sanitizeText(req.body.motivo_anulacion)

        if (!Number.isInteger(reciboId) || reciboId <= 0) {
            return res.status(400).json({ error: "ID de recibo inválido" })
        }

        if (!motivo) {
            return res.status(400).json({ error: "El motivo de anulación es obligatorio" })
        }

        const recibo = await cargarReciboPorId(reciboId)
        if (!recibo) {
            return res.status(404).json({ error: "Recibo no encontrado" })
        }

        if (recibo.estado === "anulado") {
            return res.status(400).json({ error: "El recibo ya está anulado" })
        }

        const result = await db.query(
      `
        UPDATE recibos_caja
        SET
          estado = 'anulado',
          fecha_anulacion = CURRENT_TIMESTAMP,
          motivo_anulacion = $2
        WHERE id = $1
        RETURNING *
      `,
      [reciboId, motivo]
    )

    return res.json(result.rows[0])
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo anular el recibo" })
  }
})

router.delete("/:id", async (req, res) => {
  try {
    const reciboId = Number(req.params.id)
    if (!Number.isInteger(reciboId) || reciboId <= 0) {
      return res.status(400).json({ error: "ID de recibo inválido" })
    }

    const recibo = await cargarReciboPorId(reciboId)
    if (!recibo) {
      return res.status(404).json({ error: "Recibo no encontrado" })
    }

    await db.query(
      `DELETE FROM recibos_caja WHERE id = $1`,
      [reciboId]
    )

    return res.json({ message: "Recibo eliminado exitosamente" })
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo eliminar el recibo" })
  }
})

router.get("/:id", async (req, res) => {
    try {
        const reciboId = Number(req.params.id)
        if (!Number.isInteger(reciboId) || reciboId <= 0) {
            return res.status(400).json({ error: "ID de recibo inválido" })
        }

        const recibo = await cargarReciboPorId(reciboId)
        if (!recibo) {
            return res.status(404).json({ error: "Recibo no encontrado" })
        }

        return res.json(recibo)
    } catch (error) {
        return res.status(500).json({ error: error.message || "No se pudo obtener el recibo" })
    }
})

export default router
