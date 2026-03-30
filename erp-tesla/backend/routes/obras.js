import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'

const router = express.Router()

const handleInternalError = (res, err, context) => {
  console.error(`[obras] ${context}:`, err)
  return res.status(500).json({
    error: "Error interno del servidor",
    context,
  })
}

const ADMIN_REGEX = /admin/i

// Listar todas las obras (opcionalmente filtrar por estado)
router.get("/", async (req, res) => {
  try {
    const { estado } = req.query
    let query = db.from("obras").select("*").order("created_at", { ascending: false })
    if (estado) query = query.eq("estado", estado)

    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })

    // Filtrar obras administrativas
    const { data: grupos } = await db.from("grupos").select("id, nombre")
    const gruposMap = new Map((grupos || []).map((g) => [g.id, g]))
    const obrasVisibles = (data || []).filter((o) => {
      if (ADMIN_REGEX.test(String(o.nombre || ""))) return false
      const grupo = gruposMap.get(o.grupo_id)
      return !ADMIN_REGEX.test(String(grupo?.nombre || ""))
    })

    res.json(obrasVisibles)
  } catch (err) {
    return handleInternalError(res, err, "listar_obras")
  }
})

// Obtener una obra por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db
      .from("obras")
      .select("*")
      .eq("id", id)
      .single()

    if (error) return res.status(404).json({ error: "Obra no encontrada" })
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "obtener_obra")
  }
})

// Crear obra
router.post("/", async (req, res) => {
  try {
    const { nombre, cliente_id, grupo_id, fecha_inicio } = req.body

    if (!nombre || !cliente_id || !grupo_id) {
      return res.status(400).json({
        error: "Nombre, cliente y grupo son obligatorios"
      })
    }

    const { data, error } = await db
      .from("obras")
      .insert([
        {
          nombre,
          cliente_id,
          grupo_id,
          fecha_inicio,
          estado: "activa"
        }
      ])
      .select("*")
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('obras:changed')
    res.status(201).json(data)
  } catch (err) {
    return handleInternalError(res, err, "crear_obra")
  }
})

// Actualizar obra
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, cliente_id, grupo_id, estado, fecha_inicio } = req.body

    const { data, error } = await db
      .from("obras")
      .update({ nombre, cliente_id, grupo_id, estado, fecha_inicio })
      .eq("id", id)
      .select("*")
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('obras:changed')
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "actualizar_obra")
  }
})

// Cambiar estado de obra (activa/cerrada)
router.patch("/:id/estado", async (req, res) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    if (!["activa", "finalizada", "cerrada"].includes(estado)) {
      return res.status(400).json({
        error: "Estado inválido"
      })
    }

    const { data, error } = await db
      .from("obras")
      .update({ estado })
      .eq("id", id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('obras:changed')
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "actualizar_estado_obra")
  }
})

// Eliminar obra (solo si no tiene movimientos asociados)
router.delete("/:id", async (req, res) => {
  try {
    const obraId = Number(req.params.id)
    if (!Number.isInteger(obraId) || obraId <= 0) {
      return res.status(400).json({ error: "ID de obra invalido" })
    }

    const obraResult = await pool.query(
      `SELECT id, nombre FROM obras WHERE id = $1 LIMIT 1`,
      [obraId]
    )

    if (obraResult.rowCount === 0) {
      return res.status(404).json({ error: "Obra no encontrada" })
    }

    const [horasRes, presupuestosRes, cajaRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM horas WHERE obra_id = $1`, [obraId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM presupuestos WHERE obra_id = $1`, [obraId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM movimientos_caja WHERE presupuesto_id IN (SELECT id FROM presupuestos WHERE obra_id = $1)`, [obraId]),
    ])

    const horasCount = Number(horasRes.rows[0]?.c || 0)
    const presupuestosCount = Number(presupuestosRes.rows[0]?.c || 0)
    const cajaCount = Number(cajaRes.rows[0]?.c || 0)

    if (horasCount > 0 || presupuestosCount > 0 || cajaCount > 0) {
      return res.status(409).json({
        error: "No se puede eliminar la obra porque tiene datos asociados (horas, presupuestos o caja).",
        detalle: {
          horas: horasCount,
          presupuestos: presupuestosCount,
          movimientos_caja_relacionados: cajaCount,
        },
      })
    }

    const { data, error } = await db
      .from("obras")
      .delete()
      .eq("id", obraId)
      .select("id, nombre")
      .single()

    if (error) return res.status(400).json({ error: error.message })

    getIo()?.emit('obras:changed')
    res.json({ mensaje: "Obra eliminada", data })
  } catch (err) {
    return handleInternalError(res, err, "eliminar_obra")
  }
})

export default router
