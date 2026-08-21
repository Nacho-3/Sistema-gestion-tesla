﻿import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { setupPremiumFooter, sanitizeFileText, PDF_COLORS } from "../pdf/premiumTheme.js"
import { existsSync } from "fs"
import fs from "fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

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

const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100
const formatMoneyAr = (value) =>
  roundMoney(value).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const normalizeMonedaPresupuesto = (value = "ARS") => {
  const moneda = String(value || "").trim().toUpperCase()
  return moneda === "USD" ? "USD" : "ARS"
}
const formatMoneyByMoneda = (value, moneda = "ARS") => {
  const formatted = formatMoneyAr(value)
  return normalizeMonedaPresupuesto(moneda) === "USD" ? `USD ${formatted}` : `$ ${formatted}`
}
const formatSignedMoneyAr = (value) => {
  const amount = roundMoney(value)
  const formatted = formatMoneyAr(Math.abs(amount))
  if (amount > 0) return formatted
  if (amount < 0) return `- ${formatted}`
  return formatted
}

const normalizeDateOnly = (value) => {
  if (!value) return null
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

const validarNotaCreditoPayload = (payload = {}) => {
  const fecha = normalizeDateOnly(payload.fecha) || new Date().toISOString().slice(0, 10)
  const concepto = String(payload.concepto || "").trim()
  const observaciones = String(payload.observaciones || "").trim()
  const montoTotal = roundMoney(payload.monto_total)
  const asignacionesRaw = Array.isArray(payload.presupuestos_asignaciones) ? payload.presupuestos_asignaciones : []

  if (!concepto) return { ok:false, status:400, error:"El concepto de la nota de crédito es obligatorio." }
  if (!(montoTotal > 0)) return { ok:false, status:400, error:"El monto total de la nota de crédito debe ser mayor a cero." }
  if (asignacionesRaw.length === 0) return { ok:false, status:400, error:"Debe asignar al menos un presupuesto a la nota de crédito." }

  const asignaciones = asignacionesRaw.map((a) => ({
    presupuesto_id: Number(a.presupuesto_id || 0),
    monto_asignado: roundMoney(a.monto_asignado),
  }))

  if (asignaciones.some((a) => !Number.isInteger(a.presupuesto_id) || a.presupuesto_id <= 0)) {
    return { ok:false, status:400, error:"Todos los presupuestos asignados deben tener un ID válido." }
  }

  if (asignaciones.some((a) => !(a.monto_asignado > 0))) {
    return { ok:false, status:400, error:"Todos los presupuestos asignados deben tener un monto mayor a cero." }
  }

  const suma = roundMoney(asignaciones.reduce((acc, a) => acc + Number(a.monto_asignado || 0), 0))
  if (Math.abs(suma - montoTotal) > 0.01) {
    return { ok:false, status:400, error:"La suma de los montos asignados no coincide con el monto total de la nota de crédito." }
  }

  return {
    ok: true,
    data: {
      fecha,
      concepto,
      observaciones,
      monto_total: montoTotal,
      asignaciones,
    },
  }
}

const cargarAsignacionesNotaCredito = async (notaId) => {
  const q = await pool.query(
    `
      SELECT
        ncp.nota_credito_id,
        ncp.presupuesto_id,
        ncp.monto_asignado,
        p.numero AS presupuesto_numero
      FROM notas_credito_cliente_presupuestos ncp
      INNER JOIN presupuestos p ON p.id = ncp.presupuesto_id
      WHERE ncp.nota_credito_id = $1
      ORDER BY p.numero ASC
    `,
    [Number(notaId)]
  )
  return q.rows || []
}



const labelMedioPago = (medio = "") => {
  const key = String(medio || "").toLowerCase().trim()
  if (key === "efectivo") return "EFEC"
  if (key === "transferencia") return "TRANSF"
  if (key === "cheque") return "CHEQ"
  if (key === "echeq") return "ECHEQ"
  if (key === "retencion") return "RET"
  return "-"
}

const toSortableDateKey = (value) => {
  if (!value) return "0000-00-00"

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const asText = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(asText)) {
    return asText
  }

  const parsed = new Date(asText)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return asText
}

const hasTableColumn = async (tableName, columnName) => {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  )
  return (result.rowCount || 0) > 0
}

const getFirstExistingColumn = async (tableName, candidates = []) => {
  for (const candidate of candidates) {
    if (await hasTableColumn(tableName, candidate)) {
      return candidate
    }
  }
  return null
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
      .select("razon_social, cuit, direccion, telefono, email, iva, empresa, saldo_inicial_arrastre, fecha_saldo_inicial_arrastre, nota_saldo_inicial_arrastre")
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
      .select("razon_social, empresa, cuit, direccion, telefono, email, iva, saldo_inicial_arrastre, fecha_saldo_inicial_arrastre, nota_saldo_inicial_arrastre")
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" })
    }

    const ahora = new Date()
    const fechaTexto = ahora.toLocaleDateString("es-AR")
    const fechaArchivo = ahora.toISOString().slice(0, 10)
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

    const topHeaderY = 45
    doc.fillColor(PDF_COLORS.ink)
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("FICHA DE CLIENTE", 45, topHeaderY, { align: "center", width: pageWidth - 90 })

    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, pageWidth - 45 - 60, 10, { fit: [56, 56] })
    }

    const headerLineY = topHeaderY + 32
    doc.moveTo(45, headerLineY).lineTo(pageWidth - 45, headerLineY).strokeColor(PDF_COLORS.line).lineWidth(0.9).stroke()

    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(11)
    doc.text(`Actualizada al ${fechaTexto}`, 45, headerLineY + 10, { align: "right", width: pageWidth - 90 })

    // Datos asociados
    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("id, nombre, estado, fecha_inicio")
      .eq("cliente_id", id)
      .order("created_at", { ascending: false })

    if (obrasError) throw obrasError

    const presupuestosTieneIvaMonto = await hasTableColumn("presupuestos", "iva_monto")
    const presupuestosTieneMoneda = await hasTableColumn("presupuestos", "moneda")
    const movimientosTienePresupuestoId = await hasTableColumn("movimientos_caja", "presupuesto_id")

    const selectPresupuestos = ["id", "numero", "fecha", "estado", "total", "obra_id"]
    if (presupuestosTieneIvaMonto) {
      selectPresupuestos.push("iva_monto")
    }
    if (presupuestosTieneMoneda) {
      selectPresupuestos.push("moneda")
    }

    const { data: presupuestos, error: presupuestosError } = await db
      .from("presupuestos")
      .select(selectPresupuestos.join(", "))
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })

    if (presupuestosError) throw presupuestosError

    const selectMovimientos = ["id", "fecha", "monto_total", "tipo"]
    if (movimientosTienePresupuestoId) {
      selectMovimientos.push("presupuesto_id")
    }

    const columnList = selectMovimientos.join(", ")
    const result = await pool.query(
      `SELECT ${columnList} FROM movimientos_caja WHERE cliente_id = $1 AND tipo IN ('ingreso', 'egreso') ORDER BY fecha ASC`,
      [id]
    )
    const movimientosCaja = result.rows

    const obrasList = obras || []
    const presupuestosList = presupuestos || []
    const movimientosList = (movimientosCaja || []).map((mov) => ({
      ...mov,
      presupuesto_id: movimientosTienePresupuestoId ? mov?.presupuesto_id ?? null : null,
    }))

    const obraNombrePorId = new Map(obrasList.map((obra) => [Number(obra.id), obra.nombre || "Sin obra"]))
    const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase())
    const saldoInicialArrastre = roundMoney(cliente?.saldo_inicial_arrastre)
    const presupuestosAceptadosList = presupuestosList.filter(isAceptado)
    const pagosImputadosPorPresupuesto = new Map()
    const pagosNoImputadosList = []
    movimientosList.forEach((mov) => {
      const presupuestoId = Number(mov.presupuesto_id || 0)
      const monto = roundMoney(mov.monto_total)
      if (presupuestoId > 0) {
        pagosImputadosPorPresupuesto.set(presupuestoId, roundMoney((pagosImputadosPorPresupuesto.get(presupuestoId) || 0) + monto))
      } else {
        pagosNoImputadosList.push(mov)
      }
    })

    const estadoCuenta = presupuestosAceptadosList.map((p) => {
      const total = roundMoney(p.total)
      const iva = roundMoney(p.iva_monto)
      const sinIva = roundMoney(total - iva)
      const moneda = normalizeMonedaPresupuesto(p.moneda)
      const pagado = roundMoney(pagosImputadosPorPresupuesto.get(Number(p.id)) || 0)
      const saldoPendiente = roundMoney(Math.max(0, total - pagado))
      const saldoAFavor = roundMoney(Math.max(0, pagado - total))
      const estadoCobro = pagado <= 0 ? "Pendiente" : (pagado < total ? "Parcial" : (pagado === total ? "Pagado" : "A favor"))
      return {
        presupuesto_id: Number(p.id),
        numero: p.numero,
        fecha: p.fecha,
        obra: obraNombrePorId.get(Number(p.obra_id)) || "Sin obra",
        moneda,
        sin_iva: sinIva,
        iva,
        total,
        pagado,
        saldo_pendiente: saldoPendiente,
        saldo_a_favor: saldoAFavor,
        estado_cobro: estadoCobro,
      }
    })

    const totalCargosPresupuestos = roundMoney(estadoCuenta.reduce((acc, item) => acc + item.total, 0))
    const totalPagosCaja = roundMoney(movimientosList.reduce((acc, mov) => acc + roundMoney(mov.monto_total), 0))
    const totalNoImputado = roundMoney(pagosNoImputadosList.reduce((acc, mov) => acc + roundMoney(mov.monto_total), 0))
    const saldoPendienteFinal = roundMoney(saldoInicialArrastre + totalCargosPresupuestos - totalPagosCaja)

    let cursorY = headerLineY + 24

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

    const drawSummaryGrid = (rows = []) => {
      ensureSpace(72)
      const cardHeight = 48
      const availableWidth = pageWidth - 90
      const colW = availableWidth / Math.max(rows.length, 1)

      rows.forEach((item, idx) => {
        const x = 45 + idx * colW
        doc.rect(x, cursorY, colW, cardHeight).fillAndStroke("#f8fafc", PDF_COLORS.line)
        const [title, value] = String(item).split("\n")
        doc.fillColor(PDF_COLORS.slate).font("Helvetica-Bold").fontSize(8)
        doc.text(title || "", x + 8, cursorY + 9, { width: colW - 16 })
        doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(12)
        doc.text(value || "", x + 8, cursorY + 22, { width: colW - 16 })
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
      useGrid = false,
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
        if (useGrid) {
          doc.rect(45, cursorY, pageWidth - 90, rowHeight).lineWidth(0.4).strokeColor(PDF_COLORS.line).stroke()
          columns.forEach((col, colIdx) => {
            if (colIdx === 0) return
            doc.moveTo(col.x - 4, cursorY).lineTo(col.x - 4, cursorY + rowHeight).lineWidth(0.3).strokeColor(PDF_COLORS.line).stroke()
          })
        }
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

    drawSectionTitle("ESTADO DE CUENTA")
    drawSummaryGrid([
      `Saldo inicial\n$ ${formatMoneyAr(saldoInicialArrastre)}`,
      `Cargos presupuestos\n$ ${formatMoneyAr(totalCargosPresupuestos)}`,
      `Pagos por caja\n$ ${formatMoneyAr(totalPagosCaja)}`,
      `No imputado\n$ ${formatMoneyAr(totalNoImputado)}`,
      `Saldo pendiente final\n$ ${formatMoneyAr(saldoPendienteFinal)}`,
    ])

    drawTable({
      columns: [
        { key: "numero", label: "NRO", x: 55, width: 30 },
        { key: "fecha", label: "FECHA", x: 87, width: 52 },
        { key: "obra", label: "OBRA", x: 141, width: 74 },
        { key: "moneda", label: "MON", x: 217, width: 24 },
        { key: "sin_iva", label: "S/IVA", x: 243, width: 52, align: "right" },
        { key: "iva", label: "IVA", x: 297, width: 40, align: "right" },
        { key: "total", label: "TOTAL", x: 339, width: 54, align: "right" },
        { key: "pagado", label: "PAGADO", x: 395, width: 54, align: "right" },
        { key: "saldo", label: "SALDO", x: 451, width: 54, align: "right" },
        { key: "estado", label: "ESTADO", x: 503, width: 43 },
      ],
      rows: estadoCuenta.map((p) => ({
        numero: `#${p.numero || "-"}`,
        fecha: p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-",
        obra: p.obra,
        moneda: p.moneda,
        sin_iva: formatMoneyByMoneda(p.sin_iva, p.moneda),
        iva: formatMoneyByMoneda(p.iva, p.moneda),
        total: formatMoneyByMoneda(p.total, p.moneda),
        pagado: formatMoneyByMoneda(p.pagado, p.moneda),
        saldo: formatMoneyByMoneda(p.saldo_pendiente, p.moneda),
        estado: p.estado_cobro,
      })),
      emptyText: "No hay presupuestos aceptados para estado de cuenta.",
      rowHeight: 24,
      useGrid: true,
    })

    doc.end()
  } catch (err) {
    return handleInternalError(res, err, "ficha_pdf_cliente")
  }
})

// Descargar ficha de cuenta corriente histórica del cliente en PDF
router.get("/:id/ficha-historica-pdf", async (req, res) => {
  try {
    const { id } = req.params

    const { data: cliente, error: clienteError } = await db
      .from("clientes")
      .select("razon_social, empresa, cuit, direccion, telefono, email, iva, saldo_inicial_arrastre, fecha_saldo_inicial_arrastre, nota_saldo_inicial_arrastre")
      .eq("id", id)
      .single()

    if (clienteError || !cliente) {
      return res.status(404).json({ error: "Cliente no encontrado" })
    }

    const ahora = new Date()
    const fechaTexto = ahora.toLocaleDateString("es-AR")
    const fechaArchivo = ahora.toISOString().slice(0, 10)
    const nombreCliente = sanitizeFileText(cliente.razon_social || "Cliente")
    const nombreArchivo = `Ficha Historica ${nombreCliente} ${fechaArchivo}.pdf`

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(chunks)
      await saveFileToClientFolder(nombreCliente, nombreArchivo, pdfBuffer, cliente)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
      res.send(pdfBuffer)
    })

    const pageWidth = doc.page.width
    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Documento interno" })

    const topHeaderY = 45
    doc.fillColor(PDF_COLORS.ink)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("CUENTA CORRIENTE CRONOLOGICA", 45, topHeaderY, { align: "center", width: pageWidth - 90 })

    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, pageWidth - 45 - 60, 10, { fit: [56, 56] })
    }

    const headerLineY = topHeaderY + 30
    doc.moveTo(45, headerLineY).lineTo(pageWidth - 45, headerLineY).strokeColor(PDF_COLORS.line).lineWidth(0.9).stroke()

    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(11)
    doc.text(`Actualizada al ${fechaTexto}`, 45, headerLineY + 10, { align: "right", width: pageWidth - 90 })

    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("id, nombre")
      .eq("cliente_id", id)

    if (obrasError) throw obrasError

    const columnaDetalleMovimiento = await getFirstExistingColumn("movimientos_caja", ["detalle", "descripcion"]) || "detalle"
    const movimientosTienePresupuestoId = await hasTableColumn("movimientos_caja", "presupuesto_id")

    const presupuestosTieneIvaMonto = await hasTableColumn("presupuestos", "iva_monto")
    const presupuestosTieneMoneda = await hasTableColumn("presupuestos", "moneda")
    const selectPresupuestos = ["id", "numero", "fecha", "created_at", "estado", "total", "obra_id"]
    if (presupuestosTieneIvaMonto) {
      selectPresupuestos.push("iva_monto")
    }
    if (presupuestosTieneMoneda) {
      selectPresupuestos.push("moneda")
    }

    const { data: presupuestos, error: presupuestosError } = await db
      .from("presupuestos")
      .select(selectPresupuestos.join(", "))
      .eq("cliente_id", id)

    if (presupuestosError) throw presupuestosError

    const selectMovimientos = ["id", "fecha", "created_at", columnaDetalleMovimiento, "monto_total", "observaciones", "tipo", "destinatario"]
    if (movimientosTienePresupuestoId) {
      selectMovimientos.push("presupuesto_id")
    }

    const columnList = selectMovimientos.join(", ")
    const result = await pool.query(
      `SELECT ${columnList} FROM movimientos_caja WHERE cliente_id = $1 AND tipo IN ('ingreso', 'egreso') ORDER BY fecha ASC`,
      [id]
    )
    const movimientosCaja = result.rows

    const obrasList = obras || []
    const presupuestosList = presupuestos || []
    const movimientosList = (movimientosCaja || []).map((mov) => ({
      ...mov,
      detalle: mov?.[columnaDetalleMovimiento] || mov?.detalle || "-",
      presupuesto_id: movimientosTienePresupuestoId ? mov?.presupuesto_id ?? null : null,
    }))

    const obraNombrePorId = new Map(obrasList.map((obra) => [Number(obra.id), obra.nombre || "Sin obra"]))
    const presupuestoById = new Map(presupuestosList.map((p) => [Number(p.id), p]))
    const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase())
    const presupuestosAceptadosList = presupuestosList.filter(isAceptado)

    const mediosPorMovimiento = new Map()
    const movimientoIds = movimientosList
      .map((mov) => Number(mov.id || 0))
      .filter((movId) => Number.isInteger(movId) && movId > 0)

    if (movimientoIds.length > 0) {
      const detallesPagosRes = await pool.query(
        "SELECT movimiento_id, medio_pago FROM detalles_medio_pago WHERE movimiento_id = ANY($1::int[])",
        [movimientoIds]
      )

      for (const row of detallesPagosRes.rows || []) {
        const movId = Number(row.movimiento_id)
        const actual = mediosPorMovimiento.get(movId) || new Set()
        actual.add(labelMedioPago(row.medio_pago))
        mediosPorMovimiento.set(movId, actual)
      }
    }

    let asignacionesPorMovimiento = new Map()
    if (movimientoIds.length > 0) {
      try {
        const asigRes = await pool.query(
          "SELECT mcp.movimiento_id, mcp.presupuesto_id, COALESCE(NULLIF(mcp.monto_asignado, 0), mc.monto_total) AS monto_asignado, p.numero AS presupuesto_numero, COALESCE(o.nombre, 'Sin obra') AS obra_nombre " +
            "FROM movimientos_caja_presupuestos mcp " +
            "INNER JOIN movimientos_caja mc ON mc.id = mcp.movimiento_id " +
            "INNER JOIN presupuestos p ON p.id = mcp.presupuesto_id " +
            "LEFT JOIN obras o ON o.id = p.obra_id " +
            "WHERE mcp.movimiento_id = ANY($1::int[])",
          [movimientoIds]
        )

        for (const row of asigRes.rows || []) {
          const movId = Number(row.movimiento_id)
          const list = asignacionesPorMovimiento.get(movId) || []
          list.push({
            presupuesto_id: Number(row.presupuesto_id),
            presupuesto_numero: row.presupuesto_numero,
            obra_nombre: row.obra_nombre || "Sin obra",
            monto_asignado: roundMoney(row.monto_asignado),
          })
          asignacionesPorMovimiento.set(movId, list)
        }
      } catch (err) {
        console.warn("[clientes] ficha_historica_pdf_cliente: no se pudieron cargar asignaciones de movimientos_caja_presupuestos", err)
      }
    }

    const notasRes = await pool.query(
      "SELECT nc.id, nc.fecha, nc.created_at, nc.concepto, ncp.presupuesto_id, ncp.monto_asignado, p.numero AS presupuesto_numero " +
        "FROM notas_credito_cliente nc " +
        "INNER JOIN notas_credito_cliente_presupuestos ncp ON ncp.nota_credito_id = nc.id " +
        "INNER JOIN presupuestos p ON p.id = ncp.presupuesto_id " +
        "WHERE nc.cliente_id = $1 AND LOWER(TRIM(COALESCE(nc.estado, 'activa'))) = 'activa' " +
        "ORDER BY nc.fecha ASC, nc.created_at ASC, nc.id ASC",
      [id]
    )

    const notasMap = new Map()
    for (const row of notasRes.rows || []) {
      const noteId = Number(row.id)
      const existing = notasMap.get(noteId) || {
        id: noteId,
        fecha: row.fecha,
        created_at: row.created_at,
        concepto: String(row.concepto || "-"),
        asignaciones: [],
        monto_total: 0,
      }
      const montoAsignado = roundMoney(row.monto_asignado)
      existing.asignaciones.push({
        presupuesto_id: Number(row.presupuesto_id),
        presupuesto_numero: row.presupuesto_numero,
        monto_asignado: montoAsignado,
      })
      existing.monto_total = roundMoney(existing.monto_total + montoAsignado)
      notasMap.set(noteId, existing)
    }
    const notasList = Array.from(notasMap.values())

    const saldoInicialArrastre = roundMoney(cliente?.saldo_inicial_arrastre)
    const fechaSaldoInicial = normalizeDateOnly(cliente?.fecha_saldo_inicial_arrastre) || "0000-00-00"
    const notaSaldoInicial = String(cliente?.nota_saldo_inicial_arrastre || "").trim()

    const ledgerRows = []
    ledgerRows.push({
      kind: "saldo_inicial",
      sortDate: fechaSaldoInicial,
      sortCreatedAt: `${fechaSaldoInicial}T00:00:00`,
      sortOrder: -1,
      sortId: -1,
      fecha: fechaSaldoInicial !== "0000-00-00" ? new Date(fechaSaldoInicial).toLocaleDateString("es-AR") : "-",
      tipo: "Saldo inicial",
      referencia: notaSaldoInicial || "Arrastre sistema anterior",
      debe: saldoInicialArrastre > 0 ? formatMoneyAr(saldoInicialArrastre) : "-",
      haber: saldoInicialArrastre < 0 ? formatMoneyAr(Math.abs(saldoInicialArrastre)) : "-",
      signedAmount: saldoInicialArrastre,
    })

    for (const p of presupuestosAceptadosList) {
      const total = roundMoney(p.total)
      const obra = obraNombrePorId.get(Number(p.obra_id)) || "Sin obra"
      const moneda = normalizeMonedaPresupuesto(p.moneda)
      ledgerRows.push({
        kind: "presupuesto",
        sortDate: p.fecha || "0000-00-00",
        sortCreatedAt: p.created_at || `${p.fecha || "0000-00-00"}T00:00:00`,
        sortOrder: Number(p.id) || 0,
        sortId: Number(p.id) || 0,
        fecha: p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-",
        tipo: moneda === "USD" ? "Presupuesto USD" : "Presupuesto",
        referencia: `Presupuesto #${String(p.numero || "-")} - ${obra}`,
        debe: formatMoneyByMoneda(total, moneda),
        haber: "-",
        signedAmount: total,
      })
    }

    for (const nota of notasList) {
      const presupuestosTxt = nota.asignaciones
        .map((a) => `#${String(a.presupuesto_numero || a.presupuesto_id)}`)
        .join(", ")
      const refPres = presupuestosTxt ? ` (Presupuestos: ${presupuestosTxt})` : ""

      ledgerRows.push({
        kind: "nota_credito",
        sortDate: nota.fecha || "0000-00-00",
        sortCreatedAt: nota.created_at || `${nota.fecha || "0000-00-00"}T00:00:00`,
        sortOrder: Number(nota.id) || 0,
        sortId: Number(nota.id) || 0,
        fecha: nota.fecha ? new Date(nota.fecha).toLocaleDateString("es-AR") : "-",
        tipo: "Nota de crédito",
        referencia: `Nota de crédito: ${nota.concepto || "-"}${refPres}`,
        debe: "-",
        haber: formatMoneyAr(nota.monto_total),
        signedAmount: -nota.monto_total,
      })
    }

    for (const mov of movimientosList) {
      const monto = roundMoney(mov.monto_total)
      const movTipo = String(mov.tipo || "").toLowerCase()

      if (movTipo === "egreso") {
        const detalleEgreso = mov[columnaDetalleMovimiento] || mov.detalle || "Egreso en caja"
        const destinatario = String(mov.destinatario || "Devolucion al cliente").trim()
        ledgerRows.push({
          kind: "egreso",
          sortDate: mov.fecha || "0000-00-00",
          sortCreatedAt: mov.created_at || `${mov.fecha || "0000-00-00"}T00:00:00`,
          sortOrder: Number(mov.id) || 0,
          sortId: Number(mov.id) || 0,
          fecha: mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-AR") : "-",
          tipo: "Egreso",
          referencia: `${detalleEgreso} - ${destinatario}`,
          debe: formatMoneyAr(monto),
          haber: "-",
          signedAmount: monto,
        })
        continue
      }

      const asig = asignacionesPorMovimiento.get(Number(mov.id || 0)) || []
      const numeros = asig.length
        ? asig.map((a) => `#${String(a.presupuesto_numero || a.presupuesto_id)}`).join(", ")
        : ""
      
      const detalle = String(mov[columnaDetalleMovimiento] || mov.detalle || "Cobro en caja")
      const referencia = numeros ? `${detalle} - Presupuestos ${numeros}` : `${detalle} - Pago sin imputar`

      ledgerRows.push({
        kind: "pago",
        sortDate: mov.fecha || "0000-00-00",
        sortCreatedAt: mov.created_at || `${mov.fecha || "0000-00-00"}T00:00:00`,
        sortOrder: Number(mov.id) || 0,
        sortId: Number(mov.id) || 0,
        fecha: mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-AR") : "-",
        tipo: "Pago",
        referencia,
        debe: "-",
        haber: formatMoneyAr(monto),
        signedAmount: -monto,
      })
    }

    ledgerRows.sort((a, b) => {
      const aDate = toSortableDateKey(a.sortDate)
      const bDate = toSortableDateKey(b.sortDate)
      if (aDate !== bDate) return aDate.localeCompare(bDate)

      const aCreated = new Date(a.sortCreatedAt || `${aDate}T00:00:00`).getTime()
      const bCreated = new Date(b.sortCreatedAt || `${bDate}T00:00:00`).getTime()
      if (aCreated !== bCreated) return aCreated - bCreated

      if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) {
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      }

      return String(a.referencia || "").localeCompare(String(b.referencia || ""))
    })

    let saldoAcumulado = 0
    for (const row of ledgerRows) {
      saldoAcumulado = roundMoney(saldoAcumulado + row.signedAmount)
      row.saldo_num = saldoAcumulado
      row.saldo = formatSignedMoneyAr(saldoAcumulado)
      row.saldoColor = saldoAcumulado > 0 ? "#b91c1c" : "#065f46"
    }

    const footerSafe = 80
    let cursorY = headerLineY + 24

    const ensureSpace = (requiredHeight = 30) => {
      if (cursorY + requiredHeight <= doc.page.height - footerSafe) return
      doc.addPage()
      cursorY = 60
    }

    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10)
    doc.text(`Cliente: ${cliente.razon_social || "-"}`, 45, cursorY)
    cursorY += 14
    doc.font("Helvetica").fontSize(9)
    doc.text(`CUIT: ${cliente.cuit || "-"}    IVA: ${cliente.iva || "-"}`, 45, cursorY)
    cursorY += 16

    const drawLedgerHeader = () => {
      ensureSpace(26)
      doc.rect(45, cursorY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(7.2)

      const cols = [
        { key: "fecha", label: "FECHA", x: 45, width: 62 },
        { key: "tipo", label: "TIPO", x: 107, width: 70 },
        { key: "referencia", label: "REFERENCIA", x: 177, width: 206 },
        { key: "debe", label: "DEBE", x: 383, width: 58 },
        { key: "haber", label: "HABER", x: 441, width: 58 },
        { key: "saldo", label: "SALDO", x: 499, width: 51 },
      ]

      for (const col of cols) {
        doc.text(col.label, col.x + 1, cursorY + 7, { width: col.width - 2, align: "left" })
      }

      cursorY += 22
      return cols
    }

    let ledgerCols = drawLedgerHeader()

    if (!ledgerRows.length) {
      ensureSpace(24)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9)
      doc.text("No hay movimientos para la cuenta corriente del cliente.", 45, cursorY + 4)
      cursorY += 26
    } else {
      const bodyFontSize = 7.4
      const cellPaddingX = 1
      const cellPaddingY = 4
      const minRowHeight = 18

      const medirAlturaFila = (row, cols) => {
        doc.font("Helvetica").fontSize(bodyFontSize)

        let maxTextHeight = 0
        for (const col of cols) {
          const text = String(row[col.key] ?? "")
          const align = ["debe", "haber", "saldo"].includes(col.key) ? "right" : "left"

          const textHeight = doc.heightOfString(text, {
            width: Math.max(1, col.width - (cellPaddingX * 2)),
            align,
          })

          if (textHeight > maxTextHeight) maxTextHeight = textHeight
        }

        return Math.max(minRowHeight, Math.ceil(maxTextHeight + (cellPaddingY * 2)))
      }

      for (let idx = 0; idx < ledgerRows.length; idx++) {
        const row = ledgerRows[idx]
        const rowHeight = medirAlturaFila(row, ledgerCols)

        if (cursorY + rowHeight > doc.page.height - footerSafe) {
          doc.addPage()
          cursorY = 60
          ledgerCols = drawLedgerHeader()
        }

        const fill = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, cursorY, pageWidth - 90, rowHeight).fill(fill)
        doc.rect(45, cursorY, pageWidth - 90, rowHeight).lineWidth(0.35).strokeColor(PDF_COLORS.line).stroke()

        ledgerCols.forEach((col, colIdx) => {
          if (colIdx === 0) return
          doc.moveTo(col.x, cursorY).lineTo(col.x, cursorY + rowHeight).lineWidth(0.25).strokeColor(PDF_COLORS.line).stroke()
        })

        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(bodyFontSize)

        ledgerCols.forEach((col) => {
          const text = String(row[col.key] ?? "")
          const align = ["debe", "haber", "saldo"].includes(col.key) ? "right" : "left"
          const textOptions = {
            width: Math.max(1, col.width - (cellPaddingX * 2)),
            align,
          }

          if (col.key === "saldo") {
            doc.fillColor(row.saldoColor || PDF_COLORS.ink).font("Helvetica-Bold")
            doc.text(text, col.x + cellPaddingX, cursorY + cellPaddingY, textOptions)
            doc.fillColor(PDF_COLORS.ink).font("Helvetica")
            return
          }

          doc.text(text, col.x + cellPaddingX, cursorY + cellPaddingY, textOptions)
        })

        cursorY += rowHeight
      }
    }

    doc.end()
  } catch (err) {
    return handleInternalError(res, err, "ficha_historica_pdf_cliente")
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
      saldo_inicial_arrastre,
      fecha_saldo_inicial_arrastre,
      nota_saldo_inicial_arrastre,
    } = req.body;

    const razonSocialFinal = razon_social?.trim() || "-";
    const empresaFinal = empresa?.trim() || "-";
    const cuitFinal = cuit?.trim() || "-";
    const direccionFinal = direccion?.trim() || "-";
    const telefonoFinal = telefono?.trim() || "-";
    const emailFinal = email?.trim() || "-";
    const ivaFinal = iva?.trim() || "-";
    const saldoInicialArrastreFinal = roundMoney(saldo_inicial_arrastre)
    const fechaSaldoInicialFinal = normalizeDateOnly(fecha_saldo_inicial_arrastre) || new Date().toISOString().slice(0, 10)
    const notaSaldoInicialFinal = String(nota_saldo_inicial_arrastre || "").trim()

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
          saldo_inicial_arrastre: saldoInicialArrastreFinal,
          fecha_saldo_inicial_arrastre: fechaSaldoInicialFinal,
          nota_saldo_inicial_arrastre: notaSaldoInicialFinal,
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
      saldo_inicial_arrastre,
      fecha_saldo_inicial_arrastre,
      nota_saldo_inicial_arrastre,
    } = req.body;

    const actualizaciones = {};
    if (razon_social !== undefined) actualizaciones.razon_social = (razon_social ?? "").trim() || "-";
    if (empresa !== undefined) actualizaciones.empresa = (empresa ?? "").trim() || "-";
    if (cuit !== undefined) actualizaciones.cuit = (cuit ?? "").trim() || "-";
    if (direccion !== undefined) actualizaciones.direccion = (direccion ?? "").trim() || "-";
    if (telefono !== undefined) actualizaciones.telefono = (telefono ?? "").trim() || "-";
    if (email !== undefined) actualizaciones.email = (email ?? "").trim() || "-";
    if (iva !== undefined) actualizaciones.iva = (iva ?? "").trim() || "-";
    if (saldo_inicial_arrastre !== undefined) actualizaciones.saldo_inicial_arrastre = roundMoney(saldo_inicial_arrastre);
    if (fecha_saldo_inicial_arrastre !== undefined) {
      const fechaNormalizada = normalizeDateOnly(fecha_saldo_inicial_arrastre)
      if (!fechaNormalizada) {
        return res.status(400).json({ error: "fecha_saldo_inicial_arrastre invalida" })
      }
      actualizaciones.fecha_saldo_inicial_arrastre = fechaNormalizada
    }
    if (nota_saldo_inicial_arrastre !== undefined) {
      actualizaciones.nota_saldo_inicial_arrastre = String(nota_saldo_inicial_arrastre || "").trim()
    }

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

router.get("/:id/notas-credito", async (req, res) => {
  try{
    const clienteId = Number(req.params.id)
    if(!Number.isInteger(clienteId) || clienteId <= 0){
      return res.status(400).json({ error: "ID de cliente invalido."})
  }

  const notasQ = await pool.query(
    `
      SELECT *
      FROM notas_credito_cliente
      WHERE cliente_id = $1
      ORDER BY fecha DESC, id DESC
    `,
    [clienteId]
  )

  const notas = notasQ.rows || []
  const enriched = await Promise.all(
    notas.map(async (n) => ({
      ...n,
      presupuestos_asignaciones: await cargarAsignacionesNotaCredito(n.id)
    }))
  )

  return res.json(enriched)
  } catch(err){
    return handleInternalError(res, err, "listar_notas_credito_cliente") 
  }     
})

router.post("/:id/notas-credito", async (req, res) => {
  const client = await pool.connect()
  try {
    const clienteId = Number(req.params.id)
    if (!Number.isInteger(clienteId) || clienteId <= 0) {
      return res.status(400).json({ error: "ID de cliente invalido" })
    }

    const validacion = validarNotaCreditoPayload(req.body || {})
    if (!validacion.ok) return res.status(validacion.status).json({ error: validacion.error })

    const { fecha, concepto, observaciones, monto_total, asignaciones } = validacion.data
    const presupuestosIds = [...new Set(asignaciones.map((a) => Number(a.presupuesto_id)))]

    await client.query("BEGIN")

    await client.query("LOCK TABLE notas_credito_cliente IN EXCLUSIVE MODE")
    const numeroQ = await client.query(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM notas_credito_cliente`
    )
    const numero = Number(numeroQ.rows?.[0]?.siguiente || 1)

    const presupuestosQ = await client.query(
      `
        SELECT id
        FROM presupuestos
        WHERE id = ANY($1::int[])
          AND cliente_id = $2
      `,
      [presupuestosIds, clienteId]
    )

    if ((presupuestosQ.rows || []).length !== presupuestosIds.length) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "Hay presupuestos que no pertenecen al cliente" })
    }

    const insertNotaQ = await client.query(
      `
        INSERT INTO notas_credito_cliente (numero, cliente_id, fecha, concepto, observaciones, monto_total, estado)
        VALUES ($1, $2, $3, $4, $5, $6, 'activa')
        RETURNING *
      `,
      [numero, clienteId, fecha, concepto, observaciones, monto_total]
    )

    const nota = insertNotaQ.rows[0]

    for (const a of asignaciones) {
      await client.query(
        `
          INSERT INTO notas_credito_cliente_presupuestos
          (nota_credito_id, presupuesto_id, cliente_id, monto_asignado)
          VALUES ($1, $2, $3, $4)
        `,
        [nota.id, a.presupuesto_id, clienteId, a.monto_asignado]
      )
    }

    await client.query("COMMIT")

    getIo()?.emit("clientes:changed")
    getIo()?.emit("presupuestos:changed")
    getIo()?.emit("notas_credito:changed")

    return res.status(201).json({
      ...nota,
      presupuestos_asignaciones: await cargarAsignacionesNotaCredito(nota.id),
    })
  } catch (err) {
    await client.query("ROLLBACK")
    return handleInternalError(res, err, "crear_nota_credito_cliente")
  } finally {
    client.release()
  }
})

router.put ("/:id/notas-credito/:notaId", async (req, res) => {
  const client = await pool.connect()
  try {
    const clienteId = Number(req.params.id)
    const notaId = Number(req.params.notaId)
    
    if (!Number.isInteger(clienteId) || clienteId <= 0 || !Number.isInteger(notaId) || notaId <= 0) {
      return res.status(400).json({ error: "ID de cliente o nota invalido" })
    }

    const validacion = validarNotaCreditoPayload(req.body || {})
    if (!validacion.ok) return res.status(validacion.status).json({ error: validacion.error })

    const { fecha, concepto, observaciones, monto_total, asignaciones } = validacion.data
    const presupuestosIds = [...new Set(asignaciones.map((a) => Number(a.presupuesto_id)))]

    await client.query("BEGIN")

    const notaQ = await client.query(
      `
        SELECT *
        FROM notas_credito_cliente
        WHERE id = $1 AND cliente_id = $2
      `,
      [notaId, clienteId]
    )

    const nota = notaQ.rows[0]
    if (!nota) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Nota de crédito no encontrada para el cliente" })
    }
    if(String(nota.estado || "").toLowerCase() === "anulada"){
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "No se puede modificar una nota de crédito anulada" })
    }

    const presupuestosQ = await client.query(
      `
        SELECT id
        FROM presupuestos
        WHERE id = ANY($1::int[])
          AND cliente_id = $2
      `,
      [presupuestosIds, clienteId]
    )
    if((presupuestosQ.rows || []).length !== presupuestosIds.length) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "Algunos presupuestos no pertenecen al cliente" })
    }

    const updQ = await client.query(
      `
        UPDATE notas_credito_cliente
        SET fecha = $3,
            concepto = $4,
            observaciones = $5,
            monto_total = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND cliente_id = $2
        RETURNING *
      `,
      [notaId, clienteId, fecha, concepto, observaciones, monto_total]
    )

    await client.query(
      `
        DELETE FROM notas_credito_cliente_presupuestos WHERE nota_credito_id = $1
      `,
      [notaId]
    )

    for (const a of asignaciones) {
      await client.query(
        `
          INSERT INTO notas_credito_cliente_presupuestos
          (nota_credito_id, presupuesto_id, cliente_id, monto_asignado)
          VALUES ($1, $2, $3, $4)
        `,
        [notaId, a.presupuesto_id, clienteId, a.monto_asignado]
      )
    }

    await client.query("COMMIT")

    getIo()?.emit("clientes:changed")
    getIo()?.emit("presupuestos:changed")
    getIo()?.emit("notas_credito:changed")

    return res.json({
      ...updQ.rows[0],
      presupuestos_asignaciones: await cargarAsignacionesNotaCredito(notaId),
    })
  } catch (err) {
    await client.query("ROLLBACK")
    return handleInternalError(res, err, "actualizar_nota_credito_cliente")
  } finally {
    client.release()
  }
})

router.get("/:id/notas-credito/:notaId/pdf", async (req, res) => {
  try {
    const clienteId = Number(req.params.id)
    const notaId = Number(req.params.notaId)
    if (!Number.isInteger(clienteId) || clienteId <= 0 || !Number.isInteger(notaId) || notaId <= 0) {
      return res.status(400).json({ error: "ID de cliente o nota invalido" })
    }

    const notaQ = await pool.query(
      `
        SELECT nc.*, c.razon_social, c.empresa, c.cuit, c.iva, c.direccion, c.telefono
        FROM notas_credito_cliente nc
        INNER JOIN clientes c ON c.id = nc.cliente_id
        WHERE nc.id = $1 AND nc.cliente_id = $2
        LIMIT 1
      `,
      [notaId, clienteId]
    )
    if (!notaQ.rows?.length) {
      return res.status(404).json({ error: "Nota de crédito no encontrada para el cliente" })
    }

    const nota = notaQ.rows[0]
    const asignacionesQ = await pool.query(
      `
        SELECT ncp.monto_asignado, p.numero AS presupuesto_numero, p.proyecto, o.nombre AS obra
        FROM notas_credito_cliente_presupuestos ncp
        INNER JOIN presupuestos p ON p.id = ncp.presupuesto_id
        LEFT JOIN obras o ON o.id = p.obra_id
        WHERE ncp.nota_credito_id = $1
        ORDER BY p.numero ASC
      `,
      [notaId]
    )
    const asignaciones = asignacionesQ.rows || []
    const getSafe = (value) => {
      const text = String(value ?? "").trim()
      return text || "-"
    }
    const fecha = nota.fecha ? new Date(`${String(nota.fecha).slice(0, 10)}T00:00:00`).toLocaleDateString("es-AR") : "-"
    const clienteEmpresa = getSafe(nota.empresa || nota.razon_social)
    const fileName = `Nota-de-Credito-${nota.numero || nota.id}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="${sanitizeFileText(fileName)}"`)

    const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true })
    doc.pipe(res)
    const left = 45
    const right = doc.page.width - 45
    const width = right - left
    const lineColor = "#1f1f1f"
    const muted = "#5b5b5b"
    const pageBottom = doc.page.height - 82
    let y = 22

    doc.strokeColor(lineColor).lineWidth(1).moveTo(left, y + 50).lineTo(right, y + 50).stroke()
    doc.strokeColor("#7a7a7a").lineWidth(0.6).moveTo(left, y + 54).lineTo(right, y + 54).stroke()
    doc.font("Helvetica-Bold").fontSize(28).fillColor("#111")
    doc.text("NOTA DE CRÉDITO", left, y + 14, { width, align: "center" })

    y += 64
    const blockGap = 12
    const blockW = (width - blockGap) / 2
    const blockH = 116
    const logoBandW = 82
    doc.rect(left, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
    if (existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, left + blockW - logoBandW - 4, y + 23, { fit: [78, 56], align: "center", valign: "center" })
    }
    const empresaTextW = blockW - logoBandW - 14
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("EMPRESA", left + 8, y + 6)
    doc.font("Helvetica").fontSize(8.1)
    doc.text("Tesla Montajes Electricos", left + 8, y + 21, { width: empresaTextW, lineBreak: false })
    doc.text("CUIT: 30-71712557-2", left + 8, y + 34, { width: empresaTextW, lineBreak: false })
    doc.text("IVA: Responsable Inscripto", left + 8, y + 47, { width: empresaTextW, lineBreak: false })
    doc.text("Echeverria 197 - San Francisco (Cba.)", left + 8, y + 60, { width: empresaTextW, lineBreak: false })
    doc.text("03564-15642579/15573800/15586865", left + 8, y + 73, { width: empresaTextW, lineBreak: false })
    doc.text("teslamontajeselectricos@hotmail.com", left + 8, y + 86, { width: empresaTextW, lineBreak: false })
    doc.text("www.teslamontajeselectricos.com.ar", left + 8, y + 99, { width: empresaTextW, lineBreak: false })

    const rightBoxX = left + blockW + blockGap
    doc.rect(rightBoxX, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("CLIENTE", rightBoxX + 8, y + 6)
    doc.font("Helvetica").fontSize(8.4)
    doc.text(`Empresa: ${clienteEmpresa}`, rightBoxX + 8, y + 21, { width: blockW - 16, lineBreak: false })
    doc.text(`CUIT: ${getSafe(nota.cuit)}`, rightBoxX + 8, y + 34, { width: blockW - 16, lineBreak: false })
    doc.text(`IVA: ${getSafe(nota.iva)}`, rightBoxX + 8, y + 47, { width: blockW - 16, lineBreak: false })
    doc.text(`Direccion: ${getSafe(nota.direccion)}`, rightBoxX + 8, y + 60, { width: blockW - 16, lineBreak: false })
    doc.text(`Telefono: ${getSafe(nota.telefono)}`, rightBoxX + 8, y + 73, { width: blockW - 16, lineBreak: false })

    y += blockH + 12
    doc.rect(left, y, width, 58).lineWidth(0.8).strokeColor(lineColor).stroke()
    doc.strokeColor("#d0d0d0").lineWidth(0.5).moveTo(left, y + 29).lineTo(right, y + 29).stroke()
    doc.font("Helvetica").fontSize(8.6).fillColor(muted)
    doc.text("Nota de crédito Nro.", left + 8, y + 8)
    doc.text("Fecha", right - 164, y + 8, { width: 94 })
    doc.text("Estado", left + 8, y + 37)
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111")
    doc.text(String(nota.numero || nota.id), left + 105, y + 8)
    doc.text(fecha, right - 70, y + 8, { width: 62, align: "right" })
    doc.text(String(nota.estado || "activa").toUpperCase(), left + 58, y + 37)

    y += 78
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111").text("DETALLE DE LA NOTA", left, y)
    doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y + 13).lineTo(right, y + 13).stroke()
    y += 24
    doc.font("Helvetica-Bold").fontSize(9).text("Concepto", left, y)
    doc.font("Helvetica").fontSize(9).text(getSafe(nota.concepto), left + 70, y, { width: width - 70 })
    y += 22
    if (String(nota.observaciones || "").trim()) {
      doc.font("Helvetica-Bold").text("Observaciones", left, y)
      doc.font("Helvetica").text(getSafe(nota.observaciones), left + 90, y, { width: width - 90 })
      y += 26
    }

    doc.font("Helvetica-Bold").fontSize(10).text("IMPUTACIÓN A PRESUPUESTOS", left, y)
    doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y + 13).lineTo(right, y + 13).stroke()
    y += 24
    const colWidths = [110, width - 110 - 150, 150]
    const headers = ["Presupuesto", "Obra / Proyecto", "Monto asignado"]
    doc.rect(left, y, width, 22).fillAndStroke("#f3f3f3", lineColor)
    let x = left
    headers.forEach((header, index) => {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111").text(header, x + 6, y + 7, { width: colWidths[index] - 12, align: index === 2 ? "right" : "left" })
      x += colWidths[index]
    })
    y += 22
    asignaciones.forEach((asignacion, index) => {
      if (y + 24 > pageBottom) { doc.addPage(); y = 40 }
      if (index % 2 === 0) doc.rect(left, y, width, 24).fill("#fbfbfb")
      doc.rect(left, y, width, 24).lineWidth(0.5).strokeColor("#6b6b6b").stroke()
      const obra = getSafe(asignacion.proyecto || asignacion.obra)
      doc.font("Helvetica").fontSize(8.6).fillColor("#111")
      doc.text(`#${getSafe(asignacion.presupuesto_numero)}`, left + 6, y + 7, { width: colWidths[0] - 12 })
      doc.text(obra, left + colWidths[0] + 6, y + 7, { width: colWidths[1] - 12, ellipsis: true })
      doc.text(`$ ${formatMoneyAr(asignacion.monto_asignado)}`, left + colWidths[0] + colWidths[1] + 6, y + 7, { width: colWidths[2] - 12, align: "right" })
      y += 24
    })

    y += 14
    doc.rect(right - 210, y, 210, 34).fillAndStroke("#efede8", lineColor)
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111")
    doc.text("TOTAL NOTA DE CRÉDITO", right - 202, y + 11, { width: 115 })
    doc.text(`$ ${formatMoneyAr(nota.monto_total)}`, right - 80, y + 11, { width: 72, align: "right" })

    const range = doc.bufferedPageRange()
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(index)
      doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, doc.page.height - 62).lineTo(right, doc.page.height - 62).stroke()
      doc.font("Helvetica").fontSize(7.8).fillColor(muted)
      doc.text("Tesla Montajes Electricos - Nota de crédito", left, doc.page.height - 60)
      doc.text(`Pagina ${index + 1}`, left, doc.page.height - 60, { width, align: "right" })
    }
    doc.end()
  } catch (err) {
    return handleInternalError(res, err, "pdf_nota_credito_cliente")
  }
})

router.delete("/:id/notas-credito/:notaId", async (req, res) => {
  try{
    const clienteId = Number(req.params.id)
    const notaId = Number(req.params.notaId)

    if(!Number.isInteger(clienteId) || clienteId <= 0 || !Number.isInteger(notaId) || notaId <= 0){
      return res.status(400).json({ error: "ID de cliente o nota invalido" })
    }

    const updQ = await pool.query(
      `
        UPDATE notas_credito_cliente
        SET estado = 'anulada', 
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 
          AND cliente_id = $2 
        RETURNING *
      `,
      [notaId, clienteId]
    )

    if (!updQ.rows?.length) {
      return res.status(404).json({ error: "Nota de crédito no encontrada para el cliente" })
    }

    getIo()?.emit("clientes:changed")
    getIo()?.emit("presupuestos:changed")
    getIo()?.emit("notas_credito:changed")

    return res.json({ ok:true, data: updQ.rows[0] })
  } catch(err){
    return handleInternalError(res, err, "anular_nota_credito_cliente")
  }
})

export default router