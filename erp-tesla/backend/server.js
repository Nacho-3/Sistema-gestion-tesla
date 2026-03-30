import { createServer } from "http"
import fs from "fs"
import path from "path"
import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import { Server as SocketIO } from "socket.io"
import { fileURLToPath } from "url"
import { pool } from "./db.js"
import { setIo } from "./socket.js"
import authRoutes from "./auth.js"
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

const ensureDatabaseSchema = async () => {
  const sql = fs.readFileSync(schemaPath, "utf8")
  await pool.query(sql)
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
app.use(cors({ origin: corsOriginValidator }))
app.use(express.json({ limit: "1mb" }))
app.use(apiLimiter)
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
    methods: ["GET", "POST"],
  }
})

setIo(io)

io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id)
  socket.on("disconnect", () => console.log("Cliente desconectado:", socket.id))
})

const startServer = async () => {
  try {
    await ensureDatabaseSchema()
    httpServer.listen(3000, "0.0.0.0", () => {
      console.log("Servidor corriendo en puerto 3000")
    })
  } catch (error) {
    console.error("Error aplicando schema al iniciar:", error)
    process.exit(1)
  }
}

startServer()
