import fs from "fs"
import os from "os"
import path from "path"
import { execFileSync } from "child_process"
import { pool } from "../db.js"

const parseArgs = () => {
  const args = process.argv.slice(2)
  const get = (name, fallback = null) => {
    const idx = args.indexOf(name)
    if (idx === -1) return fallback
    return args[idx + 1] ?? fallback
  }

  const presupuestoId = Number(get("--presupuesto-id", "0"))
  const backupPath = get("--backup", "")

  if (!Number.isInteger(presupuestoId) || presupuestoId <= 0) {
    throw new Error("Debe indicar --presupuesto-id <id_numerico>")
  }

  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error(`Backup inexistente: ${backupPath}`)
  }

  return { presupuestoId, backupPath }
}

const getPgRestorePath = () => {
  const pgRestoreWin = "C:/Program Files/PostgreSQL/18/bin/pg_restore.exe"
  if (fs.existsSync(pgRestoreWin)) return pgRestoreWin
  return "pg_restore"
}

const readCantidadesFromBackup = ({ backupPath, presupuestoId }) => {
  const tmpSql = path.join(os.tmpdir(), `restore_presupuesto_${presupuestoId}_${Date.now()}.sql`)
  const pgRestore = getPgRestorePath()

  try {
    execFileSync(pgRestore, ["--data-only", "--table=presupuesto_items", "--file", tmpSql, backupPath], { stdio: "ignore" })
    const lines = fs.readFileSync(tmpSql, "utf8").split(/\r?\n/)
    const cantidadesByOrden = new Map()

    for (const line of lines) {
      if (!line || line.startsWith("--") || line.startsWith("SET ") || line.startsWith("COPY ") || line === "\\.") continue
      const parts = line.split("\t")
      if (parts.length < 6) continue

      const presupuesto = Number(parts[1])
      const tipo = String(parts[2] || "").trim()
      if (presupuesto !== presupuestoId || tipo !== "material") continue

      const orden = Number(parts[3])
      const cantidad = Number(parts[5])
      if (!Number.isFinite(orden) || !Number.isFinite(cantidad)) continue

      cantidadesByOrden.set(orden, cantidad)
    }

    return cantidadesByOrden
  } finally {
    if (fs.existsSync(tmpSql)) {
      fs.unlinkSync(tmpSql)
    }
  }
}

const run = async () => {
  const { presupuestoId, backupPath } = parseArgs()
  const cantidadesByOrden = readCantidadesFromBackup({ backupPath, presupuestoId })

  if (!cantidadesByOrden.size) {
    throw new Error(`No se encontraron items de materiales para presupuesto_id=${presupuestoId} en el backup`)
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const current = await client.query(
      `SELECT orden, cantidad FROM presupuesto_items WHERE presupuesto_id = $1 AND tipo = 'material' ORDER BY orden ASC`,
      [presupuestoId]
    )

    if (!current.rows.length) {
      throw new Error(`El presupuesto ${presupuestoId} no tiene items materiales actuales`)
    }

    const currentByOrden = new Map(current.rows.map((r) => [Number(r.orden), Number(r.cantidad)]))

    let updated = 0
    let unchanged = 0
    let missingInBackup = 0

    for (const [orden, oldCantidad] of currentByOrden.entries()) {
      if (!cantidadesByOrden.has(orden)) {
        missingInBackup += 1
        continue
      }

      const nuevaCantidad = cantidadesByOrden.get(orden)
      if (Number(oldCantidad) === Number(nuevaCantidad)) {
        unchanged += 1
        continue
      }

      const r = await client.query(
        `UPDATE presupuesto_items SET cantidad = $1 WHERE presupuesto_id = $2 AND tipo = 'material' AND orden = $3`,
        [nuevaCantidad, presupuestoId, orden]
      )
      if (r.rowCount === 1) updated += 1
    }

    await client.query("COMMIT")

    const stats = await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE cantidad = 1)::int AS en_uno, COUNT(*) FILTER (WHERE cantidad <> 1)::int AS distintos_de_uno FROM presupuesto_items WHERE presupuesto_id = $1 AND tipo = 'material'`,
      [presupuestoId]
    )

    console.log("RESTORE_OK", {
      presupuestoId,
      backupPath,
      sourceRows: cantidadesByOrden.size,
      currentRows: current.rows.length,
      updated,
      unchanged,
      missingInBackup,
      stats: stats.rows[0],
    })
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((error) => {
  console.error("RESTORE_ERROR", error.message)
  process.exit(1)
})
