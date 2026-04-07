const SESSION_KEY = "session"

const parseSession = (raw) => {
	if (!raw) return null
	try {
		return JSON.parse(raw)
	} catch {
		return null
	}
}

export const getStoredSession = () => {
	const sessionFromSessionStorage = parseSession(window.sessionStorage.getItem(SESSION_KEY))
	if (sessionFromSessionStorage) return sessionFromSessionStorage

	const legacySession = parseSession(window.localStorage.getItem(SESSION_KEY))
	if (legacySession) {
		window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(legacySession))
		window.localStorage.removeItem(SESSION_KEY)
	}
	return legacySession
}

export const setStoredSession = (session) => {
	window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
	window.localStorage.removeItem(SESSION_KEY)
}

export const clearStoredSession = () => {
	window.sessionStorage.removeItem(SESSION_KEY)
	window.localStorage.removeItem(SESSION_KEY)
}

export const hasStoredSession = () => {
	const session = getStoredSession()
	return Boolean(session?.user?.id)
}
