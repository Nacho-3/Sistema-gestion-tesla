import { createServer } from "http"
import fs from "fs"
import path from "path"
import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import bcrypt from "bcryptjs"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { Server as SocketIO } from "socket.io"
import { fileURLToPath } from "url"
import { pool } from "./db.js"
import { setIo } from "./socket.js"
import { extractTokenFromRequest, requireAuth, verifyAuthToken } from "./middleware/auth.js"
import { registerBackupHooks, startBackupService } from "./services/backup-service.js"
import authRoutes from "./auth.js"
import dashboardRoutes from "./routes/dashboard.js"
import clientesRoutes from "./routes/clientes.js"
import obrasRoutes from "./routes/obras.js"
import gruposRoutes from "./routes/grupos.js"
import empleadosRoutes from "./routes/empleados.js"
import horasRoutes from "./routes/horas.js"
import liquidacionesRoutes from "./routes/liquidaciones.js"
import cajaRoutes from "./routes/caja.js"
import presupuestosRoutes from "./routes/presupuestos.js"
import certificadosRoutes from "./routes/certificados.js"


dotenv.config()

const app = express()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(__dirname, "database", "schema.sql")
const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || "0.0.0.0"

const hasInsecureValue = (value, insecureValues = []) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return true
  return insecureValues.map((item) => String(item).trim().toLowerCase()).includes(normalized)
}

const warnOnInsecureConfig = () => {
  if (hasInsecureValue(process.env.DB_PASSWORD, ["postgres", "admin", "1234", "admin1234"])) {
    console.warn("[security] DB_PASSWORD es débil o no está configurado con un valor seguro")
  }

  if (hasInsecureValue(process.env.JWT_SECRET, ["changeme", "secret", "tesla_erp_local_2026_7f3a1c2e9b4d8a6f5c1e7d9a2b4c6e8f"])) {
    console.warn("[security] JWT_SECRET usa un valor débil o conocido. Debe rotarse.")
  }

  if (host === "0.0.0.0" && !String(process.env.ALLOWED_ORIGINS || "").trim()) {
    console.warn("[security] El backend escucha en toda la red sin ALLOWED_ORIGINS explícitos")
  }
  if (process.env.NODE_ENV !== "production") {
	console.warn("[security] La sesión HTTP usa cookie HttpOnly. Si publicás el sistema por HTTPS, activá COOKIE_SECURE=true.")
  }
}

const ensureBootstrapAdmin = async () => {
  const enabled = ["1", "true", "yes", "on", "si"].includes(String(process.env.APP_BOOTSTRAP_ADMIN || "").trim().toLowerCase())
  if (!enabled) return

  const email = String(process.env.APP_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase()
  const password = String(process.env.APP_BOOTSTRAP_ADMIN_PASSWORD || "")
  if (!email || !password) {
    console.warn("[security] APP_BOOTSTRAP_ADMIN está activo pero faltan APP_BOOTSTRAP_ADMIN_EMAIL o APP_BOOTSTRAP_ADMIN_PASSWORD")
    return
  }

  const existing = await pool.query(`SELECT id FROM usuarios WHERE email = $1 LIMIT 1`, [email])
    if (existing.rowCount > 0) return

  const hash = await bcrypt.hash(password, 12)
  await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES ($1, $2, $3, 'admin', true)`,
    [email, hash, "Administrador"]
  )
  console.log(`[security] Usuario administrador bootstrap creado: ${email}`)
}

const ensureDatabaseSchema = async () => {
  try {
    const sql = fs.readFileSync(schemaPath, "utf8");
    await pool.query(sql);
  } catch (error) {
    console.error("Error al aplicar el schema.sql:", error);
    throw error;
  }
}

const parseAllowedOrigins = () => {
  const raw = String(process.env.ALLOWED_ORIGINS || "").trim()
  if (raw) {
    return raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  }

  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]
}

const allowedOrigins = parseAllowedOrigins()
const hasExplicitAllowedOrigins = Boolean(String(process.env.ALLOWED_ORIGINS || "").trim())

const isPrivateLanOrigin = (origin) => {
  try {
    const url = new URL(origin)
    const host = url.hostname
    const port = url.port || (url.protocol === "https:" ? "443" : "80")

    if (port !== "5173") return false
    if (host.startsWith("192.168.")) return true
    if (host === "localhost" || host === "127.0.0.1") return true

    if (host.startsWith("10.")) return true

    if (host.startsWith("172.")) {
      const octets = host.split(".")
      const second = Number(octets[1])
      if (Number.isInteger(second) && second >= 16 && second <= 31) return true
    }

    return false
  } catch {
    return false
  }
}

const corsOriginValidator = (origin, callback) => {
  if (!origin) return callback(null, true)
  if (allowedOrigins.includes(origin)) return callback(null, true)
  if (!hasExplicitAllowedOrigins && isPrivateLanOrigin(origin)) return callback(null, true)
  return callback(new Error("Origen no permitido por CORS"))
}

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 1000),
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 80),
  standardHeaders: true,
  legacyHeaders: false,
})

app.set("trust proxy", 1)
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(cors({ origin: corsOriginValidator, credentials: true }))
app.use(express.json({ limit: "1mb" }))
app.use(apiLimiter)
registerBackupHooks(app)
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1")
    res.json({
      status: "ok",
      db: "ok",
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      db: "error",
      error: err?.message || "DB unavailable",
      timestamp: new Date().toISOString(),
    })
  }
})
app.use("/auth", authLimiter, authRoutes)
app.use(requireAuth)
app.use("/dashboard", dashboardRoutes)
app.use("/clientes", clientesRoutes)
app.use("/obras", obrasRoutes)
app.use("/grupos", gruposRoutes)
app.use("/empleados", empleadosRoutes)
app.use("/horas", horasRoutes)
app.use("/liquidaciones", liquidacionesRoutes)
app.use("/caja", cajaRoutes)
app.use("/presupuestos", presupuestosRoutes)
app.use("/certificados", certificadosRoutes)

const httpServer = createServer(app)

const io = new SocketIO(httpServer, {
  cors: {
    origin: corsOriginValidator,
    credentials: true,
    methods: ["GET", "POST"],
  }
})

io.use((socket, next) => {
  try {
  const tokenFromCookie = extractTokenFromRequest({ headers: { cookie: socket.handshake.headers?.cookie || "" } })
  const token = tokenFromCookie
    if (!token) {
      return next(new Error("Sesión requerida"))
    }

    socket.user = verifyAuthToken(token)
    next()
  } catch (error) {
    const message = String(error?.message || "")
    if (message.includes("JWT_SECRET")) {
      return next(new Error("Configuración de autenticación inválida"))
    }
    return next(new Error("Sesión expirada o inválida"))
  }
})

setIo(io)

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id)
  socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id))
})

const startServer = async () => {
  try {
    warnOnInsecureConfig()
    await ensureDatabaseSchema()
    await ensureBootstrapAdmin()
    startBackupService()
    httpServer.listen(port, host, () => {
      console.log(`Servidor corriendo en ${host}:${port}`)
    })
  } catch (error) {
    console.error("Error aplicando schema al iniciar:", error)
    process.exit(1)
  }
}

httpServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`No se pudo iniciar el backend porque ${host}:${port} ya está en uso`)
    process.exit(1)
    return
  }

  console.error("Error iniciando el servidor HTTP:", error)
  process.exit(1)
})

startServer()

process.on("unhandledRejection", (reason, promise) => {
  console.error("[process] Unhandled Rejection:", reason instanceof Error ? reason.stack : reason, "| Promise:", promise)
})

process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught Exception:", err.stack || err)
})
