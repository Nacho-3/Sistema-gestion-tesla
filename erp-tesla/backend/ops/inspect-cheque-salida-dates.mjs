import { pool } from "../db.js"

const numero = process.argv[2] || "083745"

async function main() {
  const q = await pool.query(
    `
      SELECT
        l.id AS libro_id,
        l.numero_cheque,
        l.estado,
        l.fecha_entrada,
        l.fecha_cheque,
        l.fecha_salida,
        l.endosado_a,
        l.movimiento_salida_id,
        m.fecha AS movimiento_fecha,
        m.caja_codigo,
        m.caja_semanal_id,
        s.fecha_inicio AS semana_inicio,
        s.fecha_fin AS semana_fin,
        s.estado AS semana_estado,
        m.updated_at AS movimiento_updated_at,
        l.updated_at AS cheque_updated_at
      FROM libro_cheques_caja l
      LEFT JOIN movimientos_caja m ON m.id = l.movimiento_salida_id
      LEFT JOIN cajas_semanales s ON s.id = m.caja_semanal_id
      WHERE l.numero_cheque = $1
      ORDER BY l.id DESC
    `,
    [numero]
  )

  console.log(JSON.stringify(q.rows, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
