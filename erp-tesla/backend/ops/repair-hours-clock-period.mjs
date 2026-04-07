import { pool } from "../db.js"
import { convertStoredClockNumberToDecimal, formatHoursAsClock } from "../utils/hourFormat.js"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const values = args.filter((arg) => !arg.startsWith("--"))

const month = Number(values[0])
const year = Number(values[1])

if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
  console.error("Uso: node ops/repair-hours-clock-period.mjs <mes> <anio> [--apply]")
  process.exit(1)
}

const start = `${year}-${String(month).padStart(2, "0")}-01`
const endDate = new Date(year, month, 1)
const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`

const toFixedText = (value) => Number(value || 0).toFixed(2)

const repairField = (value) => {
  if (value === null || value === undefined || value === "") return null
  return convertStoredClockNumberToDecimal(value)
}

async function run() {
  const { rows } = await pool.query(
    `
      SELECT id, fecha, empleado_id, cantidad_horas, horas_trabajadas, es_hora_extra, tipo_hora_extra
      FROM horas
      WHERE fecha >= $1 AND fecha < $2
      ORDER BY fecha, id
    `,
    [start, end],
  )

  const cambios = rows
    .map((row) => {
      const cantidadOriginal = row.cantidad_horas
      const trabajadasOriginal = row.horas_trabajadas
      const cantidadNueva = repairField(cantidadOriginal)
      const trabajadasNueva = repairField(trabajadasOriginal)

      const cambioCantidad = cantidadNueva !== null && toFixedText(cantidadNueva) !== toFixedText(cantidadOriginal)
      const cambioTrabajadas = trabajadasNueva !== null && toFixedText(trabajadasNueva) !== toFixedText(trabajadasOriginal)

      if (!cambioCantidad && !cambioTrabajadas) return null

      return {
        id: row.id,
        fecha: row.fecha,
        empleado_id: row.empleado_id,
        cantidad_original: cantidadOriginal,
        cantidad_nueva: cantidadNueva,
        trabajadas_original: trabajadasOriginal,
        trabajadas_nueva: trabajadasNueva,
        es_hora_extra: row.es_hora_extra,
        tipo_hora_extra: row.tipo_hora_extra,
      }
    })
    .filter(Boolean)

  const sample = cambios.slice(0, 10).map((item) => ({
    id: item.id,
    fecha: item.fecha,
    empleado_id: item.empleado_id,
    cantidad_guardada: item.cantidad_original,
    cantidad_visible_hoy: formatHoursAsClock(item.cantidad_original),
    cantidad_reparada: item.cantidad_nueva,
    cantidad_visible_reparada: formatHoursAsClock(item.cantidad_nueva),
    trabajadas_guardada: item.trabajadas_original,
    trabajadas_visible_hoy: formatHoursAsClock(item.trabajadas_original),
    trabajadas_reparada: item.trabajadas_nueva,
    trabajadas_visible_reparada: formatHoursAsClock(item.trabajadas_nueva),
    tipo: item.es_hora_extra ? `extra_${item.tipo_hora_extra || "50"}` : "normal",
  }))

  const resumen = {
    periodo: `${String(month).padStart(2, "0")}/${year}`,
    apply,
    registrosLeidos: rows.length,
    registrosConCambio: cambios.length,
    muestra: sample,
  }

  if (!apply || cambios.length === 0) {
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
          SET cantidad_horas = COALESCE($2, cantidad_horas),
              horas_trabajadas = COALESCE($3, horas_trabajadas)
          WHERE id = $1
        `,
        [item.id, item.cantidad_nueva, item.trabajadas_nueva],
      )
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }

  console.log(JSON.stringify({ ...resumen, actualizado: true }, null, 2))
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