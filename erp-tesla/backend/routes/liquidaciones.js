import express from "express"
import db from "../db.js"

const router = express.Router()

const getPeriodo = (mes, anio) => {
  const mesInt = parseInt(mes)
  const anioInt = parseInt(anio)
  const inicio = new Date(anioInt, mesInt - 1, 1)
  const fin = new Date(anioInt, mesInt, 0)
  return {
    mesInt,
    anioInt,
    inicioISO: inicio.toISOString().split("T")[0],
    finISO: fin.toISOString().split("T")[0],
  }
}

const mapLiquidacion = (liq, totalPagado = 0) => {
  const periodo = liq?.periodo_inicio ? new Date(liq.periodo_inicio) : null
  const mes = periodo ? periodo.getMonth() + 1 : null
  const anio = periodo ? periodo.getFullYear() : null
  const total = Number(liq?.monto_neto ?? 0)
  const importeHoras = Number(liq?.monto_bruto ?? 0)
  const totalHoras = Number(liq?.total_horas ?? 0)
  const valorHora = totalHoras > 0 ? importeHoras / totalHoras : 0
  const descuentos = Number(liq?.descuentos ?? 0)
  const estado = totalPagado >= total ? "pagada" : "pendiente"

  return {
    ...liq,
    mes,
    anio,
    valor_hora: valorHora,
    importe_horas: importeHoras,
    importe_horas_extra: 0,
    no_remunerativo: 0,
    aguinaldo: 0,
    vacaciones: 0,
    adelantos: descuentos,
    total,
    total_pagado: totalPagado,
    estado,
    observaciones: liq?.observaciones || "",
  }
}

const getCantidadHoras = (registro = {}) => {
  const valor =
    registro.cantidad_horas ??
    registro.horas_trabajadas ??
    registro.cantidad_hora ??
    registro.horas ??
    0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const syncLiquidacionesPeriodo = async (mes, anio) => {
  try {
    if (!mes || !anio) return

    const { inicioISO, finISO } = getPeriodo(mes, anio)

    const [{ data: empleados }, { data: horasPeriodo }, { data: existentes }] = await Promise.all([
      db.from("empleados").select("id, valor_hora").eq("activo", true),
      db.from("horas").select("*").gte("fecha", inicioISO).lte("fecha", finISO),
      db.from("liquidaciones").select("*").eq("periodo_inicio", inicioISO).eq("periodo_fin", finISO),
    ])

    const empleadosData = empleados || []
    const horasData = horasPeriodo || []
    const liquidaciones = [...(existentes || [])]

    const horasPorEmpleado = {}
    for (const h of horasData) {
      if (!horasPorEmpleado[h.empleado_id]) horasPorEmpleado[h.empleado_id] = 0
      horasPorEmpleado[h.empleado_id] += getCantidadHoras(h)
    }

    const byEmpleado = new Map(liquidaciones.map((l) => [l.empleado_id, l]))

    for (const emp of empleadosData) {
      if (!byEmpleado.has(emp.id)) {
        const { data: creada } = await db
          .from("liquidaciones")
          .insert([
            {
              empleado_id: emp.id,
              periodo_inicio: inicioISO,
              periodo_fin: finISO,
              total_horas: 0,
              monto_bruto: 0,
              descuentos: 0,
              monto_neto: 0,
              estado: "pendiente",
              observaciones: "",
            },
          ])
          .select()
        if (creada?.[0]) {
          byEmpleado.set(emp.id, creada[0])
          liquidaciones.push(creada[0])
        }
      }
    }

    const liquidacionIds = liquidaciones.map((l) => l.id)
    let pagosPorLiquidacion = {}

    if (liquidacionIds.length > 0) {
      const { data: pagos } = await db
        .from("pagos_sueldo")
        .select("liquidacion_id, monto")

      for (const p of pagos || []) {
        if (!liquidacionIds.includes(p.liquidacion_id)) continue
        if (!pagosPorLiquidacion[p.liquidacion_id]) pagosPorLiquidacion[p.liquidacion_id] = 0
        pagosPorLiquidacion[p.liquidacion_id] += Number(p.monto || 0)
      }
    }

    for (const emp of empleadosData) {
      const liq = byEmpleado.get(emp.id)
      if (!liq) continue

      const totalHoras = Number(horasPorEmpleado[emp.id] || 0)
      const valorHora = Number(emp.valor_hora || 0)
      const montoBruto = totalHoras * valorHora
      const descuentos = Number(liq.descuentos || 0)
      const montoNeto = Math.max(0, montoBruto - descuentos)
      const totalPagado = Number(pagosPorLiquidacion[liq.id] || 0)
      const estado = totalPagado >= montoNeto ? "pagada" : "pendiente"

      await db
        .from("liquidaciones")
        .update({
          total_horas: totalHoras,
          monto_bruto: montoBruto,
          monto_neto: montoNeto,
          estado,
        })
        .eq("id", liq.id)
    }
  } catch (err) {
    console.error("⚠️ Error sincronizando liquidaciones del período:", err.message)
  }
}

const withTimeout = async (promise, ms = 5000) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

// Obtener liquidaciones (con filtros opcionales)
router.get("/", async (req, res) => {
  try {
    const { mes, anio, empleado_id } = req.query
    console.log("📋 GET liquidaciones con filtros:", { mes, anio, empleado_id })
    
    let query = db.from("liquidaciones").select("*")

    if (mes && anio) {
      await withTimeout(syncLiquidacionesPeriodo(mes, anio), 5000)
      const { inicioISO, finISO } = getPeriodo(mes, anio)
      query = query.gte("periodo_inicio", inicioISO).lte("periodo_fin", finISO)
    }
    if (empleado_id) query = query.eq("empleado_id", empleado_id)

    const { data, error } = await query.order("created_at", { ascending: false })

    if (error) {
      console.error("❌ Error al obtener liquidaciones:", error)
      return res.status(400).json({ error: error.message })
    }
    
    // Calcular total pagado para cada liquidación
    const liquidacionesConEstado = await Promise.all(
      (data || []).map(async (liq) => {
        const { data: pagos } = await db
          .from("pagos_sueldo")
          .select("monto")
          .eq("liquidacion_id", liq.id)
        
        const totalPagado = pagos ? pagos.reduce((sum, p) => sum + (p.monto || 0), 0) : 0
        return mapLiquidacion(liq, totalPagado)
      })
    )
    
    console.log(`✅ ${liquidacionesConEstado?.length || 0} liquidaciones encontradas`)
    res.json(liquidacionesConEstado)
  } catch (err) {
    console.error("❌ Error en try-catch GET liquidaciones:", err)
    res.status(500).json({ error: err.message })
  }
})

// Obtener liquidación por ID
router.get("/:id", async (req, res) => {
  try {
    const { data: liq, error } = await db
      .from("liquidaciones")
      .select("*")
      .eq("id", req.params.id)
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const { data: pagos } = await db
      .from("pagos_sueldo")
      .select("monto")
      .eq("liquidacion_id", req.params.id)

    const totalPagado = pagos ? pagos.reduce((sum, p) => sum + (p.monto || 0), 0) : 0
    res.json(mapLiquidacion(liq, totalPagado))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear liquidación (calcula automáticamente total_horas e importe_horas)
router.post("/", async (req, res) => {
  try {
    const { empleado_id, mes, anio } = req.body
    
    console.log("📝 Creando liquidación:", { empleado_id, mes, anio })
    
    // Validar datos de entrada
    if (!empleado_id || !mes || !anio) {
      return res.status(400).json({ error: "Faltan parámetros requeridos" })
    }

    const { inicioISO, finISO } = getPeriodo(mes, anio)

    // Validar que no exista liquidación para este empleado en este período
    const { data: existente, error: existError } = await db
      .from("liquidaciones")
      .select("id")
      .eq("empleado_id", empleado_id)
      .eq("periodo_inicio", inicioISO)
      .eq("periodo_fin", finISO)

    if (existError) {
      console.error("❌ Error al verificar liquidación existente:", existError)
      return res.status(400).json({ error: existError.message })
    }

    if (existente && existente.length > 0) {
      return res.status(200).json(mapLiquidacion(existente[0], 0))
    }

    // Obtener datos del empleado
    const { data: empleados, error: empError } = await db
      .from("empleados")
      .select("id, valor_hora, nombre, apellido, activo")
      .eq("activo", true)
    
    if (empError) {
      console.error("❌ Error obteniendo empleados:", empError)
      return res.status(400).json({ error: `Error al obtener empleados: ${empError.message}` })
    }
    
    console.log("📊 Todos los empleados activos:", empleados)
    console.log("🔍 Buscando empleado_id:", empleado_id, "Tipo:", typeof empleado_id)

    const empleado = empleados?.find(e => e.id === empleado_id)
    
    if (!empleado) {
      console.log("❌ Empleado no encontrado. IDs en BD:", empleados?.map(e => e.id))
      return res.status(400).json({ error: `Empleado con ID ${empleado_id} no encontrado` })
    }
    
    if (!empleado.valor_hora || empleado.valor_hora <= 0) {
      return res.status(400).json({ error: `El empleado ${empleado.nombre} ${empleado.apellido} no tiene tarifa configurada` })
    }

    console.log("✅ Empleado encontrado:", empleado)

    // Calcular total de horas del mes (incluye horas prestadas)
    const fechaInicio = inicioISO
    const fechaFin = finISO

    const { data: horas, error: horasError } = await db
      .from("horas")
      .select("cantidad_horas")
      .eq("empleado_id", empleado_id)
      .gte("fecha", fechaInicio)
      .lte("fecha", fechaFin)

    if (horasError) {
      console.error("❌ Error al obtener horas:", horasError)
    }

    const total_horas = horas ? horas.reduce((sum, h) => sum + Number(h.cantidad_horas || 0), 0) : 0
    const importe_horas = total_horas * empleado.valor_hora

    console.log("💰 Cálculos:", { total_horas, valor_hora: empleado.valor_hora, importe_horas, horas_encontradas: horas?.length })

    // Crear liquidación
    const { data, error } = await db.from("liquidaciones").insert([
      {
        empleado_id,
        periodo_inicio: fechaInicio,
        periodo_fin: fechaFin,
        total_horas,
        monto_bruto: importe_horas,
        descuentos: 0,
        monto_neto: importe_horas,
        estado: "pendiente"
      }
    ]).select()

    if (error) {
      console.error("❌ Error al insertar liquidación:", error)
      return res.status(400).json({ error: `Error de BD: ${error.message}` })
    }

    console.log("✅ Liquidación creada:", data)
    const creada = Array.isArray(data) ? data[0] : data
    res.status(201).json(mapLiquidacion(creada, 0))
  } catch (err) {
    console.error("❌ Error en try-catch:", err)
    res.status(500).json({ error: `Error del servidor: ${err.message}` })
  }
})

// Actualizar liquidación (conceptos manuales y total)
router.put("/:id", async (req, res) => {
  try {
    const { importe_horas_extra, no_remunerativo, aguinaldo, vacaciones, adelantos, observaciones } = req.body

    // Obtener liquidación actual para recalcular total
    const { data: liquidacion } = await db
      .from("liquidaciones")
      .select("monto_bruto")
      .eq("id", req.params.id)
      .single()

    if (!liquidacion) return res.status(400).json({ error: "Liquidación no encontrada" })

    // Calcular total
    const total =
      Number(liquidacion.monto_bruto || 0) +
      (importe_horas_extra || 0) +
      (no_remunerativo || 0) +
      (aguinaldo || 0) +
      (vacaciones || 0) -
      (adelantos || 0)

    const { data: updatedRows, error } = await db
      .from("liquidaciones")
      .update({
        descuentos: adelantos || 0,
        monto_neto: total,
        estado: "pendiente",
        observaciones: observaciones || ""
      })
      .eq("id", req.params.id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    res.json({
      ...mapLiquidacion(updatedRows[0], 0),
      importe_horas_extra: importe_horas_extra || 0,
      no_remunerativo: no_remunerativo || 0,
      aguinaldo: aguinaldo || 0,
      vacaciones: vacaciones || 0,
      adelantos: adelantos || 0,
      total,
      observaciones: observaciones || "",
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar liquidación (y sus pagos asociados)
router.delete("/:id", async (req, res) => {
  try {
    const liquidacionId = req.params.id
    
    console.log("🗑️  Eliminando liquidación:", liquidacionId)
    
    // Primero, eliminar todos los pagos asociados
    const { error: errorPagos } = await db
      .from("pagos_sueldo")
      .delete()
      .eq("liquidacion_id", liquidacionId)
    
    if (errorPagos) {
      console.error("❌ Error al eliminar pagos:", errorPagos)
      return res.status(400).json({ error: `Error al eliminar pagos: ${errorPagos.message}` })
    }
    
    console.log("✅ Pagos eliminados")
    
    // Luego, eliminar la liquidación
    const { error } = await db
      .from("liquidaciones")
      .delete()
      .eq("id", liquidacionId)

    if (error) {
      console.error("❌ Error al eliminar liquidación:", error)
      return res.status(400).json({ error: error.message })
    }
    
    console.log("✅ Liquidación eliminada")
    res.json({ message: "Liquidación y sus pagos eliminados correctamente" })
  } catch (err) {
    console.error("❌ Error en try-catch DELETE:", err)
    res.status(500).json({ error: err.message })
  }
})

// ========== PAGOS DE LIQUIDACIONES ==========

// Obtener pagos de una liquidación
router.get("/:liquidacion_id/pagos", async (req, res) => {
  try {
    const { data: pagosRaw, error } = await db
      .from("pagos_sueldo")
      .select("*")
      .eq("liquidacion_id", req.params.liquidacion_id)
      .order("fecha_pago", { ascending: false })

    if (error) return res.status(400).json({ error: error.message })

    const pagos = (pagosRaw || []).map((p) => ({
      ...p,
      fecha: p.fecha_pago || (p.created_at ? new Date(p.created_at).toISOString().split("T")[0] : null),
    }))
    res.json(pagos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear pago de liquidación
router.post("/:liquidacion_id/pagos", async (req, res) => {
  try {
    const { monto, medio_pago, fecha } = req.body
    const liquidacion_id = req.params.liquidacion_id

    // Validar que el monto no exceda el adeudado
    const { data: liquidacion } = await db
      .from("liquidaciones")
      .select("monto_neto")
      .eq("id", liquidacion_id)
      .single()

    if (!liquidacion) return res.status(400).json({ error: "Liquidación no encontrada" })

    // Obtener total pagado hasta ahora
    const { data: pagosExistentes } = await db
      .from("pagos_sueldo")
      .select("monto")
      .eq("liquidacion_id", liquidacion_id)

    const totalPagado = pagosExistentes ? pagosExistentes.reduce((sum, p) => sum + (p.monto || 0), 0) : 0
    const aDeudarse = Number(liquidacion.monto_neto || 0) - totalPagado

    if (monto > aDeudarse) {
      return res.status(400).json({
        error: `Monto excede lo adeudado. A deudarse: ${aDeudarse}`
      })
    }

    // Crear pago
    const { data, error } = await db
      .from("pagos_sueldo")
      .insert([
        {
          liquidacion_id,
          monto,
          medio_pago,
          fecha_pago: fecha || new Date().toISOString().split("T")[0]
        }
      ])
      .select()

    if (error) return res.status(400).json({ error: error.message })

    res.status(201).json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar pago
router.delete("/pagos/:id", async (req, res) => {
  try {
    const { error } = await db.from("pagos_sueldo").delete().eq("id", req.params.id)

    if (error) return res.status(400).json({ error: error.message })

    res.json({ message: "Pago eliminado" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
