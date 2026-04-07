import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import dotenv from "dotenv"

dotenv.config()

const DEFAULT_BACKUP_ROOT = "C:\\ERP-Tesla-Backups"
const DEFAULT_PG_BIN = "C:\\Program Files\\PostgreSQL\\18\\bin"
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

let timer = null
let running = false
let pendingReason = ""
let lastRunAt = 0
let intervalHandle = null

const envBool = (name, fallback = false) => {
	const raw = String(process.env[name] ?? "").trim().toLowerCase()
	if (!raw) return fallback
	return ["1", "true", "yes", "on", "si"].includes(raw)
}

const envNumber = (name, fallback) => {
	const value = Number(process.env[name])
	return Number.isFinite(value) ? value : fallback
}

const getConfig = () => {
	const pgDumpPath = process.env.PG_DUMP_PATH || path.join(process.env.PG_BIN || DEFAULT_PG_BIN, "pg_dump.exe")
	return {
		enabled: envBool("BACKUP_ENABLED", true),
		onWrite: envBool("BACKUP_ON_WRITE", true),
		onStart: envBool("BACKUP_ON_START", false),
		root: process.env.BACKUP_ROOT || DEFAULT_BACKUP_ROOT,
		retentionDays: Math.max(1, envNumber("BACKUP_RETENTION_DAYS", 21)),
		debounceMs: Math.max(1000, envNumber("BACKUP_DEBOUNCE_MS", 120000)),
		minIntervalMs: Math.max(60000, envNumber("BACKUP_MIN_INTERVAL_MS", 900000)),
		periodicMs: Math.max(0, envNumber("BACKUP_PERIODIC_MS", 21600000)),
		pgDumpPath,
		dbHost: process.env.DB_HOST || "localhost",
		dbPort: String(process.env.DB_PORT || 5432),
		dbName: process.env.DB_NAME || "erp_tesla",
		dbUser: process.env.DB_USER || "postgres",
		dbPassword: process.env.DB_PASSWORD || "",
	}
}

const cleanupOldBackups = async (root, retentionDays) => {
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
	const entries = await fs.promises.readdir(root, { withFileTypes: true })
	await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".backup"))
			.map(async (entry) => {
				const filePath = path.join(root, entry.name)
				const stat = await fs.promises.stat(filePath)
				if (stat.mtimeMs < cutoff) {
					await fs.promises.unlink(filePath)
				}
			})
	)
}

export const runBackupNow = async (reason = "manual") => {
	const config = getConfig()
	if (!config.enabled) return { skipped: true, reason: "disabled" }
	if (!fs.existsSync(config.pgDumpPath)) {
		throw new Error(`No se encontró pg_dump en ${config.pgDumpPath}`)
	}

	await fs.promises.mkdir(config.root, { recursive: true })
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/\.$/, "")
	const safeReason = String(reason || "manual").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "manual"
	const filePath = path.join(config.root, `erp_tesla_${stamp}_${safeReason}.backup`)

	await new Promise((resolve, reject) => {
		const child = spawn(
			config.pgDumpPath,
			["-h", config.dbHost, "-p", config.dbPort, "-U", config.dbUser, "-d", config.dbName, "-F", "c", "-f", filePath],
			{
				env: {
					...process.env,
					PGPASSWORD: config.dbPassword,
				},
				stdio: ["ignore", "ignore", "pipe"],
			}
		)

		let stderr = ""
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk)
		})

		child.on("error", reject)
		child.on("close", (code) => {
			if (code === 0) {
				resolve()
				return
			}
			reject(new Error(stderr.trim() || `pg_dump fallo con codigo ${code}`))
		})
	})

	await cleanupOldBackups(config.root, config.retentionDays)
	lastRunAt = Date.now()
	return { ok: true, filePath }
}

const runScheduledBackup = async (reason) => {
	if (running) {
		pendingReason = pendingReason || reason
		return
	}

	running = true
	try {
		const result = await runBackupNow(reason)
		if (result?.filePath) {
			console.log(`[backup] OK: ${result.filePath}`)
		}
	} catch (error) {
		console.error("[backup] Error generando backup:", error.message)
	} finally {
		running = false
		if (pendingReason) {
			const nextReason = pendingReason
			pendingReason = ""
			scheduleBackup(nextReason)
		}
	}
}

export const scheduleBackup = (reason = "mutation") => {
	const config = getConfig()
	if (!config.enabled || !config.onWrite) return

	const now = Date.now()
	const waitForMinInterval = Math.max(0, config.minIntervalMs - (now - lastRunAt))
	const delay = Math.max(config.debounceMs, waitForMinInterval)

	clearTimeout(timer)
	if (running) {
		pendingReason = reason
		return
	}

	timer = setTimeout(() => {
		timer = null
		runScheduledBackup(reason)
	}, delay)
	if (typeof timer.unref === "function") timer.unref()
}

export const registerBackupHooks = (app) => {
	app.use((req, res, next) => {
		if (!MUTATING_METHODS.has(req.method) || req.path.startsWith("/auth")) {
			next()
			return
		}

		res.on("finish", () => {
			if (res.statusCode >= 200 && res.statusCode < 400) {
				scheduleBackup(`${req.method.toLowerCase()}_${req.path.replace(/[^a-zA-Z0-9_-]+/g, "_")}`)
			}
		})

		next()
	})
}

export const startBackupService = () => {
	const config = getConfig()
	if (!config.enabled) {
		console.log("[backup] Servicio de backup deshabilitado")
		return
	}

	if (!fs.existsSync(config.pgDumpPath)) {
		console.warn(`[backup] pg_dump no encontrado en ${config.pgDumpPath}. No se iniciará el backup automático.`)
		return
	}

	console.log(`[backup] Servicio activo. Carpeta: ${config.root}`)
	if (config.onStart) {
		scheduleBackup("startup")
	}

	if (config.periodicMs > 0) {
		intervalHandle = setInterval(() => {
			runScheduledBackup("periodic")
		}, config.periodicMs)
		if (typeof intervalHandle.unref === "function") intervalHandle.unref()
	}
}
