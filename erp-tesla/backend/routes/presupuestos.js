import express from "express"
import fs from "fs"
import db, { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"

const router = express.Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo.png")
const LOGO_PRESUPUESTO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

const formatoMoneda = (valor) => {
	const numero = Number(valor) || 0
	return new Intl.NumberFormat("es-AR", {
		style: "currency",
		currency: "ARS",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(numero)
}

const formatoFecha = (valor) => {
	if (!valor) return "-"
	const fecha = new Date(valor)
	if (Number.isNaN(fecha.getTime())) return String(valor)
	return fecha.toLocaleDateString("es-AR")
}

const toNumber = (value, fallback = 0) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

const sanitizeDescripcion = (value = "") => String(value).trim()

const normalizeItems = (items = [], tipo = "material") => {
	if (!Array.isArray(items)) return []

	return items
		.map((item, idx) => {
			const descripcion = sanitizeDescripcion(item.descripcion)
			const cantidadBase = toNumber(item.cantidad, 0)
			const precioUnitarioBase = toNumber(item.precio_unitario, 0)
			const gananciaPorcentaje = tipo === "material" ? Math.max(0, toNumber(item.ganancia_porcentaje, 0)) : 0
			const cantidad = tipo === "mano_obra" ? (cantidadBase > 0 ? cantidadBase : 1) : cantidadBase
			const precioUnitario = tipo === "material"
				? precioUnitarioBase * (1 + gananciaPorcentaje / 100)
				: precioUnitarioBase
			const subtotal = tipo === "mano_obra"
				? 0
				: cantidad * precioUnitario

			return {
				tipo,
				orden: idx + 1,
				descripcion,
				cantidad,
				ganancia_porcentaje: gananciaPorcentaje,
				precio_unitario: precioUnitario,
				subtotal,
			}
		})
		.filter((item) => item.descripcion && item.cantidad > 0 && (tipo === "mano_obra" || item.precio_unitario >= 0))
}

const calcularTotales = ({ materiales, manoObra, aplicaIva, ivaPorcentaje, subtotalGeneralManoObra = 0 }) => {
	const subtotalMateriales = materiales.reduce((acc, item) => acc + item.subtotal, 0)
	const subtotalManoObra = subtotalGeneralManoObra
	const ivaMonto = aplicaIva ? subtotalMateriales * (ivaPorcentaje / 100) : 0
	const total = subtotalMateriales + subtotalManoObra + ivaMonto

	return {
		subtotalMateriales,
		subtotalManoObra,
		ivaMonto,
		total,
	}
}

const getNextNumero = async (client) => {
	const lockRes = await client.query(
		`
			SELECT value_int
			FROM app_config
			WHERE key = 'presupuesto_next_number'
			FOR UPDATE
		`
	)

	if (lockRes.rowCount === 0) {
		await client.query(
			`INSERT INTO app_config (key, value_int) VALUES ('presupuesto_next_number', 2)`
		)
		return 1
	}

	const numeroActual = Number(lockRes.rows[0].value_int) || 1

	await client.query(
		`UPDATE app_config SET value_int = $1 WHERE key = 'presupuesto_next_number'`,
		[numeroActual + 1]
	)

	return numeroActual
}

const getPresupuestoCompleto = async (id) => {
	const cabeceraQuery = await pool.query(
		`
			SELECT
				p.*,
				c.razon_social AS cliente_razon_social,
				c.direccion AS cliente_direccion,
				c.telefono AS cliente_telefono,
				c.email AS cliente_email,
				o.nombre AS obra_nombre
			FROM presupuestos p
			INNER JOIN clientes c ON c.id = p.cliente_id
			INNER JOIN obras o ON o.id = p.obra_id
			WHERE p.id = $1
			LIMIT 1
		`,
		[id]
	)

	if (cabeceraQuery.rowCount === 0) return null

	const itemsQuery = await pool.query(
		`
			SELECT id, tipo, orden, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
			FROM presupuesto_items
			WHERE presupuesto_id = $1
			ORDER BY tipo ASC, orden ASC
		`,
		[id]
	)

	return {
		...cabeceraQuery.rows[0],
		items: itemsQuery.rows,
	}
}

const recalcularCertificadosPorPresupuesto = async (client, presupuestoId) => {
	const presupuestoResult = await client.query(
		`SELECT id, total, iva_porcentaje FROM presupuestos WHERE id = $1 LIMIT 1`,
		[Number(presupuestoId)]
	)

	if (presupuestoResult.rowCount === 0) return

	const presupuesto = presupuestoResult.rows[0]
	const certificadosResult = await client.query(
		`
			SELECT id, tipo_registro, porcentaje_avance, monto_base, indice_cac, pagos
			FROM certificados
			WHERE presupuesto_id = $1
			ORDER BY secuencia ASC, id ASC
		`,
		[Number(presupuestoId)]
	)

	let acumuladoPrevio = 0
	for (const row of certificadosResult.rows) {
		const importeOriginal = Math.round((toNumber(presupuesto.total) + Number.EPSILON) * 100) / 100
		const tipoRegistro = String(row.tipo_registro || "porcentaje") === "monto" ? "monto" : "porcentaje"
		const montoLegacy = Math.max(0, toNumber(row.certificado, 0))
		const tipoEfectivo = tipoRegistro === "porcentaje" && toNumber(row.porcentaje_avance, 0) <= 0 && toNumber(row.monto_base, 0) <= 0 && montoLegacy > 0
			? "monto"
			: tipoRegistro
		const porcentajeAvance = tipoEfectivo === "porcentaje" ? Math.max(0, toNumber(row.porcentaje_avance, 0)) : 0
		const montoBase = tipoEfectivo === "monto"
			? Math.max(0, toNumber(row.monto_base, row.certificado))
			: Math.round((importeOriginal * (porcentajeAvance / 100) + Number.EPSILON) * 100) / 100
		const indiceCac = Math.max(0, toNumber(row.indice_cac, 1)) || 1
		const ajustePorcentaje = Math.round((((indiceCac - 1) * 100) + Number.EPSILON) * 100) / 100
		const actualizacion = Math.round((montoBase * (indiceCac - 1) + Number.EPSILON) * 100) / 100
		const certificado = Math.round((montoBase + actualizacion + Number.EPSILON) * 100) / 100
		const iva = Math.round((certificado * (toNumber(presupuesto.iva_porcentaje, 21) / 100) + Number.EPSILON) * 100) / 100
		const totalCertConIva = Math.round((certificado + iva + Number.EPSILON) * 100) / 100
		const pagos = Math.round((Math.max(0, toNumber(row.pagos, 0)) + Number.EPSILON) * 100) / 100
		const acumuladoCertificado = Math.round((acumuladoPrevio + certificado + Number.EPSILON) * 100) / 100
		const saldoPreOriginal = Math.round((Math.max(0, importeOriginal - acumuladoCertificado) + Number.EPSILON) * 100) / 100
		const saldoPendiente = Math.round((Math.max(0, totalCertConIva - pagos) + Number.EPSILON) * 100) / 100

		await client.query(
			`
				UPDATE certificados
				SET importe_original = $2,
					monto_base = $3,
					ajuste_porcentaje = $4,
					actualizacion = $5,
					certificado = $6,
					iva = $7,
					total_cert_sin_iva = $8,
					total_cert_con_iva = $9,
					acumulado_certificado = $10,
					saldo_pre_original = $11,
					pagos = $12,
					saldo_pendiente = $13,
					porcentaje_avance = $14
				WHERE id = $1
			`,
			[
				row.id,
				importeOriginal,
				montoBase,
				ajustePorcentaje,
				actualizacion,
				certificado,
				iva,
				certificado,
				totalCertConIva,
				acumuladoCertificado,
				saldoPreOriginal,
				pagos,
				saldoPendiente,
				porcentajeAvance,
			]
		)
		acumuladoPrevio = acumuladoCertificado
	}
}

router.get("/config/numero-siguiente", async (req, res) => {
	try {
		const { data, error } = await db
			.from("app_config")
			.select("value_int")
			.eq("key", "presupuesto_next_number")
			.single()

		if (error || !data) {
			return res.json({ numero_siguiente: 1 })
		}

		res.json({ numero_siguiente: Number(data.value_int) || 1 })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.put("/config/numero-siguiente", async (req, res) => {
	try {
		const numero = Number(req.body?.numero_siguiente)
		if (!Number.isInteger(numero) || numero <= 0) {
			return res.status(400).json({ error: "numero_siguiente debe ser un entero mayor a 0" })
		}

		await pool.query(
			`
				INSERT INTO app_config (key, value_int)
				VALUES ('presupuesto_next_number', $1)
				ON CONFLICT (key)
				DO UPDATE SET value_int = EXCLUDED.value_int
			`,
			[numero]
		)

		res.json({ numero_siguiente: numero })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/", async (req, res) => {
	try {
		const result = await pool.query(
			`
				SELECT
					p.id,
					p.numero,
					p.cliente_id,
					p.obra_id,
					p.fecha,
					p.estado,
					p.total,
					p.forma_pago,
					COALESCE(cert.cantidad_certificados, 0) AS cantidad_certificados,
					COALESCE(cert.total_certificado, 0) AS total_certificado,
					COALESCE(cert.total_certificado_con_iva, 0) AS total_certificado_con_iva,
					COALESCE(cert.total_pagado_certificados, 0) AS total_pagado_certificados,
					COALESCE(cert.tiene_pendientes, false) AS tiene_certificados_pendientes,
					c.razon_social AS cliente,
					c.telefono AS cliente_telefono,
					o.nombre AS obra
				FROM presupuestos p
				INNER JOIN clientes c ON c.id = p.cliente_id
				INNER JOIN obras o ON o.id = p.obra_id
				LEFT JOIN (
					SELECT
						presupuesto_id,
						COUNT(*) AS cantidad_certificados,
						SUM(certificado) AS total_certificado,
						SUM(total_cert_con_iva) AS total_certificado_con_iva,
						SUM(pagos) AS total_pagado_certificados,
						BOOL_OR(estado = 'pendiente') AS tiene_pendientes
					FROM certificados
					GROUP BY presupuesto_id
				) cert ON cert.presupuesto_id = p.id
				ORDER BY p.created_at DESC
			`
		)

		res.json(result.rows)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/:id", async (req, res) => {
	try {
		const data = await getPresupuestoCompleto(req.params.id)
		if (!data) return res.status(404).json({ error: "Presupuesto no encontrado" })
		res.json(data)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.post("/", async (req, res) => {
	const client = await pool.connect()

	try {
		const {
			cliente_id,
			obra_id,
			fecha,
			validez_dias,
			forma_pago,
			observaciones,
			aplica_iva,
			iva_porcentaje,
			subtotal_general_mano_obra,
			items_materiales,
			items_mano_obra,
		} = req.body || {}

		if (!cliente_id || !obra_id) {
			return res.status(400).json({ error: "cliente_id y obra_id son obligatorios" })
		}

		const subtotalGeneralManoObra = Math.max(0, toNumber(subtotal_general_mano_obra, 0))
		const materiales = normalizeItems(items_materiales, "material")
		const manoObra = normalizeItems(items_mano_obra, "mano_obra")

		if (materiales.length === 0 && manoObra.length === 0) {
			return res.status(400).json({ error: "Debe ingresar al menos un item" })
		}

		const ivaPorcentaje = toNumber(iva_porcentaje, 21)
		const aplicaIva = Boolean(aplica_iva)
		const { subtotalMateriales, subtotalManoObra, ivaMonto, total } = calcularTotales({
			materiales,
			manoObra,
			aplicaIva,
			ivaPorcentaje,
			subtotalGeneralManoObra,
		})

		await client.query("BEGIN")

		const numero = await getNextNumero(client)

		const insertPresupuesto = await client.query(
			`
				INSERT INTO presupuestos (
					numero, cliente_id, obra_id, fecha, validez_dias, forma_pago, observaciones,
					subtotal_materiales, subtotal_mano_obra, iva_porcentaje, iva_monto, total
				) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12)
				RETURNING *
			`,
			[
				numero,
				Number(cliente_id),
				Number(obra_id),
				fecha || null,
				Number(validez_dias) || 15,
				forma_pago || "Contado",
				observaciones || "",
				subtotalMateriales,
				subtotalManoObra,
				ivaPorcentaje,
				ivaMonto,
				total,
			]
		)

		const presupuesto = insertPresupuesto.rows[0]
		const allItems = [...materiales, ...manoObra]

		for (const item of allItems) {
			await client.query(
				`
					INSERT INTO presupuesto_items (
						presupuesto_id, tipo, orden, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				`,
				[
					presupuesto.id,
					item.tipo,
					item.orden,
					item.descripcion,
					item.cantidad,
					item.ganancia_porcentaje,
					item.precio_unitario,
					item.subtotal,
				]
			)
		}

		await client.query("COMMIT")

		const completo = await getPresupuestoCompleto(presupuesto.id)
		getIo()?.emit('presupuestos:changed')
		res.status(201).json(completo)
	} catch (err) {
		await client.query("ROLLBACK")
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

router.put("/:id", async (req, res) => {
	const client = await pool.connect()

	try {
		const presupuestoId = Number(req.params.id)
		if (!Number.isInteger(presupuestoId) || presupuestoId <= 0) {
			return res.status(400).json({ error: "ID de presupuesto invalido" })
		}

		const {
			cliente_id,
			obra_id,
			fecha,
			validez_dias,
			forma_pago,
			observaciones,
			aplica_iva,
			iva_porcentaje,
			subtotal_general_mano_obra,
			items_materiales,
			items_mano_obra,
		} = req.body || {}

		if (!cliente_id || !obra_id) {
			return res.status(400).json({ error: "cliente_id y obra_id son obligatorios" })
		}

		const subtotalGeneralManoObra = Math.max(0, toNumber(subtotal_general_mano_obra, 0))
		const materiales = normalizeItems(items_materiales, "material")
		const manoObra = normalizeItems(items_mano_obra, "mano_obra")

		if (materiales.length === 0 && manoObra.length === 0) {
			return res.status(400).json({ error: "Debe ingresar al menos un item" })
		}

		const ivaPorcentaje = toNumber(iva_porcentaje, 21)
		const aplicaIva = Boolean(aplica_iva)
		const { subtotalMateriales, subtotalManoObra, ivaMonto, total } = calcularTotales({
			materiales,
			manoObra,
			aplicaIva,
			ivaPorcentaje,
			subtotalGeneralManoObra,
		})

		await client.query("BEGIN")

		const existing = await client.query(
			`SELECT id FROM presupuestos WHERE id = $1 LIMIT 1`,
			[presupuestoId]
		)

		if (existing.rowCount === 0) {
			await client.query("ROLLBACK")
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		await client.query(
			`
				UPDATE presupuestos
				SET
					cliente_id = $1,
					obra_id = $2,
					fecha = COALESCE($3::date, fecha),
					validez_dias = $4,
					forma_pago = $5,
					observaciones = $6,
					subtotal_materiales = $7,
					subtotal_mano_obra = $8,
					iva_porcentaje = $9,
					iva_monto = $10,
					total = $11
				WHERE id = $12
			`,
			[
				Number(cliente_id),
				Number(obra_id),
				fecha || null,
				Number(validez_dias) || 15,
				forma_pago || "Contado",
				observaciones || "",
				subtotalMateriales,
				subtotalManoObra,
				ivaPorcentaje,
				ivaMonto,
				total,
				presupuestoId,
			]
		)

		await recalcularCertificadosPorPresupuesto(client, presupuestoId)

		await client.query(`DELETE FROM presupuesto_items WHERE presupuesto_id = $1`, [presupuestoId])

		const allItems = [...materiales, ...manoObra]
		for (const item of allItems) {
			await client.query(
				`
					INSERT INTO presupuesto_items (
						presupuesto_id, tipo, orden, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				`,
				[
					presupuestoId,
					item.tipo,
					item.orden,
					item.descripcion,
					item.cantidad,
					item.ganancia_porcentaje,
					item.precio_unitario,
					item.subtotal,
				]
			)
		}

		await client.query("COMMIT")

		const completo = await getPresupuestoCompleto(presupuestoId)
		getIo()?.emit('presupuestos:changed')
		res.json(completo)
	} catch (err) {
		await client.query("ROLLBACK")
		res.status(500).json({ error: err.message })
	} finally {
		client.release()
	}
})

router.patch("/:id/estado", async (req, res) => {
	try {
		const estado = String(req.body?.estado || "").toLowerCase().trim()
		const estadosValidos = ["pendiente", "enviado", "aceptado", "rechazado"]

		if (!estadosValidos.includes(estado)) {
			return res.status(400).json({ error: "Estado invalido" })
		}

		const result = await pool.query(
			`
				UPDATE presupuestos
				SET estado = $1
				WHERE id = $2
				RETURNING id, estado
			`,
			[estado, req.params.id]
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		getIo()?.emit('presupuestos:changed')
		res.json(result.rows[0])
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.delete("/:id", async (req, res) => {
	try {
		const presupuestoId = Number(req.params.id)
		if (!Number.isInteger(presupuestoId) || presupuestoId <= 0) {
			return res.status(400).json({ error: "ID de presupuesto invalido" })
		}

		const result = await pool.query(
			`DELETE FROM presupuestos WHERE id = $1 RETURNING id`,
			[presupuestoId]
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		getIo()?.emit('presupuestos:changed')
		res.json({ ok: true, id: presupuestoId })
	} catch (err) {
		if (err?.code === "23503") {
			return res.status(409).json({ error: "No se puede eliminar: el presupuesto esta asociado a otros registros" })
		}
		res.status(500).json({ error: err.message })
	}
})

router.get("/:id/pdf", async (req, res) => {
	try {
		const presupuesto = await getPresupuestoCompleto(req.params.id)
		if (!presupuesto) {
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		const itemsMateriales = presupuesto.items.filter((item) => item.tipo === "material")
		const itemsManoObra = presupuesto.items.filter((item) => item.tipo === "mano_obra")

		const doc = new PDFDocument({ size: "A4", margin: 45 })
		const chunks = []

		doc.on("data", (chunk) => chunks.push(chunk))
		doc.on("end", () => {
			const buffer = Buffer.concat(chunks)
			const nombreArchivo = `Presupuesto-${presupuesto.numero}.pdf`
			res.setHeader("Content-Type", "application/pdf")
			res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
			res.send(buffer)
		})

		const left = 45
		const pageWidth = doc.page.width
		const right = pageWidth - 45
		const width = right - left
		const top = 34
		const lineColor = "#1f1f1f"
		const muted = "#5b5b5b"

		const getSafe = (value) => {
			const text = String(value ?? "").trim()
			return text ? text : "-"
		}

		const clienteNombre = getSafe(presupuesto.cliente_razon_social)
		const clienteDireccion = getSafe(presupuesto.cliente_direccion)
		const clienteLocalidad = "-"
		const clienteTelefono = getSafe(presupuesto.cliente_telefono)
		const clienteEmail = getSafe(presupuesto.cliente_email)

		const sectionHeader = (title, y) => {
			doc.font("Helvetica-Bold").fontSize(9.6).fillColor("#111")
			doc.text(String(title || "").toUpperCase(), left, y)
			doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y + 12).lineTo(right, y + 12).stroke()
			return y + 19
		}

		const pageBottomLimit = doc.page.height - 98
		const drawContinuationHeader = () => {
			let y = top + 2
			doc.font("Helvetica-Bold").fontSize(12).fillColor("#111")
			doc.text(`PRESUPUESTO Nro ${presupuesto.numero} - CONTINUACION`, left, y)
			doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y + 16).lineTo(right, y + 16).stroke()
			return y + 24
		}

		const drawTable = ({ yStart, sectionTitle, columns, rows, rowHeight = 16, subtotalLabel = null, subtotalValue = null }) => {
			let y = yStart

			const drawHeaderRow = () => {
				doc.rect(left, y, width, rowHeight).fillAndStroke("#f3f3f3", lineColor)
				let x = left
				columns.forEach((col, idx) => {
					doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111")
					doc.text(col.label, x + 6, y + 4, { width: col.width - 12, align: col.align || "left" })
					x += col.width
					if (idx < columns.length - 1) {
						doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor(lineColor).lineWidth(0.6).stroke()
					}
				})
				y += rowHeight
			}

			drawHeaderRow()

			rows.forEach((row, rowIdx) => {
				if (y + rowHeight > pageBottomLimit) {
					doc.addPage()
					y = drawContinuationHeader()
					y = sectionHeader(`${sectionTitle} (continuacion)`, y)
					drawHeaderRow()
				}

				if (rowIdx % 2 === 0) {
					doc.rect(left, y, width, rowHeight).fill("#fbfbfb")
				}
				doc.rect(left, y, width, rowHeight).lineWidth(0.5).strokeColor("#6b6b6b").stroke()
				let cellX = left
				columns.forEach((col, idx) => {
					doc.font("Helvetica").fontSize(8.6).fillColor("#111")
					doc.text(String(row[idx] ?? "-"), cellX + 6, y + 4, {
						width: col.width - 12,
						align: col.align || "left",
					})
					cellX += col.width
					if (idx < columns.length - 1) {
						doc.moveTo(cellX, y).lineTo(cellX, y + rowHeight).strokeColor("#808080").lineWidth(0.35).stroke()
					}
				})
				y += rowHeight
			})

			if (subtotalLabel !== null && subtotalValue !== null) {
				if (y + rowHeight > pageBottomLimit) {
					doc.addPage()
					y = drawContinuationHeader()
					y = sectionHeader(`${sectionTitle} (continuacion)`, y)
					drawHeaderRow()
				}

				doc.rect(left, y, width, rowHeight).fillAndStroke("#efede8", lineColor)
				doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#111")
				const subtotalText = `${String(subtotalLabel)}: ${String(subtotalValue)}`
				doc.text(subtotalText, left + 6, y + 4, {
					width: width - 12,
					align: "right",
					lineBreak: false,
				})
				y += rowHeight
			}

			return y + 8
		}

		const logoToUse = fs.existsSync(LOGO_PRESUPUESTO_PATH) ? LOGO_PRESUPUESTO_PATH : LOGO_PATH
		let y = top

		doc.strokeColor(lineColor).lineWidth(1).moveTo(left, y + 58).lineTo(right, y + 58).stroke()
		doc.strokeColor("#7a7a7a").lineWidth(0.6).moveTo(left, y + 62).lineTo(right, y + 62).stroke()
		doc.font("Helvetica-Bold").fontSize(34).fillColor("#111")
		doc.text("PRESUPUESTO", left, y + 19)

		const infoBoxW = 142
		doc.rect(right - infoBoxW, y + 5, infoBoxW, 40).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica").fontSize(8.4).fillColor(muted)
		doc.text("Numero", right - infoBoxW + 8, y + 11)
		doc.text("Fecha", right - infoBoxW + 8, y + 25)
		doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
		doc.text(String(presupuesto.numero), right - 58, y + 11, { width: 48, align: "right" })
		doc.text(formatoFecha(presupuesto.fecha), right - 90, y + 25, { width: 80, align: "right" })

		y += 74
		const blockGap = 12
		const blockW = (width - blockGap) / 2
		const blockH = 96
		const logoBandW = 82

		doc.rect(left, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
		if (fs.existsSync(logoToUse)) {
			doc.image(logoToUse, left + blockW - logoBandW - 4, y + 20, { fit: [78, 56], align: "center", valign: "center" })
		}
		const empresaTextW = blockW - logoBandW - 14
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("EMPRESA", left + 8, y + 6)
		doc.font("Helvetica").fontSize(8.1).fillColor("#111")
		doc.text("Tesla Montajes Electricos", left + 8, y + 21, { width: empresaTextW, lineBreak: false })
		doc.text("CUIT: 30-71712557-2", left + 8, y + 34, { width: empresaTextW, lineBreak: false })
		doc.text("Echeverria 197 - San Francisco (Cba.)", left + 8, y + 47, { width: empresaTextW, lineBreak: false })
		doc.text("teslamontajeselectricos@hotmail.com", left + 8, y + 60, { width: empresaTextW, lineBreak: false })
		doc.text("www.teslamontajeselectricos.com.ar", left + 8, y + 73, { width: empresaTextW, lineBreak: false })

		const rightBoxX = left + blockW + blockGap
		doc.rect(rightBoxX, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("CLIENTE", rightBoxX + 8, y + 6)
		doc.font("Helvetica").fontSize(8.4)
		doc.text(`Nombre: ${clienteNombre}`, rightBoxX + 8, y + 21, { width: blockW - 16, lineBreak: false })
		doc.text(`Direccion: ${clienteDireccion}`, rightBoxX + 8, y + 34, { width: blockW - 16, lineBreak: false })
		doc.text(`Localidad: ${clienteLocalidad}`, rightBoxX + 8, y + 47, { width: blockW - 16, lineBreak: false })
		doc.text(`Telefono: ${clienteTelefono}`, rightBoxX + 8, y + 60, { width: blockW - 16, lineBreak: false })
		doc.text(`Email: ${clienteEmail}`, rightBoxX + 8, y + 73, { width: blockW - 16, lineBreak: false })

		y += blockH + 12
		doc.rect(left, y, width, 34).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica").fontSize(9).fillColor("#111")
		doc.text(`Proyecto: ${getSafe(presupuesto.obra_nombre)}`, left + 8, y + 6, { width: width * 0.56 })
		doc.text(`Validez: ${presupuesto.validez_dias || 15} dias`, left + width * 0.58, y + 6)
		doc.text(`Forma de pago: ${(presupuesto.forma_pago || "Contado").toUpperCase()}`, left + 8, y + 20)

		y += 46
		y = sectionHeader("Detalle mano de obra", y)
		const manoRows = itemsManoObra.map((item, idx) => [
			`${idx + 1}. ${item.descripcion || "-"}`,
		])
		y = drawTable({
			yStart: y,
			sectionTitle: "Detalle mano de obra",
			columns: [
				{ label: "Descripcion", width },
			],
			rows: manoRows.length ? manoRows : [["Sin items"]],
			subtotalLabel: "Subtotal mano de obra",
			subtotalValue: formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)),
		})

		y = sectionHeader("Detalle materiales", y)
		const materialRows = itemsMateriales.map((item, idx) => [
			`${idx + 1}. ${item.descripcion || "-"}`,
			String(Number(item.cantidad || 0)),
			formatoMoneda(item.precio_unitario),
			formatoMoneda(item.subtotal),
		])
		y = drawTable({
			yStart: y,
			sectionTitle: "Detalle materiales",
			columns: [
				{ label: "Descripcion", width: width - 290 },
				{ label: "Cant.", width: 60, align: "right" },
				{ label: "P. unitario", width: 115, align: "right" },
				{ label: "Subtotal", width: 115, align: "right" },
			],
			rows: materialRows.length ? materialRows : [["Sin items", "0", formatoMoneda(0), formatoMoneda(0)]],
			subtotalLabel: "Subtotal materiales",
			subtotalValue: formatoMoneda(Number(presupuesto.subtotal_materiales || 0)),
		})

		const ivaMonto = Number(presupuesto.iva_monto || 0)
		const totalGeneral = Number(presupuesto.total || 0)
		const summaryBoxH = 84
		const summaryLeftW = width - 182

		if (y + summaryBoxH + 24 > pageBottomLimit) {
			doc.addPage()
			y = drawContinuationHeader()
		}

		doc.rect(left, y, summaryLeftW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica-Bold").fontSize(8.8).text("Observaciones", left + 8, y + 6)
		doc.font("Helvetica").fontSize(8.2).fillColor("#111")
		doc.text(String(presupuesto.observaciones || "-"), left + 8, y + 18, {
			width: summaryLeftW - 16,
			height: summaryBoxH - 24,
		})

		const sumX = left + summaryLeftW
		doc.rect(sumX, y, width - summaryLeftW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
		doc.font("Helvetica").fontSize(8.5).fillColor("#111")
		doc.text("Subtotal mano de obra", sumX + 8, y + 8)
		doc.text(formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)), right - 8 - 80, y + 8, { width: 80, align: "right" })
		doc.text("Subtotal materiales", sumX + 8, y + 24)
		doc.text(formatoMoneda(Number(presupuesto.subtotal_materiales || 0)), right - 8 - 80, y + 24, { width: 80, align: "right" })
		doc.text(`IVA ${Number(presupuesto.iva_porcentaje || 21)}%`, sumX + 8, y + 40)
		doc.text(formatoMoneda(ivaMonto), right - 8 - 80, y + 40, { width: 80, align: "right" })

		doc.rect(sumX + 6, y + 57, width - summaryLeftW - 12, 21).fillAndStroke("#1f1f1f", lineColor)
		doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#ffffff")
		doc.text("TOTAL", sumX + 12, y + 64)
		doc.text(formatoMoneda(totalGeneral), right - 8 - 80, y + 64, { width: 80, align: "right" })

		const firmaY = doc.page.height - 84
		doc.strokeColor("#5a5a5a").lineWidth(0.6).moveTo(left + 10, firmaY).lineTo(left + 170, firmaY).stroke()
		doc.strokeColor("#5a5a5a").lineWidth(0.6).moveTo(right - 170, firmaY).lineTo(right - 10, firmaY).stroke()
		doc.font("Helvetica").fontSize(7.4).fillColor(muted)
		doc.text("Firma cliente", left + 10, firmaY + 3)
		doc.text("Firma empresa", right - 170, firmaY + 3)

		doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, doc.page.height - 62).lineTo(right, doc.page.height - 62).stroke()
		doc.font("Helvetica").fontSize(7.8).fillColor(muted)
		doc.text("Tesla Montajes Electricos - Documento comercial", left, doc.page.height - 54)
		doc.text(`Pagina 1`, left, doc.page.height - 54, { width, align: "right" })

		doc.end()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
