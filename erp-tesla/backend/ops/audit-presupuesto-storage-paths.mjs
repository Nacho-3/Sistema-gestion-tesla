import fs from "fs/promises"
import path from "path"
import { pool } from "../db.js"
import { sanitizeFileText } from "../pdf/premiumTheme.js"

const BASE = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "Presupuestos")

const RESERVED_WIN_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])

const isReservedWinName = (name = "") => RESERVED_WIN_NAMES.has(String(name || "").trim().toUpperCase())

const getFileName = (p, mode = "presupuesto") => {
  const numero = sanitizeFileText(String(p.numero || "SinNumero")) || "SinNumero"
  const clienteNombre = sanitizeFileText(p.cliente_empresa || p.cliente_razon_social || "Cliente") || "Cliente"
  const obraNombre = sanitizeFileText(p.obra_nombre || "SinObra") || "SinObra"
  if (mode === "materiales") {
    return `Listado materiales (${obraNombre}) (${clienteNombre}) (${numero}).pdf`
  }
  return `Presupuesto-${numero}.pdf`
}

const getFolder = (p, mode = "presupuesto") => {
  const companyName = sanitizeFileText(p.cliente_empresa || p.cliente_razon_social || "Empresa") || "Empresa"
  let folderPath = path.join(BASE, `Presupuestos ${companyName}`)
  if (mode === "materiales") folderPath = path.join(folderPath, "Listados de materiales")
  return folderPath
}

async function run() {
  const result = await pool.query(`
    SELECT p.id, p.numero, c.empresa AS cliente_empresa, c.razon_social AS cliente_razon_social, o.nombre AS obra_nombre
    FROM presupuestos p
    INNER JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN obras o ON o.id = p.obra_id
    ORDER BY p.id ASC
  `)

  const issues = []
  let writeOkCount = 0

  for (const p of result.rows) {
    for (const mode of ["presupuesto", "materiales"]) {
      const folder = getFolder(p, mode)
      const fileName = getFileName(p, mode)
      const filePath = path.join(folder, fileName)

      const folderParts = folder.split("\\").filter(Boolean)
      const filePart = path.basename(filePath)
      const segmentIssues = []

      for (const seg of [...folderParts, filePart]) {
        if (isReservedWinName(seg.replace(/\..*$/, ""))) {
          segmentIssues.push(`segmento reservado Windows: ${seg}`)
        }
        if (/[. ]$/.test(seg)) {
          segmentIssues.push(`segmento termina en espacio/punto: ${seg}`)
        }
      }

      const lengthIssues = []
      if (folder.length > 240) lengthIssues.push(`carpeta larga (${folder.length})`)
      if (filePath.length > 259) lengthIssues.push(`ruta larga (${filePath.length})`)

      let writeError = null
      try {
        await fs.mkdir(folder, { recursive: true })
        const tmp = path.join(folder, `__audit_write_${p.id}_${mode}.tmp`)
        await fs.writeFile(tmp, "ok")
        await fs.unlink(tmp)
        writeOkCount += 1
      } catch (err) {
        writeError = `${err?.code || "ERR"}: ${err?.message || err}`
      }

      if (segmentIssues.length || lengthIssues.length || writeError) {
        issues.push({
          id: p.id,
          numero: p.numero,
          mode,
          cliente: p.cliente_empresa || p.cliente_razon_social || null,
          obra: p.obra_nombre || null,
          folder,
          filePath,
          segmentIssues,
          lengthIssues,
          writeError,
        })
      }
    }
  }

  console.log(JSON.stringify({
    base: BASE,
    presupuestos: result.rowCount,
    pruebasEscrituraOK: writeOkCount,
    issuesCount: issues.length,
    issues: issues.slice(0, 100),
  }, null, 2))

  await pool.end()
}

run().catch(async (err) => {
  console.error(err)
  try { await pool.end() } catch {}
  process.exit(1)
})
