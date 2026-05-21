import { pool } from "../db.js"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const empleadoArg = args.find((arg) => arg.startsWith("--empleado="))
const empleadoId = empleadoArg ? Number(empleadoArg.split("=")[1]) : null

const values = args.filter((arg) => !arg.startsWith("--"))
const month = Number(values[0])
const year = Number(values[1])

if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
  console.error("Uso: node ops/normalize-hours-real-period.mjs <mes> <anio> [--empleado=<id>] [--apply]")
  process.exit(1)
}

if (empleadoArg && !Number.isInteger(empleadoId)) {
  console.error("El parametro --empleado debe ser un entero")
  process.exit(1)
}

const start = `${year}-${String(month).padStart(2, "0")}-01`
const endDate = new Date(year, month, 1)
const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`

const round2 = (value) => Math.round(Number(value) * 100) / 100

const toFixedText = (value) => round2(value).toFixed(2)

const parseHoraToMinutes = (hora) => {
  const raw = String(hora || "").trim()
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }

  return (hours * 60) + minutes
}

const getHorasDecimalesDesdeHorario = (horaInicio, horaFin) => {
  const inicioMin = parseHoraToMinutes(horaInicio)
  const finMin = parseHoraToMinutes(horaFin)
  if (!Number.isFinite(inicioMin) || !Number.isFinite(finMin)) return null

  const totalMin = finMin - inicioMin
  if (totalMin <= 0) return null
  return round2(totalMin / 60)
}

async function run() {
  const whereEmpleado = Number.isInteger(empleadoId) ? "AND empleado_id = $3" : ""
  const params = Number.isInteger(empleadoId) ? [start, end, empleadoId] : [start, end]

  const { rows } = await pool.query(
    `
      SELECT id, fecha, empleado_id, hora_inicio, hora_fin, cantidad_horas, horas_trabajadas
      FROM horas
      WHERE fecha >= $1
        AND fecha < $2
        AND hora_inicio IS NOT NULL
        AND hora_fin IS NOT NULL
        ${whereEmpleado}
      ORDER BY fecha, id
    `,
    params,
  )

  const cambios = rows
    .map((row) => {
      const normalizado = getHorasDecimalesDesdeHorario(row.hora_inicio, row.hora_fin)
      if (!Number.isFinite(normalizado)) return null

      const cantidadActual = Number(row.cantidad_horas)
      const trabajadasActual = Number(row.horas_trabajadas)

      const cambiaCantidad = toFixedText(cantidadActual) !== toFixedText(normalizado)
      const cambiaTrabajadas = toFixedText(trabajadasActual) !== toFixedText(normalizado)

      if (!cambiaCantidad && !cambiaTrabajadas) return null

      return {
        id: row.id,
        fecha: row.fecha,
        empleado_id: row.empleado_id,
        hora_inicio: row.hora_inicio,
        hora_fin: row.hora_fin,
        cantidad_actual: cantidadActual,
        trabajadas_actual: trabajadasActual,
        nuevo_valor: normalizado,
      }
    })
    .filter(Boolean)

  let updatedRows = 0
  let postApplySample = []

  if (apply && cambios.length > 0) {
    const client = await pool.connect()
    try {
      await client.query("BEGIN")

      for (const item of cambios) {
        const updateResult = await client.query(
          `
            UPDATE horas
            SET cantidad_horas = $1,
                horas_trabajadas = $1
            WHERE id = $2
          `,
          [item.nuevo_valor, item.id],
        )
        updatedRows += Number(updateResult.rowCount || 0)
      }

      const sampleIds = cambios.slice(0, 10).map((item) => item.id)
      if (sampleIds.length > 0) {
        const verify = await client.query(
          `
            SELECT id, cantidad_horas, horas_trabajadas
            FROM horas
            WHERE id = ANY($1::int[])
            ORDER BY id
          `,
          [sampleIds],
        )
        postApplySample = verify.rows
      }

      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  console.log(JSON.stringify({
    periodo: `${String(month).padStart(2, "0")}/${year}`,
    apply,
    empleado_id: Number.isInteger(empleadoId) ? empleadoId : null,
    evaluados: rows.length,
    a_normalizar: cambios.length,
    updated_rows: apply ? updatedRows : undefined,
    post_apply_sample: apply ? postApplySample : undefined,
    muestra: cambios.slice(0, 15).map((item) => ({
      id: item.id,
      fecha: item.fecha,
      empleado_id: item.empleado_id,
      rango: `${item.hora_inicio} -> ${item.hora_fin}`,
      cantidad: `${toFixedText(item.cantidad_actual)} -> ${toFixedText(item.nuevo_valor)}`,
      trabajadas: `${toFixedText(item.trabajadas_actual)} -> ${toFixedText(item.nuevo_valor)}`,
    })),
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
