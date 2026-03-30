import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'

const router = express.Router()
const TIPOS_EMPLEADO_VALIDOS = ["monotributista", "empleado_dependiente", "no_corresponde"]

const normalizeTipoEmpleado = (tipo) => (
  TIPOS_EMPLEADO_VALIDOS.includes(tipo) ? tipo : null
)

const normalizeValorHora = (valorHora, fallback = 0) => {
  if (valorHora === null || valorHora === undefined || valorHora === "") return fallback
  const valor = Number(valorHora)
  return Number.isFinite(valor) && valor >= 0 ? valor : fallback
}

const handleInternalError = (res, err, context) => {
  console.error(`[empleados] ${context}:`, err)
  return res.status(500).json({
    error: "Error interno del servidor",
    context,
  })
}

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
    return handleInternalError(res, err, "listar_empleados")
  }
})

// Crear nuevo empleado
router.post("/", async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      dni,
      cuit,
      fecha_nacimiento,
      direccion,
      telefono,
      tipo,
      alias,
      grupo_id,
      valor_hora,
    } = req.body

    const nombreFinal = String(nombre || "").trim() || "Sin nombre"
    const apellidoFinal = String(apellido || "").trim() || "Sin apellido"
    const dniFinal = String(dni || "").trim() || `TEMP-${Date.now()}`
    const tipoFinal = normalizeTipoEmpleado(tipo)
    const valorHoraFinal = normalizeValorHora(valor_hora, 0)
    const grupoIdFinal = Number.isInteger(Number(grupo_id)) && Number(grupo_id) > 0
      ? Number(grupo_id)
      : null

    if (!grupoIdFinal) {
      return res.status(400).json({ error: "grupo_id es obligatorio para asignar el empleado" })
    }

    // Verificar que el DNI no exista
    const { data: existente } = await db
      .from("empleados")
      .select("id")
      .eq("dni", dniFinal)
      .eq("activo", true)
    
    if (existente && existente.length > 0) {
      return res.status(400).json({ error: "Este DNI ya existe" })
    }

    // Verificar que el CUIT no exista
    if (cuit) {
      const { data: cuitExistente } = await db
        .from("empleados")
        .select("id")
        .eq("cuit", cuit)
        .eq("activo", true)

      if (cuitExistente && cuitExistente.length > 0) {
        return res.status(400).json({ error: "Este CUIT ya existe" })
      }
    }

    const { data, error } = await db
      .from("empleados")
      .insert([
        {
          nombre: nombreFinal,
          apellido: apellidoFinal,
          dni: dniFinal,
          cuit,
          fecha_nacimiento,
          direccion,
          telefono,
          tipo: tipoFinal,
          alias,
          grupo_id: grupoIdFinal,
          valor_hora: valorHoraFinal,
          activo: true
        }
      ])
      .select()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('empleados:changed')
    res.status(201).json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "crear_empleado")
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
    return handleInternalError(res, err, "obtener_empleado")
  }
})

// Actualizar empleado
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const {
      nombre,
      apellido,
      dni,
      cuit,
      fecha_nacimiento,
      direccion,
      telefono,
      tipo,
      alias,
      grupo_id,
      valor_hora,
    } = req.body

    const actualizaciones = {}
    if (nombre !== undefined) actualizaciones.nombre = nombre
    if (apellido !== undefined) actualizaciones.apellido = apellido
    if (grupo_id !== undefined) actualizaciones.grupo_id = grupo_id
    if (valor_hora !== undefined) actualizaciones.valor_hora = normalizeValorHora(valor_hora, 0)
    if (fecha_nacimiento !== undefined) actualizaciones.fecha_nacimiento = fecha_nacimiento
    if (direccion !== undefined) actualizaciones.direccion = direccion
    if (telefono !== undefined) actualizaciones.telefono = telefono
    if (alias !== undefined) actualizaciones.alias = alias

    if (tipo !== undefined) {
      if (!TIPOS_EMPLEADO_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: "Tipo inválido. Valores permitidos: monotributista, empleado_dependiente, no_corresponde" })
      }
      actualizaciones.tipo = tipo
    }

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

    // Validar CUIT si se actualiza
    if (cuit !== undefined) {
      const { data: cuitExistente } = await db
        .from("empleados")
        .select("id")
        .eq("cuit", cuit)
        .neq("id", id)

      if (cuitExistente && cuitExistente.length > 0) {
        return res.status(400).json({ error: "Este CUIT ya existe" })
      }
      actualizaciones.cuit = cuit
    }

    const { data, error } = await db
      .from("empleados")
      .update(actualizaciones)
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Empleado no encontrado" })

    getIo()?.emit('empleados:changed')
    res.json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "actualizar_empleado")
  }
})

// Eliminar empleado
// Si tiene datos asociados, se realiza una baja lógica para preservar el historial.
router.delete("/:id", async (req, res) => {
  try {
    const empleadoId = Number(req.params.id)
    if (!Number.isInteger(empleadoId) || empleadoId <= 0) {
      return res.status(400).json({ error: "ID de empleado invalido" })
    }

    const empleadoRes = await pool.query(
      `SELECT id, nombre, apellido FROM empleados WHERE id = $1 LIMIT 1`,
      [empleadoId]
    )

    if (empleadoRes.rowCount === 0) {
      return res.status(404).json({ error: "Empleado no encontrado" })
    }

    const [horasRes, liqRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c FROM horas WHERE empleado_id = $1`, [empleadoId]),
      pool.query(`SELECT COUNT(*)::int AS c FROM liquidaciones WHERE empleado_id = $1`, [empleadoId]),
    ])

    const horasCount = Number(horasRes.rows[0]?.c || 0)
    const liqCount = Number(liqRes.rows[0]?.c || 0)

    if (horasCount > 0 || liqCount > 0) {
      const desactivarRes = await pool.query(
        `UPDATE empleados
         SET activo = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, nombre, apellido, activo`,
        [empleadoId]
      )

      getIo()?.emit('empleados:changed')
      return res.json({
        ok: true,
        action: "deactivated",
        message: "El empleado tenía datos asociados y fue dado de baja para preservar el historial.",
        data: desactivarRes.rows[0],
        detalle: {
          horas: horasCount,
          liquidaciones: liqCount,
        },
      })
    }

    const { data, error } = await db
      .from("empleados")
      .delete()
      .eq("id", empleadoId)
      .select("id, nombre, apellido")

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Empleado no encontrado" })

    getIo()?.emit('empleados:changed')
    res.json({ mensaje: "Empleado eliminado", data: data[0] })
  } catch (err) {
    return handleInternalError(res, err, "eliminar_empleado")
  }
})

// Actualizar valor hora de un empleado
router.put("/:id/tarifa", async (req, res) => {
  try {
    const { valor_hora } = req.body
    const { id } = req.params
    const valorHoraNormalizado = normalizeValorHora(valor_hora, null)

    if (valorHoraNormalizado === null) {
      return res.status(400).json({ error: "Valor de hora inválido" })
    }

    const { data, error } = await db
      .from("empleados")
      .update({ valor_hora: valorHoraNormalizado })
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('empleados:changed')
    res.json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "actualizar_tarifa")
  }
})

export default router
