import { pool } from "../db.js"

async function run() {
  try {
    const q1 = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='liquidaciones' ORDER BY ordinal_position"
    )
    console.log("LIQUIDACIONES:")
    console.log(q1.rows.map((r) => r.column_name).join(", "))

    const q2 = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='movimientos_caja' ORDER BY ordinal_position"
    )
    console.log("MOVIMIENTOS_CAJA:")
    console.log(q2.rows.map((r) => r.column_name).join(", "))
  } catch (err) {
    console.error("Error verificando columnas:", err.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

run()
