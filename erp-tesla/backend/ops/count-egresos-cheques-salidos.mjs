import { pool } from "../db.js"

async function main() {
  const q1 = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM movimientos_caja m
    WHERE LOWER(m.tipo) = 'egreso'
      AND EXISTS (SELECT 1 FROM libro_cheques_caja l WHERE l.movimiento_salida_id = m.id)
  `)

  const q2 = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM movimientos_caja m
    JOIN cajas_semanales s ON s.id = m.caja_semanal_id
    WHERE LOWER(m.tipo) = 'egreso'
      AND LOWER(COALESCE(s.estado, '')) = 'abierta'
      AND s.fecha_inicio < (CURRENT_DATE - INTERVAL '5 days')
      AND EXISTS (SELECT 1 FROM libro_cheques_caja l WHERE l.movimiento_salida_id = m.id)
  `)

  const q3 = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM libro_cheques_caja
    WHERE estado = 'salido'
      AND movimiento_salida_id IS NOT NULL
  `)

  console.log(JSON.stringify({
    egresosConChequesSalidos: Number(q1.rows?.[0]?.total || 0),
    enSemanasViejasAbiertas: Number(q2.rows?.[0]?.total || 0),
    chequesSalidosTotal: Number(q3.rows?.[0]?.total || 0),
  }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
