import { pool } from "../db.js"
import { roundHourDecimal, formatHoursAsClock } from "../utils/hourFormat.js"

const month = Number(process.argv[2])
const year = Number(process.argv[3])
const apply = process.argv.includes("--apply")

if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
  console.error("Uso: node ops/revert-hours-clock-batch.mjs <mes> <anio> [--apply]")
  process.exit(1)
}

const start = `${year}-${String(month).padStart(2, "0")}-01`
const end = `${year}-${String(month).padStart(2, "0")}-31`

const decimalToStoredClockNumber = (value) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return null

  const totalMinutes = Math.round(numberValue * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return roundHourDecimal(Number(`${hours}.${String(minutes).padStart(2, "0")}`))
}

async function run() {
  const latest = await pool.query(
    `
      SELECT MAX(updated_at) AS updated_at
      FROM horas
      WHERE fecha BETWEEN $1 AND $2
    `,
    [start, end],
  )

  const batchUpdatedAt = latest.rows[0]?.updated_at
  if (!batchUpdatedAt) {
    console.log(JSON.stringify({ periodo: `${String(month).padStart(2, "0")}/${year}`, apply, registros: 0 }, null, 2))
    await pool.end()
    return
  }

  const { rows } = await pool.query(
    `
      SELECT id, fecha, empleado_id, cantidad_horas, horas_trabajadas, updated_at
      FROM horas
      WHERE fecha BETWEEN $1 AND $2
        AND updated_at = (
          SELECT MAX(updated_at)
          FROM horas
          WHERE fecha BETWEEN $1 AND $2
        )
      ORDER BY fecha, id
    `,
    [start, end],
  )

  const cambios = rows.map((row) => ({
    id: row.id,
    fecha: row.fecha,
    empleado_id: row.empleado_id,
    cantidad_actual: Number(row.cantidad_horas),
    cantidad_revertida: decimalToStoredClockNumber(row.cantidad_horas),
    trabajadas_actual: Number(row.horas_trabajadas),
    trabajadas_revertida: decimalToStoredClockNumber(row.horas_trabajadas),
    updated_at: row.updated_at,
  }))

  const resumen = {
    periodo: `${String(month).padStart(2, "0")}/${year}`,
    apply,
    batch_updated_at: batchUpdatedAt,
    registros: cambios.length,
    muestra: cambios.slice(0, 10).map((item) => ({
      id: item.id,
      fecha: item.fecha,
      empleado_id: item.empleado_id,
      cantidad: `${item.cantidad_actual} -> ${item.cantidad_revertida} (${formatHoursAsClock(item.cantidad_revertida)})`,
      trabajadas: `${item.trabajadas_actual} -> ${item.trabajadas_revertida} (${formatHoursAsClock(item.trabajadas_revertida)})`,
    })),
  }

  if (!apply) {
    console.log(JSON.stringify(resumen, null, 2))
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const item of cambios) {
      await client.query(
        `
          UPDATE horas
          SET cantidad_horas = $2,
              horas_trabajadas = $3
          WHERE id = $1
        `,
        [item.id, item.cantidad_revertida, item.trabajadas_revertida],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }

  console.log(JSON.stringify({ ...resumen, revertido: true }, null, 2))
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