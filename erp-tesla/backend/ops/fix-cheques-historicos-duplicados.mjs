import { pool } from "../db.js"

const APPLY = process.argv.includes("--apply")
const HIST_PREFIX = "Carga historica cheque anterior - Identificador:"
const TECH_OBS_ING = "MIGRACION_LIBRO_CHEQUES_TECNICO_ING_001"
const TECH_OBS_EGR = "MIGRACION_LIBRO_CHEQUES_TECNICO_EGR_001"

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100
const formatMoneyAr = (value) => new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(roundMoney(value))

async function main() {
  const client = await pool.connect()
  try {
    const libroRes = await client.query(
      `
      SELECT id, movimiento_entrada_id, detalle_medio_pago_entrada_id
      FROM libro_cheques_caja
      WHERE caja_codigo = 'tesla'
        AND observaciones LIKE $1
      ORDER BY id
      `,
      [`${HIST_PREFIX}%`]
    )

    const libroRows = libroRes.rows || []
    const movimientoIds = [...new Set(libroRows
      .map((r) => Number(r.movimiento_entrada_id || 0))
      .filter((id) => Number.isInteger(id) && id > 0))]

    let movimientos = []
    if (movimientoIds.length > 0) {
      const movRes = await client.query(
        `
        SELECT id, monto_total
        FROM movimientos_caja
        WHERE id = ANY($1::int[])
        `,
        [movimientoIds]
      )
      movimientos = movRes.rows || []
    }

    const totalDuplicado = roundMoney(movimientos.reduce((acc, row) => acc + Number(row.monto_total || 0), 0))

    console.log(`Cheques historicos detectados en libro: ${libroRows.length}`)
    console.log(`Movimientos de ingreso asociados: ${movimientos.length}`)
    console.log(`Monto duplicado estimado en caja: ${formatMoneyAr(totalDuplicado)}`)

    if (!APPLY) {
      console.log("Modo verificacion: no se aplicaron cambios. Ejecutar con --apply para corregir.")
      return
    }

    if (!libroRows.length || !movimientos.length) {
      console.log("No hay datos para corregir.")
      return
    }

    await client.query("BEGIN")

    let techMovimientoId = null
    const techIngRes = await client.query(
      `
      SELECT id
      FROM movimientos_caja
      WHERE caja_codigo = 'tesla'
        AND observaciones = $1
      LIMIT 1
      `,
      [TECH_OBS_ING]
    )

    if (techIngRes.rowCount > 0) {
      techMovimientoId = Number(techIngRes.rows[0].id)
    } else {
      const insertTech = await client.query(
        `
        INSERT INTO movimientos_caja (
          fecha, caja_codigo, tipo, detalle, observaciones, categoria,
          con_iva, destinatario, cliente_id, presupuesto_id, monto_total
        ) VALUES (
          CURRENT_DATE, 'tesla', 'ingreso',
          'Ajuste tecnico migracion libro de cheques',
          $1,
          'varios', true, NULL, NULL, NULL, 0.01
        )
        RETURNING id
        `,
        [TECH_OBS_ING]
      )
      techMovimientoId = Number(insertTech.rows[0].id)

    }

    const techEgrRes = await client.query(
      `
      SELECT id
      FROM movimientos_caja
      WHERE caja_codigo = 'tesla'
        AND observaciones = $1
      LIMIT 1
      `,
      [TECH_OBS_EGR]
    )

    if (techEgrRes.rowCount === 0) {
      await client.query(
        `
        INSERT INTO movimientos_caja (
          fecha, caja_codigo, tipo, detalle, observaciones, categoria,
          con_iva, destinatario, cliente_id, presupuesto_id, monto_total
        ) VALUES (
          CURRENT_DATE, 'tesla', 'egreso',
          'Ajuste tecnico compensacion migracion libro de cheques',
          $1,
          NULL, true, 'Ajuste tecnico migracion', NULL, NULL, 0.01
        )
        `,
        [TECH_OBS_EGR]
      )
    }

    const libroIds = libroRows.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0)

    await client.query(
      `
      UPDATE libro_cheques_caja
      SET movimiento_entrada_id = $1,
          detalle_medio_pago_entrada_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($2::int[])
      `,
      [techMovimientoId, libroIds]
    )

    await client.query(
      `
      DELETE FROM detalles_medio_pago
      WHERE movimiento_id = ANY($1::int[])
      `,
      [movimientoIds]
    )

    await client.query(
      `
      DELETE FROM movimientos_caja
      WHERE id = ANY($1::int[])
      `,
      [movimientoIds]
    )

    await client.query("COMMIT")

    console.log(`Correccion aplicada. Movimiento tecnico: ${techMovimientoId}`)
    console.log(`Movimientos eliminados: ${movimientoIds.length}`)
    console.log(`Monto removido de ingresos: ${formatMoneyAr(totalDuplicado)}`)
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // noop
    }
    console.error("Error:", error.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
