import express from "express"
import { existsSync } from "fs"
import fs from "fs/promises"
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
const PRESUPUESTOS_BASE_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "Presupuestos")

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
			const etapa = sanitizeDescripcion(item?.etapa)
			const descripcion = sanitizeDescripcion(item.descripcion)
			const cantidadBase = toNumber(item.cantidad, 0)
			const precioUnitarioBase = toNumber(item.precio_unitario, 0)
			const gananciaPorcentaje = tipo === "material" ? Math.max(0, toNumber(item.ganancia_porcentaje, 0)) : 0
			const cantidad = tipo === "mano_obra" ? (cantidadBase > 0 ? cantidadBase : 1) : cantidadBase
			const precioUnitario = tipo === "material"
				? precioUnitarioBase * (1 + gananciaPorcentaje / 100)
				: precioUnitarioBase
			const subtotal = cantidad * precioUnitario

			return {
				tipo,
				orden: idx + 1,
				etapa,
				descripcion,
				cantidad,
				ganancia_porcentaje: gananciaPorcentaje,
				precio_unitario: precioUnitario,
				subtotal,
			}
		})
		.filter((item) => item.descripcion && item.cantidad > 0 && item.precio_unitario >= 0)
}

const normalizeInfoInternaItems = (items = []) => {
	if (!Array.isArray(items)) return []

	return items
		.map((item, idx) => ({
			orden: idx + 1,
			descripcion: sanitizeDescripcion(item?.descripcion),
			mostrar_en_pdf: Boolean(item?.mostrar_en_pdf),
		}))
		.filter((item) => item.descripcion)
}

const calcularTotales = ({ materiales, manoObra, aplicaIvaMateriales, aplicaIvaManoObra, ivaPorcentaje, subtotalGeneralManoObra = 0 }) => {
	const subtotalMateriales = materiales.reduce((acc, item) => acc + item.subtotal, 0)
	const subtotalManoObraCalculado = manoObra.reduce((acc, item) => {
		const precioUnitario = Math.max(0, toNumber(item.precio_unitario, 0))
		if (precioUnitario <= 0) return acc
		return acc + item.subtotal
	}, 0)
	const subtotalManoObra = subtotalManoObraCalculado > 0 ? subtotalManoObraCalculado : subtotalGeneralManoObra
	const baseIva = (aplicaIvaMateriales ? subtotalMateriales : 0) + (aplicaIvaManoObra ? subtotalManoObra : 0)
	const ivaMonto = baseIva > 0 ? baseIva * (ivaPorcentaje / 100) : 0
	const total = subtotalMateriales + subtotalManoObra + ivaMonto

	return {
		subtotalMateriales,
		subtotalManoObra,
		ivaMonto,
		total,
	}
}

const validarClienteObraRelacion = async (client, clienteId, obraId) => {
	const clienteNumero = Number(clienteId)

	if (!Number.isInteger(clienteNumero) || clienteNumero <= 0) {
		return { ok: false, status: 400, error: "cliente_id invalido" }
	}

	// Validar que el cliente existe
	const clienteResult = await client.query(`SELECT id FROM clientes WHERE id = $1 LIMIT 1`, [clienteNumero])
	const clienteExiste = clienteResult.rowCount > 0

	if (!clienteExiste) {
		return { ok: false, status: 404, error: "Cliente no encontrado" }
	}

	// Si obra_id viene vacío, nulo o 0, permitir (presupuesto sin obra)
	if (!obraId || obraId === "" || Number(obraId) <= 0) {
		return { ok: true, clienteId: clienteNumero, obraId: null }
	}

	const obraNumero = Number(obraId)

	// Si viene un obra_id, validar que sea un número válido
	if (!Number.isInteger(obraNumero) || obraNumero <= 0) {
		return { ok: false, status: 400, error: "obra_id invalido" }
	}

	const obraResult = await client.query(`SELECT id, cliente_id FROM obras WHERE id = $1 LIMIT 1`, [obraNumero])
	const obra = obraResult.rows[0]

	if (!obra) {
		return { ok: false, status: 404, error: "Obra no encontrada" }
	}

	if (Number(obra.cliente_id) !== clienteNumero) {
		return { ok: false, status: 400, error: "La obra seleccionada no pertenece al cliente indicado" }
	}

	return { ok: true, clienteId: clienteNumero, obraId: obraNumero }
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
				c.empresa AS cliente_empresa,
				c.razon_social AS cliente_razon_social,
				c.cuit AS cliente_cuit,
				c.iva AS cliente_iva,
				c.direccion AS cliente_direccion,
				c.telefono AS cliente_telefono,
				c.email AS cliente_email,
				o.nombre AS obra_nombre
			FROM presupuestos p
			INNER JOIN clientes c ON c.id = p.cliente_id
			LEFT JOIN obras o ON o.id = p.obra_id
			WHERE p.id = $1
			LIMIT 1
		`,
		[id]
	)

	if (cabeceraQuery.rowCount === 0) return null

	const itemsQuery = await pool.query(
		`
			SELECT id, tipo, orden, etapa, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
			FROM presupuesto_items
			WHERE presupuesto_id = $1
			ORDER BY tipo ASC, orden ASC
		`,
		[id]
	)

	const infoInternaItemsQuery = await pool.query(
		`
			SELECT id, orden, descripcion, mostrar_en_pdf
			FROM presupuesto_info_interna_items
			WHERE presupuesto_id = $1
			ORDER BY orden ASC, id ASC
		`,
		[id]
	)

	return {
		...cabeceraQuery.rows[0],
		items: itemsQuery.rows,
		items_info_interna: infoInternaItemsQuery.rows,
	}
}

const getPresupuestoPdfFileName = (presupuesto = {}, mode = "presupuesto") => {
	const numero = sanitizeFileText(String(presupuesto.numero || "SinNumero")) || "SinNumero"
	const clienteNombre = sanitizeFileText(presupuesto.cliente_empresa || presupuesto.cliente_razon_social || "Cliente") || "Cliente"
	const obraNombre = sanitizeFileText(presupuesto.obra_nombre || "SinObra")
	if (mode === "materiales") {
		return `Listado materiales (${obraNombre}) (${clienteNombre}) (${numero}).pdf`
	}
	return `Presupuesto-${numero}.pdf`
}

const getPresupuestoPdfFolderPath = (presupuesto = {}, mode = "presupuesto") => {
	const companyName = sanitizeFileText(presupuesto.cliente_empresa || presupuesto.cliente_razon_social || "Empresa")
	let folderPath = path.join(PRESUPUESTOS_BASE_FOLDER, `Presupuestos ${companyName}`)
	if (mode === "materiales") {
		folderPath = path.join(folderPath, "Listados de materiales")
	}
	return folderPath
}

const getPresupuestoPdfFilePath = (presupuesto = {}, mode = "presupuesto") => {
	return path.join(getPresupuestoPdfFolderPath(presupuesto, mode), getPresupuestoPdfFileName(presupuesto, mode))
}

const removeStoredPresupuestoPdf = async (presupuesto = {}) => {
	const filePathPresupuesto = getPresupuestoPdfFilePath(presupuesto, "presupuesto")
	const filePathMateriales = getPresupuestoPdfFilePath(presupuesto, "materiales")
	if (existsSync(filePathPresupuesto)) await fs.unlink(filePathPresupuesto)
	if (existsSync(filePathMateriales)) await fs.unlink(filePathMateriales)
}

const renderPresupuestoPdfBuffer = async (presupuesto, options = {}) => {
	return new Promise((resolve, reject) => {
		try {
			const pdfMode = options?.mode === "materiales" ? "materiales" : "presupuesto"
			const isMaterialesMode = pdfMode === "materiales"
			const mostrarManoObraEnPdf = !isMaterialesMode && Boolean(presupuesto.mostrar_mano_obra_pdf ?? true)
			const mostrarMaterialesEnPdf = isMaterialesMode ? true : Boolean(presupuesto.mostrar_materiales_pdf ?? true)
			const itemsMateriales = presupuesto.items.filter((item) => item.tipo === "material")
			const itemsManoObra = presupuesto.items.filter((item) => item.tipo === "mano_obra")
			const manoObraTienePrecio = itemsManoObra.some((item) => Number(item.precio_unitario || 0) > 0)
			const manoObraTieneCantidad = itemsManoObra.some((item) => Number(item.cantidad || 0) > 1)
			const infoInternaItems = Array.isArray(presupuesto.items_info_interna) ? presupuesto.items_info_interna : []
			const infoInternaVisible = []
			const quienHizo = sanitizeDescripcion(presupuesto.info_interna_quien_hizo)
			const quienAprobo = sanitizeDescripcion(presupuesto.info_interna_quien_aprobo)

			if (Boolean(presupuesto.info_interna_quien_hizo_pdf) && quienHizo) {
				infoInternaVisible.push(`Quien hizo el presupuesto: ${quienHizo}`)
			}
			if (Boolean(presupuesto.info_interna_quien_aprobo_pdf) && quienAprobo) {
				infoInternaVisible.push(`Quien aprobo el presupuesto: ${quienAprobo}`)
			}
			for (const item of infoInternaItems) {
				const descripcion = sanitizeDescripcion(item?.descripcion)
				if (Boolean(item?.mostrar_en_pdf) && descripcion) {
					infoInternaVisible.push(descripcion)
				}
			}

			const doc = new PDFDocument({ size: "A4", margin: 45, bufferPages: true })
			const chunks = []

			doc.on("data", (chunk) => chunks.push(chunk))
			doc.on("end", async () => {
				let buffer = Buffer.concat(chunks)
				//buffer = await removeBlankPagesFromBuffer(buffer)
				resolve(buffer)
			})
			doc.on("error", reject)

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

			const getEtapaLabel = (value) => {
				const text = sanitizeDescripcion(value)
				return text || "General"
			}

			const agruparPorEtapa = (items = []) => {
				const grupos = []
				const mapa = new Map()

				items.forEach((item) => {
					const etapa = getEtapaLabel(item?.etapa)
					if (!mapa.has(etapa)) {
						const grupo = { etapa, items: [] }
						mapa.set(etapa, grupo)
						grupos.push(grupo)
					}
					mapa.get(etapa).items.push(item)
				})

				return grupos
			}

			const clienteEmpresa = getSafe(presupuesto.cliente_empresa)
			const clienteCuit = getSafe(presupuesto.cliente_cuit)
			const clienteIva = getSafe(presupuesto.cliente_iva)
			const clienteDireccion = getSafe(presupuesto.cliente_direccion)
			const clienteTelefono = getSafe(presupuesto.cliente_telefono)
			const proyectoPresupuesto = getSafe(presupuesto.proyecto || presupuesto.obra_nombre)
			const validezDiasNumero = Number(presupuesto.validez_dias)
			const validezTexto = Number.isFinite(validezDiasNumero) && validezDiasNumero > 0 ? `${validezDiasNumero} dias` : "-"

			const sectionHeader = (title, y) => {
				doc.font("Helvetica-Bold").fontSize(9.6).fillColor("#111")
				doc.text(String(title || "").toUpperCase(), left, y)
				doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, y + 12).lineTo(right, y + 12).stroke()
				return y + 19
			}

			const pageBottomLimit = doc.page.height - 98
			const drawSubtotalBand = ({ yStart, label, value }) => {
				let yBand = yStart
				if (yBand + 18 > pageBottomLimit) {
					doc.addPage()
					yBand = top + 2
				}

				doc.rect(left, yBand, width, 16).fillAndStroke("#efede8", lineColor)
				doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#111")
				doc.text(`${String(label)}: ${String(value)}`, left + 6, yBand + 4, {
					width: width - 12,
					align: "right",
					lineBreak: false,
				})

				return yBand + 22
			}

			const drawTable = ({ yStart, sectionTitle, columns, rows, rowHeight = 16, subtotalLabel = null, subtotalValue = null }) => {
				let y = yStart
				const baseRowHeight = rowHeight

				const getRowHeight = (row) => {
					let maxHeight = baseRowHeight
					columns.forEach((col, idx) => {
						doc.font("Helvetica").fontSize(8.6)
						const value = String(row[idx] ?? "-")
						const textHeight = doc.heightOfString(value, {
							width: col.width - 12,
							align: col.align || "left",
						})
						maxHeight = Math.max(maxHeight, Math.ceil(textHeight) + 8)
					})
					return maxHeight
				}

				const drawHeaderRow = () => {
					doc.rect(left, y, width, baseRowHeight).fillAndStroke("#f3f3f3", lineColor)
					let x = left
					columns.forEach((col, idx) => {
						doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111")
						doc.text(col.label, x + 6, y + 4, { width: col.width - 12, align: col.align || "left" })
						x += col.width
						if (idx < columns.length - 1) {
							doc.moveTo(x, y).lineTo(x, y + baseRowHeight).strokeColor(lineColor).lineWidth(0.6).stroke()
						}
					})
					y += baseRowHeight
				}

				drawHeaderRow()

				rows.forEach((row, rowIdx) => {
					const currentRowHeight = getRowHeight(row)
					if (y + currentRowHeight > pageBottomLimit) {
						doc.addPage()
						y = top + 2
						y = sectionHeader(sectionTitle, y)
						drawHeaderRow()
					}

					if (rowIdx % 2 === 0) {
						doc.rect(left, y, width, currentRowHeight).fill("#fbfbfb")
					}
					doc.rect(left, y, width, currentRowHeight).lineWidth(0.5).strokeColor("#6b6b6b").stroke()
					let cellX = left
					columns.forEach((col, idx) => {
						doc.font("Helvetica").fontSize(8.6).fillColor("#111")
						doc.text(String(row[idx] ?? "-"), cellX + 6, y + 4, {
							width: col.width - 12,
							align: col.align || "left",
							height: currentRowHeight - 8,
						})
						cellX += col.width
						if (idx < columns.length - 1) {
							doc.moveTo(cellX, y).lineTo(cellX, y + currentRowHeight).strokeColor("#808080").lineWidth(0.35).stroke()
						}
					})
					y += currentRowHeight
				})

				if (subtotalLabel !== null && subtotalValue !== null) {
					if (y + baseRowHeight > pageBottomLimit) {
						doc.addPage()
						y = top + 2
						y = sectionHeader(sectionTitle, y)
						drawHeaderRow()
					}

					doc.rect(left, y, width, baseRowHeight).fillAndStroke("#efede8", lineColor)
					doc.font("Helvetica-Bold").fontSize(8.7).fillColor("#111")
					const subtotalText = `${String(subtotalLabel)}: ${String(subtotalValue)}`
					doc.text(subtotalText, left + 6, y + 4, {
						width: width - 12,
						align: "right",
						lineBreak: false,
					})
					y += baseRowHeight
				}

				return y + 8
			}

			const logoToUse = existsSync(LOGO_PRESUPUESTO_PATH) ? LOGO_PRESUPUESTO_PATH : LOGO_PATH
			let y = top

			doc.strokeColor(lineColor).lineWidth(1).moveTo(left, y + 58).lineTo(right, y + 58).stroke()
			doc.strokeColor("#7a7a7a").lineWidth(0.6).moveTo(left, y + 62).lineTo(right, y + 62).stroke()
			doc.font("Helvetica-Bold").fontSize(isMaterialesMode ? 26 : 34).fillColor("#111")
			doc.text(isMaterialesMode ? "LISTADO DE MATERIALES" : "PRESUPUESTO", left, y + 19, { width, align: "center" })

			y += 74
			const blockGap = 12
			const blockW = (width - blockGap) / 2
			const blockH = 108
			const logoBandW = 82

			doc.rect(left, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
			if (existsSync(logoToUse)) {
				doc.image(logoToUse, left + blockW - logoBandW - 4, y + 20, { fit: [78, 56], align: "center", valign: "center" })
			}
			const empresaTextW = blockW - logoBandW - 14
			doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("EMPRESA", left + 8, y + 6)
			doc.font("Helvetica").fontSize(8.1).fillColor("#111")
			doc.text("Tesla Montajes Electricos", left + 8, y + 21, { width: empresaTextW, lineBreak: false })
			doc.text("CUIT: 30-71712557-2", left + 8, y + 34, { width: empresaTextW, lineBreak: false })
			doc.text("IVA: Responsable Inscripto", left + 8, y + 47, { width: empresaTextW, lineBreak: false })
			doc.text("Echeverria 197 - San Francisco (Cba.)", left + 8, y + 60, { width: empresaTextW, lineBreak: false })
			doc.text("teslamontajeselectricos@hotmail.com", left + 8, y + 73, { width: empresaTextW, lineBreak: false })
			doc.text("www.teslamontajeselectricos.com.ar", left + 8, y + 86, { width: empresaTextW, lineBreak: false })

			const rightBoxX = left + blockW + blockGap
			doc.rect(rightBoxX, y, blockW, blockH).lineWidth(0.8).strokeColor(lineColor).stroke()
			doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text("CLIENTE", rightBoxX + 8, y + 6)
			doc.font("Helvetica").fontSize(8.4)
			doc.text(`Empresa: ${clienteEmpresa}`, rightBoxX + 8, y + 21, { width: blockW - 16, lineBreak: false })
			doc.text(`CUIT: ${clienteCuit}`, rightBoxX + 8, y + 34, { width: blockW - 16, lineBreak: false })
			doc.text(`IVA: ${clienteIva}`, rightBoxX + 8, y + 47, { width: blockW - 16, lineBreak: false })
			doc.text(`Direccion: ${clienteDireccion}`, rightBoxX + 8, y + 60, { width: blockW - 16, lineBreak: false })
			doc.text(`Telefono: ${clienteTelefono}`, rightBoxX + 8, y + 73, { width: blockW - 16, lineBreak: false })

			y += blockH + 10
			const boxDatosH = 46
			doc.rect(left, y, width, boxDatosH).lineWidth(0.8).strokeColor(lineColor).stroke()
			doc.strokeColor("#d0d0d0").lineWidth(0.5).moveTo(left, y + 23).lineTo(right, y + 23).stroke()
			doc.font("Helvetica").fontSize(8.6).fillColor(muted)
			doc.text("Proyecto:", left + 8, y + 7)
			doc.text("Nro presupuesto", right - 164, y + 7, { width: 94, align: "left" })
			doc.text("Fecha:", left + 8, y + 30)
			doc.text("Validez", right - 164, y + 30, { width: 94, align: "left" })
			doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
			doc.text(String(proyectoPresupuesto), left + 58, y + 7, { width: width - 232, lineBreak: false })
			doc.text(String(presupuesto.numero || "-"), right - 70, y + 7, { width: 62, align: "right", lineBreak: false })
			doc.text(formatoFecha(presupuesto.fecha), left + 58, y + 30, { width: width - 232, lineBreak: false })
			doc.text(validezTexto, right - 70, y + 30, { width: 62, align: "right", lineBreak: false })

			y += boxDatosH + 12

			if (mostrarManoObraEnPdf) {
				y = sectionHeader("Detalle mano de obra", y)
				const gruposManoObra = agruparPorEtapa(itemsManoObra)
				const manoObraConEtapas = gruposManoObra.some((grupo) => grupo.etapa !== "General")
				const modoManoObraPdf = String(presupuesto.modo_mano_obra || "").trim() || (!manoObraTienePrecio ? "subtotal" : (manoObraTieneCantidad ? "cantidad" : "item"))

				const construirBloquesManoObra = (items = []) => {
					const bloques = []
					let index = 0

					while (index < items.length) {
						const actual = items[index]
						const cantidadBloque = Math.max(1, Number(actual?.cantidad || 1))
						const itemsBloque = items.slice(index, Math.min(items.length, index + cantidadBloque))
						const subtotalDirecto = Number(actual?.subtotal || 0)
						const subtotalBloque = subtotalDirecto > 0
							? subtotalDirecto
							: itemsBloque.reduce((acc, item) => acc + Number(item?.subtotal || 0), 0)

						bloques.push({
							items: itemsBloque,
							subtotal: subtotalBloque,
						})

						index += Math.max(1, cantidadBloque)
					}

					return bloques
				}

				if (modoManoObraPdf === "cantidad") {
					const bloques = construirBloquesManoObra(itemsManoObra)
					bloques.forEach((bloque, idx) => {
						y = sectionHeader(`Bloque ${idx + 1}`, y)
						const rowsBloque = bloque.items.map((item, itemIdx) => [`${itemIdx + 1}. ${item.descripcion || "-"}`])
						y = drawTable({
							yStart: y,
							sectionTitle: `Bloque ${idx + 1}`,
							columns: [{ label: "Descripcion", width }],
							rows: rowsBloque.length ? rowsBloque : [["Sin items"]],
							subtotalLabel: "Subtotal bloque",
							subtotalValue: formatoMoneda(Number(bloque.subtotal || 0)),
						})
					})
					y = drawSubtotalBand({
						yStart: y,
						label: "Subtotal mano de obra",
						value: formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)),
					})
				} else {
				const manoObraDetalle = modoManoObraPdf !== "subtotal" && manoObraTienePrecio
				const manoObraConCantidad = manoObraDetalle && modoManoObraPdf === "cantidad"

				const manoObraColumns = manoObraConCantidad
					? [
						{ label: "Descripcion", width: width - 290 },
						{ label: "Cant.", width: 60, align: "right" },
						{ label: "P. unitario", width: 115, align: "right" },
						{ label: "Subtotal", width: 115, align: "right" },
					]
					: manoObraDetalle
						? [
							{ label: "Descripcion", width: width - 115 },
							{ label: "Precio", width: 115, align: "right" },
						]
						: [{ label: "Descripcion", width }]

				const manoObraRowsFromItems = (items = []) => items.map((item, idx) => {
					const descripcion = `${idx + 1}. ${item.descripcion || "-"}`
					if (!manoObraDetalle) {
						return [descripcion]
					}
					const cantidad = Number(item.cantidad || 0)
					const precioUnitario = Number(item.precio_unitario || 0)
					const subtotal = Number(item.subtotal || 0)
					if (manoObraConCantidad) {
						return [descripcion, String(cantidad || 1), formatoMoneda(precioUnitario), formatoMoneda(subtotal)]
					}
					return [descripcion, formatoMoneda(precioUnitario)]
				})

				const manoObraEmptyRow = manoObraDetalle
					? (manoObraConCantidad ? [["Sin items", "0", formatoMoneda(0), formatoMoneda(0)]] : [["Sin items", formatoMoneda(0)]])
					: [["Sin items"]]

				const drawManoObraGrupo = (grupo) => {
					y = sectionHeader(grupo.etapa, y)
					const rowsGrupo = manoObraRowsFromItems(grupo.items)
					y = drawTable({
						yStart: y,
						sectionTitle: grupo.etapa,
						columns: manoObraColumns,
						rows: rowsGrupo.length ? rowsGrupo : manoObraEmptyRow,
					})
				}

				if (manoObraConEtapas) {
					gruposManoObra.forEach(drawManoObraGrupo)
					y = drawSubtotalBand({
						yStart: y,
						label: "Subtotal mano de obra",
						value: formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)),
					})
				} else {
					const manoRows = gruposManoObra.flatMap((grupo) => manoObraRowsFromItems(grupo.items))
					y = drawTable({
						yStart: y,
						sectionTitle: "Detalle mano de obra",
						columns: manoObraColumns,
						rows: manoRows.length ? manoRows : manoObraEmptyRow,
						subtotalLabel: "Subtotal mano de obra",
						subtotalValue: formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)),
					})
				}
				}
			}

			if (mostrarMaterialesEnPdf) {
				y = sectionHeader("Detalle materiales", y)
				const gruposMateriales = agruparPorEtapa(itemsMateriales)
				const materialesConEtapas = gruposMateriales.some((grupo) => grupo.etapa !== "General")

				if (materialesConEtapas) {
					gruposMateriales.forEach((grupo) => {
						y = sectionHeader(grupo.etapa, y)
						const rowsGrupo = grupo.items.map((item, idx) => (
							isMaterialesMode
								? [`${idx + 1}. ${item.descripcion || "-"}`, String(Number(item.cantidad || 0))]
								: [`${idx + 1}. ${item.descripcion || "-"}`, String(Number(item.cantidad || 0)), formatoMoneda(item.precio_unitario), formatoMoneda(item.subtotal)]
						))
						y = drawTable({
							yStart: y,
							sectionTitle: grupo.etapa,
							columns: isMaterialesMode
								? [
									{ label: "Descripcion", width: width - 58 },
									{ label: "Cant.", width: 58, align: "center" },
								]
								: [
									{ label: "Descripcion", width: width - 290 },
									{ label: "Cant.", width: 60, align: "right" },
									{ label: "P. unitario", width: 115, align: "right" },
									{ label: "Subtotal", width: 115, align: "right" },
								],
							rows: rowsGrupo.length
								? rowsGrupo
								: (isMaterialesMode
									? [["Sin items", "0"]]
									: [["Sin items", "0", formatoMoneda(0), formatoMoneda(0)]]),
						})
					})
					if (!isMaterialesMode) {
						y = drawSubtotalBand({
							yStart: y,
							label: "Subtotal materiales",
							value: formatoMoneda(Number(presupuesto.subtotal_materiales || 0)),
						})
					}
				} else {
					const materialRows = gruposMateriales.flatMap((grupo) =>
						grupo.items.map((item, idx) => (
							isMaterialesMode
								? [`${idx + 1}. ${item.descripcion || "-"}`, String(Number(item.cantidad || 0))]
								: [`${idx + 1}. ${item.descripcion || "-"}`, String(Number(item.cantidad || 0)), formatoMoneda(item.precio_unitario), formatoMoneda(item.subtotal)]
						))
					)
					y = drawTable({
						yStart: y,
						sectionTitle: "Detalle materiales",
						columns: isMaterialesMode
							? [
								{ label: "Descripcion", width: width - 58 },
								{ label: "Cant.", width: 58, align: "center" },
							]
							: [
								{ label: "Descripcion", width: width - 290 },
								{ label: "Cant.", width: 60, align: "right" },
								{ label: "P. unitario", width: 115, align: "right" },
								{ label: "Subtotal", width: 115, align: "right" },
							],
						rows: materialRows.length
							? materialRows
							: (isMaterialesMode
								? [["Sin items", "0"]]
								: [["Sin items", "0", formatoMoneda(0), formatoMoneda(0)]]),
						subtotalLabel: isMaterialesMode ? null : "Subtotal materiales",
						subtotalValue: isMaterialesMode ? null : formatoMoneda(Number(presupuesto.subtotal_materiales || 0)),
					})
				}
			}

			const ivaMonto = Number(presupuesto.iva_monto || 0)
			const totalGeneral = Number(presupuesto.total || 0)
			const summaryBoxH = 84
			const summaryLeftW = width - 182
			const observacionesTexto = sanitizeDescripcion(presupuesto.observaciones)

			if (!isMaterialesMode && infoInternaVisible.length > 0) {
				const infoHeaderH = 22
				const infoRowH = 15
				const infoBoxH = infoHeaderH + (infoInternaVisible.length * infoRowH) + 8

				if (y + infoBoxH + 24 > pageBottomLimit) {
					doc.addPage()
					y = top + 2
				}

				doc.rect(left, y, width, infoBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
				doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
				doc.text("Informacion interna", left + 8, y + 7)
				doc.strokeColor("#d0d0d0").lineWidth(0.5).moveTo(left + 8, y + infoHeaderH).lineTo(right - 8, y + infoHeaderH).stroke()
				doc.font("Helvetica").fontSize(8.4).fillColor("#111")

				let infoY = y + infoHeaderH + 4
				infoInternaVisible.forEach((linea) => {
					doc.text(`- ${linea}`, left + 10, infoY, { width: width - 20, lineBreak: false })
					infoY += infoRowH
				})

				y += infoBoxH + 8
			}

			if (!isMaterialesMode) {
				if (y + summaryBoxH + 24 > pageBottomLimit) {
					doc.addPage()
					y = top + 2
				}

				const ySummary = pageBottomLimit - summaryBoxH
				doc.rect(left, ySummary, summaryLeftW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
				doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#111")
				doc.text("Observaciones", left + 8, ySummary + 6)
				doc.font("Helvetica").fontSize(8.2).fillColor("#111")
				doc.text(observacionesTexto, left + 8, ySummary + 18, {
					width: summaryLeftW - 16,
					height: summaryBoxH - 24,
				})

				const sumX = left + summaryLeftW
				doc.rect(sumX, ySummary, width - summaryLeftW, summaryBoxH).lineWidth(0.8).strokeColor(lineColor).stroke()
				doc.font("Helvetica").fontSize(8.5).fillColor("#111")
				doc.text("Subtotal mano de obra", sumX + 8, ySummary + 8)
				doc.text(formatoMoneda(Number(presupuesto.subtotal_mano_obra || 0)), right - 8 - 80, ySummary + 8, { width: 80, align: "right" })
				doc.text("Subtotal materiales", sumX + 8, ySummary + 24)
				doc.text(formatoMoneda(Number(presupuesto.subtotal_materiales || 0)), right - 8 - 80, ySummary + 24, { width: 80, align: "right" })
				const aplicaIvaMaterialesPdf = Boolean(presupuesto.aplica_iva_materiales)
				const aplicaIvaManoObraPdf = Boolean(presupuesto.aplica_iva_mano_obra)
				let labelIva = `IVA ${Number(presupuesto.iva_porcentaje || 21)}%`
				if (aplicaIvaMaterialesPdf && aplicaIvaManoObraPdf) labelIva += " (Mat. + M.O.)"
				else if (aplicaIvaMaterialesPdf) labelIva += " (Mat.)"
				else if (aplicaIvaManoObraPdf) labelIva += " (M.O.)"
				else labelIva += " (No aplica)"
				doc.text(labelIva, sumX + 8, ySummary + 40)
				doc.text(formatoMoneda(ivaMonto), right - 8 - 80, ySummary + 40, { width: 80, align: "right" })

				doc.rect(sumX + 6, ySummary + 57, width - summaryLeftW - 12, 21).fillAndStroke("#1f1f1f", lineColor)
				doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#ffffff")
				doc.text("TOTAL", sumX + 12, ySummary + 64)
				doc.text(formatoMoneda(totalGeneral), right - 8 - 80, ySummary + 64, { width: 80, align: "right" })
				y = ySummary + summaryBoxH + 10
			}

			const footerTipo = isMaterialesMode ? "detalle materiales" : "presupuesto"
			const range = doc.bufferedPageRange()
			for (let i = 0; i < range.count; i += 1) {
				doc.switchToPage(i)
				doc.strokeColor(lineColor).lineWidth(0.8).moveTo(left, doc.page.height - 62).lineTo(right, doc.page.height - 62).stroke()
				doc.font("Helvetica").fontSize(7.8).fillColor(muted)
				doc.text(`Tesla Montajes Eléctricos - ${footerTipo}`, left, doc.page.height - 60)
				doc.text(`Pagina ${i + 1}`, left, doc.page.height - 60, { width, align: "right" })
			}

			doc.end()
		} catch (error) {
			reject(error)
		}
	})
}

const syncPresupuestoPdfStorage = async (presupuesto, previousPresupuesto = null, mode = "presupuesto") => {
	const folderPath = getPresupuestoPdfFolderPath(presupuesto, mode)
	const filePath = getPresupuestoPdfFilePath(presupuesto, mode)
	const buffer = await renderPresupuestoPdfBuffer(presupuesto, { mode })
	const previousPath = previousPresupuesto ? getPresupuestoPdfFilePath(previousPresupuesto, mode) : null

	await fs.mkdir(folderPath, { recursive: true })
	await fs.writeFile(filePath, buffer)

	if (previousPath && previousPath !== filePath && existsSync(previousPath)) {
		await fs.unlink(previousPath)
	}

	return { buffer, filePath }
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
			SELECT id, tipo_registro, porcentaje_avance, monto_base, indice_cac, indice_base_cac, indice_actual_cac, pagos
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
		const indiceBaseCac = Math.max(0, toNumber(row.indice_base_cac, 0))
		const indiceActualCac = Math.max(0, toNumber(row.indice_actual_cac, 0))
		const indiceCac = indiceBaseCac > 0 && indiceActualCac > 0
			? (indiceActualCac / indiceBaseCac)
			: (Math.max(0, toNumber(row.indice_cac, 1)) || 1)
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
					p.indice_cac_base_id,
					p.forma_pago,
					COALESCE(cert.cantidad_certificados, 0) AS cantidad_certificados,
					COALESCE(cert.total_certificado, 0) AS total_certificado,
					COALESCE(cert.total_certificado_con_iva, 0) AS total_certificado_con_iva,
					COALESCE(cert.total_pagado_certificados, 0) AS total_pagado_certificados,
					COALESCE(cert.tiene_pendientes, false) AS tiene_certificados_pendientes,
					COALESCE(NULLIF(TRIM(c.empresa), ''), c.razon_social) AS cliente,
					c.telefono AS cliente_telefono,
					o.nombre AS obra
				FROM presupuestos p
				INNER JOIN clientes c ON c.id = p.cliente_id
				LEFT JOIN obras o ON o.id = p.obra_id
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
			proyecto,
			fecha,
			validez_dias,
			forma_pago,
			observaciones,
			aplica_iva,
			aplica_iva_mano_obra,
			modo_mano_obra,
			iva_porcentaje,
			subtotal_general_mano_obra,
			items_materiales,
			items_mano_obra,
			mostrar_mano_obra_pdf,
			mostrar_materiales_pdf,
			info_interna_quien_hizo,
			info_interna_quien_hizo_pdf,
			info_interna_quien_aprobo,
			info_interna_quien_aprobo_pdf,
			items_info_interna,
			indice_cac_base_id,
		} = req.body || {}

		if (!cliente_id) {
			return res.status(400).json({ error: "cliente_id es obligatorio" })
		}

		const validacionRelacion = await validarClienteObraRelacion(client, cliente_id, obra_id || null)
		if (!validacionRelacion.ok) {
			return res.status(validacionRelacion.status).json({ error: validacionRelacion.error })
		}

		const subtotalGeneralManoObra = Math.max(0, toNumber(subtotal_general_mano_obra, 0))
		const materiales = normalizeItems(items_materiales, "material")
		const manoObra = normalizeItems(items_mano_obra, "mano_obra")
		const infoInternaItems = normalizeInfoInternaItems(items_info_interna)
		const infoInternaQuienHizo = sanitizeDescripcion(info_interna_quien_hizo)
		const infoInternaQuienAprobo = sanitizeDescripcion(info_interna_quien_aprobo)
		const proyectoPresupuesto = sanitizeDescripcion(proyecto)
		const indiceCacBaseId = indice_cac_base_id ? Number(indice_cac_base_id) : null

		if (materiales.length === 0 && manoObra.length === 0) {
			return res.status(400).json({ error: "Debe ingresar al menos un item" })
		}

		const ivaPorcentaje = toNumber(iva_porcentaje, 21)
		const aplicaIvaMateriales = Boolean(aplica_iva)
		const aplicaIvaManoObra = Boolean(aplica_iva_mano_obra)
		const { subtotalMateriales, subtotalManoObra, ivaMonto, total } = calcularTotales({
			materiales,
			manoObra,
			aplicaIvaMateriales,
			aplicaIvaManoObra,
			ivaPorcentaje,
			subtotalGeneralManoObra,
		})

		await client.query("BEGIN")

		const numero = await getNextNumero(client)

		const insertPresupuesto = await client.query(
			`
				INSERT INTO presupuestos (
					numero, cliente_id, obra_id, fecha, validez_dias, forma_pago, observaciones,
					subtotal_materiales, subtotal_mano_obra, aplica_iva_materiales, aplica_iva_mano_obra, iva_porcentaje, iva_monto, total,
					mostrar_mano_obra_pdf, mostrar_materiales_pdf,
					proyecto, info_interna_quien_hizo, info_interna_quien_hizo_pdf,
					info_interna_quien_aprobo, info_interna_quien_aprobo_pdf, indice_cac_base_id
				) VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
				RETURNING *
			`,
			[
				numero,
				validacionRelacion.clienteId,
				validacionRelacion.obraId,
				fecha || null,
				Number(validez_dias) || 15,
				forma_pago || "Contado",
				observaciones || "",
				subtotalMateriales,
				subtotalManoObra,
				aplicaIvaMateriales,
				aplicaIvaManoObra,
				ivaPorcentaje,
				ivaMonto,
				total,
				Boolean(mostrar_mano_obra_pdf ?? true),
				Boolean(mostrar_materiales_pdf ?? true),
				proyectoPresupuesto,
				infoInternaQuienHizo,
				Boolean(info_interna_quien_hizo_pdf),
				infoInternaQuienAprobo,
				Boolean(info_interna_quien_aprobo_pdf),
				indiceCacBaseId,
			]
		)

		const presupuesto = insertPresupuesto.rows[0]
		const allItems = [...materiales, ...manoObra]

		for (const item of allItems) {
			await client.query(
				`
					INSERT INTO presupuesto_items (
						presupuesto_id, tipo, orden, etapa, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				`,
				[
					presupuesto.id,
					item.tipo,
					item.orden,
					item.etapa,
					item.descripcion,
					item.cantidad,
					item.ganancia_porcentaje,
					item.precio_unitario,
					item.subtotal,
				]
			)
		}

		for (const item of infoInternaItems) {
			await client.query(
				`
					INSERT INTO presupuesto_info_interna_items (
						presupuesto_id, orden, descripcion, mostrar_en_pdf
					) VALUES ($1,$2,$3,$4)
				`,
				[
					presupuesto.id,
					item.orden,
					item.descripcion,
					item.mostrar_en_pdf,
				]
			)
		}

		await client.query("COMMIT")

		const completo = await getPresupuestoCompleto(presupuesto.id)
		try {
			const presupuestoPdf = { ...completo, modo_mano_obra: String(modo_mano_obra || "") }
			await syncPresupuestoPdfStorage(presupuestoPdf)
			await syncPresupuestoPdfStorage(presupuestoPdf, null, "materiales")
		} catch (storageError) {
			console.error("No se pudo guardar el PDF del presupuesto en disco", storageError)
		}
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
		const presupuestoPrevio = await getPresupuestoCompleto(presupuestoId)

		const {
			cliente_id,
			obra_id,
			proyecto,
			fecha,
			validez_dias,
			forma_pago,
			observaciones,
			aplica_iva,
			aplica_iva_mano_obra,
			modo_mano_obra,
			iva_porcentaje,
			subtotal_general_mano_obra,
			items_materiales,
			items_mano_obra,
			mostrar_mano_obra_pdf,
			mostrar_materiales_pdf,
			info_interna_quien_hizo,
			info_interna_quien_hizo_pdf,
			info_interna_quien_aprobo,
			info_interna_quien_aprobo_pdf,
			items_info_interna,
			indice_cac_base_id,
		} = req.body || {}

		if (!cliente_id) {
			return res.status(400).json({ error: "cliente_id es obligatorio" })
		}

		const validacionRelacion = await validarClienteObraRelacion(client, cliente_id, obra_id || null)
		if (!validacionRelacion.ok) {
			return res.status(validacionRelacion.status).json({ error: validacionRelacion.error })
		}

		const subtotalGeneralManoObra = Math.max(0, toNumber(subtotal_general_mano_obra, 0))
		const materiales = normalizeItems(items_materiales, "material")
		const manoObra = normalizeItems(items_mano_obra, "mano_obra")
		const infoInternaItems = normalizeInfoInternaItems(items_info_interna)
		const infoInternaQuienHizo = sanitizeDescripcion(info_interna_quien_hizo)
		const infoInternaQuienAprobo = sanitizeDescripcion(info_interna_quien_aprobo)
		const proyectoPresupuesto = sanitizeDescripcion(proyecto)
		const indiceCacBaseId = indice_cac_base_id ? Number(indice_cac_base_id) : null

		if (materiales.length === 0 && manoObra.length === 0) {
			return res.status(400).json({ error: "Debe ingresar al menos un item" })
		}

		const ivaPorcentaje = toNumber(iva_porcentaje, 21)
		const aplicaIvaMateriales = Boolean(aplica_iva)
		const aplicaIvaManoObra = Boolean(aplica_iva_mano_obra)
		const { subtotalMateriales, subtotalManoObra, ivaMonto, total } = calcularTotales({
			materiales,
			manoObra,
			aplicaIvaMateriales,
			aplicaIvaManoObra,
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
					aplica_iva_materiales = $9,
					aplica_iva_mano_obra = $10,
					iva_porcentaje = $11,
					iva_monto = $12,
					total = $13,
					mostrar_mano_obra_pdf = $14,
					mostrar_materiales_pdf = $15,
					info_interna_quien_hizo = $16,
					info_interna_quien_hizo_pdf = $17,
					info_interna_quien_aprobo = $18,
					info_interna_quien_aprobo_pdf = $19,
					proyecto = $20,
					indice_cac_base_id = $21
				WHERE id = $22
			`,
			[
				validacionRelacion.clienteId,
				validacionRelacion.obraId,
				fecha || null,
				Number(validez_dias) || 15,
				forma_pago || "Contado",
				observaciones || "",
				subtotalMateriales,
				subtotalManoObra,
				aplicaIvaMateriales,
				aplicaIvaManoObra,
				ivaPorcentaje,
				ivaMonto,
				total,
				Boolean(mostrar_mano_obra_pdf ?? true),
				Boolean(mostrar_materiales_pdf ?? true),
				infoInternaQuienHizo,
				Boolean(info_interna_quien_hizo_pdf),
				infoInternaQuienAprobo,
				Boolean(info_interna_quien_aprobo_pdf),
				proyectoPresupuesto,
				indiceCacBaseId,
				presupuestoId,
			]
		)

		await recalcularCertificadosPorPresupuesto(client, presupuestoId)

		await client.query(`DELETE FROM presupuesto_items WHERE presupuesto_id = $1`, [presupuestoId])
		await client.query(`DELETE FROM presupuesto_info_interna_items WHERE presupuesto_id = $1`, [presupuestoId])

		const allItems = [...materiales, ...manoObra]
		for (const item of allItems) {
			await client.query(
				`
					INSERT INTO presupuesto_items (
						presupuesto_id, tipo, orden, etapa, descripcion, cantidad, ganancia_porcentaje, precio_unitario, subtotal
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				`,
				[
					presupuestoId,
					item.tipo,
					item.orden,
					item.etapa,
					item.descripcion,
					item.cantidad,
					item.ganancia_porcentaje,
					item.precio_unitario,
					item.subtotal,
				]
			)
		}

		for (const item of infoInternaItems) {
			await client.query(
				`
					INSERT INTO presupuesto_info_interna_items (
						presupuesto_id, orden, descripcion, mostrar_en_pdf
					) VALUES ($1,$2,$3,$4)
				`,
				[
					presupuestoId,
					item.orden,
					item.descripcion,
					item.mostrar_en_pdf,
				]
			)
		}

		await client.query("COMMIT")

		const completo = await getPresupuestoCompleto(presupuestoId)
		try {
			const presupuestoPdf = { ...completo, modo_mano_obra: String(modo_mano_obra || "") }
			await syncPresupuestoPdfStorage(presupuestoPdf, presupuestoPrevio)
			await syncPresupuestoPdfStorage(presupuestoPdf, presupuestoPrevio, "materiales")
		} catch (storageError) {
			console.error("No se pudo actualizar el PDF del presupuesto en disco", storageError)
		}
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

		const presupuestoPrevio = await getPresupuestoCompleto(presupuestoId)

		const result = await pool.query(
			`DELETE FROM presupuestos WHERE id = $1 RETURNING id`,
			[presupuestoId]
		)

		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		if (presupuestoPrevio) {
			try {
				await removeStoredPresupuestoPdf(presupuestoPrevio) // This function now removes both types
			} catch (storageError) {
				console.error("No se pudo eliminar el PDF del presupuesto del disco", storageError)
			}
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

		const pdfMode = String(req.query?.tipo || "").toLowerCase() === "materiales" ? "materiales" : "presupuesto"
		const { buffer, filePath } = await syncPresupuestoPdfStorage(presupuesto, null, pdfMode)
		const nombreArchivo = getPresupuestoPdfFileName(presupuesto, pdfMode)

		console.log(`[Presupuestos] PDF ${pdfMode} guardado en: ${filePath}`)

		res.setHeader("Content-Type", "application/pdf")
		res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
		res.send(buffer)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

router.get("/:id/pdf-materiales", async (req, res) => {
	try {
		const presupuesto = await getPresupuestoCompleto(req.params.id)
		if (!presupuesto) {
			return res.status(404).json({ error: "Presupuesto no encontrado" })
		}

		const { buffer, filePath } = await syncPresupuestoPdfStorage(presupuesto, null, "materiales")
		const nombreArchivo = getPresupuestoPdfFileName(presupuesto, "materiales")

		console.log(`[Presupuestos] PDF materiales guardado en: ${filePath}`)

		res.setHeader("Content-Type", "application/pdf")
		res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo}"`)
		res.send(buffer)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
