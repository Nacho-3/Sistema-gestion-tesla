import express from "express"
import { pool } from "../db.js"

const router = express.Router()

const toNumber = (value, fallback = 0) => {
	const n = Number(value)
	return Number.isFinite(n) ? n : fallback
}

const mapIndice = (row) => ({
	id: Number(row.id),
	periodo: String(row.periodo || ""),
	valor: toNumber(row.valor),
	fecha_publicacion: row.fecha_publicacion ? String(row.fecha_publicacion).slice(0, 10) : null,
	notas: String(row.notas || ""),
	created_at: row.created_at,
	updated_at: row.updated_at,
})

// GET / - Listar todos los índices CAC ordenados por fecha/periodo
router.get("/", async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT * FROM indices_cac
			ORDER BY fecha_publicacion DESC NULLS LAST, id DESC
		`)
		res.json(result.rows.map(mapIndice))
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// POST / - Crear un nuevo índice CAC
router.post("/", async (req, res) => {
	try {
		const periodo = String(req.body.periodo || "").trim()
		const valor = toNumber(req.body.valor, 0)
		const fechaPublicacion = req.body.fecha_publicacion || null
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
			[periodo, valor, fechaPublicacion || null, notas]
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
		const fechaPublicacion = req.body.fecha_publicacion || null
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
			[id, periodo, valor, fechaPublicacion || null, notas]
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
