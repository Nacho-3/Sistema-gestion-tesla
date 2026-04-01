import db from "../db.js"

const roundMoney = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

const parseObservacionesData = (observacionesRaw) => {
  const raw = String(observacionesRaw || "").trim()
  if (!raw) return { nota: "", meta: {} }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && parsed.__liquidacion_meta === true && typeof parsed === "object") {
      return { nota: String(parsed.nota || ""), meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {} }
    }
  } catch {}
  return { nota: raw, meta: {} }
}

const getConceptosFromLiquidacion = (liq = {}, valorHora = 0) => {
  const { meta } = parseObservacionesData(liq?.observaciones)
  const prefer = (col, m, fallback = 0) => {
    const hasCol = col !== undefined && col !== null && col !== ""
    const hasMeta = m !== undefined && m !== null && m !== ""
    if (hasCol) {
      const coln = roundMoney(col)
      const metn = hasMeta ? roundMoney(m) : null
      if (coln === 0 && hasMeta && metn !== 0) return metn
      return coln
    }
    if (hasMeta) return roundMoney(m)
    return roundMoney(fallback)
  }

  const presentismo = prefer(liq.presentismo, meta.presentismo)
  const noRem = prefer(liq.no_remunerativo, meta.no_remunerativo)
  const aguinaldo = prefer(liq.aguinaldo, meta.aguinaldo)
  const vacaciones = prefer(liq.vacaciones, meta.vacaciones)
  const adelantos = prefer(liq.adelantos, meta.adelantos, liq?.descuentos)
  const horasExtra = prefer(liq.horas_extra_cantidad, meta.horas_extra_cantidad)
  const horasExtra100 = prefer(liq.horas_extra_100_cantidad, meta.horas_extra_100_cantidad)
  const feriados = prefer(liq.feriados_cantidad, meta.feriados_cantidad)
  const diasNo = prefer(liq.dias_no_trabajados, meta.dias_no_trabajados)
  const adicional = prefer(liq.adicional, meta.adicional)

  const importeHorasExtra = roundMoney(horasExtra * valorHora * 1.5)
  const importeHorasExtra100 = roundMoney(horasExtra100 * valorHora * 2)
  const importeFeriados = roundMoney(feriados * 8 * valorHora)
  const descuentoDias = roundMoney(diasNo * 8 * valorHora)

  return {
    presentismo,
    no_remunerativo: noRem,
    aguinaldo,
    vacaciones,
    adelantos,
    horas_extra_cantidad: horasExtra,
    horas_extra_100_cantidad: horasExtra100,
    feriados_cantidad: feriados,
    dias_no_trabajados: diasNo,
    importe_horas_extra: importeHorasExtra,
    importe_horas_extra_100: importeHorasExtra100,
    importe_feriados: importeFeriados,
    descuento_dias_no_trabajados: descuentoDias,
    adicional,
  }
}

const recompute = async (id) => {
  const { data: liq, error } = await db.from("liquidaciones").select("*").eq("id", id).single()
  if (error || !liq) {
    console.error("No se encontró liquidación id=", id, error?.message)
    process.exit(1)
  }

  // get pagos total
  const { data: pagos } = await db.from("pagos_sueldo").select("monto").eq("liquidacion_id", id)
  const totalPagado = (pagos || []).reduce((s, p) => s + Number(p.monto || 0), 0)

  const periodo = liq?.periodo_inicio ? new Date(liq.periodo_inicio) : null
  const totalHoras = Number(liq?.total_horas || 0)
  const importeHoras = Number(liq?.monto_bruto || 0)
  const valorHora = totalHoras > 0 ? importeHoras / totalHoras : 0

  const conceptos = getConceptosFromLiquidacion(liq, valorHora)

  const totalCalculado = roundMoney(
    importeHoras +
      conceptos.presentismo +
      conceptos.no_remunerativo +
      conceptos.aguinaldo +
      conceptos.vacaciones +
      conceptos.importe_horas_extra +
      conceptos.importe_horas_extra_100 +
      conceptos.importe_feriados +
      conceptos.adicional -
      conceptos.adelantos -
      conceptos.descuento_dias_no_trabajados
  )

  const montoNeto = Number(liq?.monto_neto ?? totalCalculado)
  // If monto_neto differs from computed, update it to computed total (preserve if user used base_manual?)
  const nuevoMonto = roundMoney(totalCalculado)

  const estado = totalPagado >= nuevoMonto ? "pagada" : "pendiente"

  // sanitize observaciones: remove adicional from meta if exists
  const obs = parseObservacionesData(liq.observaciones)
  if (obs.meta && obs.meta.adicional !== undefined) delete obs.meta.adicional
  const observacionesActualizadas = JSON.stringify({ __liquidacion_meta: true, nota: obs.nota || "", meta: obs.meta || {} })

  const updates = {
    presentismo: conceptos.presentismo,
    importe_horas_extra: conceptos.importe_horas_extra,
    importe_horas_extra_100: conceptos.importe_horas_extra_100,
    no_remunerativo: conceptos.no_remunerativo,
    aguinaldo: conceptos.aguinaldo,
    vacaciones: conceptos.vacaciones,
    feriados_cantidad: conceptos.feriados_cantidad,
    importe_feriados: conceptos.importe_feriados,
    dias_no_trabajados: conceptos.dias_no_trabajados,
    descuento_dias_no_trabajados: conceptos.descuento_dias_no_trabajados,
    adelantos: conceptos.adelantos,
    adicional: conceptos.adicional,
    monto_neto: nuevoMonto,
    estado,
    observaciones: observacionesActualizadas,
  }

  const { error: upErr } = await db.from("liquidaciones").update(updates).eq("id", id)
  if (upErr) {
    console.error("Error actualizando liquidación:", upErr.message)
    process.exit(1)
  }

  console.log(`Liquidación ${id} actualizada: monto_neto=${nuevoMonto}, adicional=${conceptos.adicional}, total_pagado=${totalPagado}, estado=${estado}`)
  process.exit(0)
}

const idArg = process.argv[2]
if (!idArg) {
  console.error("Uso: node recompute_liquidacion.js <id>")
  process.exit(1)
}

recompute(Number(idArg)).catch((e) => { console.error(e); process.exit(1) })
