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
    const movimientosTienePresupuestoId = await hasTableColumn("movimientos_caja", "presupuesto_id")

    const selectPresupuestos = ["id", "numero", "fecha", "estado", "total", "obra_id"]
    if (presupuestosTieneIvaMonto) {
      selectPresupuestos.push("iva_monto")
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
      const pagado = roundMoney(pagosImputadosPorPresupuesto.get(Number(p.id)) || 0)
      const saldoPendiente = roundMoney(Math.max(0, total - pagado))
      const saldoAFavor = roundMoney(Math.max(0, pagado - total))
      const estadoCobro = pagado <= 0 ? "Pendiente" : (pagado < total ? "Parcial" : (pagado === total ? "Pagado" : "A favor"))
      return {
        presupuesto_id: Number(p.id),
        numero: p.numero,
        fecha: p.fecha,
        obra: obraNombrePorId.get(Number(p.obra_id)) || "Sin obra",
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
        { key: "obra", label: "OBRA", x: 141, width: 88 },
        { key: "sin_iva", label: "S/IVA", x: 233, width: 54, align: "right" },
        { key: "iva", label: "IVA", x: 289, width: 42, align: "right" },
        { key: "total", label: "TOTAL", x: 335, width: 54, align: "right" },
        { key: "pagado", label: "PAGADO", x: 391, width: 54, align: "right" },
        { key: "saldo", label: "SALDO", x: 447, width: 54, align: "right" },
        { key: "estado", label: "ESTADO", x: 503, width: 43 },
      ],
      rows: estadoCuenta.map((p) => ({
        numero: `#${p.numero || "-"}`,
        fecha: p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-",
        obra: p.obra,
        sin_iva: formatMoneyAr(p.sin_iva),
        iva: formatMoneyAr(p.iva),
        total: formatMoneyAr(p.total),
        pagado: formatMoneyAr(p.pagado),
        saldo: formatMoneyAr(p.saldo_pendiente),
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
    const selectPresupuestos = ["id", "numero", "fecha", "estado", "total", "obra_id"]
    if (presupuestosTieneIvaMonto) {
      selectPresupuestos.push("iva_monto")
    }

    const { data: presupuestos, error: presupuestosError } = await db
      .from("presupuestos")
      .select(selectPresupuestos.join(", "))
      .eq("cliente_id", id)

    if (presupuestosError) throw presupuestosError

    const selectMovimientos = ["id", "fecha", columnaDetalleMovimiento, "monto_total", "observaciones", "tipo"]
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
        `
          SELECT movimiento_id, medio_pago
          FROM detalles_medio_pago
          WHERE movimiento_id = ANY($1::int[])
        `,
        [movimientoIds]
      )

      for (const row of detallesPagosRes.rows || []) {
        const movId = Number(row.movimiento_id)
        const actual = mediosPorMovimiento.get(movId) || new Set()
        actual.add(labelMedioPago(row.medio_pago))
        mediosPorMovimiento.set(movId, actual)
      }
    }

    const saldoInicialArrastre = roundMoney(cliente?.saldo_inicial_arrastre)
    const fechaSaldoInicial = normalizeDateOnly(cliente?.fecha_saldo_inicial_arrastre) || "0000-00-00"
    const notaSaldoInicial = String(cliente?.nota_saldo_inicial_arrastre || "").trim()

    const ledgerRows = []
    ledgerRows.push({
      kind: "saldo_inicial",
      sortDate: fechaSaldoInicial,
      nro: "SI",
      fecha: fechaSaldoInicial !== "0000-00-00" ? new Date(fechaSaldoInicial).toLocaleDateString("es-AR") : "-",
      obra: notaSaldoInicial || "Arrastre sistema anterior",
      importe_sin_iva: "",
      iva: "",
      total: formatSignedMoneyAr(saldoInicialArrastre),
      medio: "ARRASTRE",
      signedAmount: saldoInicialArrastre,
    })

    for (const p of presupuestosAceptadosList) {
      const total = roundMoney(p.total)
      const iva = roundMoney(p.iva_monto)
      const sinIva = roundMoney(total - iva)
      const obra = obraNombrePorId.get(Number(p.obra_id)) || "Sin obra"
      ledgerRows.push({
        kind: "cargo",
        sortDate: p.fecha || "0000-00-00",
        nro: String(p.numero || "-"),
        fecha: p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-",
        obra,
        importe_sin_iva: formatMoneyAr(sinIva),
        iva: formatMoneyAr(iva),
        total: formatMoneyAr(total),
        medio: "",
        signedAmount: total,
      })
    }

    for (const mov of movimientosList) {
      const monto = roundMoney(mov.monto_total)
      
      if (String(mov.tipo || "").toLowerCase() === "egreso") {
        // Egresos (efectivo que nosotros damos al cliente, reduce su saldo a favor)
        const detalleEgreso = mov[columnaDetalleMovimiento] || mov.detalle || "EGRESO"
        ledgerRows.push({
          kind: "egreso",
          sortDate: mov.fecha || "0000-00-00",
          nro: "-",
          fecha: mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-AR") : "-",
          obra: detalleEgreso,
          importe_sin_iva: "",
          iva: "",
          total: `- ${formatMoneyAr(monto)}`,
          medio: "-",
          signedAmount: monto,
        })
      } else {
        // Ingresos (pagos)
        const presupuestoRef = Number(mov.presupuesto_id || 0) > 0 ? presupuestoById.get(Number(mov.presupuesto_id)) : null
        const obra = presupuestoRef ? (obraNombrePorId.get(Number(presupuestoRef.obra_id)) || "Sin obra") : "PAGO C/CHEQS"
        const nroFc = presupuestoRef ? String(presupuestoRef.numero || "-") : "-"
        const medios = [...(mediosPorMovimiento.get(Number(mov.id || 0)) || new Set())]
        ledgerRows.push({
          kind: "pago",
          sortDate: mov.fecha || "0000-00-00",
          nro: nroFc,
          fecha: mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-AR") : "-",
          obra,
          importe_sin_iva: "",
          iva: "",
          total: `- ${formatMoneyAr(monto)}`,
          medio: medios.join("/") || "-",
          signedAmount: -monto,
        })
      }
    }

    ledgerRows.sort((a, b) => {
      const aDateKey = toSortableDateKey(a.sortDate)
      const bDateKey = toSortableDateKey(b.sortDate)
      if (aDateKey !== bDateKey) return aDateKey.localeCompare(bDateKey)
      const order = { saldo_inicial: 0, cargo: 1, pago: 2, egreso: 3 }
      return (order[a.kind] ?? 99) - (order[b.kind] ?? 99)
    })

    let pendienteAcumulado = 0
    ledgerRows.forEach((row) => {
      pendienteAcumulado = roundMoney(pendienteAcumulado + row.signedAmount)
      row.pendiente = formatMoneyAr(pendienteAcumulado)
      row.pendienteColor = pendienteAcumulado > 0 ? "#b91c1c" : "#065f46"
    })

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
        { key: "nro", label: "NRO", x: 45, width: 40 },
        { key: "fecha", label: "FECHA", x: 85, width: 56 },
        { key: "obra", label: "OBRA", x: 141, width: 102 },
        { key: "importe_sin_iva", label: "IMPORTE S/IVA", x: 243, width: 74 },
        { key: "iva", label: "IVA", x: 317, width: 50 },
        { key: "total", label: "TOTAL", x: 367, width: 74 },
        { key: "medio", label: "MEDIO", x: 441, width: 54 },
        { key: "pendiente", label: "PENDIENTE", x: 495, width: 55 },
      ]

      cols.forEach((col) => {
        doc.text(col.label, col.x + 1, cursorY + 7, { width: col.width - 2, align: "left" })
      })

      cursorY += 22
      return cols
    }

    const ledgerCols = drawLedgerHeader()

    if (!ledgerRows.length) {
      ensureSpace(24)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9)
      doc.text("No hay movimientos para la cuenta corriente del cliente.", 45, cursorY + 4)
      cursorY += 26
    } else {
      ledgerRows.forEach((row, idx) => {
        if (cursorY + 18 > doc.page.height - footerSafe) {
          doc.addPage()
          cursorY = 60
          drawLedgerHeader()
        }

        const fill = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, cursorY, pageWidth - 90, 18).fill(fill)
        doc.rect(45, cursorY, pageWidth - 90, 18).lineWidth(0.35).strokeColor(PDF_COLORS.line).stroke()
        ledgerCols.forEach((col, colIdx) => {
          if (colIdx === 0) return
          doc.moveTo(col.x, cursorY).lineTo(col.x, cursorY + 18).lineWidth(0.25).strokeColor(PDF_COLORS.line).stroke()
        })
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(7.4)

        ledgerCols.forEach((col) => {
          const text = String(row[col.key] ?? "")
          if (col.key === "pendiente") {
            doc.fillColor(row.pendienteColor || PDF_COLORS.ink).font("Helvetica-Bold")
            doc.text(text, col.x + 1, cursorY + 6, { width: col.width - 2, align: "right", ellipsis: true })
            doc.fillColor(PDF_COLORS.ink).font("Helvetica")
            return
          }
          const align = ["importe_sin_iva", "iva", "total", "pendiente"].includes(col.key) ? "right" : "left"
          doc.text(text, col.x + 1, cursorY + 6, { width: col.width - 2, align, ellipsis: true })
        })

        cursorY += 18
      })
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

export default router