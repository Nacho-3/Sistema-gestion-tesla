import { pool } from "./db.js"

try {
  const q1 = await pool.query(
    "select current_schema() as schema, current_setting('search_path') as search_path, to_regclass('movimientos_caja') as regclass"
  )
  console.log("META", q1.rows[0])

  const q2 = await pool.query(
    "select a.attname from pg_attribute a where a.attrelid = to_regclass('movimientos_caja') and a.attnum > 0 and not a.attisdropped order by a.attnum"
  )
  console.log("COLS", q2.rows.map((r) => r.attname))

  const q3 = await pool.query(
    "select a.attname from pg_attribute a where a.attrelid = to_regclass('detalles_medio_pago') and a.attnum > 0 and not a.attisdropped order by a.attnum"
  )
  console.log("DETALLES_COLS", q3.rows.map((r) => r.attname))
} catch (err) {
  console.error(err)
} finally {
  await pool.end()
}
