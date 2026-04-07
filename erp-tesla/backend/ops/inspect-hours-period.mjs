import { pool } from "../db.js"

const month = Number(process.argv[2])
const year = Number(process.argv[3])

if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
  console.error("Uso: node ops/inspect-hours-period.mjs <mes> <anio>")
  process.exit(1)
}

const start = `${year}-${String(month).padStart(2, "0")}-01`
const end = `${year}-${String(month).padStart(2, "0")}-31`

async function run() {
  const resumen = await pool.query(
    `
      SELECT COUNT(*)::int AS total, MIN(updated_at) AS min_updated_at, MAX(updated_at) AS max_updated_at
      FROM horas
      WHERE fecha BETWEEN $1 AND $2
    `,
    [start, end],
  )

  const muestra = await pool.query(
    `
      SELECT id, fecha, empleado_id, cantidad_horas, horas_trabajadas, updated_at
      FROM horas
      WHERE fecha BETWEEN $1 AND $2
      ORDER BY updated_at DESC, id DESC
      LIMIT 20
    `,
    [start, end],
  )

  console.log(JSON.stringify({
    periodo: `${String(month).padStart(2, "0")}/${year}`,
    resumen: resumen.rows[0],
    muestra: muestra.rows,
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