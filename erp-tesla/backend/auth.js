import express from "express"
import db from "./db.js"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const router = express.Router()

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

    return res.json({
      session: {
        access_token: token,
        token_type: "bearer",
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

export default router