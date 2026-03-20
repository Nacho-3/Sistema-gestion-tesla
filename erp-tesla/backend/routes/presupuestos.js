import express from "express"
import fs from "fs"
import db, { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { sanitizeFileText } from "../pdf/premiumTheme.js"

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
			const precioUnitario = toNumber(item.precio_unitario, 0)
			const cantidad = tipo === "mano_obra" ? (cantidadBase > 0 ? cantidadBase : 1) : cantidadBase
			const subtotal = cantidad * precioUnitario

			return {
				tipo,
				orden: idx + 1,
				descripcion,
				cantidad,
				precio_unitario: precioUnitario,
				subtotal,
			}
		})
		.filter((item) => item.descripcion && item.cantidad > 0 && item.precio_unitario >= 0)
}

const calcularTotales = ({ materiales, manoObra, aplicaIva, ivaPorcentaje }) => {
	const subtotalMateriales = materiales.reduce((acc, item) => acc + item.subtotal, 0)
	const subtotalManoObra = manoObra.reduce((acc, item) => acc + item.subtotal, 0)
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
			SELECT id, tipo, orden, descripcion, cantidad, precio_unitario, subtotal
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
					p.fecha,
					p.estado,
					p.total,
					p.forma_pago,
					c.razon_social AS cliente,
					o.nombre AS obra
				FROM presupuestos p
				INNER JOIN clientes c ON c.id = p.cliente_id
				INNER JOIN obras o ON o.id = p.obra_id
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
			items_materiales,
			items_mano_obra,
		} = req.body || {}

		if (!cliente_id || !obra_id) {
			return res.status(400).json({ error: "cliente_id y obra_id son obligatorios" })
		}

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
						presupuesto_id, tipo, orden, descripcion, cantidad, precio_unitario, subtotal
					) VALUES ($1,$2,$3,$4,$5,$6,$7)
				`,
				[
					presupuesto.id,
					item.tipo,
					item.orden,
					item.descripcion,
					item.cantidad,
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

		const left = 35
		const top = 24
		const width = 525
		const right = left + width
		const xItem = left + 22
		const xDesc = left + 320
		const xCant = left + 368
		const xPrecio = left + 443

		const getSafe = (value) => {
			const text = String(value ?? "").trim()
			return text ? text : "-"
		}

		const clienteNombre = getSafe(presupuesto.cliente_razon_social)
		const clienteDireccion = getSafe(presupuesto.cliente_direccion)
		const clienteLocalidad = "-"
		const clienteTelefono = getSafe(presupuesto.cliente_telefono)
		const clienteEmail = getSafe(presupuesto.cliente_email)

		doc.lineWidth(0.8).strokeColor("#111").rect(left, top, width, 710).stroke()

		doc.font("Helvetica-Bold").fontSize(17).fillColor("#000").text("PRESUPUESTO", left, top + 6, {
			width,
			align: "center",
		})

		const headerY = top + 30
		const headerH = 96
		const colLogoW = 95
		const colEmpresaW = 220
		const colClienteW = width - colLogoW - colEmpresaW

		doc.rect(left, headerY, width, headerH).fill("#0b1537")
		doc.strokeColor("#9ca3af").lineWidth(0.8).rect(left, headerY, width, headerH).stroke()
		doc.moveTo(left + colLogoW, headerY).lineTo(left + colLogoW, headerY + headerH).stroke()
		doc.moveTo(left + colLogoW + colEmpresaW, headerY).lineTo(left + colLogoW + colEmpresaW, headerY + headerH).stroke()

		const logoToUse = fs.existsSync(LOGO_PRESUPUESTO_PATH) ? LOGO_PRESUPUESTO_PATH : LOGO_PATH
		if (fs.existsSync(logoToUse)) {
			doc.image(logoToUse, left + 9, headerY + 10, { fit: [78, 78], align: "center", valign: "center" })
		}

		doc.fillColor("#ffffff")
		doc.font("Helvetica-Bold").fontSize(11.2).text("TESLA MONTAJES ELECTRICOS", left + colLogoW + 8, headerY + 9)
		doc.font("Helvetica").fontSize(8.2)
		doc.text("T.M.E. S.A.S.", left + colLogoW + 8, headerY + 25)
		doc.text("IVA: responsable inscripto", left + colLogoW + 8, headerY + 37)
		doc.text("CUIT: 30-71712557-2", left + colLogoW + 8, headerY + 49)
		doc.text("Echeverria 197 (San Francisco - Cba.)", left + colLogoW + 8, headerY + 61)
		doc.text("03564-15642579 / 15573800 / 15586865", left + colLogoW + 8, headerY + 73)
		doc.text("teslamontajeselectricos@hotmail.com", left + colLogoW + 8, headerY + 85)
		doc.text("www.teslamontajeselectricos.com.ar", left + colLogoW + 8, headerY + 97, { width: colEmpresaW - 16 })

		const clienteX = left + colLogoW + colEmpresaW + 8
		doc.font("Helvetica-Bold").fontSize(10).fillColor("#fbbf24").text("DATOS DEL CLIENTE", clienteX, headerY + 9)
		doc.font("Helvetica").fontSize(9).fillColor("#ffffff")
		doc.text(`Nombre: ${clienteNombre}`, clienteX, headerY + 25, { width: colClienteW - 14 })
		doc.text(`Direccion: ${clienteDireccion}`, clienteX, headerY + 40, { width: colClienteW - 14 })
		doc.text(`Localidad: ${clienteLocalidad}`, clienteX, headerY + 55, { width: colClienteW - 14 })
		doc.text(`Telefono: ${clienteTelefono}`, clienteX, headerY + 70, { width: colClienteW - 14 })
		doc.text(`Email: ${clienteEmail}`, clienteX, headerY + 85, { width: colClienteW - 14 })

		const metaTop = headerY + headerH
		const splitX = left + 355
		doc.strokeColor("#111").lineWidth(0.8)
		doc.rect(left, metaTop, width, 40).stroke()
		doc.moveTo(left, metaTop + 20).lineTo(right, metaTop + 20).stroke()
		doc.moveTo(splitX, metaTop).lineTo(splitX, metaTop + 40).stroke()

		doc.font("Helvetica").fontSize(9.5).fillColor("#000")
		doc.text("Proyecto:", left + 4, metaTop + 6)
		doc.text(getSafe(presupuesto.obra_nombre), left + 54, metaTop + 6, { width: splitX - left - 58 })
		doc.text("Presupuesto N°:", splitX + 4, metaTop + 6)
		doc.text(String(presupuesto.numero), right - 70, metaTop + 6, { width: 64, align: "right" })

		doc.text("Fecha de Presupuesto:", left + 4, metaTop + 25)
		doc.text(formatoFecha(presupuesto.fecha), left + 112, metaTop + 25)
		doc.text("Validez de Oferta:", splitX + 4, metaTop + 25)
		doc.text(`${presupuesto.validez_dias || 15} dias`, right - 70, metaTop + 25, { width: 64, align: "right" })

		const bodyTop = metaTop + 40
		const bodyBottom = top + 635
		const rowH = 14

		doc.rect(left, bodyTop, width, bodyBottom - bodyTop).stroke()
		doc.moveTo(xItem, bodyTop).lineTo(xItem, bodyBottom).stroke()
		doc.moveTo(xPrecio, bodyTop).lineTo(xPrecio, bodyBottom).stroke()

		let yLine = bodyTop + rowH
		while (yLine < bodyBottom) {
			doc.dash(1, { space: 1 }).moveTo(left, yLine).lineTo(right, yLine).stroke().undash()
			yLine += rowH
		}

		doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#c2410c")
		doc.text("item", left + 2, bodyTop + 3)
		doc.text("Descripcion", xItem + 100, bodyTop + 3)
		doc.text("Subtotal", xPrecio + 18, bodyTop + 3)

		let y = bodyTop + rowH + 2
		doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
		doc.text("MANO DE OBRA", xItem + 4, y)
		y += rowH

		doc.font("Helvetica").fontSize(8.8).fillColor("#000")
		itemsManoObra.slice(0, 10).forEach((item, idx) => {
			doc.text(String(item.orden || idx + 1), left + 5, y)
			doc.text(String(item.descripcion || ""), xItem + 6, y, { width: 292 })
			doc.text(formatoMoneda(item.subtotal), xPrecio + 3, y, { width: 76, align: "right" })
			y += rowH
		})

		const materialesSeparatorY = y - 2
		const materialesHeaderY = materialesSeparatorY + 3
		doc.lineWidth(0.8).strokeColor("#111").moveTo(left, materialesSeparatorY).lineTo(right, materialesSeparatorY).stroke()
		doc.moveTo(xDesc, materialesSeparatorY).lineTo(xDesc, bodyBottom).stroke()
		doc.moveTo(xCant, materialesSeparatorY).lineTo(xCant, bodyBottom).stroke()
		doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#000")
		doc.text("MATERIALES", xItem + 4, materialesHeaderY)
		doc.fillColor("#c2410c")
		doc.text("Cantidad", xDesc + 2, materialesHeaderY)
		doc.text("Precio", xCant + 20, materialesHeaderY)
		doc.text("Subtotal", xPrecio + 18, materialesHeaderY)

		y = materialesHeaderY + rowH

		doc.font("Helvetica").fontSize(8.8).fillColor("#000")
		itemsMateriales.slice(0, 12).forEach((item, idx) => {
			doc.text(String(item.orden || idx + 1), left + 5, y)
			doc.text(String(item.descripcion || ""), xItem + 6, y, { width: 292 })
			doc.text(String(Number(item.cantidad || 0)), xDesc + 3, y, { width: 42, align: "right" })
			doc.text(formatoMoneda(item.precio_unitario), xCant + 3, y, { width: 66, align: "right" })
			doc.text(formatoMoneda(item.subtotal), xPrecio + 3, y, { width: 76, align: "right" })
			y += rowH
		})

		const summaryTop = bodyBottom
		doc.lineWidth(0.8).moveTo(left, summaryTop).lineTo(right, summaryTop).stroke()
		doc.moveTo(left + 105, summaryTop).lineTo(left + 105, summaryTop + 16).stroke()

		const subtotalBase = Number(presupuesto.subtotal_mano_obra || 0) + Number(presupuesto.subtotal_materiales || 0)
		const ivaMonto = Number(presupuesto.iva_monto || 0)
		const totalGeneral = Number(presupuesto.total || 0)

		doc.font("Helvetica").fontSize(9.4).fillColor("#000")
		doc.text("FORMA DE PAGO:", left + 5, summaryTop + 5)
		doc.text((presupuesto.forma_pago || "CONTADO").toUpperCase(), left + 112, summaryTop + 5)

		const calcTop = summaryTop + 16
		const calcHeight = 50
		doc.rect(left, calcTop, width, calcHeight).stroke()
		doc.moveTo(left + 360, calcTop).lineTo(left + 360, calcTop + calcHeight).stroke()

		doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
		doc.text("Observaciones", left + 10, calcTop + 6)
		doc.font("Helvetica").fontSize(8.3)
		doc.text(String(presupuesto.observaciones || "-"), left + 10, calcTop + 18, { width: 336, height: 26 })

		const labelX = left + 372
		const valueX = right - 76
		doc.font("Helvetica").fontSize(8.8)
		doc.text("Subtotal mano de obra:", labelX, calcTop + 5)
		doc.text(formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)), valueX, calcTop + 5, { width: 72, align: "right" })
		doc.text("Subtotal materiales:", labelX, calcTop + 17)
		doc.text(formatoMoneda(Number(presupuesto.subtotal_materiales || 0)), valueX, calcTop + 17, { width: 72, align: "right" })
		doc.text("IVA 21%:", labelX, calcTop + 29)
		doc.text(formatoMoneda(ivaMonto), valueX, calcTop + 29, { width: 72, align: "right" })
		doc.font("Helvetica-Bold")
		doc.text("TOTAL GENERAL:", labelX, calcTop + 43)
		doc.text(formatoMoneda(totalGeneral), valueX, calcTop + 43, { width: 72, align: "right" })

		doc.end()
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
