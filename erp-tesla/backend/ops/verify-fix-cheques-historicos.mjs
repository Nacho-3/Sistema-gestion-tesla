import { pool } from "../db.js"

async function main() {
  const libro = await pool.query(`
    SELECT
      COUNT(*)::int AS cheques_hist,
      MIN(movimiento_entrada_id)::int AS mov_ref_min,
      MAX(movimiento_entrada_id)::int AS mov_ref_max
    FROM libro_cheques_caja
    WHERE caja_codigo = 'tesla'
      AND observaciones LIKE 'Carga historica cheque anterior - Identificador:%'
  `)

  const movimientosHistoricos = await pool.query(`
    SELECT COUNT(*)::int AS mov_restantes
    FROM movimientos_caja
    WHERE caja_codigo = 'tesla'
      AND observaciones LIKE 'Carga historica de cheque anterior.%'
  `)

  const ajustes = await pool.query(`
    SELECT COUNT(*)::int AS ajustes
    FROM movimientos_caja
    WHERE caja_codigo = 'tesla'
      AND observaciones IN (
        'MIGRACION_LIBRO_CHEQUES_TECNICO_ING_001',
        'MIGRACION_LIBRO_CHEQUES_TECNICO_EGR_001'
      )
  `)

  console.log({
    libro: libro.rows[0],
    movimientosHistoricos: movimientosHistoricos.rows[0],
    ajustes: ajustes.rows[0],
  })

  await pool.end()
}

main().catch(async (e) => {
  console.error(e.message)
  try { await pool.end() } catch {}
  process.exitCode = 1
})
