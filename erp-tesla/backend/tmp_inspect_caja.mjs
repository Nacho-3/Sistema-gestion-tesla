import { pool } from "./db.js"

try {
  const semanas = await pool.query(`
    select id, caja_codigo, fecha_inicio, fecha_fin, saldo_inicial, saldo_final, estado
    from cajas_semanales
    where caja_codigo = 'juani'
    order by fecha_inicio asc, id asc
  `)
  console.log("SEMANAS_JUANI")
  console.table(semanas.rows)

  const movimientos = await pool.query(`
    select
      m.id,
      m.fecha,
      m.tipo,
      m.monto_total,
      m.caja_semanal_id,
      coalesce(
        json_agg(
          json_build_object(
            'medio_pago', d.medio_pago,
            'monto', d.monto,
            'identificador', d.identificador
          )
        ) filter (where d.id is not null),
        '[]'::json
      ) as detalles
    from movimientos_caja m
    left join detalles_medio_pago d on d.movimiento_id = m.id
    where m.caja_codigo = 'juani'
      and m.fecha >= '2026-04-01'
      and m.fecha <= '2026-04-30'
    group by m.id, m.fecha, m.tipo, m.monto_total, m.caja_semanal_id
    order by m.fecha asc, m.id asc
  `)
  console.log("MOVIMIENTOS_JUANI_ABRIL")
  console.table(movimientos.rows.map((row) => ({
    ...row,
    detalles: JSON.stringify(row.detalles),
  })))
} catch (err) {
  console.error(err)
} finally {
  await pool.end()
}
