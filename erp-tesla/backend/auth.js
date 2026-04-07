import express from "express"
import db from "./db.js"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { requireAuth } from "./middleware/auth.js"
import { runBackupNow } from "./services/backup-service.js"
import { getSessionCookieName, serializeCookie } from "./utils/http-cookies.js"

const router = express.Router()
const SESSION_COOKIE = getSessionCookieName()
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12

const isCookieSecure = () => String(process.env.COOKIE_SECURE || "").trim().toLowerCase() === "true"

const buildSessionCookie = (token) => serializeCookie(SESSION_COOKIE, token, {
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
  secure: isCookieSecure(),
  maxAge: SESSION_MAX_AGE_SECONDS,
})

const buildExpiredSessionCookie = () => serializeCookie(SESSION_COOKIE, "", {
  path: "/",
  httpOnly: true,
  sameSite: "Lax",
  secure: isCookieSecure(),
  maxAge: 0,
})

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email y contraseña son obligatorios" })
    }

    const result = await db.query(
      `SELECT id, email, password_hash, nombre, rol, activo FROM usuarios WHERE email = $1 LIMIT 1`,
      [email]
    )

    const usuario = result.rows[0]

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: "Credenciales incorrectas" })
    }

    const passwordOk = await bcrypt.compare(password, usuario.password_hash)
    if (!passwordOk) {
      return res.status(401).json({ error: "Credenciales incorrectas" })
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
      return res.status(500).json({ error: "JWT_SECRET no configurado" })
    }

    const token = jwt.sign(
      {
        sub: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        nombre: usuario.nombre,
      },
      secret,
      { expiresIn: "12h" }
    )

	res.setHeader("Set-Cookie", buildSessionCookie(token))

    return res.json({
      session: {
		token_type: "cookie",
        expires_in: 43200,
        user: {
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          rol: usuario.rol,
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})

router.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", buildExpiredSessionCookie())
  return res.json({ ok: true })
})

router.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: {
      id: req.user.sub,
      email: req.user.email,
      nombre: req.user.nombre,
      rol: req.user.rol,
    },
  })
})

router.post("/backup", requireAuth, async (_req, res) => {
  try {
    const result = await runBackupNow("manual_panel")
    return res.json({ ok: true, filePath: result?.filePath || null })
  } catch (error) {
    return res.status(500).json({ error: error.message || "No se pudo generar el backup" })
  }
})

export default router