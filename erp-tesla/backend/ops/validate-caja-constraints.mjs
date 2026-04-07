import { pool } from "../db.js"

async function run() {
  const summary = {}

  summary.movimientosConstraints = (await pool.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'movimientos_caja'::regclass
      AND conname IN (
        'chk_movimientos_caja_codigo',
        'chk_movimientos_reglas_tipo',
        'chk_movimientos_monto_total_positivo',
        'fk_movimientos_presupuesto_cliente'
      )
    ORDER BY conname
  `)).rows.map((row) => row.conname)

  summary.detallesConstraints = (await pool.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'detalles_medio_pago'::regclass
      AND conname IN (
        'chk_detalles_medio_pago_codigo',
        'chk_detalles_medio_pago_monto'
      )
    ORDER BY conname
  `)).rows.map((row) => row.conname)

  summary.indexes = (await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'detalles_medio_pago'
      AND indexname IN ('uq_detalles_medio_pago_movimiento_medio')
  `)).rows.map((row) => row.indexname)

  summary.cajas = (await pool.query(`
    SELECT caja_codigo, COUNT(*)::int AS cantidad
    FROM movimientos_caja
    GROUP BY caja_codigo
    ORDER BY caja_codigo
  `)).rows

  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    const { rows } = await client.query(`
      INSERT INTO movimientos_caja (
        fecha,
        caja_codigo,
        tipo,
        detalle,
        monto_total,
        categoria,
        con_iva,
        destinatario,
        cliente_id,
        presupuesto_id
      ) VALUES (
        CURRENT_DATE,
        'tesla',
        'egreso',
        'VALIDACION TEMPORAL',
        1500,
        NULL,
        true,
        'Proveedor test',
        NULL,
        NULL
      )
      RETURNING id
    `)

    const movimientoId = rows[0].id

    await client.query(
      `INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto) VALUES ($1, 'efectivo', 1500)`,
      [movimientoId],
    )

    summary.validInsert = "ok"

    try {
      await client.query("SAVEPOINT sp_tipo")
      await client.query(`
        INSERT INTO movimientos_caja (
          fecha,
          caja_codigo,
          tipo,
          detalle,
          monto_total,
          categoria,
          con_iva,
          destinatario
        ) VALUES (
          CURRENT_DATE,
          'tesla',
          'egreso',
          'INVALIDO SIN DESTINATARIO',
          1000,
          'materiales',
          true,
          NULL
        )
      `)
      summary.invalidTipoRules = "unexpectedly inserted"
    } catch (error) {
      summary.invalidTipoRules = error.constraint || error.message
      await client.query("ROLLBACK TO SAVEPOINT sp_tipo")
    }

    try {
      await client.query("SAVEPOINT sp_medio")
      await client.query(
        `INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto) VALUES ($1, 'bitcoin', 10)`,
        [movimientoId],
      )
      summary.invalidMedio = "unexpectedly inserted"
    } catch (error) {
      summary.invalidMedio = error.constraint || error.message
      await client.query("ROLLBACK TO SAVEPOINT sp_medio")
    }

    try {
      await client.query("SAVEPOINT sp_duplicado")
      await client.query(
        `INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto) VALUES ($1, 'efectivo', 10)`,
        [movimientoId],
      )
      summary.duplicateMedio = "unexpectedly inserted"
    } catch (error) {
      summary.duplicateMedio = error.constraint || error.message
      await client.query("ROLLBACK TO SAVEPOINT sp_duplicado")
    }

    await client.query("ROLLBACK")
  } finally {
    client.release()
    await pool.end()
  }

  console.log(JSON.stringify(summary, null, 2))
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