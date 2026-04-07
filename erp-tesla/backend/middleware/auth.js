import jwt from "jsonwebtoken"
import { getSessionCookieName, parseCookies } from "../utils/http-cookies.js"

const SESSION_COOKIE = getSessionCookieName()

export const verifyAuthToken = (token) => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error("JWT_SECRET no configurado")
  }

  return jwt.verify(token, secret)
}

export const extractTokenFromRequest = (req) => {
  const cookies = parseCookies(req.headers.cookie || "")
  return String(cookies[SESSION_COOKIE] || "").trim()
}

export const requireAuth = (req, res, next) => {
  const token = extractTokenFromRequest(req)

  if (!token) {
    return res.status(401).json({ error: "Sesión requerida" })
  }

  try {
    req.user = verifyAuthToken(token)
    next()
  } catch (error) {
    if (String(error?.message || "").includes("JWT_SECRET")) {
      return res.status(500).json({ error: "JWT_SECRET no configurado" })
    }
    return res.status(401).json({ error: "Sesión expirada o inválida" })
  }
}