const COOKIE_NAME = "tesla_session"

export const getSessionCookieName = () => COOKIE_NAME

export const parseCookies = (cookieHeader = "") => {
	return String(cookieHeader || "")
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.reduce((acc, entry) => {
			const separatorIndex = entry.indexOf("=")
			if (separatorIndex === -1) return acc
			const key = entry.slice(0, separatorIndex).trim()
			const value = entry.slice(separatorIndex + 1).trim()
			if (!key) return acc
			acc[key] = decodeURIComponent(value)
			return acc
		}, {})
}

export const serializeCookie = (name, value, options = {}) => {
	const parts = [`${name}=${encodeURIComponent(value)}`]
	if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
	if (options.path) parts.push(`Path=${options.path}`)
	if (options.httpOnly) parts.push("HttpOnly")
	if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
	if (options.secure) parts.push("Secure")
	return parts.join("; ")
}