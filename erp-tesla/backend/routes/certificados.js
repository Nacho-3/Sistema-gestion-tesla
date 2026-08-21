                        
import express from "express"
import { existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { pool } from "../db.js"
import { getIo } from "../socket.js"
import PDFDocument from "pdfkit"
import fs from "fs/promises"
import { sanitizeFileText } from "../pdf/premiumTheme.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")
const LOGO_PRESUPUESTO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

const CERTIFICADOS_BASE_FOLDER=
	process.env.CERTIFICADOS_BASE_FOLDER || path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA\\certificados")

const router = express.Router()

const toNumber = (value, fallback = 0) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

const toBoolean = (value, fallback = false) => {
	if (typeof value === "boolean") return value
	if (typeof value === "number") return value === 1
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase()
		if (normalized === "true" || normalized === "1" || normalized === "si") return true
		if (normalized === "false" || normalized === "0" || normalized === "no") return false
	}
	return fallback
}

const roundMoney = (value) => Math.round((toNumber(value) + Number.EPSILON) * 100) / 100

const normalizeEstado = (value) => {
	const estado = String(value || "pendiente").toLowerCase()
	return estado === "pagado" ? "pagado" : "pendiente"
}

const normalizeTipoRegistro = (value) => {
	const tipo = String(value || "porcentaje").toLowerCase()
	return tipo === "monto" ? "monto" : "porcentaje"
}

const resolveIndiceCacData = (input = {}) => {
	const indiceBase = toNumber(input.indice_base_cac, 0)
	const indiceActual = toNumber(input.indice_actual_cac, 0)

	if (indiceBase > 0 && indiceActual > 0) {
		return {
			indiceCac: indiceActual / indiceBase,
			indiceBase,
			indiceActual,
			origen: "indices",
		}
	}

	return {
		indiceCac: toNumber(input.indice_cac, 1),
		indiceBase: 0,
		indiceActual: 0,
		origen: "factor",
	}
}

const formatMoney = (value) => {
	return new Intl.NumberFormat("es-AR", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(toNumber(value, 0))
}

const formatDate = (value) => {
	if (!value) return "-"
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return String(value)
	return date.toLocaleDateString("es-AR")
}

const formatPercentLabel = (value) => {
	const num = toNumber(value, 0)
	const formatted = new Intl.NumberFormat("es-AR", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	}).format(num)
	return `${formatted} %`
}

const validarInputCertificado = (input = {}) => {
	const presupuestoId = Number(input.presupuesto_id)
	if (!Number.isInteger(presupuestoId) || presupuestoId <= 0) {
		return { ok: false, status: 400, error: "presupuesto_id invalido" }
	}

	const tipoRegistroRaw = normalizeTipoRegistro(input.tipo_registro)
	const porcentajeAvance = Math.max(0, toNumber(input.porcentaje_avance, 0))
	const montoBase = Math.max(0, toNumber(input.monto_base, 0))
	const montoLegacy = Math.max(0, toNumber(input.certificado, 0))
	// Compatibilidad: si llega sin tipo_registro pero con monto base/certificado, tratar como registro por monto.
	const tipoRegistro = (tipoRegistroRaw === "porcentaje" && porcentajeAvance <= 0 && (montoBase > 0 || montoLegacy > 0))
		? "monto"
		: tipoRegistroRaw
	const indiceData = resolveIndiceCacData(input)
	const indiceCac = indiceData.indiceCac
	const ingresoIndiceBase = toNumber(input.indice_base_cac, 0)
	const ingresoIndiceActual = toNumber(input.indice_actual_cac, 0)
	const aplicaIva = toBoolean(input.aplica_iva, true)
	const ivaPorcentaje = Math.max(0, toNumber(input.iva_porcentaje, 21))
	const pagos = Math.max(0, toNumber(input.pagos, 0))
	const estado = normalizeEstado(input.estado)

	if ((ingresoIndiceBase > 0 || ingresoIndiceActual > 0) && !(ingresoIndiceBase > 0 && ingresoIndiceActual > 0)) {
		return { ok: false, status: 400, error: "Si se informa CAC por indices, deben completarse indice base y actual" }
	}

	if (tipoRegistro === "porcentaje" && porcentajeAvance <= 0) {
		return { ok: false, status: 400, error: "El porcentaje de avance debe ser mayor a 0" }
	}

	if (tipoRegistro === "porcentaje" && porcentajeAvance > 100) {
		return { ok: false, status: 400, error: "El porcentaje de avance no puede superar 100" }
	}

	if (tipoRegistro === "monto" && montoBase <= 0) {
		return { ok: false, status: 400, error: "El monto base debe ser mayor a 0" }
	}

	if (!Number.isFinite(indiceCac) || indiceCac <= 0) {
		return { ok: false, status: 400, error: "El indice CAC debe ser mayor a 0" }
	}

	if (estado === "pagado" && pagos <= 0) {
		return { ok: false, status: 400, error: "Un certificado pagado debe registrar pagos mayores a 0" }
	}

	return {
		ok: true,
		presupuestoId,
		tipoRegistro,
		porcentajeAvance,
		montoBase,
		indiceCac,
		indiceBaseCac: indiceData.indiceBase,
		indiceActualCac: indiceData.indiceActual,
		indiceOrigen: indiceData.origen,
		aplicaIva,
		ivaPorcentaje,
		pagos,
		estado,
	}
}

const calcularCertificado = ({ presupuesto, input, acumuladoPrevio = 0 }) => {
	const importeOriginal = roundMoney(presupuesto.total)
	const aplicaIva = toBoolean(input.aplica_iva, true)
	const ivaPorcentaje = Math.max(0, toNumber(input.iva_porcentaje, toNumber(presupuesto.iva_porcentaje, 21)))
	const tipoRegistro = normalizeTipoRegistro(input.tipo_registro)
	const indiceData = resolveIndiceCacData(input)
	const montoLegacy = Math.max(0, toNumber(input.certificado, 0))
	const tipoEfectivo = tipoRegistro === "porcentaje" && toNumber(input.porcentaje_avance, 0) <= 0 && toNumber(input.monto_base, 0) <= 0 && montoLegacy > 0
		? "monto"
		: tipoRegistro
	const porcentajeAvance = tipoEfectivo === "porcentaje"
		? Math.max(0, toNumber(input.porcentaje_avance, 0))
		: 0
	const montoBase = tipoEfectivo === "monto"
		? Math.max(0, toNumber(input.monto_base ?? input.certificado, 0))
		: roundMoney(importeOriginal * (porcentajeAvance / 100))
	const indiceCac = Math.max(0, toNumber(indiceData.indiceCac, 1)) || 1
	const ajustePorcentaje = roundMoney((indiceCac - 1) * 100)
	const actualizacion = roundMoney(montoBase * (indiceCac - 1))
	const certificado = roundMoney(montoBase + actualizacion)
	const iva = aplicaIva ? roundMoney(certificado * (ivaPorcentaje / 100)) : 0
	const totalCertSinIva = certificado
	const totalCertConIva = roundMoney(totalCertSinIva + iva)
	const pagos = roundMoney(Math.max(0, toNumber(input.pagos, 0)))
	const acumuladoCertificado = roundMoney(acumuladoPrevio + certificado)
	const saldoPreOriginal = roundMoney(Math.max(0, importeOriginal - acumuladoCertificado))
	const saldoPendiente = roundMoney(Math.max(0, totalCertConIva - pagos))

	return {
		importe_original: importeOriginal,
		tipo_registro: tipoEfectivo,
		porcentaje_avance: porcentajeAvance,
		monto_base: montoBase,
		indice_cac: indiceCac,
		indice_base_cac: indiceData.indiceBase,
		indice_actual_cac: indiceData.indiceActual,
		indice_origen: indiceData.origen,
		aplica_iva: aplicaIva,
		iva_porcentaje: ivaPorcentaje,
		ajuste_porcentaje: ajustePorcentaje,
		actualizacion: actualizacion,
		certificado: certificado,
		iva: iva,
		total_cert_sin_iva: totalCertSinIva,
		total_cert_con_iva: totalCertConIva,
		pagos: pagos,
		acumulado_certificado: acumuladoCertificado,
		saldo_pre_original: saldoPreOriginal,
		saldo_pendiente: saldoPendiente,
	}
}

const mapCertificado = (row) => ({
	...row,
	secuencia: Number(row.secuencia) || Number(row.numero) || 1,
	porcentaje_avance: toNumber(row.porcentaje_avance),
	importe_original: toNumber(row.importe_original),
	monto_base: toNumber(row.monto_base),
	indice_cac: toNumber(row.indice_cac, 1),
	indice_base_cac: toNumber(row.indice_base_cac, 0),
	indice_actual_cac: toNumber(row.indice_actual_cac, 0),
	indice_origen: String(row.indice_origen || "factor"),
	aplica_iva: toBoolean(row.aplica_iva, true),
	iva_porcentaje: toNumber(row.iva_porcentaje, 21),
	certificado: toNumber(row.certificado),
	ajuste_porcentaje: toNumber(row.ajuste_porcentaje),
	actualizacion: toNumber(row.actualizacion),
	iva: toNumber(row.iva),
	total_cert_sin_iva: toNumber(row.total_cert_sin_iva),
	total_cert_con_iva: toNumber(row.total_cert_con_iva),
	acumulado_certificado: toNumber(row.acumulado_certificado),
	saldo_pre_original: toNumber(row.saldo_pre_original),
	pagos: toNumber(row.pagos),
	saldo_pendiente: toNumber(row.saldo_pendiente),
})

const recalcularCertificadosPresupuesto = async (client, presupuestoId) => {
	const presupuestoResult = await client.query(
		`SELECT id, total, iva_porcentaje FROM presupuestos WHERE id = $1 LIMIT 1`,
		[Number(presupuestoId)]
	)

	if (presupuestoResult.rowCount === 0) return

	const presupuesto = presupuestoResult.rows[0]
	const certificadosResult = await client.query(
		`
			SELECT id, secuencia, tipo_registro, porcentaje_avance, monto_base, indice_cac, indice_base_cac, indice_actual_cac, aplica_iva, iva_porcentaje, pagos
			FROM certificados
			WHERE presupuesto_id = $1
			ORDER BY secuencia ASC, id ASC
		`,
		[Number(presupuestoId)]
	)

	let acumuladoPrevio = 0
	for (const row of certificadosResult.rows) {
		const calculado = calcularCertificado({ presupuesto, input: row, acumuladoPrevio })
		await client.query(
			`
				UPDATE certificados
				SET importe_original = $2,
					monto_base = $3,
					indice_cac = $4,
					indice_base_cac = $5,
					indice_actual_cac = $6,
					indice_origen = $7,
					aplica_iva = $8,
					iva_porcentaje = $9,
					ajuste_porcentaje = $10,
					actualizacion = $11,
					certificado = $12,
					iva = $13,
					total_cert_sin_iva = $14,
					total_cert_con_iva = $15,
					acumulado_certificado = $16,
					saldo_pre_original = $17,
					pagos = $18,
					saldo_pendiente = $19,
					porcentaje_avance = $20
				WHERE id = $1
			`,
			[
				row.id,
				calculado.importe_original,
				calculado.monto_base,
				calculado.indice_cac,
				calculado.indice_base_cac,
				calculado.indice_actual_cac,
				calculado.indice_origen,
				calculado.aplica_iva,
				calculado.iva_porcentaje,
				calculado.ajuste_porcentaje,
				calculado.actualizacion,
				calculado.certificado,
				calculado.iva,
				calculado.total_cert_sin_iva,
				calculado.total_cert_con_iva,
				calculado.acumulado_certificado,
				calculado.saldo_pre_original,
				calculado.pagos,
				calculado.saldo_pendiente,
				calculado.porcentaje_avance,
			]
		)
		acumuladoPrevio = calculado.acumulado_certificado
	}
}

router.get("/", async (req, res) => {
	try {
		res.setHeader("Cache-Control", "no-store")
		const result = await pool.query(`
			SELECT
				c.*,
				p.numero AS presupuesto_numero,
				p.estado AS presupuesto_estado,
				cl.razon_social AS cliente,
				o.nombre AS obra
			FROM certificados c
			INNER JOIN presupuestos p ON p.id = c.presupuesto_id
			INNER JOIN clientes cl ON cl.id = p.cliente_id
			INNER JOIN obras o ON o.id = p.obra_id
			ORDER BY p.numero DESC, c.secuencia DESC
		`)

		res.json(result.rows.map(mapCertificado))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/resumen-por-presupuesto", async (req, res) => {
	try {
		const result = await pool.query(
			`
				SELECT
					p.id AS presupuesto_id,
					COUNT(c.id) AS cantidad_certificados,
					COALESCE(MAX(c.secuencia), 0) AS ultimo_certificado,
					COALESCE(SUM(c.certificado), 0) AS total_certificado,
					COALESCE(SUM(c.total_cert_con_iva), 0) AS total_certificado_con_iva,
					COALESCE(SUM(c.pagos), 0) AS total_pagado_certificados,
					BOOL_OR(c.estado = 'pendiente') AS tiene_pendientes
				FROM presupuestos p
				LEFT JOIN certificados c ON c.presupuesto_id = p.id
				GROUP BY p.id
			`
		)

		res.json(result.rows.map((row) => ({
			presupuesto_id: Number(row.presupuesto_id),
			cantidad_certificados: Number(row.cantidad_certificados) || 0,
			ultimo_certificado: Number(row.ultimo_certificado) || 0,
			total_certificado: toNumber(row.total_certificado),
			total_certificado_con_iva: toNumber(row.total_certificado_con_iva),
			total_pagado_certificados: toNumber(row.total_pagado_certificados),
			tiene_pendientes: Boolean(row.tiene_pendientes),
		})))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/presupuesto/:presupuestoId/pdf", async (req, res) => {
	try {
		const presupuestoId = Number(req.params.presupuestoId)
		if (!Number.isInteger(presupuestoId) || presupuestoId <= 0) {
			return res.status(400).json({ error: "ID de presupuesto invalido" })
		}

		const result = await pool.query(
			`
				SELECT
					c.*,
					p.numero AS presupuesto_numero,
					p.fecha AS presupuesto_fecha,
					p.total AS presupuesto_total,
					p.proyecto AS presupuesto_proyecto,
					COALESCE(NULLIF(TRIM(cl.empresa), ''), cl.razon_social) AS cliente_nombre,
					o.nombre AS obra_nombre
				FROM certificados c
				INNER JOIN presupuestos p ON p.id = c.presupuesto_id
				INNER JOIN clientes cl ON cl.id = p.cliente_id
				INNER JOIN obras o ON o.id = p.obra_id
				WHERE c.presupuesto_id = $1
				ORDER BY c.secuencia ASC, c.id ASC
			`,
			[presupuestoId]
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: "No hay certificados para ese presupuesto" })
		}

		const certificadosGrupo = result.rows.map(mapCertificado)
		const base = certificadosGrupo[0]
		const title = `Certificados-Presupuesto-${base.presupuesto_numero || presupuestoId}.pdf`

		res.setHeader("Content-Type", "application/pdf")
		res.setHeader("Content-Disposition", `inline; filename="${title}"`)

		const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true })
		doc.pipe(res)

		const left = 42
		const right = doc.page.width - 42
		const width = right - left
		const pageBottom = doc.page.height - 74
		const lineColor = "#1f1f1f"
		const muted = "#5b5b5b"
		const getSafe = (v) => {
			const t = String(v ?? "").trim()
			return t || "-"
		}

		let y = 36
		doc.font("Helvetica-Bold").fontSize(21).fillColor("#111")
		doc.text("LISTADO DE CERTIFICADOS", left, y, { width, align: "center" })
		y += 26
		doc.font("Helvetica").fontSize(10).fillColor("#111")
		doc.text(`Presupuesto Nro: ${getSafe(base.presupuesto_numero)}`, left, y)
		doc.text(`Fecha: ${formatDate(base.presupuesto_fecha)}`, right - 176, y, { width: 176, align: "right" })
		y += 14
		doc.text(`Cliente: ${getSafe(base.cliente_nombre)}`, left, y, { width: width * 0.56 })
		doc.text(`Obra: ${getSafe(base.obra_nombre)}`, left + width * 0.56, y, { width: width * 0.44, align: "right" })
		y += 16
		doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y).lineTo(right, y).stroke()
		y += 8

		const colDesc = width - 252
		const colRef = 112
		const colSub = 140
		const rowH = 16

		const drawTableHeader = () => {
			if (y + rowH > pageBottom) {
				doc.addPage()
				y = 40
			}
			doc.rect(left, y, width, rowH).fillAndStroke("#f3f3f3", lineColor)
			doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111")
			doc.text("Item", left + 6, y + 4, { width: colDesc - 12 })
			doc.moveTo(left + colDesc, y).lineTo(left + colDesc, y + rowH).strokeColor(lineColor).lineWidth(0.6).stroke()
			doc.text("Referencia", left + colDesc + 6, y + 4, { width: colRef - 12, align: "right" })
			doc.moveTo(left + colDesc + colRef, y).lineTo(left + colDesc + colRef, y + rowH).stroke()
			doc.text("Subtotal", left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right" })
			y += rowH
		}

		const drawItemRow = (desc, ref, subtotal, idx) => {
			if (y + rowH > pageBottom) {
				doc.addPage()
				y = 40
				drawTableHeader()
			}
			if (idx % 2 === 0) doc.rect(left, y, width, rowH).fill("#fbfbfb")
			doc.rect(left, y, width, rowH).lineWidth(0.5).strokeColor("#6b6b6b").stroke()
			doc.font("Helvetica").fontSize(8.6).fillColor("#111")
			doc.text(desc, left + 6, y + 4, { width: colDesc - 12, lineBreak: false })
			doc.moveTo(left + colDesc, y).lineTo(left + colDesc, y + rowH).strokeColor("#808080").lineWidth(0.35).stroke()
			doc.text(ref, left + colDesc + 6, y + 4, { width: colRef - 12, align: "right", lineBreak: false })
			doc.moveTo(left + colDesc + colRef, y).lineTo(left + colDesc + colRef, y + rowH).stroke()
			const sub = toNumber(subtotal, 0)
			doc.text(sub !== 0 ? `$ ${formatMoney(sub)}` : "-", left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right", lineBreak: false })
			y += rowH
		}

		drawTableHeader()

		let totalNeto = 0
		let totalIva = 0
		let totalConIva = 0
		let rowIndex = 0

		certificadosGrupo.forEach((c) => {
			totalNeto += toNumber(c.total_cert_sin_iva)
			totalIva += toNumber(c.iva)
			totalConIva += toNumber(c.total_cert_con_iva)

			const avanceRef = c.tipo_registro === "monto"
				? `$ ${formatMoney(c.monto_base)}`
				: `${toNumber(c.porcentaje_avance, 0).toFixed(2)}%`
			const ajustePct = roundMoney((toNumber(c.indice_cac, 1) - 1) * 100)

			drawItemRow(`   CERTIFICADO NRO.${c.secuencia} (${formatDate(c.fecha)})`, "", 0, rowIndex++)
			drawItemRow(`   AVANCE DE OBRAS (${avanceRef})`, avanceRef, c.monto_base, rowIndex++)
			drawItemRow("   ACTUALIZACION S/INDICE CAC", `${ajustePct.toFixed(2)}%`, c.actualizacion, rowIndex++)
			drawItemRow("   IVA", formatPercentLabel(toNumber(c.iva_porcentaje, 21)), c.iva, rowIndex++)

			if (y + rowH > pageBottom) {
				doc.addPage()
				y = 40
				drawTableHeader()
			}
			doc.rect(left, y, width, rowH).fillAndStroke("#efede8", lineColor)
			doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#111")
			doc.text(`TOTAL CERTIFICADO NRO.${c.secuencia}`, left + 6, y + 4, { width: colDesc - 12, lineBreak: false })
			doc.text(`$ ${formatMoney(c.total_cert_con_iva)}`, left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right", lineBreak: false })
			y += rowH

			drawItemRow("", "", 0, rowIndex++)
		})

		y += 8
		if (y + 58 > pageBottom) {
			doc.addPage()
			y = 40
		}
		const totalsW = 258
		const totalsX = right - totalsW
		doc.rect(totalsX, y, totalsW, 58).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica").fontSize(8.6).fillColor("#111")
		doc.text("TOTAL NETO CERTIFICADO", totalsX + 8, y + 8)
		doc.text(`$ ${formatMoney(totalNeto)}`, totalsX + totalsW - 88, y + 8, { width: 80, align: "right" })
		doc.text("TOTAL IVA", totalsX + 8, y + 24)
		doc.text(`$ ${formatMoney(totalIva)}`, totalsX + totalsW - 88, y + 24, { width: 80, align: "right" })
		doc.rect(totalsX + 6, y + 38, totalsW - 12, 16).fillAndStroke("#1f1f1f", lineColor)
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#fff")
		doc.text("TOTAL C/IVA", totalsX + 12, y + 42)
		doc.text(`$ ${formatMoney(totalConIva)}`, totalsX + totalsW - 88, y + 42, { width: 80, align: "right" })

		const range = doc.bufferedPageRange()
		for (let i = 0; i < range.count; i++) {
			doc.switchToPage(i)
			doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, doc.page.height - 56).lineTo(right, doc.page.height - 56).stroke()
			doc.font("Helvetica").fontSize(7.6).fillColor(muted)
			doc.text("Tesla Montajes Electricos - Resumen de certificados", left, doc.page.height - 54)
			doc.text(`Pagina ${i + 1}`, left, doc.page.height - 54, { width, align: "right" })
		}

		doc.end()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/:id/pdf", async (req, res) => {
	try {
		const certificadoId = Number(req.params.id)
		if (!Number.isInteger(certificadoId) || certificadoId <= 0) {
			return res.status(400).json({ error: "ID de certificado invalido" })
		}

		const result = await pool.query(
			`
				SELECT
					c.*,
					p.numero AS presupuesto_numero,
					p.fecha AS presupuesto_fecha,
					p.total AS presupuesto_total,
					p.iva_porcentaje AS presupuesto_iva_porcentaje,
					p.forma_pago,
					p.proyecto AS presupuesto_proyecto,
					p.indice_cac_base_id,
					ic.periodo AS indice_base_periodo,
					ic.valor AS indice_base_valor,
					ia.periodo AS indice_actual_periodo,
					ia.valor AS indice_actual_valor,
					COALESCE(NULLIF(TRIM(cl.empresa), ''), cl.razon_social) AS cliente_nombre,
					cl.cuit AS cliente_cuit,
					cl.iva AS cliente_iva,
					cl.direccion AS cliente_direccion,
					cl.telefono AS cliente_telefono,
					o.nombre AS obra_nombre
				FROM certificados c
				INNER JOIN presupuestos p ON p.id = c.presupuesto_id
				LEFT JOIN indices_cac ic ON ic.id = p.indice_cac_base_id
				LEFT JOIN LATERAL (
					SELECT i.periodo, i.valor
					FROM indices_cac i
					WHERE ABS(COALESCE(i.valor, 0) - COALESCE(c.indice_actual_cac, 0)) < 0.0001
					ORDER BY i.id DESC
					LIMIT 1
				) ia ON true
				INNER JOIN clientes cl ON cl.id = p.cliente_id
				INNER JOIN obras o ON o.id = p.obra_id
				WHERE c.id = $1
				LIMIT 1
			`,
			[certificadoId]
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Certificado no encontrado" })
		}

		const cert = mapCertificado(result.rows[0])
		const title = `Certificado-${cert.presupuesto_numero || cert.presupuesto_id}-${cert.secuencia}.pdf`

		res.setHeader("Content-Type", "application/pdf")
		res.setHeader("Content-Disposition", `inline; filename="${title}"`)

		const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true })
		doc.pipe(res)

		const left = 45
		const pageWidth = doc.page.width
		const right = pageWidth - 45
		const width = right - left
		const top = 34
		const lineColor = "#1f1f1f"
		const muted = "#5b5b5b"
		const pageBottomLimit = doc.page.height - 98

		const getSafe = (v) => { const t = String(v ?? "").trim(); return t || "-" }

		// ── TÍTULO ──────────────────────────────────────────────
		let y = top
		doc.strokeColor(lineColor).lineWidth(1).moveTo(left, y + 58).lineTo(right, y + 58).stroke()
		doc.strokeColor("#7a7a7a").lineWidth(0.6).moveTo(left, y + 62).lineTo(right, y + 62).stroke()
		doc.font("Helvetica-Bold").fontSize(30).fillColor("#111")
		doc.text("CERTIFICADO DE AVANCE", left, y + 19, { width, align: "center" })

		// ── BLOQUES EMPRESA / CLIENTE ─────────────────────────
		y += 74
		const blockGap = 12
		const blockW = (width - blockGap) / 2
		const blockH = 108
		const logoBandW = 82
		const logoToUse = existsSync(LOGO_PRESUPUESTO_PATH) ? LOGO_PRESUPUESTO_PATH : (existsSync(LOGO_PATH) ? LOGO_PATH : null)

		doc.rect(left, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
		if (logoToUse) {
			doc.image(logoToUse, left + blockW - logoBandW - 4, y + 20, { fit: [78, 56], align: "center", valign: "center" })
		}
		const empresaTextW = blockW - logoBandW - 14
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("TESLA MONTAJES ELECTRICOS", left + 8, y + 6)
		doc.font("Helvetica").fontSize(8.1).fillColor("#111")
		doc.text("T.M.E. S.A.S.", left + 8, y + 21, { width: empresaTextW, lineBreak: false })
		doc.text("CUIT: 30-71712557-2", left + 8, y + 34, { width: empresaTextW, lineBreak: false })
		doc.text("IVA: Responsable Inscripto", left + 8, y + 47, { width: empresaTextW, lineBreak: false })
		doc.text("Echeverria 197 - San Francisco (Cba.)", left + 8, y + 60, { width: empresaTextW, lineBreak: false })
		doc.text("03564-15642579 / 15573800 / 15586865", left + 8, y + 73, { width: empresaTextW, lineBreak: false })
		doc.text("teslamontajeselectricos@hotmail.com", left + 8, y + 86, { width: empresaTextW, lineBreak: false })

		const rightBoxX = left + blockW + blockGap
		doc.rect(rightBoxX, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("DATOS DEL CLIENTE", rightBoxX + 8, y + 6)
		doc.font("Helvetica").fontSize(8.4)
		doc.text(`Nombre: ${getSafe(cert.cliente_nombre)}`, rightBoxX + 8, y + 21, { width: blockW - 16, lineBreak: false })
		doc.text(`CUIT: ${getSafe(cert.cliente_cuit)}`, rightBoxX + 8, y + 34, { width: blockW - 16, lineBreak: false })
		doc.text(`IVA: ${getSafe(cert.cliente_iva)}`, rightBoxX + 8, y + 47, { width: blockW - 16, lineBreak: false })
		doc.text(`Direccion: ${getSafe(cert.cliente_direccion)}`, rightBoxX + 8, y + 60, { width: blockW - 16, lineBreak: false })
		doc.text(`Telefono: ${getSafe(cert.cliente_telefono)}`, rightBoxX + 8, y + 73, { width: blockW - 16, lineBreak: false })

		// ── BOX DATOS DEL CERTIFICADO ─────────────────────────
		y += blockH + 10
		const boxDatosH = 46
		doc.rect(left, y, width, boxDatosH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.strokeColor("#d0d0d0").lineWidth(0.5).moveTo(left, y + 23).lineTo(right, y + 23).stroke()
		doc.font("Helvetica").fontSize(8.6).fillColor(muted)
		doc.text("Proyecto:", left + 8, y + 7)
		doc.text("Presupuesto Nro", right - 164, y + 7, { width: 94, align: "left" })
		doc.text("Fecha:", left + 8, y + 30)
		doc.text("Certificado Nro", right - 164, y + 30, { width: 94, align: "left" })
		doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
		doc.text(getSafe(cert.presupuesto_proyecto || cert.obra_nombre), left + 58, y + 7, { width: width - 232, lineBreak: false })
		doc.text(getSafe(cert.presupuesto_numero), right - 70, y + 7, { width: 62, align: "right", lineBreak: false })
		doc.text(formatDate(cert.fecha), left + 58, y + 30, { width: width - 232, lineBreak: false })
		doc.text(String(cert.secuencia), right - 70, y + 30, { width: 62, align: "right", lineBreak: false })

		// ── TABLA DE ÍTEMS ────────────────────────────────────
		y += boxDatosH + 12

		const colDesc = width - 252
		const colRef = 112
		const colSub = 140
		const rowH = 16

		// cabecera tabla
		doc.rect(left, y, width, rowH).fillAndStroke("#f3f3f3", lineColor)
		doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111")
		doc.text("Item", left + 6, y + 4, { width: colDesc - 12 })
		doc.moveTo(left + colDesc, y).lineTo(left + colDesc, y + rowH).strokeColor(lineColor).lineWidth(0.6).stroke()
		doc.text("Referencia", left + colDesc + 6, y + 4, { width: colRef - 12, align: "right" })
		doc.moveTo(left + colDesc + colRef, y).lineTo(left + colDesc + colRef, y + rowH).stroke()
		doc.text("Subtotal", left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right" })
		y += rowH

		const drawItemRow = (desc, ref, subtotal, idx) => {
			if (y + rowH > pageBottomLimit) { doc.addPage(); y = top + 2 }
			if (idx % 2 === 0) doc.rect(left, y, width, rowH).fill("#fbfbfb")
			doc.rect(left, y, width, rowH).lineWidth(0.5).strokeColor("#6b6b6b").stroke()
			doc.font("Helvetica").fontSize(8.6).fillColor("#111")
			doc.text(desc, left + 6, y + 4, { width: colDesc - 12, lineBreak: false })
			doc.moveTo(left + colDesc, y).lineTo(left + colDesc, y + rowH).strokeColor("#808080").lineWidth(0.35).stroke()
			doc.text(ref, left + colDesc + 6, y + 4, { width: colRef - 12, align: "right", lineBreak: false })
			doc.moveTo(left + colDesc + colRef, y).lineTo(left + colDesc + colRef, y + rowH).stroke()
			const sub = toNumber(subtotal, 0)
			doc.text(sub !== 0 ? `$ ${formatMoney(sub)}` : "-", left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right", lineBreak: false })
			y += rowH
		}

		const avanceRef = cert.tipo_registro === "monto"
			? `$ ${formatMoney(cert.monto_base)}`
			: `${toNumber(cert.porcentaje_avance, 0).toFixed(2)}%`

		const ajustePct = roundMoney((toNumber(cert.indice_cac, 1) - 1) * 100)
		const indiceBaseTexto = cert.indice_base_periodo && cert.indice_base_valor
			? `${String(cert.indice_base_periodo)} (${toNumber(cert.indice_base_valor).toFixed(1)})`
			: (cert.indice_base_cac > 0 ? toNumber(cert.indice_base_cac).toFixed(1) : "-")
		const indiceActualTexto = cert.indice_actual_periodo && cert.indice_actual_valor
			? `${String(cert.indice_actual_periodo)} (${toNumber(cert.indice_actual_valor).toFixed(1)})`
			: (cert.indice_actual_cac > 0 ? toNumber(cert.indice_actual_cac).toFixed(1) : "-")
		const indiceRef = cert.indice_base_cac > 0 && cert.indice_actual_cac > 0
			? `${indiceBaseTexto}`
			: `factor ${toNumber(cert.indice_cac, 1).toFixed(4)}`
		const ajusteRef = `${ajustePct.toFixed(2)}%`

		drawItemRow(`*  PRESUPUESTO ORIGINAL NRO.${getSafe(cert.presupuesto_numero)}`, "", cert.presupuesto_total, 0)
		drawItemRow("", "", 0, 1)
		const certLabel = `CERTIFICADO NRO.${cert.secuencia}`
		drawItemRow(`   ${certLabel}`, "", 0, 2)
		drawItemRow(`   AVANCE DE OBRAS (${avanceRef})`, avanceRef, cert.monto_base, 3)
		drawItemRow(`   FORMULA CAC: ${indiceRef}`, "", 0, 4)
		drawItemRow(`   ACTUALIZACION S/INDICE CAC: ${indiceActualTexto}`, ajusteRef, cert.actualizacion, 5)
		drawItemRow("", "", 0, 6)

		// fila subtotal del certificado (banda beige)
		if (y + rowH > pageBottomLimit) { doc.addPage(); y = top + 2 }
		doc.rect(left, y, width, rowH).fillAndStroke("#efede8", lineColor)
		doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#111")
		doc.text(`TOTAL CERTIFICADO NRO.${cert.secuencia}`, left + 6, y + 4, { width: colDesc - 12, lineBreak: false })
		doc.text(`$ ${formatMoney(cert.total_cert_sin_iva)}`, left + colDesc + colRef + 6, y + 4, { width: colSub - 12, align: "right", lineBreak: false })
		y += rowH

		// ── SUMMARY BOX FIJO AL PIE ───────────────────────────
		const summaryBoxH = 110
		const summaryLeftW = width - 228
		const observacionesTexto = String(cert.observaciones || "").trim()
		const ySummary = pageBottomLimit - summaryBoxH

		doc.rect(left, ySummary, summaryLeftW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
		doc.text("Observaciones", left + 8, ySummary + 6)
		doc.font("Helvetica").fontSize(8.2).fillColor("#111")
		if (observacionesTexto) {
			doc.text(observacionesTexto, left + 8, ySummary + 18, { width: summaryLeftW - 16, height: summaryBoxH - 24 })
		}

		const sumX = left + summaryLeftW
		const sumW = width - summaryLeftW
		const sumLabelX = sumX + 8
		const sumValueW = 94
		const sumValueX = sumX + sumW - 8 - sumValueW
		doc.rect(sumX, ySummary, sumW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica").fontSize(8.3).fillColor("#111")
		doc.text("SUBTOTAL", sumLabelX, ySummary + 8, { width: sumW - 24 - sumValueW })
		doc.text(`$ ${formatMoney(cert.total_cert_sin_iva)}`, sumValueX, ySummary + 8, { width: sumValueW, align: "right" })
		doc.text(`IVA ${formatPercentLabel(toNumber(cert.iva_porcentaje, 21))}`, sumLabelX, ySummary + 24, { width: sumW - 24 - sumValueW })
		doc.text(`$ ${formatMoney(cert.iva)}`, sumValueX, ySummary + 24, { width: sumValueW, align: "right" })
		doc.text("RESTO PRESUP.", sumLabelX, ySummary + 40, { width: sumW - 24 - sumValueW })
		doc.text(`$ ${formatMoney(cert.saldo_pre_original)}`, sumValueX, ySummary + 40, { width: sumValueW, align: "right" })
		doc.rect(sumX + 6, ySummary + 69, sumW - 12, 21).fillAndStroke("#1f1f1f", lineColor)
		doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#ffffff")
		doc.text("TOTAL", sumX + 12, ySummary + 76)
		doc.text(`$ ${formatMoney(cert.total_cert_con_iva)}`, sumValueX, ySummary + 76, { width: sumValueW, align: "right" })

		// ── FOOTER ────────────────────────────────────────────
		const range = doc.bufferedPageRange()
		for (let i = 0; i < range.count; i++) {
			doc.switchToPage(i)
			doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, doc.page.height - 62).lineTo(right, doc.page.height - 62).stroke()
			doc.font("Helvetica").fontSize(7.8).fillColor(muted)
			doc.text(`Tesla Montajes Electricos - certificado de avance`, left, doc.page.height - 60)
			doc.text(`Pagina ${i + 1}`, left, doc.page.height - 60, { width, align: "right" })
		}

		doc.end()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.post("/", async (req, res) => {
	const client = await pool.connect()

	try {
		const {
			presupuesto_id,
			fecha,
			estado,
			observaciones,
		} = req.body || {}

		if (!presupuesto_id) {
			return res.status(400).json({ error: "presupuesto_id es obligatorio" })
		}

		const validacion = validarInputCertificado(req.body || {})
		if (!validacion.ok) {
			return res.status(validacion.status).json({ error: validacion.error })
		}

		await client.query("BEGIN")

		const presupuestoResult = await client.query(
			`SELECT p.id, p.total, p.iva_porcentaje, p.indice_cac_base_id, ic.valor AS indice_base_cac
			 FROM presupuestos p
			 LEFT JOIN indices_cac ic ON ic.id = p.indice_cac_base_id
			 WHERE p.id = $1 LIMIT 1`,
			[validacion.presupuestoId]
		)

		if (presupuestoResult.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		const presupuesto = presupuestoResult.rows[0]
		const indiceBasePresupuesto = Math.max(0, toNumber(presupuesto.indice_base_cac, 0))
		// Compatibilidad con BD antiguas: algunas tienen unique global en certificados.numero.
		// Se genera un numero global para evitar choques entre presupuestos distintos.
		await client.query("LOCK TABLE certificados IN EXCLUSIVE MODE")
		const numeroGlobalResult = await client.query(
			`SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente_global FROM certificados`
		)
		const secuenciaResult = await client.query(
			`SELECT COALESCE(MAX(secuencia), 0) + 1 AS siguiente FROM certificados WHERE presupuesto_id = $1`,
			[validacion.presupuestoId]
		)
		const acumuladoPrevioResult = await client.query(
			`SELECT COALESCE(MAX(acumulado_certificado), 0) AS acumulado FROM certificados WHERE presupuesto_id = $1`,
			[validacion.presupuestoId]
		)

		const siguienteSecuencia = Number(secuenciaResult.rows[0]?.siguiente) || 1
		const siguienteNumeroGlobal = Number(numeroGlobalResult.rows[0]?.siguiente_global) || siguienteSecuencia
		const acumuladoPrevio = toNumber(acumuladoPrevioResult.rows[0]?.acumulado)
		const calculado = calcularCertificado({
			presupuesto,
			input: {
				tipo_registro: validacion.tipoRegistro,
				porcentaje_avance: validacion.porcentajeAvance,
				monto_base: validacion.montoBase,
				indice_cac: validacion.indiceCac,
				indice_base_cac: validacion.indiceBaseCac || indiceBasePresupuesto,
				indice_actual_cac: validacion.indiceActualCac,
				aplica_iva: validacion.aplicaIva,
				iva_porcentaje: validacion.ivaPorcentaje,
				pagos: validacion.pagos,
			},
			acumuladoPrevio,
		})

		const result = await client.query(
			`
				INSERT INTO certificados (
					presupuesto_id, numero, secuencia, fecha, estado, tipo_registro, porcentaje_avance,
					importe_original, monto_base, indice_cac, indice_base_cac, indice_actual_cac, indice_origen, certificado, ajuste_porcentaje,
					actualizacion, aplica_iva, iva_porcentaje, iva, total_cert_sin_iva, total_cert_con_iva, acumulado_certificado,
					saldo_pre_original, pagos, saldo_pendiente, observaciones
				) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
				RETURNING *
			`,
			[
				validacion.presupuestoId,
				siguienteNumeroGlobal,
				siguienteSecuencia,
				fecha || null,
				validacion.estado,
				calculado.tipo_registro,
				calculado.porcentaje_avance,
				calculado.importe_original,
				calculado.monto_base,
				calculado.indice_cac,
				calculado.indice_base_cac,
				calculado.indice_actual_cac,
				calculado.indice_origen,
				calculado.certificado,
				calculado.ajuste_porcentaje,
				calculado.actualizacion,
				calculado.aplica_iva,
				calculado.iva_porcentaje,
				calculado.iva,
				calculado.total_cert_sin_iva,
				calculado.total_cert_con_iva,
				calculado.acumulado_certificado,
				calculado.saldo_pre_original,
				validacion.pagos,
				calculado.saldo_pendiente,
				String(observaciones || "").trim(),
			]
		)

		await client.query("COMMIT")

		getIo()?.emit("certificados:changed")
		getIo()?.emit("presupuestos:changed")
		res.status(201).json(mapCertificado(result.rows[0]))
	} catch (err) {
		await client.query("ROLLBACK")
		if (err?.code === "23505") {
			return res.status(409).json({ error: "Ya existe ese certificado para el presupuesto seleccionado" })
		}
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

router.put("/:id", async (req, res) => {
	const client = await pool.connect()

	try {
		const certificadoId = Number(req.params.id)
		if (!Number.isInteger(certificadoId) || certificadoId <= 0) {
			return res.status(400).json({ error: "ID de certificado invalido" })
		}

		await client.query("BEGIN")
		const certificadoResult = await client.query(
			`SELECT id, presupuesto_id, secuencia, fecha FROM certificados WHERE id = $1 LIMIT 1`,
			[certificadoId]
		)

		if (certificadoResult.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Certificado no encontrado" })
		}

		const certificadoActual = certificadoResult.rows[0]
		const presupuestoResult = await client.query(
			`SELECT p.id, p.total, p.iva_porcentaje, p.indice_cac_base_id, ic.valor AS indice_base_cac
			 FROM presupuestos p
			 LEFT JOIN indices_cac ic ON ic.id = p.indice_cac_base_id
			 WHERE p.id = $1 LIMIT 1`,
			[certificadoActual.presupuesto_id]
		)
		if (presupuestoResult.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		const certificadoCompletoResult = await client.query(
			`SELECT * FROM certificados WHERE id = $1 LIMIT 1`,
			[certificadoId]
		)
		const certificadoCompleto = certificadoCompletoResult.rows?.[0] || {}

		const validacion = validarInputCertificado({
			...certificadoCompleto,
			...req.body,
			presupuesto_id: certificadoActual.presupuesto_id,
		})
		if (!validacion.ok) {
			await client.query("ROLLBACK")
			return res.status(validacion.status).json({ error: validacion.error })
		}

		const anterioresResult = await client.query(
			`SELECT COALESCE(MAX(acumulado_certificado), 0) AS acumulado FROM certificados WHERE presupuesto_id = $1 AND secuencia < $2`,
			[certificadoActual.presupuesto_id, certificadoActual.secuencia]
		)

		const calculado = calcularCertificado({
			presupuesto: presupuestoResult.rows[0],
			input: {
				tipo_registro: validacion.tipoRegistro,
				porcentaje_avance: validacion.porcentajeAvance,
				monto_base: validacion.montoBase,
				indice_cac: validacion.indiceCac,
				indice_base_cac: validacion.indiceBaseCac || Math.max(0, toNumber(presupuestoResult.rows[0]?.indice_base_cac, 0)),
				indice_actual_cac: validacion.indiceActualCac,
				aplica_iva: validacion.aplicaIva,
				iva_porcentaje: validacion.ivaPorcentaje,
				pagos: validacion.pagos,
			},
			acumuladoPrevio: toNumber(anterioresResult.rows[0]?.acumulado),
		})

		await client.query(
			`
				UPDATE certificados
				SET fecha = COALESCE($2::date, fecha),
					estado = $3,
					tipo_registro = $4,
					porcentaje_avance = $5,
					monto_base = $6,
					indice_cac = $7,
					indice_base_cac = $8,
					indice_actual_cac = $9,
					indice_origen = $10,
					aplica_iva = $11,
					iva_porcentaje = $12,
					importe_original = $13,
					certificado = $14,
					ajuste_porcentaje = $15,
					actualizacion = $16,
					iva = $17,
					total_cert_sin_iva = $18,
					total_cert_con_iva = $19,
					acumulado_certificado = $20,
					saldo_pre_original = $21,
					pagos = $22,
					saldo_pendiente = $23,
					observaciones = $24
				WHERE id = $1
			`,
			[
				certificadoId,
				req.body?.fecha || null,
				validacion.estado,
				calculado.tipo_registro,
				calculado.porcentaje_avance,
				calculado.monto_base,
				calculado.indice_cac,
				calculado.indice_base_cac,
				calculado.indice_actual_cac,
				calculado.indice_origen,
				calculado.aplica_iva,
				calculado.iva_porcentaje,
				calculado.importe_original,
				calculado.certificado,
				calculado.ajuste_porcentaje,
				calculado.actualizacion,
				calculado.iva,
				calculado.total_cert_sin_iva,
				calculado.total_cert_con_iva,
				calculado.acumulado_certificado,
				calculado.saldo_pre_original,
				validacion.pagos,
				calculado.saldo_pendiente,
				String(req.body?.observaciones || "").trim(),
			]
		)

		await recalcularCertificadosPresupuesto(client, certificadoActual.presupuesto_id)
		await client.query("COMMIT")

		const updatedResult = await pool.query(`SELECT * FROM certificados WHERE id = $1 LIMIT 1`, [certificadoId])
		getIo()?.emit("certificados:changed")
		getIo()?.emit("presupuestos:changed")
		res.json(mapCertificado(updatedResult.rows[0]))
	} catch (err) {
		await client.query("ROLLBACK")
		if (err?.code === "23505") {
			return res.status(409).json({ error: "Conflicto de datos al actualizar el certificado. Reintentá la operación." })
		}
		if (err?.code === "23514" || err?.code === "22P02" || err?.code === "22003") {
			return res.status(400).json({ error: `Datos inválidos para actualizar certificado: ${err.message}` })
		}
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

router.delete("/:id", async (req, res) => {
	const client = await pool.connect()

	try {
		const certificadoId = Number(req.params.id)
		if (!Number.isInteger(certificadoId) || certificadoId <= 0) {
			return res.status(400).json({ error: "ID de certificado invalido" })
		}

		await client.query("BEGIN")
		const certificadoResult = await client.query(
			`SELECT id, presupuesto_id FROM certificados WHERE id = $1 LIMIT 1`,
			[certificadoId]
		)

		if (certificadoResult.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Certificado no encontrado" })
		}

		const certificado = certificadoResult.rows[0]
		await client.query(`DELETE FROM certificados WHERE id = $1`, [certificadoId])
		await recalcularCertificadosPresupuesto(client, certificado.presupuesto_id)
		await client.query("COMMIT")

		getIo()?.emit("certificados:changed")
		getIo()?.emit("presupuestos:changed")
		res.json({ ok: true })
	} catch (err) {
		await client.query("ROLLBACK")
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

export default router
