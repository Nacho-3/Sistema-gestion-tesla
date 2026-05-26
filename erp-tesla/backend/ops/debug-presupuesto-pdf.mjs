import fs from "fs/promises"
import path from "path"
import { pool } from "../db.js"
import { sanitizeFileText } from "../pdf/premiumTheme.js"

const id = Number(process.argv[2] || 64)

const BASE = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "Presupuestos")

async function run() {
  const cabecera = await pool.query(
    `
      SELECT
        p.id,
        p.numero,
        c.empresa AS cliente_empresa,
        c.razon_social AS cliente_razon_social,
        o.nombre AS obra_nombre
      FROM presupuestos p
      INNER JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN obras o ON o.id = p.obra_id
      WHERE p.id = $1
      LIMIT 1
    `,
    [id],
  )

  if (cabecera.rowCount === 0) {
    console.log(JSON.stringify({ ok: false, error: "Presupuesto no encontrado", id }, null, 2))
    await pool.end()
    return
  }

  const p = cabecera.rows[0]
  const numero = sanitizeFileText(String(p.numero || "SinNumero")) || "SinNumero"
  const cliente = sanitizeFileText(p.cliente_empresa || p.cliente_razon_social || "Cliente") || "Cliente"
  const obra = sanitizeFileText(p.obra_nombre || "SinObra") || "SinObra"

  const fileName = `Presupuesto-${numero}.pdf`
  const folderPath = path.join(BASE, `Presupuestos ${cliente}`)
  const filePath = path.join(folderPath, fileName)

  let fsWriteOk = true
  let fsError = null

  try {
    await fs.mkdir(folderPath, { recursive: true })
    await fs.writeFile(path.join(folderPath, "__write_test__.tmp"), "ok")
    await fs.unlink(path.join(folderPath, "__write_test__.tmp"))
  } catch (err) {
    fsWriteOk = false
    fsError = String(err?.message || err)
  }

  console.log(JSON.stringify({
    ok: true,
    id,
    presupuesto: p,
    paths: {
      base: BASE,
      folderPath,
      filePath,
      folderLength: folderPath.length,
      filePathLength: filePath.length,
    },
    fsWriteOk,
    fsError,
  }, null, 2))

  await pool.end()
}

run().catch(async (err) => {
  console.error(err)
  try { await pool.end() } catch {}
  process.exit(1)
})
