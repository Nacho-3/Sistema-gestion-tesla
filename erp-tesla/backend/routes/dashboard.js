import express from "express"
import db from "../db.js"
import { getPeriodo, syncLiquidacionesPeriodo } from "./liquidaciones.js"

const router = express.Router()

const withTimeout = async (promise, ms = 1000) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

const CAJAS_DISPONIBLES = ["tesla", "teslita", "juani"]

const toNumber = (value) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

router.get("/resumen", async (req, res) => {
  try {
    const now = new Date()
    const mes = Number(req.query.mes || now.getMonth() + 1)
    const anio = Number(req.query.anio || now.getFullYear())
    const { inicioISO, finISO } = getPeriodo(mes, anio)

    await withTimeout(syncLiquidacionesPeriodo(mes, anio), 1000)

    const finExclusive = new Date(finISO)
    finExclusive.setDate(finExclusive.getDate() + 1)
    const finExclusiveISO = finExclusive.toISOString().split("T")[0]

    const [obrasRes, horasRes, liquidacionesRes, cajaRes, presupuestosRes] = await Promise.all([
      db.query(
        `
          SELECT COUNT(*)::int AS total
          FROM obras o
          LEFT JOIN grupos g ON g.id = o.grupo_id
          WHERE COALESCE(o.activo, true) = true
            AND o.estado = 'activa'
            AND o.nombre !~* 'admin'
            AND COALESCE(g.nombre, '') !~* 'admin'
        `
      ),
      db.query(
        `
          SELECT COALESCE(SUM(COALESCE(cantidad_horas, horas_trabajadas, 0)), 0) AS total
          FROM horas
          WHERE fecha >= $1 AND fecha <= $2
        `,
        [inicioISO, finISO]
      ),
      db.query(
        `
          SELECT
            l.id,
            COALESCE(l.monto_neto, 0) AS total,
            COALESCE(SUM(p.monto), 0) AS total_pagado
          FROM liquidaciones l
          LEFT JOIN pagos_sueldo p ON p.liquidacion_id = l.id
          WHERE l.periodo_inicio >= $1 AND l.periodo_fin <= $2
          GROUP BY l.id, l.monto_neto
        `,
        [inicioISO, finISO]
      ),
      db.query(
        `
          SELECT 
            id, 
            fecha, 
            tipo, 
            detalle, 
            COALESCE(monto_total, 0) AS monto_total,
            caja_codigo
          FROM movimientos_caja
          WHERE fecha >= $1 AND fecha < $2
          ORDER BY fecha DESC, id DESC
        `,
        [inicioISO, finExclusiveISO]
      ),
      db.query(
        `
          SELECT p.id, p.numero, p.fecha, p.total, c.razon_social AS cliente
          FROM presupuestos p
          INNER JOIN clientes c ON c.id = p.cliente_id
          WHERE p.estado = 'pendiente'
          ORDER BY p.created_at DESC
          LIMIT 5
        `
      ),
    ])

    const obrasActivas = Number(obrasRes.rows[0]?.total || 0)
    const horasMes = toNumber(horasRes.rows[0]?.total)
    const sueldosMes = liquidacionesRes.rows.reduce((sum, liq) => {
      return sum + Math.max(0, toNumber(liq.total) - toNumber(liq.total_pagado))
    }, 0)

    const cajaMovimientos = (cajaRes.rows || []).map((mov) => ({
      ...mov,
      monto_total: toNumber(mov.monto_total),
      caja_codigo: mov.caja_codigo,
    }))


    const cajasMes = CAJAS_DISPONIBLES.reduce((acc, codigo) => {
      acc[codigo] = {
        ingresos: 0,
        egresos: 0,
        saldo: 0,
      }
      return acc
    }, {})

    cajaMovimientos.forEach((mov) => {
      const codigo = CAJAS_DISPONIBLES.includes(String(mov.caja_codigo || "").toLowerCase())
        ? String(mov.caja_codigo || "").toLowerCase()
        : "tesla, teslita, juani"
      if (mov.tipo === "ingreso") {
        cajasMes[codigo].ingresos += toNumber(mov.monto_total)
      } else if (mov.tipo === "egreso") {
        cajasMes[codigo].egresos += toNumber(mov.monto_total)
      }
    })

    CAJAS_DISPONIBLES.forEach((codigo) => {
      cajasMes[codigo].ingresos = Math.round(cajasMes[codigo].ingresos * 100) / 100
      cajasMes[codigo].egresos = Math.round(cajasMes[codigo].egresos * 100) / 100
      cajasMes[codigo].saldo = Math.round((cajasMes[codigo].ingresos - cajasMes[codigo].egresos) * 100) / 100
    })

    const ingresosMes = cajaMovimientos
      .filter((mov) => mov.tipo === "ingreso")
      .reduce((sum, mov) => sum + toNumber(mov.monto_total), 0)

    const egresosMes = cajaMovimientos
      .filter((mov) => mov.tipo === "egreso")
      .reduce((sum, mov) => sum + toNumber(mov.monto_total), 0)

    res.json({
      obras_activas: obrasActivas,
      horas_mes: horasMes,
      sueldos_mes: Math.round(sueldosMes * 100) / 100,
      ingresos_mes: Math.round(ingresosMes * 100) / 100,
      egresos_mes: Math.round(egresosMes * 100) / 100,
      cajas_mes: cajasMes,
      ultimos_movimientos: cajaMovimientos.slice(0, 5),
      presupuestos_pendientes: (presupuestosRes.rows || []).map((item) => ({
        ...item,
        total: toNumber(item.total),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router