import express from "express"
import db from "../db.js"

const router = express.Router()

// Listar todos los empleados activos
router.get("/", async (req, res) => {
  try {
    const { data, error } = await db
      .from("empleados")
      .select("*")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear nuevo empleado
router.post("/", async (req, res) => {
  try {
    const { nombre, apellido, dni, grupo_id, valor_hora } = req.body

    // Validar campos requeridos
    if (!nombre || !apellido || !dni || !grupo_id) {
      return res.status(400).json({ error: "Campos requeridos: nombre, apellido, dni, grupo_id" })
    }

    if (!valor_hora || valor_hora <= 0) {
      return res.status(400).json({ error: "Valor de hora debe ser mayor a 0" })
    }

    // Verificar que el DNI no exista
    const { data: existente } = await db
      .from("empleados")
      .select("id")
      .eq("dni", dni)
      .eq("activo", true)
    
    if (existente && existente.length > 0) {
      return res.status(400).json({ error: "Este DNI ya existe" })
    }

    const { data, error } = await db
      .from("empleados")
      .insert([
        {
          nombre,
          apellido,
          dni,
          grupo_id,
          valor_hora,
          activo: true
        }
      ])
      .select()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Obtener empleado por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Obtener solo el empleado, sin queries adicionales
    const { data, error } = await db
      .from("empleados")
      .select("*")
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Empleado no encontrado" })

    // Retornar empleado con resumen simplificado
    res.json({
      ...data,
      resumen: {
        totalHoras: 0,
        horasPrestadas: 0,
        liquidacionesPendientes: 0,
        liquidacionesPagadas: 0
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar empleado
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, apellido, dni, grupo_id, valor_hora } = req.body

    const actualizaciones = {}
    if (nombre !== undefined) actualizaciones.nombre = nombre
    if (apellido !== undefined) actualizaciones.apellido = apellido
    if (grupo_id !== undefined) actualizaciones.grupo_id = grupo_id
    if (valor_hora !== undefined) actualizaciones.valor_hora = valor_hora

    // Validar DNI si se actualiza
    if (dni !== undefined) {
      const { data: existente } = await db
        .from("empleados")
        .select("id")
        .eq("dni", dni)
        .neq("id", id)

      if (existente && existente.length > 0) {
        return res.status(400).json({ error: "Este DNI ya existe" })
      }
      actualizaciones.dni = dni
    }

    const { data, error } = await db
      .from("empleados")
      .update(actualizaciones)
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Empleado no encontrado" })

    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar empleado (soft delete)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await db
      .from("empleados")
      .update({ activo: false })
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Empleado no encontrado" })

    res.json({ mensaje: "Empleado eliminado", data: data[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar valor hora de un empleado
router.put("/:id/tarifa", async (req, res) => {
  try {
    const { valor_hora } = req.body
    const { id } = req.params

    if (!valor_hora || valor_hora <= 0) {
      return res.status(400).json({ error: "Valor de hora inválido" })
    }

    const { data, error } = await db
      .from("empleados")
      .update({ valor_hora })
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
