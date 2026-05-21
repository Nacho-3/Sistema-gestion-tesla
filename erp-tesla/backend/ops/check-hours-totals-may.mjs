import { pool } from "../db.js"

async function run() {
  const resumenQuery = `
    WITH base AS (
      SELECT
        h.id,
        h.empleado_id,
        COALESCE(e.nombre || ' ' || e.apellido, 'Empleado ' || h.empleado_id::text) AS empleado,
        h.fecha,
        h.cantidad_horas::numeric AS cantidad_horas,
        ROUND((h.cantidad_horas::numeric) * 60)::int AS minutos_totales,
        (ROUND((h.cantidad_horas::numeric) * 60)::int % 60) AS minutos_clock
      FROM horas h
      LEFT JOIN empleados e ON e.id = h.empleado_id
      WHERE h.fecha >= DATE '2026-05-01'
        AND h.fecha < DATE '2026-06-01'
    ),
    resumen AS (
      SELECT
        empleado_id,
        MIN(empleado) AS empleado,
        ROUND(SUM(cantidad_horas), 2) AS total_decimal,
        ROUND(SUM(cantidad_horas) * 60)::int AS total_minutos_desde_suma_decimal,
        SUM(ROUND(cantidad_horas * 60)::int)::int AS total_minutos_suma_filas,
        COUNT(*) FILTER (WHERE (minutos_clock % 5) <> 0) AS registros_minutos_no_mult_5
      FROM base
      GROUP BY empleado_id
    )
    SELECT
      empleado_id,
      empleado,
      total_decimal,
      FLOOR(total_minutos_desde_suma_decimal / 60.0)::int AS total_horas_desde_suma_decimal,
      (total_minutos_desde_suma_decimal % 60) AS total_minutos_restantes_desde_suma_decimal,
      FLOOR(total_minutos_suma_filas / 60.0)::int AS total_horas_suma_filas,
      (total_minutos_suma_filas % 60) AS total_minutos_restantes_suma_filas,
      (total_minutos_desde_suma_decimal - total_minutos_suma_filas) AS diferencia_minutos,
      registros_minutos_no_mult_5
    FROM resumen
    ORDER BY total_decimal DESC
  `

  const detalleQuery = `
    SELECT
      h.id,
      h.empleado_id,
      COALESCE(e.nombre || ' ' || e.apellido, 'Empleado ' || h.empleado_id::text) AS empleado,
      h.fecha,
      h.hora_inicio,
      h.hora_fin,
      h.cantidad_horas,
      (ROUND((h.cantidad_horas::numeric) * 60)::int % 60) AS minutos_clock
    FROM horas h
    LEFT JOIN empleados e ON e.id = h.empleado_id
    WHERE h.fecha >= DATE '2026-05-01'
      AND h.fecha < DATE '2026-06-01'
      AND ((ROUND((h.cantidad_horas::numeric) * 60)::int % 60) % 5) <> 0
    ORDER BY h.empleado_id, h.fecha, h.id
    LIMIT 200
  `

  const [resumen, detalle] = await Promise.all([
    pool.query(resumenQuery),
    pool.query(detalleQuery),
  ])

  console.log(JSON.stringify({
    periodo: "05/2026",
    resumen: resumen.rows,
    registros_sospechosos: detalle.rows,
  }, null, 2))

  await pool.end()
}

run().catch(async (error) => {
  console.error(error)
  try {
    await pool.end()
  } catch {
    // noop
  }
  process.exit(1)
})
