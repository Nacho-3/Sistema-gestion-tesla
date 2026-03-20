import express from "express"
import db from "../db.js"
import { getIo } from '../socket.js'

const router = express.Router()

// Listar todos los grupos activos
router.get("/", async (req, res) => {
  try {
    const { data, error } = await db
      .from("grupos")
      .select("*")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Resumen de un grupo: empleados, obras activas, total horas
router.get("/:id/resumen", async (req, res) => {
  try {
    const { id } = req.params
    const grupoIdInt = parseInt(id)

    const [resGrupo, resEmpleados, resObras] = await Promise.all([
      db.from("grupos").select("*").eq("id", grupoIdInt).single(),
      db.from("empleados").select("*").eq("grupo_id", grupoIdInt).eq("activo", true).order("apellido", { ascending: true }),
      db.from("obras").select("*").eq("grupo_id", grupoIdInt).order("created_at", { ascending: false })
    ])

    if (resGrupo.error) return res.status(404).json({ error: "Grupo no encontrado" })

    const empleados = resEmpleados.data || []
    const obras = resObras.data || []
    const obrasActivas = obras.filter(o => o.estado === "activa")
    const obrasFinalizadas = obras.filter(o => o.estado !== "activa")

    // Total horas del grupo (SELECT * + suma en JS para tolerar variaciones de columna)
    let totalHoras = 0
    if (empleados.length > 0) {
      const empIds = empleados.map(e => e.id)
      const placeholders = empIds.map((_, i) => `$${i + 1}`).join(",")
      const { pool } = await import("../db.js")
      const resHoras = await pool.query(
        `SELECT * FROM horas WHERE empleado_id IN (${placeholders})`,
        empIds
      )
      const getHs = (r) => r.cantidad_horas ?? r.cantidad_hora ?? r.horas ?? r.cantidad ?? 0
      totalHoras = resHoras.rows.reduce((sum, r) => sum + Number(getHs(r)), 0)
    }

    res.json({
      grupo: resGrupo.data,
      empleados,
      obras,
      resumen: {
        totalEmpleados: empleados.length,
        totalObras: obras.length,
        obrasActivas: obrasActivas.length,
        obrasFinalizadas: obrasFinalizadas.length,
        totalHoras
      }
    })
  } catch (err) {
    console.error("Error en resumen de grupo:", err)
    res.status(500).json({ error: err.message })
  }
})

// Crear grupo
router.post("/", async (req, res) => {
  try {
    const { nombre, descripcion } = req.body
    if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" })

    const { data, error } = await db
      .from("grupos")
      .insert([{ nombre, descripcion: descripcion || "", activo: true }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('grupos:changed')
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar grupo
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, descripcion } = req.body

    const { data, error } = await db
      .from("grupos")
      .update({ nombre, descripcion })
      .eq("id", id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('grupos:changed')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
