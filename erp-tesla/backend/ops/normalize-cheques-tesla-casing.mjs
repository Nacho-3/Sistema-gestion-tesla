import { pool } from "../db.js"

async function main() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(`
      UPDATE libro_cheques_caja
      SET
        librador_endosante = UPPER(LEFT(BTRIM(librador_endosante), 1)) || SUBSTRING(BTRIM(librador_endosante) FROM 2),
        banco = UPPER(LEFT(BTRIM(banco), 1)) || SUBSTRING(BTRIM(banco) FROM 2),
        updated_at = CURRENT_TIMESTAMP
      WHERE caja_codigo = 'tesla'
        AND librador_endosante IS NOT NULL
        AND BTRIM(librador_endosante) <> ''
    `)

    await client.query(`
      UPDATE detalles_medio_pago d
      SET
        librador_endosante = UPPER(LEFT(BTRIM(d.librador_endosante), 1)) || SUBSTRING(BTRIM(d.librador_endosante) FROM 2),
        banco = UPPER(LEFT(BTRIM(d.banco), 1)) || SUBSTRING(BTRIM(d.banco) FROM 2)
      FROM movimientos_caja m
      WHERE d.movimiento_id = m.id
        AND m.caja_codigo = 'tesla'
        AND d.medio_pago IN ('cheque', 'echeq')
    `)

    await client.query("COMMIT")

    const resumen = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado = 'disponible')::int AS disponibles,
        COUNT(*) FILTER (WHERE estado <> 'disponible')::int AS no_disponibles
      FROM libro_cheques_caja
      WHERE caja_codigo = 'tesla'
    `)

    console.log("Normalizacion OK:", resumen.rows[0])
  } catch (error) {
    await client.query("ROLLBACK")
    console.error("Error:", error.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
