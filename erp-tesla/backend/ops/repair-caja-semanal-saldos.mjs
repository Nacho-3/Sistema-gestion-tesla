import { pool } from "../db.js"

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100

const normalizarFechaISO = (valor) => {
  if (!valor) return null
  const texto = String(valor).split("T")[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto
  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const getRangoSemana = (fechaValor) => {
  const fechaIso = normalizarFechaISO(fechaValor)
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split("-").map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  const diaSemana = fecha.getDay()
  const offsetLunes = diaSemana === 0 ? -6 : 1 - diaSemana
  const inicio = new Date(fecha)
  inicio.setDate(fecha.getDate() + offsetLunes)
  const fin = new Date(inicio)
  fin.setDate(inicio.getDate() + 4)
  const toIso = (value) => {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, "0")
    const d = String(value.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return { fecha_inicio: toIso(inicio), fecha_fin: toIso(fin) }
}

const normalizarDetalles = (detalles) => {
  if (!Array.isArray(detalles)) return []
  return detalles.map((item) => ({
    medio_pago: String(item.medio_pago || "").toLowerCase(),
    monto: Number(item.monto || 0),
  }))
}

const actualizarSaldoPorMedio = (acumulador, movimiento) => {
  const signo = String(movimiento?.tipo || "").toLowerCase() === "egreso" ? -1 : 1
  const detalles = normalizarDetalles(movimiento?.detalles_medio_pago)
  let montoAplicado = 0

  detalles.forEach((detalle) => {
    if (!(detalle.monto > 0)) return
    if (detalle.medio_pago === "efectivo") {
      acumulador.efectivo += signo * detalle.monto
      montoAplicado += detalle.monto
    }
    if (detalle.medio_pago === "cheque") {
      acumulador.cheques += signo * detalle.monto
      montoAplicado += detalle.monto
    }
  })

  if (detalles.length === 0 && !(montoAplicado > 0)) {
    acumulador.efectivo += signo * Number(movimiento?.monto_total || 0)
  }
}

try {
  await pool.query("BEGIN")

  const semanasResult = await pool.query(`
    select id, caja_codigo, fecha_inicio, fecha_fin, estado
    from cajas_semanales
    order by caja_codigo asc, fecha_inicio asc, id asc
  `)

  const grouped = new Map()
  for (const semana of semanasResult.rows) {
    const start = normalizarFechaISO(semana.fecha_inicio)
    const key = `${semana.caja_codigo}-${start}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(semana)
  }

  for (const semanas of grouped.values()) {
    if (semanas.length <= 1) continue

    const canonical = [...semanas].sort((a, b) => {
      const finA = normalizarFechaISO(a.fecha_fin) || "9999-12-31"
      const finB = normalizarFechaISO(b.fecha_fin) || "9999-12-31"
      if (finA !== finB) return finA.localeCompare(finB)
      if (String(a.estado) !== String(b.estado)) return String(a.estado) === "abierta" ? -1 : 1
      return Number(a.id) - Number(b.id)
    })[0]

    const rangoEsperado = getRangoSemana(canonical.fecha_inicio)
    if (rangoEsperado && normalizarFechaISO(canonical.fecha_fin) !== rangoEsperado.fecha_fin) {
      await pool.query(
        "update cajas_semanales set fecha_fin = $1 where id = $2",
        [rangoEsperado.fecha_fin, canonical.id]
      )
    }

    for (const duplicada of semanas) {
      if (Number(duplicada.id) === Number(canonical.id)) continue
      await pool.query(
        "update movimientos_caja set caja_semanal_id = $1 where caja_semanal_id = $2",
        [canonical.id, duplicada.id]
      )
      await pool.query("delete from cajas_semanales where id = $1", [duplicada.id])
    }
  }

  const semanasLimpias = await pool.query(`
    select id, caja_codigo, fecha_inicio, fecha_fin
    from cajas_semanales
    order by caja_codigo asc, fecha_inicio asc, id asc
  `)

  const movimientos = await pool.query(`
    select
      m.id,
      m.caja_codigo,
      m.caja_semanal_id,
      m.fecha,
      m.tipo,
      m.monto_total,
      coalesce(
        json_agg(
          json_build_object(
            'medio_pago', d.medio_pago,
            'monto', d.monto
          )
        ) filter (where d.id is not null),
        '[]'::json
      ) as detalles_medio_pago
    from movimientos_caja m
    left join detalles_medio_pago d on d.movimiento_id = m.id
    group by m.id, m.caja_codigo, m.caja_semanal_id, m.fecha, m.tipo, m.monto_total
    order by m.caja_codigo asc, m.fecha asc, m.id asc
  `)

  const movimientosPorSemana = new Map()
  for (const movimiento of movimientos.rows) {
    const key = Number(movimiento.caja_semanal_id)
    if (!key) continue
    if (!movimientosPorSemana.has(key)) movimientosPorSemana.set(key, [])
    movimientosPorSemana.get(key).push(movimiento)
  }

  const semanasPorCaja = new Map()
  for (const semana of semanasLimpias.rows) {
    if (!semanasPorCaja.has(semana.caja_codigo)) semanasPorCaja.set(semana.caja_codigo, [])
    semanasPorCaja.get(semana.caja_codigo).push(semana)
  }

  for (const semanas of semanasPorCaja.values()) {
    const saldo = { efectivo: 0, cheques: 0 }
    const ordenadas = [...semanas].sort((a, b) => {
      const inicioA = normalizarFechaISO(a.fecha_inicio) || ""
      const inicioB = normalizarFechaISO(b.fecha_inicio) || ""
      if (inicioA !== inicioB) return inicioA.localeCompare(inicioB)
      return Number(a.id) - Number(b.id)
    })

    for (const semana of ordenadas) {
      const movimientosSemana = (movimientosPorSemana.get(Number(semana.id)) || []).sort((a, b) => {
        const fechaA = normalizarFechaISO(a.fecha) || ""
        const fechaB = normalizarFechaISO(b.fecha) || ""
        if (fechaA !== fechaB) return fechaA.localeCompare(fechaB)
        return Number(a.id) - Number(b.id)
      })

      const saldoInicial = roundMoney(saldo.efectivo + saldo.cheques)
      const totalIngresos = roundMoney(
        movimientosSemana
          .filter((mov) => String(mov.tipo) === "ingreso")
          .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0)
      )
      const totalEgresos = roundMoney(
        movimientosSemana
          .filter((mov) => String(mov.tipo) === "egreso")
          .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0)
      )

      movimientosSemana.forEach((movimiento) => actualizarSaldoPorMedio(saldo, movimiento))
      const saldoFinal = roundMoney(saldo.efectivo + saldo.cheques)

      await pool.query(
        `update cajas_semanales
         set saldo_inicial = $1,
             total_ingresos = $2,
             total_egresos = $3,
             saldo_final = $4
         where id = $5`,
        [saldoInicial, totalIngresos, totalEgresos, saldoFinal, semana.id]
      )
    }
  }

  await pool.query("COMMIT")
  console.log("Repair completed successfully")
} catch (error) {
  await pool.query("ROLLBACK")
  console.error(error)
  process.exitCode = 1
} finally {
  await pool.end()
}