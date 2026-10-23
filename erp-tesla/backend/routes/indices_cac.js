import express from "express"
import { pool } from "../db.js"

const router = express.Router()

const toNumber = (value, fallback = 0) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

const toIsoDate = (value) => {
	if (!value) return null
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString().slice(0, 10)
	}
	const texto = String(value).trim()
	const match = texto.match(/^(\d{4}-\d{2}-\d{2})/)
	if (match) return match[1]
	const parsed = new Date(texto)
	if (Number.isNaN(parsed.getTime())) return null
	return parsed.toISOString().slice(0, 10)
}

const MESES_NOMBRE = [
	["septiembre", "09"],
	["setiembre", "09"],
	["diciembre", "12"],
	["noviembre", "11"],
	["febrero", "02"],
	["octubre", "10"],
	["agosto", "08"],
	["enero", "01"],
	["marzo", "03"],
	["abril", "04"],
	["junio", "06"],
	["julio", "07"],
	["mayo", "05"],
]

const MESES_ABREV = [
	["sept", "09"],
	["sep", "09"],
	["set", "09"],
	["ene", "01"],
	["feb", "02"],
	["mar", "03"],
	["abr", "04"],
	["may", "05"],
	["jun", "06"],
	["jul", "07"],
	["ago", "08"],
	["oct", "10"],
	["nov", "11"],
	["dic", "12"],
]

const mapIndice = (row) => ({
	id: Number(row.id),
	periodo: String(row.periodo || ""),
	valor: toNumber(row.valor),
	fecha_publicacion: toIsoDate(row.fecha_publicacion),
	notas: String(row.notas || ""),
	created_at: row.created_at,
	updated_at: row.updated_at,
})

const claveOrdenPeriodo = (periodo) => {
	const texto = String(periodo || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
	const anio = texto.match(/(19|20)\d{2}/)?.[0] || "0000"
	const mesNombre = MESES_NOMBRE.find(([mes]) => texto.includes(mes))
	if (mesNombre) return `${anio}-${mesNombre[1]}`
	const mesAbrev = MESES_ABREV.find(([mes]) => new RegExp(`(^|[^a-z])${mes}([^a-z]|$)`).test(texto))
	return `${anio}-${mesAbrev ? mesAbrev[1] : "00"}`
}

const claveOrdenIndice = (indice) => {
	const periodo = claveOrdenPeriodo(indice.periodo)
	if (periodo !== "0000-00") return `${periodo}-01`
	return toIsoDate(indice.fecha_publicacion) || "0000-00-00"
}

const ordenarIndices = (lista) =>
	[...lista].sort((a, b) => {
		const clave = claveOrdenIndice(b).localeCompare(claveOrdenIndice(a))
		if (clave !== 0) return clave
		return Number(b.id || 0) - Number(a.id || 0)
	})

// GET / - Listar todos los índices CAC ordenados por fecha/periodo
router.get("/", async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT
				id,
				periodo,
				valor,
				to_char(fecha_publicacion, 'YYYY-MM-DD') AS fecha_publicacion,
				notas,
				created_at,
				updated_at
			FROM indices_cac
			ORDER BY fecha_publicacion DESC NULLS LAST, periodo DESC, id DESC
		`)
		res.json(ordenarIndices(result.rows.map(mapIndice)))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// POST / - Crear un nuevo índice CAC
router.post("/", async (req, res) => {
	try {
		const periodo = String(req.body.periodo || "").trim()
		const valor = toNumber(req.body.valor, 0)
		const fechaPublicacion = toIsoDate(req.body.fecha_publicacion)
		const notas = String(req.body.notas || "").trim()

		if (!periodo) {
			return res.status(400).json({ error: "El campo periodo es obligatorio" })
		}
		if (valor <= 0) {
			return res.status(400).json({ error: "El valor del índice debe ser mayor a 0" })
		}

		const result = await pool.query(
			`INSERT INTO indices_cac (periodo, valor, fecha_publicacion, notas)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
			[periodo, valor, fechaPublicacion, notas]
		)
		res.status(201).json(mapIndice(result.rows[0]))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// PUT /:id - Actualizar un índice CAC
router.put("/:id", async (req, res) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id) || id <= 0) {
			return res.status(400).json({ error: "ID inválido" })
		}

		const periodo = String(req.body.periodo || "").trim()
		const valor = toNumber(req.body.valor, 0)
		const fechaPublicacion = toIsoDate(req.body.fecha_publicacion)
		const notas = String(req.body.notas || "").trim()

		if (!periodo) {
			return res.status(400).json({ error: "El campo periodo es obligatorio" })
		}
		if (valor <= 0) {
			return res.status(400).json({ error: "El valor del índice debe ser mayor a 0" })
		}

		const result = await pool.query(
			`UPDATE indices_cac
			 SET periodo = $2, valor = $3, fecha_publicacion = $4, notas = $5, updated_at = NOW()
			 WHERE id = $1
			 RETURNING *`,
			[id, periodo, valor, fechaPublicacion, notas]
		)
		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Índice no encontrado" })
		}
		res.json(mapIndice(result.rows[0]))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// DELETE /:id - Eliminar un índice CAC
router.delete("/:id", async (req, res) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id) || id <= 0) {
			return res.status(400).json({ error: "ID inválido" })
		}

		// Verificar si está referenciado por algún presupuesto
		const refCheck = await pool.query(
			`SELECT COUNT(*) FROM presupuestos WHERE indice_cac_base_id = $1`,
			[id]
		)
		if (Number(refCheck.rows[0].count) > 0) {
			return res.status(409).json({ error: "No se puede eliminar: el índice está asociado a uno o más presupuestos" })
		}

		const result = await pool.query(`DELETE FROM indices_cac WHERE id = $1`, [id])
		if (result.rowCount === 0) {
			return res.status(404).json({ error: "Índice no encontrado" })
		}
		res.json({ ok: true })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

export default router
