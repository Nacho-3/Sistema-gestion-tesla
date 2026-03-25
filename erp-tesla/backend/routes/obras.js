import express from "express"
import db from "../db.js"
import { getIo } from '../socket.js'

const router = express.Router()

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
    res.status(500).json({ error: err.message })
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
    res.status(500).json({ error: err.message })
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
    res.status(500).json({ error: err.message })
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
    res.status(500).json({ error: err.message })
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
    res.status(500).json({ error: err.message })
  }
})

export default router
