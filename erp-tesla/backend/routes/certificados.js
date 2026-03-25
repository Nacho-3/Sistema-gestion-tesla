import express from "express"
import { pool } from "../db.js"
import { getIo } from "../socket.js"

const router = express.Router()

const toNumber = (value, fallback = 0) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
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

const calcularCertificado = ({ presupuesto, input, acumuladoPrevio = 0 }) => {
	const importeOriginal = roundMoney(presupuesto.total)
	const ivaPorcentaje = toNumber(presupuesto.iva_porcentaje, 21)
	const tipoRegistro = normalizeTipoRegistro(input.tipo_registro)
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
	const indiceCac = Math.max(0, toNumber(input.indice_cac, 1)) || 1
	const ajustePorcentaje = roundMoney((indiceCac - 1) * 100)
	const actualizacion = roundMoney(montoBase * (indiceCac - 1))
	const certificado = roundMoney(montoBase + actualizacion)
	const iva = roundMoney(certificado * (ivaPorcentaje / 100))
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
			SELECT id, secuencia, tipo_registro, porcentaje_avance, monto_base, indice_cac, pagos
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
					ajuste_porcentaje = $5,
					actualizacion = $6,
					certificado = $7,
					iva = $8,
					total_cert_sin_iva = $9,
					total_cert_con_iva = $10,
					acumulado_certificado = $11,
					saldo_pre_original = $12,
					pagos = $13,
					saldo_pendiente = $14,
					porcentaje_avance = $15
				WHERE id = $1
			`,
			[
				row.id,
				calculado.importe_original,
				calculado.monto_base,
				calculado.indice_cac,
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

router.post("/", async (req, res) => {
	const client = await pool.connect()

	try {
		const {
			presupuesto_id,
			fecha,
			tipo_registro,
			porcentaje_avance,
			monto_base,
			indice_cac,
			estado,
			pagos,
			observaciones,
		} = req.body || {}

		if (!presupuesto_id) {
			return res.status(400).json({ error: "presupuesto_id es obligatorio" })
		}

		await client.query("BEGIN")

		const presupuestoResult = await client.query(
			`SELECT id, total, iva_porcentaje FROM presupuestos WHERE id = $1 LIMIT 1`,
			[Number(presupuesto_id)]
		)

		if (presupuestoResult.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		const presupuesto = presupuestoResult.rows[0]
		const secuenciaResult = await client.query(
			`SELECT COALESCE(MAX(secuencia), 0) + 1 AS siguiente FROM certificados WHERE presupuesto_id = $1`,
			[Number(presupuesto_id)]
		)
		const acumuladoPrevioResult = await client.query(
			`SELECT COALESCE(MAX(acumulado_certificado), 0) AS acumulado FROM certificados WHERE presupuesto_id = $1`,
			[Number(presupuesto_id)]
		)

		const siguienteSecuencia = Number(secuenciaResult.rows[0]?.siguiente) || 1
		const acumuladoPrevio = toNumber(acumuladoPrevioResult.rows[0]?.acumulado)
		const calculado = calcularCertificado({
			presupuesto,
			input: { tipo_registro, porcentaje_avance, monto_base, indice_cac, pagos },
			acumuladoPrevio,
		})

		const result = await client.query(
			`
				INSERT INTO certificados (
					presupuesto_id, numero, secuencia, fecha, estado, tipo_registro, porcentaje_avance,
					importe_original, monto_base, indice_cac, certificado, ajuste_porcentaje,
					actualizacion, iva, total_cert_sin_iva, total_cert_con_iva, acumulado_certificado,
					saldo_pre_original, pagos, saldo_pendiente, observaciones
				) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
				RETURNING *
			`,
			[
				Number(presupuesto_id),
				siguienteSecuencia,
				siguienteSecuencia,
				fecha || null,
				normalizeEstado(estado),
				calculado.tipo_registro,
				calculado.porcentaje_avance,
				calculado.importe_original,
				calculado.monto_base,
				calculado.indice_cac,
				calculado.certificado,
				calculado.ajuste_porcentaje,
				calculado.actualizacion,
				calculado.iva,
				calculado.total_cert_sin_iva,
				calculado.total_cert_con_iva,
				calculado.acumulado_certificado,
				calculado.saldo_pre_original,
				calculado.pagos,
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
			`SELECT id, total, iva_porcentaje FROM presupuestos WHERE id = $1 LIMIT 1`,
			[certificadoActual.presupuesto_id]
		)
		const anterioresResult = await client.query(
			`SELECT COALESCE(MAX(acumulado_certificado), 0) AS acumulado FROM certificados WHERE presupuesto_id = $1 AND secuencia < $2`,
			[certificadoActual.presupuesto_id, certificadoActual.secuencia]
		)

		const calculado = calcularCertificado({
			presupuesto: presupuestoResult.rows[0],
			input: req.body || {},
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
					importe_original = $8,
					certificado = $9,
					ajuste_porcentaje = $10,
					actualizacion = $11,
					iva = $12,
					total_cert_sin_iva = $13,
					total_cert_con_iva = $14,
					acumulado_certificado = $15,
					saldo_pre_original = $16,
					pagos = $17,
					saldo_pendiente = $18,
					observaciones = $19
				WHERE id = $1
			`,
			[
				certificadoId,
				req.body?.fecha || null,
				normalizeEstado(req.body?.estado),
				calculado.tipo_registro,
				calculado.porcentaje_avance,
				calculado.monto_base,
				calculado.indice_cac,
				calculado.importe_original,
				calculado.certificado,
				calculado.ajuste_porcentaje,
				calculado.actualizacion,
				calculado.iva,
				calculado.total_cert_sin_iva,
				calculado.total_cert_con_iva,
				calculado.acumulado_certificado,
				calculado.saldo_pre_original,
				calculado.pagos,
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
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

export default router
