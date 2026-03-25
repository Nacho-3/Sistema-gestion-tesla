import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { pool } from "../db.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(__dirname, "..", "database", "schema.sql")

async function run() {
  try {
    const sql = fs.readFileSync(schemaPath, "utf8")
    console.log("Aplicando schema.sql...")
    await pool.query(sql)
    console.log("Schema aplicado correctamente.")
  } catch (err) {
    console.error("Error aplicando schema:", err.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

run()
