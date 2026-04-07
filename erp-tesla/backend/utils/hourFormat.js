export const roundHourDecimal = (value) => {
	const numberValue = Number(value)
	if (!Number.isFinite(numberValue)) return 0
	return Math.round(numberValue * 100) / 100
}

const getClockPartsFromDecimalHours = (value) => {
	const numberValue = Number(value)
	if (!Number.isFinite(numberValue)) return null

	const sign = numberValue < 0 ? "-" : ""
	const totalMinutes = Math.round(Math.abs(numberValue) * 60)
	const hours = Math.floor(totalMinutes / 60)
	const minutes = totalMinutes % 60

	return {
		sign,
		hours,
		minutes,
	}
}

export const formatHoursAsClock = (value, fallback = "0.00") => {
	const parts = getClockPartsFromDecimalHours(value)
	if (!parts) return fallback
	return `${parts.sign}${parts.hours}.${String(parts.minutes).padStart(2, "0")}`
}

export const parseHoursInput = (value) => {
	if (value === "" || value === null || value === undefined) return null
	if (typeof value === "number") return Number.isFinite(value) ? roundHourDecimal(value) : null

	const rawValue = String(value).trim()
	if (!rawValue) return null

	const normalized = rawValue.replace(/\s+/g, "").replace(/,/g, ".")

	if (/^\d+:\d{1,2}$/.test(normalized)) {
		const [hoursPart, minutesPart] = normalized.split(":")
		const hours = Number(hoursPart)
		const minutes = Number(minutesPart)

		if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null
		return roundHourDecimal(hours + (minutes / 60))
	}

	if (/^\d+$/.test(normalized)) {
		return roundHourDecimal(Number(normalized))
	}

	if (/^\d+[.]\d{2}$/.test(normalized)) {
		const [hoursPart, minutesPart] = normalized.split(".")
		const hours = Number(hoursPart)
		const minutes = Number(minutesPart)

		if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null
		return roundHourDecimal(hours + (minutes / 60))
	}

	if (/^\d+[.]\d{1}$/.test(normalized)) {
		return roundHourDecimal(Number(normalized))
	}

	return null
}

export const convertStoredClockNumberToDecimal = (value) => {
	if (value === null || value === undefined || value === "") return null

	const raw = String(value).trim().replace(/,/g, ".")
	if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null

	const [hoursPart, decimalPartRaw = "00"] = raw.split(".")
	const minutesPart = decimalPartRaw.padEnd(2, "0").slice(0, 2)
	const hours = Number(hoursPart)
	const minutes = Number(minutesPart)

	if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null

	return roundHourDecimal(hours + (minutes / 60))
}