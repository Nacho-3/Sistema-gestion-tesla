import express from "express"
import db, { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js"

const router = express.Router()
const MEDIOS_PAGO = ["efectivo", "transferencia", "cheque", "echeq", "retencion"]
const MEDIOS_CHEQUE = ["cheque", "echeq"]
const CAJAS_DISPONIBLES = ["tesla", "teslita", "juani"]
const CATEGORIAS_CAJA = ["mano_obra", "materiales", "varios"]
const LABEL_CAJA = {
  tesla: "Caja Tesla",
  teslita: "Caja Teslita",
  juani: "Caja Juani",
}
const LABEL_MEDIO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  echeq: "Echeq",
  retencion: "Retencion",
}
const LABEL_CATEGORIA = {
  mano_obra: "Mano de obra",
  materiales: "Materiales",
  varios: "Varios", 
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

let detalleColumnCache = null
let detallesSchemaCache = null

const roundMoney = (valor) => Math.round((Number(valor) || 0) * 100) / 100

const normalizarFechaISO = (valor) => {
  if (!valor) return null

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear()
    const m = String(valor.getMonth() + 1).padStart(2, "0")
    const d = String(valor.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }

  const texto = String(valor).split("T")[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto
  }

  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return null

  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const normalizarCajaSemanalId = (valor) => {
  if (valor === undefined || valor === null || valor === "") return undefined
  const texto = String(valor).trim()
  const match = texto.match(/^id-(\d+)$/i)
  const numero = Number(match ? match[1] : texto)
  return Number.isInteger(numero) && numero > 0 ? numero : undefined
}

const getRangoSemana = (fechaValor) => {
  const fechaIso = normalizarFechaISO(fechaValor)
  if (!fechaIso) throw new Error("Fecha inválida para calcular semana de caja")

  const [anio, mes, dia] = fechaIso.split("-").map(Number)
  const fecha = new Date(anio, mes - 1, dia)
  const diaSemana = fecha.getDay()
  // Lunes = 1, Domingo = 0
  const offsetLunes = diaSemana === 0 ? -6 : 1 - diaSemana
  const inicio = new Date(fecha)
  inicio.setDate(fecha.getDate() + offsetLunes)
  inicio.setHours(0, 0, 0, 0)
  const fin = new Date(inicio)
  fin.setDate(inicio.getDate() + 4) // Solo lunes a viernes
  fin.setHours(0, 0, 0, 0)

  const toIso = (value) => {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, "0")
    const d = String(value.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }

  return {
    fecha_inicio: toIso(inicio),
    fecha_fin: toIso(fin),
  }
}

async function obtenerCajaSemanalAnterior(caja_codigo, fecha_inicio) {
  const { data, error } = await db
    .from("cajas_semanales")
    .select("*")
    .eq("caja_codigo", caja_codigo)
    .lt("fecha_fin", fecha_inicio)
    .order("fecha_fin", { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] || null
}

async function asegurarCajaSemanal(caja_codigo, fecha) {
  const rango = getRangoSemana(fecha)
  const codigo = String(caja_codigo || "").toLowerCase()

  const { data: existentes, error: errorExistente } = await db
    .from("cajas_semanales")
    .select("*")
    .eq("caja_codigo", codigo)
    .eq("fecha_inicio", rango.fecha_inicio)
    .eq("fecha_fin", rango.fecha_fin)

  if (errorExistente) throw errorExistente

  const existente = Array.isArray(existentes) ? existentes[0] : null
  if (existente) return existente

  const { data: legacyMismaSemana, error: errorLegacy } = await db
    .from("cajas_semanales")
    .select("*")
    .eq("caja_codigo", codigo)
    .eq("fecha_inicio", rango.fecha_inicio)
    .order("fecha_fin", { ascending: true })

  if (errorLegacy) throw errorLegacy

  const legacy = Array.isArray(legacyMismaSemana) && legacyMismaSemana.length > 0 ? legacyMismaSemana[0] : null
  if (legacy) {
    const fechaFinLegacy = normalizarFechaISO(legacy.fecha_fin)
    if (fechaFinLegacy && fechaFinLegacy !== rango.fecha_fin) {
      const { data: actualizada, error: errorActualizada } = await db
        .from("cajas_semanales")
        .update({ fecha_fin: rango.fecha_fin })
        .eq("id", legacy.id)
        .select()
        .single()

      if (errorActualizada) throw errorActualizada
      return actualizada
    }

    return legacy
  }

  const saldoPrevio = await obtenerSaldoAcumuladoPorMedio(codigo, rango.fecha_inicio)
  const saldoInicial = roundMoney(saldoPrevio.total || 0)

  const { data: creada, error: errorCreada } = await db
    .from("cajas_semanales")
    .insert([{
      caja_codigo: codigo,
      fecha_inicio: rango.fecha_inicio,
      fecha_fin: rango.fecha_fin,
      saldo_inicial: saldoInicial,
      total_ingresos: 0,
      total_egresos: 0,
      saldo_final: saldoInicial,
      estado: "abierta",
    }])
    .select()
    .single()

  if (errorCreada) throw errorCreada
  return creada
}

async function recalcularCajaSemanal(cajaSemanalId) {
  if (!cajaSemanalId) return null

  const { data: semana, error: errorSemana } = await db
    .from("cajas_semanales")
    .select("*")
    .eq("id", cajaSemanalId)
    .single()

  if (errorSemana || !semana) {
    if (errorSemana) throw errorSemana
    return null
  }

  const { data: movimientos, error: errorMovimientos } = await db
    .from("movimientos_caja")
    .select(`
      monto_total,
      tipo,
      detalles_medio_pago(*)
    `)
    .eq("caja_semanal_id", cajaSemanalId)

  if (errorMovimientos) throw errorMovimientos

  const movimientosNormalizados = (movimientos || []).map(normalizarMovimiento)

  const totalIngresos = movimientos.filter(m => m.tipo === "ingreso").reduce((sum, m) => sum + Number(m.monto_total || 0), 0)
  const totalEgresos = movimientos.filter(m => m.tipo === "egreso").reduce((sum, m) => sum + Number(m.monto_total || 0), 0)
  const balance = totalIngresos - totalEgresos
  const cantidadMovimientos = movimientos.length

  const saldoInicialPorMedio = await obtenerSaldoAcumuladoPorMedio(semana.caja_codigo, semana.fecha_inicio)
  const saldoPorMedio = {
    efectivo: Number(saldoInicialPorMedio.efectivo || 0),
    cheques: Number(saldoInicialPorMedio.cheques || 0),
  }
  movimientosNormalizados.forEach((movimiento) => {
    actualizarSaldoPorMedio(saldoPorMedio, movimiento)
  })
  const saldoFinal = roundMoney(Number(saldoPorMedio.efectivo || 0) + Number(saldoPorMedio.cheques || 0))

  const { data: actualizada, error: errorActualizacion } = await db
    .from("cajas_semanales")
    .update({
      saldo_inicial: roundMoney(Number(saldoInicialPorMedio.total || 0)),
      total_ingresos: totalIngresos,
      total_egresos: totalEgresos,
      saldo_final: saldoFinal,
    })
    .eq("id", cajaSemanalId)
    .select()
    .single()

  if (errorActualizacion) throw errorActualizacion
  return actualizada
}

async function asignarCajaSemanalAMovimiento({ movimientoId, fecha, caja_codigo }) {
  const semana = await asegurarCajaSemanal(caja_codigo, fecha)

  if (String(semana.estado || "").toLowerCase() === "cerrada") {
    throw new Error("La semana de caja correspondiente ya está cerrada")
  }

  const { error } = await db
    .from("movimientos_caja")
    .update({ caja_semanal_id: semana.id })
    .eq("id", movimientoId)

  if (error) throw error

  await recalcularCajaSemanal(semana.id)
  return semana
}

const formatoMoneda = (valor) => {
  const numero = Number(valor) || 0
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numero)
}

const formatoFecha = (valor) => {
  if (!valor) return "-"

  const texto = String(valor)

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [anio, mes, dia] = texto.split("-")
    return `${dia}/${mes}/${anio}`
  }

  const fecha = new Date(valor)
  if (Number.isNaN(fecha.getTime())) return texto

  const dia = String(fecha.getDate()).padStart(2, "0")
  const mes = String(fecha.getMonth() + 1).padStart(2, "0")
  const anio = fecha.getFullYear()
  return `${dia}/${mes}/${anio}`
}


async function getDetalleColumn() {
  if (detalleColumnCache) return detalleColumnCache

  const result = await pool.query(
    `
      SELECT a.attname AS column_name
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('movimientos_caja')
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname IN ('detalle', 'descripcion', 'concepto')
    `
  )

  const columns = result.rows.map((row) => row.column_name)
  if (columns.includes("detalle")) {
    detalleColumnCache = "detalle"
  } else if (columns.includes("concepto")) {
    detalleColumnCache = "concepto"
  } else if (columns.includes("descripcion")) {
    detalleColumnCache = "descripcion"
  } else {
    detalleColumnCache = "detalle"
  }
  return detalleColumnCache
}

function normalizarMovimiento(movimiento) {
  if (!movimiento) return movimiento

  const detallesNormalizados = normalizarDetalles(movimiento.detalles_medio_pago || [])

  return {
    ...movimiento,
    caja_codigo: CAJAS_DISPONIBLES.includes(String(movimiento.caja_codigo || "").toLowerCase())
      ? String(movimiento.caja_codigo).toLowerCase()
      : "tesla",
    detalle: movimiento.detalle ?? movimiento.concepto ?? movimiento.descripcion ?? "",
    observaciones: String(movimiento.observaciones || "").trim(),
    categoria: CATEGORIAS_CAJA.includes(String(movimiento.categoria || "")) ? movimiento.categoria : null,
    con_iva: Boolean(movimiento.con_iva),
    destinatario: movimiento.destinatario || "",
    cliente_id: movimiento.cliente_id ?? null,
    nombre_cliente: movimiento.nombre_cliente ?? movimiento.cliente ?? null,
    numero_presupuesto: movimiento.numero_presupuesto ?? null,
    presupuesto_id: movimiento.presupuesto_id ?? null,
    detalles_medio_pago: detallesNormalizados,
  }
}

function normalizarBoolean(valor, defaultValue = false) {
  if (valor === undefined || valor === null || valor === "") return defaultValue
  if (typeof valor === "boolean") return valor
  if (typeof valor === "number") return valor !== 0
  const normalizado = String(valor).trim().toLowerCase()
  return ["true", "1", "si", "sí", "con_iva", "con iva"].includes(normalizado)
}

async function getDetallesSchema() {
  if (detallesSchemaCache) return detallesSchemaCache

  const result = await pool.query(
    `
      SELECT a.attname AS column_name
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('detalles_medio_pago')
        AND a.attnum > 0
        AND NOT a.attisdropped
    `
  )

  const columns = result.rows.map((row) => row.column_name)
  if (columns.includes("medio_pago") && columns.includes("monto")) {
    detallesSchemaCache = { mode: "filas" }
  } else {
    detallesSchemaCache = { mode: "columnas" }
  }

  return detallesSchemaCache
}

function normalizarDetalles(detalles) {
  if (!Array.isArray(detalles) || detalles.length === 0) return []

  const primerDetalle = detalles[0]
  if (Object.prototype.hasOwnProperty.call(primerDetalle, "medio_pago") && Object.prototype.hasOwnProperty.call(primerDetalle, "monto")) {
    return detalles
      .filter((item) => item.medio_pago)
      .map((item) => ({
        ...item,
        medio_pago: String(item.medio_pago).toLowerCase(),
        monto: parseFloat(item.monto || 0),
        identificador: String(item.identificador || "").trim() || null,
        banco: String(item.banco || "").trim() || null,
        fecha_cobro: item.fecha_cobro || null,
      }))
  }

  return MEDIOS_PAGO
    .map((medio) => ({
      medio_pago: medio,
      monto: parseFloat(primerDetalle[medio] || 0),
    }))
    .filter((item) => item.monto > 0)
}

// Solo efectivo y cheques comunes afectan el saldo inicial/final
function actualizarSaldoPorMedio(acumulador, movimiento) {
  const signo = String(movimiento?.tipo || "").toLowerCase() === "egreso" ? -1 : 1
  let montoAplicado = 0
  const detalles = Array.isArray(movimiento?.detalles_medio_pago) ? movimiento.detalles_medio_pago : []

  detalles.forEach((detalle) => {
    const medio = String(detalle?.medio_pago || "").toLowerCase()
    const monto = Number(detalle?.monto || 0)
    if (!(monto > 0)) return

    if (medio === "efectivo") {
      acumulador.efectivo += signo * monto
      montoAplicado += monto
    }
    // Solo cheques comunes (NO echeq, NO transferencia, NO retencion)
    if (medio === "cheque") {
      acumulador.cheques += signo * monto
      montoAplicado += monto
    }
    // NO sumar echeq, transferencia, retencion, etc.
  })

  // Compatibilidad con movimientos historicos sin desglose guardado.
  if (detalles.length === 0 && !(montoAplicado > 0)) {
    acumulador.efectivo += signo * Number(movimiento?.monto_total || 0)
  }
}

function deduplicarSemanasPorRango(semanas = []) {
  const mapa = new Map()

  semanas.forEach((semana) => {
    const inicio = normalizarFechaISO(semana?.fecha_inicio)
    const fin = normalizarFechaISO(semana?.fecha_fin)
    if (!inicio || !fin) return

    const clave = `${inicio}-${fin}`
    const existente = mapa.get(clave)
    const estadoSemana = String(semana?.estado || "").toLowerCase()
    const estadoExistente = String(existente?.estado || "").toLowerCase()

    if (!existente || (estadoExistente !== "abierta" && estadoSemana === "abierta")) {
      mapa.set(clave, semana)
    }
  })

  return Array.from(mapa.values()).sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio))
}

async function obtenerMovimientosCajaConDetalles(cajaCodigo) {
  await getDetallesSchema()

  const { data, error } = await db
    .from("movimientos_caja")
    .select(`
      id,
      fecha,
      tipo,
      monto_total,
      caja_semanal_id,
      detalles_medio_pago(*)
    `)
    .eq("caja_codigo", cajaCodigo)
    .order("fecha", { ascending: true })

  if (error) throw error
  return (data || []).map(normalizarMovimiento)
}

async function obtenerSaldoAcumuladoPorMedio(cajaCodigo, fechaCorteExclusiva) {
  if (!cajaCodigo) {
    return { efectivo: 0, cheques: 0, total: 0 }
  }

  const movimientos = await obtenerMovimientosCajaConDetalles(cajaCodigo)
  const acumulador = { efectivo: 0, cheques: 0 }

  movimientos.forEach((movimiento) => {
    const fechaMovimiento = normalizarFechaISO(movimiento.fecha)
    if (!fechaMovimiento) return
    if (fechaCorteExclusiva && fechaMovimiento >= fechaCorteExclusiva) return
    actualizarSaldoPorMedio(acumulador, movimiento)
  })

  return {
    efectivo: roundMoney(acumulador.efectivo),
    cheques: roundMoney(acumulador.cheques),
    total: roundMoney(acumulador.efectivo + acumulador.cheques),
  }
}

async function enriquecerSemanasConMedios(cajaCodigo, semanas = []) {
  if (!cajaCodigo || !Array.isArray(semanas) || semanas.length === 0) return semanas || []

  const movimientos = await obtenerMovimientosCajaConDetalles(cajaCodigo)
  const acumulador = { efectivo: 0, cheques: 0 }

  const enriquecidas = [...semanas]
    .map((semana) => ({ ...semana }))
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio))
    .map((semana) => {
      const semanaId = normalizarCajaSemanalId(semana.id)
      const inicio = normalizarFechaISO(semana.fecha_inicio)
      const fin = normalizarFechaISO(semana.fecha_fin)

      const movimientosSemana = movimientos.filter((movimiento) => {
        const movimientoSemanaId = normalizarCajaSemanalId(movimiento.caja_semanal_id)
        if (semanaId && movimientoSemanaId) {
          return semanaId === movimientoSemanaId
        }

        const fechaMovimiento = normalizarFechaISO(movimiento.fecha)
        if (!fechaMovimiento) return false
        return (!inicio || fechaMovimiento >= inicio) && (!fin || fechaMovimiento <= fin)
      })

      const semanaEnriquecida = {
        ...semana,
        saldo_inicial: roundMoney(acumulador.efectivo + acumulador.cheques),
        saldo_inicial_efectivo: roundMoney(acumulador.efectivo),
        saldo_inicial_cheques: roundMoney(acumulador.cheques),
      }

      movimientosSemana.forEach((movimiento) => {
        actualizarSaldoPorMedio(acumulador, movimiento)
      })

      semanaEnriquecida.saldo_final = roundMoney(acumulador.efectivo + acumulador.cheques)
      semanaEnriquecida.saldo_final_efectivo = roundMoney(acumulador.efectivo)
      semanaEnriquecida.saldo_final_cheques = roundMoney(acumulador.cheques)

      return semanaEnriquecida
    })

  return enriquecidas.sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio))
}

const MEDIOS_SIMPLES = ["efectivo", "transferencia", "retencion"]
const MEDIOS_MULTIPLES = ["cheque", "echeq"]

function construirDetallesPago({ desglose = {}, detalles_medio_pago = [] } = {}) {
  const detalles = []

  MEDIOS_SIMPLES.forEach((medio) => {
    const monto = parseFloat(desglose?.[medio] || 0)
    if (monto > 0) {
      detalles.push({
        medio_pago: medio,
        monto,
        identificador: null,
        banco: null,
        fecha_cobro: null,
      })
    }
  })

  if (Array.isArray(detalles_medio_pago)) {
    detalles_medio_pago.forEach((item) => {
      const medio = String(item?.medio_pago || "").toLowerCase().trim()
      const monto = parseFloat(item?.monto || 0)
      if (!MEDIOS_MULTIPLES.includes(medio) || !(monto > 0)) return

      detalles.push({
        medio_pago: medio,
        monto,
        identificador: String(item?.identificador || "").trim() || null,
        banco: String(item?.banco || "").trim() || null,
        fecha_cobro: item?.fecha_cobro || null,
      })
    })
  }

  return detalles
}

function validarDetallesPago(detalles = []) {
  if (!Array.isArray(detalles) || detalles.length === 0) {
    throw new Error("Debe incluir al menos un medio de pago")
  }

  for (const item of detalles) {
    const medio = String(item?.medio_pago || "").toLowerCase().trim()
    const monto = parseFloat(item?.monto || 0)
    if (!MEDIOS_PAGO.includes(medio)) {
      throw new Error(`Medio de pago inválido: ${medio}`)
    }
    if (!(monto > 0)) {
      throw new Error("Todos los medios de pago deben tener un monto mayor a 0")
    }
    if (MEDIOS_MULTIPLES.includes(medio) && !String(item?.identificador || "").trim()) {
      throw new Error(`Cada ${medio === "echeq" ? "eCheq" : "cheque"} debe tener un identificador`)
    }
  }
}

function totalDetallesPago(detalles = []) {
  return detalles.reduce((sum, item) => sum + parseFloat(item?.monto || 0), 0)
}

async function validarPresupuestoCliente(presupuestoId, clienteId) {
  if (!presupuestoId) return null

  const { data: presupuesto, error } = await db
    .from("presupuestos")
    .select("id, cliente_id")
    .eq("id", presupuestoId)
    .single()

  if (error || !presupuesto) {
    throw new Error("Presupuesto inválido")
  }

  if (clienteId && String(presupuesto.cliente_id) !== String(clienteId)) {
    throw new Error("El presupuesto seleccionado no pertenece al cliente indicado")
  }

  return presupuesto
}

async function obtenerMovimientosYTotales({ fecha_inicio, fecha_fin, tipo, caja_codigo, caja_semanal_id } = {}) {
  await getDetallesSchema()

  let query = db.from("movimientos_caja").select(`
    *,
    detalles_medio_pago(*)
  `)

  if (fecha_inicio) {
    query = query.gte("fecha", fecha_inicio)
  }

  if (fecha_fin) {
    const fechaFinAjustada = new Date(fecha_fin)
    fechaFinAjustada.setDate(fechaFinAjustada.getDate() + 1)
    query = query.lt("fecha", fechaFinAjustada.toISOString().split("T")[0])
  }

  if (tipo) {
    query = query.eq("tipo", tipo)
  }

  if (caja_codigo) {
    query = query.eq("caja_codigo", caja_codigo)
  }

  if (caja_semanal_id) {
    query = query.eq("caja_semanal_id", caja_semanal_id)
  }

  const { data, error } = await query.order("fecha", { ascending: false })
  if (error) throw error

  const totales = {
    totalIngresos: 0,
    totalEgresos: 0,
    desglose: {
      efectivo: 0,
      transferencia: 0,
      cheque: 0,
      echeq: 0,
      retencion: 0,
    },
  }

  const movimientos = (data || []).map(normalizarMovimiento)

  movimientos.forEach((mov) => {
    const montoTotal = parseFloat(mov.monto_total || 0)
    if (mov.tipo === "ingreso") {
      totales.totalIngresos += montoTotal
    } else {
      totales.totalEgresos += montoTotal
    }

    mov.detalles_medio_pago?.forEach((detalle) => {
      const medio = String(detalle.medio_pago || "").toLowerCase()
      if (totales.desglose[medio] !== undefined) {
        totales.desglose[medio] += parseFloat(detalle.monto || 0)
      }
    })
  })

  return { movimientos, totales }
}

// Listar movimientos de caja con filtros
router.get("/", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, tipo, caja_codigo, caja_semanal_id, busqueda } = req.query

    if (caja_codigo && !CAJAS_DISPONIBLES.includes(String(caja_codigo).toLowerCase())) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const cajaSemanalIdNormalizada = normalizarCajaSemanalId(caja_semanal_id)

    let { movimientos, totales } = await obtenerMovimientosYTotales({
      fecha_inicio,
      fecha_fin,
      tipo,
      caja_codigo: caja_codigo ? String(caja_codigo).toLowerCase() : undefined,
      caja_semanal_id: cajaSemanalIdNormalizada,
    })

    // Filtro por palabra clave si se envía 'busqueda'
    if (busqueda && String(busqueda).trim() !== "") {
      const palabra = String(busqueda).trim().toLowerCase()
      movimientos = movimientos.filter(mov => {
        return (
          (mov.detalle && mov.detalle.toLowerCase().includes(palabra)) ||
          (mov.observaciones && mov.observaciones.toLowerCase().includes(palabra)) ||
          (mov.destinatario && mov.destinatario.toLowerCase().includes(palabra)) ||
          (mov.nombre_cliente && mov.nombre_cliente.toLowerCase().includes(palabra))
        )
      })
    }

    res.json({
      movimientos,
      totales
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/semanas", async (req, res) => {
  try {
    const cajaCodigoNormalizada = String(req.query.caja_codigo || "tesla").toLowerCase()
    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const { data, error } = await db
      .from("cajas_semanales")
      .select("*")
      .eq("caja_codigo", cajaCodigoNormalizada)
      .order("fecha_inicio", { ascending: false })

    if (error) throw error

    let semanasEnriquecidas = await enriquecerSemanasConMedios(cajaCodigoNormalizada, data || [])
    semanasEnriquecidas = deduplicarSemanasPorRango(semanasEnriquecidas)
    res.json(semanasEnriquecidas)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/semana-actual", async (req, res) => {
  try {
    const cajaCodigoNormalizada = String(req.query.caja_codigo || "tesla").toLowerCase()
    const fechaBase = req.query.fecha || new Date().toISOString().slice(0, 10)

    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const semana = await asegurarCajaSemanal(cajaCodigoNormalizada, fechaBase)
    const semanaActualizada = await recalcularCajaSemanal(semana.id)

    const { data: semanasData, error: semanasError } = await db
      .from("cajas_semanales")
      .select("*")
      .eq("caja_codigo", cajaCodigoNormalizada)
      .order("fecha_inicio", { ascending: false })

    if (semanasError) throw semanasError

    const semanasEnriquecidas = deduplicarSemanasPorRango(await enriquecerSemanasConMedios(cajaCodigoNormalizada, semanasData || []))
    const semanaObjetivo = semanasEnriquecidas.find((item) => {
      return normalizarFechaISO(item.fecha_inicio) === normalizarFechaISO((semanaActualizada || semana)?.fecha_inicio)
        && normalizarFechaISO(item.fecha_fin) === normalizarFechaISO((semanaActualizada || semana)?.fecha_fin)
    })

    res.json(semanaObjetivo || semanaActualizada || semana)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post("/semanas/:id/cerrar", async (req, res) => {
  try {
    const { id } = req.params
    const { saldo_banco, saldo_pendiente_echeq } = req.body

    const idNumerico = Number(id)
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: "ID de semana inválido" })
    }

    let saldoBancoNormalizado = null
    if (saldo_banco !== undefined && saldo_banco !== null && String(saldo_banco).trim() !== "") {
      const saldoParsed = Number(saldo_banco)
      if (!Number.isFinite(saldoParsed)) {
        return res.status(400).json({ error: "Saldo de banco inválido" })
      }
      saldoBancoNormalizado = roundMoney(saldoParsed)
    }

    let saldoPendienteEcheqNormalizado = null
    if (saldo_pendiente_echeq !== undefined && saldo_pendiente_echeq !== null && String(saldo_pendiente_echeq).trim() !== "") {
      const saldoPendienteParsed = Number(saldo_pendiente_echeq)
      if (!Number.isFinite(saldoPendienteParsed)) {
        return res.status(400).json({ error: "Saldo pendiente de eCheqs inválido" })
      }
      saldoPendienteEcheqNormalizado = roundMoney(saldoPendienteParsed)
    }

    const semana = await recalcularCajaSemanal(idNumerico)
    if (!semana) {
      return res.status(404).json({ error: "Semana de caja no encontrada" })
    }

    // Cerrar la semana y guardar los saldos informativos del cierre
    const { data, error } = await db
      .from("cajas_semanales")
      .update({
        estado: "cerrada",
        saldo_banco: saldoBancoNormalizado,
        saldo_pendiente_echeq: saldoPendienteEcheqNormalizado,
      })
      .eq("id", idNumerico)
      .select()
      .single()

    if (error) throw error

    // Asegura la próxima semana en la base para que quede lista al cerrar.
    const fechaInicioActual = normalizarFechaISO(semana.fecha_inicio)
    const [anioInicio, mesInicio, diaInicio] = (fechaInicioActual || "").split("-").map(Number)
    const baseInicio = new Date(anioInicio, mesInicio - 1, diaInicio)
    baseInicio.setDate(baseInicio.getDate() + 7)
    const siguienteSemanaRef = normalizarFechaISO(baseInicio)
    const proximaSemanaDb = await asegurarCajaSemanal(semana.caja_codigo, siguienteSemanaRef)
    const proximaSemana = {
      id: proximaSemanaDb.id,
      fecha_inicio: normalizarFechaISO(proximaSemanaDb.fecha_inicio),
      fecha_fin: normalizarFechaISO(proximaSemanaDb.fecha_fin),
      estado: proximaSemanaDb.estado,
    }

    getIo()?.emit('caja:changed')
    res.json({
      semanaCerrada: data,
      proximaSemana
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/resumen/pdf", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, tipo, caja_codigo, resumen_modo, busqueda } = req.query
    const cajaCodigoNormalizada = caja_codigo ? String(caja_codigo).toLowerCase() : undefined
    const modoResumen = String(resumen_modo || "general").toLowerCase()

    if (cajaCodigoNormalizada && !CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    let { movimientos, totales } = await obtenerMovimientosYTotales({
      fecha_inicio,
      fecha_fin,
      tipo,
      caja_codigo: cajaCodigoNormalizada,
    })
    // Filtro por palabra clave si se envía 'busqueda'
    if (busqueda && String(busqueda).trim() !== "") {
      const palabra = String(busqueda).trim().toLowerCase()
      movimientos = movimientos.filter(mov => {
        return (
          (mov.detalle && mov.detalle.toLowerCase().includes(palabra)) ||
          (mov.observaciones && mov.observaciones.toLowerCase().includes(palabra)) ||
          (mov.destinatario && mov.destinatario.toLowerCase().includes(palabra)) ||
          (mov.nombre_cliente && mov.nombre_cliente.toLowerCase().includes(palabra))
        )
      })
    }
    // Recalcular totales y balance usando solo los movimientos filtrados
    const totalIngresos = movimientos.filter(m => m.tipo === "ingreso").reduce((sum, m) => sum + Number(m.monto_total || 0), 0)
    const totalEgresos = movimientos.filter(m => m.tipo === "egreso").reduce((sum, m) => sum + Number(m.monto_total || 0), 0)
    const cantidadIngresos = movimientos.filter(m => m.tipo === "ingreso").length
    const cantidadEgresos = movimientos.filter(m => m.tipo === "egreso").length
    const balance = totalIngresos - totalEgresos
    const cantidadMovimientos = movimientos.length
    const tieneRangoFechas = Boolean(fecha_inicio && fecha_fin)
    const esResumenSemanal = modoResumen === "semanal" && tieneRangoFechas
    const etiquetaPeriodo = esResumenSemanal
      ? `${formatoFecha(fecha_inicio)} al ${formatoFecha(fecha_fin)}`
      : "Período completo"

    let cajaSemanalResumen = null
    if (tieneRangoFechas && cajaCodigoNormalizada) {
      const { data: semanasCajaData, error: errorSemanaCaja } = await db
        .from("cajas_semanales")
        .select("*")
        .eq("caja_codigo", cajaCodigoNormalizada)
        .order("fecha_inicio", { ascending: false })

      if (errorSemanaCaja) throw errorSemanaCaja

      const semanaCaja = (semanasCajaData || []).find((semana) => {
        return normalizarFechaISO(semana.fecha_inicio) === normalizarFechaISO(fecha_inicio)
          && normalizarFechaISO(semana.fecha_fin) === normalizarFechaISO(fecha_fin)
      })

      const ultimaSemanaConSaldosRegistrados = (semanasCajaData || [])
        .filter((semana) => {
          return (semana?.saldo_banco !== null && semana?.saldo_banco !== undefined)
            || (semana?.saldo_pendiente_echeq !== null && semana?.saldo_pendiente_echeq !== undefined)
        })
        .sort((a, b) => {
          const fechaA = new Date(a?.updated_at || a?.fecha_fin || a?.created_at || 0).getTime()
          const fechaB = new Date(b?.updated_at || b?.fecha_fin || b?.created_at || 0).getTime()
          return fechaB - fechaA
        })[0] || null

      const saldoPrevio = await obtenerSaldoAcumuladoPorMedio(cajaCodigoNormalizada, fecha_inicio)
      const saldoFinalDesglosado = {
        efectivo: Number(saldoPrevio.efectivo || 0),
        cheques: Number(saldoPrevio.cheques || 0),
      }

      movimientos.forEach((movimiento) => {
        actualizarSaldoPorMedio(saldoFinalDesglosado, movimiento)
      })

      const saldoInicialEfectivo = roundMoney(saldoPrevio.efectivo)
      const saldoInicialCheques = roundMoney(saldoPrevio.cheques)
      const saldoFinalEfectivo = roundMoney(saldoFinalDesglosado.efectivo)
      const saldoFinalCheques = roundMoney(saldoFinalDesglosado.cheques)

      cajaSemanalResumen = {
        fecha_inicio,
        fecha_fin,
        saldo_inicial: roundMoney(saldoInicialEfectivo + saldoInicialCheques),
        saldo_inicial_efectivo: saldoInicialEfectivo,
        saldo_inicial_cheques: saldoInicialCheques,
        total_ingresos: Number(semanaCaja?.total_ingresos || totales.totalIngresos || 0),
        total_egresos: Number(semanaCaja?.total_egresos || totales.totalEgresos || 0),
        saldo_final: roundMoney(saldoFinalEfectivo + saldoFinalCheques),
        saldo_final_efectivo: saldoFinalEfectivo,
        saldo_final_cheques: saldoFinalCheques,
        saldo_banco: modoResumen === "general" ? ultimaSemanaConSaldosRegistrados?.saldo_banco ?? null : semanaCaja?.saldo_banco,
        saldo_pendiente_echeq: modoResumen === "general"
          ? ultimaSemanaConSaldosRegistrados?.saldo_pendiente_echeq ?? null
          : semanaCaja?.saldo_pendiente_echeq,
      }
    }

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const sufijoCaja = cajaCodigoNormalizada ? ` ${LABEL_CAJA[cajaCodigoNormalizada]}` : ""
    const nombreArchivo = `Resumen Caja${sufijoCaja} ${fechaArchivo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen de caja" })

    const drawSectionTitle = (title) => {
      drawPremiumSectionTitle(doc, title)
    }

    const filtroPeriodo = [
      cajaCodigoNormalizada ? LABEL_CAJA[cajaCodigoNormalizada] : "Todas las cajas",
      fecha_inicio ? `Desde ${formatoFecha(fecha_inicio)}` : "",
      fecha_fin ? `Hasta ${formatoFecha(fecha_fin)}` : "",
      tipo ? `Tipo ${tipo}` : "Todos los tipos",
    ].filter(Boolean).join(" - ")
    
    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: esResumenSemanal
        ? `${cajaCodigoNormalizada ? `Resumen semanal ${LABEL_CAJA[cajaCodigoNormalizada]}` : "Resumen semanal de caja"}`
        : (cajaCodigoNormalizada ? `Resumen ${LABEL_CAJA[cajaCodigoNormalizada]}` : "Resumen completo de caja"),
      accentText: filtroPeriodo || "Sin filtros",
      logoPath: LOGO_PATH,
    })  

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 15

    if (esResumenSemanal) {
      const periodoY = doc.y
      doc.roundedRect(45, periodoY, pageWidth - 90, 42, 6).fill("#dbeafe")
      doc.fillColor("#1e3a8a").font("Helvetica-Bold").fontSize(9)
      doc.text("SEMANA IMPRESA", 58, periodoY + 10, { width: 140 })
      doc.font("Helvetica").fontSize(11)
      doc.text(etiquetaPeriodo, 180, periodoY + 9, { width: pageWidth - 240, align: "right" })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = periodoY + 54

      const semanalY = doc.y
      const semanalHeight = 138
      const cardWidth = (pageWidth - 110) / 4
      doc.roundedRect(45, semanalY, pageWidth - 90, semanalHeight, 8).fill(PDF_COLORS.card)
      doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
      doc.text("Caja semanal", 58, semanalY + 10, { width: 180 })
      doc.font("Helvetica-Bold").fontSize(11)
      doc.text(etiquetaPeriodo, 58, semanalY + 28, { width: 220 })
      doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8.8)
      doc.text("La semana nueva arranca con el saldo final de la anterior y los movimientos quedan encapsulados en su propio período.", 58, semanalY + 46, { width: pageWidth - 116 })

      const cardsY = semanalY + 88
      const labels = [
        { titulo: "Saldo inicial", valor: cajaSemanalResumen?.saldo_inicial || 0 },
        { titulo: "Ingresos semana", valor: cajaSemanalResumen?.total_ingresos || 0 },
        { titulo: "Egresos semana", valor: cajaSemanalResumen?.total_egresos || 0 },
        { titulo: "Saldo final", valor: cajaSemanalResumen?.saldo_final || 0 },
      ]


      labels.forEach((item, index) => {
        const x = 58 + index * (cardWidth + 4)
        const mostrarDetalleMedios = index === 0 || index === 3
        const cardHeight = mostrarDetalleMedios ? 64 : 36

        doc.roundedRect(x, cardsY, cardWidth, cardHeight, 6).fill(index === 3 ? "#dbeafe" : PDF_COLORS.lightAlt)
        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8)
        doc.text(item.titulo.toUpperCase(), x + 8, cardsY + 6, { width: cardWidth - 16, lineBreak: false })
        doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10.2)
        doc.text(formatoMoneda(item.valor), x + 8, cardsY + 18, { width: cardWidth - 16, align: "left", lineBreak: false })

        if (mostrarDetalleMedios) {
          const efectivoValor = index === 0
            ? cajaSemanalResumen?.saldo_inicial_efectivo || 0
            : cajaSemanalResumen?.saldo_final_efectivo || 0
          const chequesValor = index === 0
            ? cajaSemanalResumen?.saldo_inicial_cheques || 0
            : cajaSemanalResumen?.saldo_final_cheques || 0

          doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.2)
          doc.text(`EFECTIVO: ${formatoMoneda(efectivoValor)}`, x + 8, cardsY + 34, { width: cardWidth - 16, lineBreak: false })
          doc.text(`CHEQUES: ${formatoMoneda(chequesValor)}`, x + 8, cardsY + 48, { width: cardWidth - 16, lineBreak: false })
        }
      })

      doc.fillColor(PDF_COLORS.ink)
      doc.y = semanalY + semanalHeight + 14
    }

    const resumenY = doc.y
    doc.roundedRect(65, resumenY, pageWidth - 90, 82, 6).fill(PDF_COLORS.card)
    const balanceTexto = formatoMoneda(balance)
    const balanceInicioX = 430 + 110 - doc.font("Helvetica-Bold").fontSize(13).widthOfString(balanceTexto)

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("MOVIMIENTOS", 58, resumenY + 10, { width: 100 })
    doc.text("INGRESOS", 185, resumenY + 10, { width: 120 })
    doc.text("EGRESOS", 320, resumenY + 10, { width: 120 })
    doc.text("BALANCE", balanceInicioX, resumenY + 10, { width: 110, align: "left" })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(13)
    doc.text(String(cantidadMovimientos), 58, resumenY + 24, { width: 100 })
    doc.text(String(cantidadIngresos), 185, resumenY + 24, { width: 120 })
    doc.text(String(cantidadEgresos), 320, resumenY + 24, { width: 120 })
    doc.text(balanceTexto, 430, resumenY + 24, { width: 110, align: "right" })

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, resumenY + 48).lineTo(pageWidth - 58, resumenY + 48).stroke()
    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(9)
    doc.text(`Generado: ${formatoFecha(new Date())}`, 58, resumenY + 56, { width: pageWidth - 116 })
    doc.fillColor(PDF_COLORS.ink)
    doc.y = resumenY + 92

    const saldoBancoInformativo = cajaSemanalResumen?.saldo_banco
    const saldoEcheqInformativo = cajaSemanalResumen?.saldo_pendiente_echeq
    const formatoMonedaOpcional = (valor) => {
      return valor === null || valor === undefined ? "No informado" : formatoMoneda(valor)
    }

    const saldosInfoY = doc.y + 6
    doc.roundedRect(45, saldosInfoY, pageWidth - 90, 58, 6).fill("#e0f2fe")
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9)
    doc.text("SALDOS INFORMATIVOS", 58, saldosInfoY + 8, { width: 180 })

    doc.fillColor("#1e3a8a").font("Helvetica-Bold").fontSize(8.8)
    doc.text("Saldo en banco", 58, saldosInfoY + 26, { width: 180 })
    doc.text("Saldo pendiente en eCheqs", 300, saldosInfoY + 26, { width: 180 })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(11)
    doc.text(formatoMonedaOpcional(saldoBancoInformativo), 58, saldosInfoY + 39, { width: 180 })
    doc.text(formatoMonedaOpcional(saldoEcheqInformativo), 300, saldosInfoY + 39, { width: 180 })
    doc.fillColor(PDF_COLORS.ink)
    doc.y = saldosInfoY + 70

    drawSectionTitle("Desglose por medio de pago")

    const desglosePorTipo = MEDIOS_PAGO.reduce((acc, medio) => {
      acc[medio] = { ingresos: 0, egresos: 0 }
      return acc
    }, {})

    movimientos.forEach((mov) => {
      ;(mov.detalles_medio_pago || []).forEach((detalle) => {
        const medio = String(detalle?.medio_pago || "").toLowerCase()
        const monto = parseFloat(detalle?.monto || 0)
        if (!desglosePorTipo[medio] || !(monto > 0)) return

        if (mov.tipo === "ingreso") {
          desglosePorTipo[medio].ingresos += monto
        } else {
          desglosePorTipo[medio].egresos += monto
        }
      })
    })

    const desgloseItems = MEDIOS_PAGO.map((medio) => ({
      label: LABEL_MEDIO[medio],
      ingresos: desglosePorTipo[medio].ingresos,
      egresos: desglosePorTipo[medio].egresos,
      total: desglosePorTipo[medio].ingresos - desglosePorTipo[medio].egresos,
    }))

    const colMedioX = 55
    const colIngresosX = 190
    const colEgresosX = 315
    const colTotalX = 440
    const colMedioWidth = 120
    const colMontoWidth = 105

    const tableLeft = 45
    const tableRight = pageWidth - 45

    const drawVerticalSeparators = (y, height) => {
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
      doc.moveTo(colEgresosX - 10, y).lineTo(colEgresosX - 10, y + height).stroke()
      doc.moveTo(colTotalX - 10, y).lineTo(colTotalX - 10, y + height).stroke()
    }

    const drawHorizontalSeparator = (y) => {
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.6)
      doc.moveTo(tableLeft, y).lineTo(tableRight, y).stroke()
    }

    const drawTableBorders = (topY, bottomY) => {
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
      doc.moveTo(tableLeft, topY).lineTo(tableLeft, bottomY).stroke()
      doc.moveTo(tableRight, topY).lineTo(tableRight, bottomY).stroke()
    }

    const drawDesgloseHeader = () => {
      const headerY = doc.y
      doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
      drawVerticalSeparators(headerY, 22)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
      doc.text("MEDIO", colMedioX, headerY + 7, { width: colMedioWidth })
      doc.text("INGRESOS", colIngresosX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
      doc.text("EGRESOS", colEgresosX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
      doc.text("TOTAL", colTotalX, headerY + 7, { width: colMontoWidth, align: "right", lineBreak: false })
      drawHorizontalSeparator(headerY + 22)
      doc.fillColor(PDF_COLORS.ink)
      doc.y = headerY + 22
    }

    const tableTopY = doc.y
    drawDesgloseHeader()
    let yDesglose = doc.y
    desgloseItems.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
      doc.rect(45, yDesglose, pageWidth - 90, 20).fill(bg)
      drawVerticalSeparators(yDesglose, 20)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.8)
      doc.text(item.label, colMedioX, yDesglose + 6, { width: colMedioWidth, lineBreak: false })
      doc.text(formatoMoneda(item.ingresos), colIngresosX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
      doc.text(formatoMoneda(item.egresos), colEgresosX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
      doc.text(formatoMoneda(item.total), colTotalX, yDesglose + 6, { width: colMontoWidth, align: "right", lineBreak: false })
      drawHorizontalSeparator(yDesglose + 20)
      yDesglose += 20
    })

    doc.rect(45, yDesglose, pageWidth - 90, 22).fill(PDF_COLORS.card)
    drawVerticalSeparators(yDesglose, 22)
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(9.2)
    doc.text("TOTAL GENERAL", colMedioX, yDesglose + 7, { width: colMedioWidth })
    doc.text(formatoMoneda(totalIngresos), colIngresosX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(totalEgresos), colEgresosX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
    doc.text(formatoMoneda(balance), colTotalX, yDesglose + 7, { width: colMontoWidth, align: "right", lineBreak: false })
    drawHorizontalSeparator(yDesglose)
    yDesglose += 22

    drawHorizontalSeparator(yDesglose)
    drawTableBorders(tableTopY, yDesglose)
    doc.fillColor(PDF_COLORS.ink)
    doc.y = yDesglose + 6

    const drawDetallePageHeader = () => {
      const detalleHeaderBottom = drawPremiumHeader(doc, {
        title: "TESLA MONTAJES ELECTRICOS",
        subtitle: "Detalle de movimientos de caja",
        accentText: filtroPeriodo || "Sin filtros",
        logoPath: LOGO_PATH,
      })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = detalleHeaderBottom + 14
      drawSectionTitle("Detalle de movimientos")
    }

    const drawMovHeader = () => {
      const headerY = doc.y
      doc.rect(45, headerY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(8.5)
      doc.text("FECHA", 50, headerY + 8, { width: 68 })
      doc.text("CAJA", 120, headerY + 8, { width: 72 })
      doc.text("DETALLE", 194, headerY + 8, { width: 158 })
      doc.text("MEDIOS", 345, headerY + 8, { width: 150 })
      doc.text("MONTO", 456, headerY + 8, { width: 44, align: "right" })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = headerY + 24
    }

    // El detalle siempre empieza en la segunda página.
    doc.addPage()
    drawDetallePageHeader()
    drawMovHeader()
    let yMov = doc.y

    if (movimientos.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("No hay movimientos para los filtros seleccionados", 55, yMov)
      doc.fillColor("#111827")
    } else {
      movimientos.forEach((mov, idx) => {
        const medios = (mov.detalles_medio_pago || [])
          .filter((d) => parseFloat(d.monto || 0) > 0)
          .map((d) => {
            const nombre = LABEL_MEDIO[d.medio_pago] || d.medio_pago
            const identificador = String(d.identificador || "").trim()
            return identificador
              ? `${nombre} (${identificador}): ${formatoMoneda(d.monto)}`
              : `${nombre}: ${formatoMoneda(d.monto)}`
          })
          .join("\n")

        const textoCaja = `${LABEL_CAJA[mov.caja_codigo] || mov.caja_codigo} / ${mov.tipo === "ingreso" ? "Ingreso" : "Egreso"}`
        const textoDetalle = String(mov.detalle || mov.destinatario || "-")
        const textoMonto = formatoMoneda(mov.monto_total)

        doc.font("Helvetica").fontSize(8.5)
        const contenidoHeight = Math.max(
          doc.heightOfString(formatoFecha(mov.fecha), { width: 68 }),
          doc.heightOfString(textoCaja, { width: 72 }),
          doc.heightOfString(textoDetalle, { width: 135 }),
          doc.heightOfString(medios || "-", { width: 150 }),
          doc.heightOfString(textoMonto, { width: 60, align: "right" }),
        )
        const rowHeight = Math.max(26, contenidoHeight + 12)

        if (yMov + rowHeight > doc.page.height - 74) {
          doc.addPage()
          drawDetallePageHeader()
          drawMovHeader()
          yMov = doc.y
        }

        const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, yMov, pageWidth - 90, rowHeight).fill(bg)

        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.5)
        doc.text(formatoFecha(mov.fecha), 50, yMov + 6, { width: 68 })
        doc.text(textoCaja, 120, yMov + 6, { width: 72 })
        doc.text(textoDetalle, 185, yMov + 6, { width: 135 })
        doc.text(medios || "-", 320, yMov + 6, { width: 150 })
        doc.text(textoMonto, 456, yMov + 6, { width: 60, align: "right" })
        doc.strokeColor(PDF_COLORS.line).lineWidth(0.5).moveTo(60, yMov + rowHeight).lineTo(pageWidth - 60, yMov + rowHeight).stroke()
        yMov += rowHeight + 4
      })
    }

    doc.end()
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params
    await getDetallesSchema()

    const { data, error } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Movimiento no encontrado" })

    const movimiento = normalizarMovimiento(data)
    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const nombreArchivo = `Movimiento Caja ${id} ${fechaArchivo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Comprobante de movimiento de caja" })

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Comprobante de movimiento de caja",
      accentText: `Movimiento #${movimiento.id}`,
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 16

    const infoY = doc.y
    doc.roundedRect(45, infoY, pageWidth - 90, 98, 6).fill(PDF_COLORS.card)

    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8.5)
    doc.text("FECHA", 58, infoY + 12, { width: 100 })
    doc.text("TIPO", 170, infoY + 12, { width: 100 })
    doc.text("MONTO", 282, infoY + 12, { width: 120 })
    doc.text("DETALLE", 58, infoY + 52, { width: 420 })

    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
    doc.text(formatoFecha(movimiento.fecha), 58, infoY + 26, { width: 100 })
    doc.text(movimiento.tipo === "ingreso" ? "Ingreso" : "Egreso", 170, infoY + 26, { width: 100 })
    doc.text(formatoMoneda(movimiento.monto_total), 282, infoY + 26, { width: 140 })
    doc.font("Helvetica").fontSize(10).fillColor(PDF_COLORS.ink)
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, infoY + 48).lineTo(pageWidth - 58, infoY + 48).stroke()
    
    doc.text(movimiento.detalle || "-", 58, infoY + 66, { width: pageWidth - 116 })
    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(58, infoY + 98).lineTo(pageWidth - 58, infoY + 98).stroke()

    let infoAdicionalY = infoY + 108

    doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.slate)
    doc.text(`Caja: ${LABEL_CAJA[movimiento.caja_codigo] || "Caja Tesla"}`, 58, infoAdicionalY, { width: 180 })
    doc.text(`IVA: ${movimiento.con_iva ? "Con IVA" : "Sin IVA"}`, 250, infoAdicionalY, { width: 120 })
    doc.text(`Categoria: ${LABEL_CATEGORIA[movimiento.categoria] || "-"}`, 360, infoAdicionalY, { width: 140, align: "right" })

    if (movimiento.destinatario) {
      doc.text(`Destinatario: ${movimiento.destinatario}`, 58, infoAdicionalY + 20, { width: 472 })
    }
    doc.text(`Cliente: ${movimiento.cliente || "-"}`, 250, infoAdicionalY + 20, { width: 85 })
    doc.text(`Presupuesto: ${movimiento.presupuesto_id || "-"}`, 410, infoAdicionalY + 20, { width: 90, align: "right" })

    const observacionesTexto = String(movimiento.observaciones || "").trim()
    let separadorY = infoAdicionalY + 50
    if (observacionesTexto) {
      const observacionesY = infoAdicionalY + 36
      doc.text(`Observaciones: ${observacionesTexto}`, 58, observacionesY, { width: pageWidth - 116 })
      const altoObservaciones = doc.heightOfString(`Observaciones: ${observacionesTexto}`, { width: pageWidth - 116 })
      separadorY = observacionesY + Math.max(18, altoObservaciones + 6)
    }

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, separadorY).lineTo(pageWidth - 45, separadorY).stroke()

    let infoDesgloseY = separadorY + 10
    doc.moveDown(0.4)
    doc.font("Helvetica-Bold").fontSize(12).fillColor(PDF_COLORS.navy).text("Desglose por medio de pago", 45, infoDesgloseY, { width: pageWidth - 90, align: "center" })
    doc.moveDown(0.25)
  

    const detalles = (movimiento.detalles_medio_pago || []).filter((d) => parseFloat(d.monto || 0) > 0)
    const desgloseItems = (detalles.length > 0 ? detalles : MEDIOS_PAGO.map((medio) => ({ medio_pago: medio, monto: 0 })))

    const headerY = doc.y
    doc.rect(45, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
    doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
    doc.text("MEDIO", 55, headerY + 7, { width: 280 })
    doc.text("MONTO", 395, headerY + 7, { width: 120, align: "right" })
    doc.fillColor(PDF_COLORS.ink)

    let y = headerY + 22
    desgloseItems.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
      doc.rect(45, y, pageWidth - 90, 20).fill(bg)
      doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(9.5)
      doc.text(LABEL_MEDIO[item.medio_pago] || '\n' + item.medio_pago, 55, y + 6, { width: 280 }) +'\n'+ 
      doc.text(formatoMoneda(item.monto), 410, y + 6, { width: 120, align: "right" })
      y += 20
    })

    doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8)
    doc.text(`Generado ${formatoFecha(new Date())}`, 45, doc.page.height - doc.page.margins.bottom - 6, { width: pageWidth - 90, align: "right" })

    doc.end()
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// Obtener movimiento por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await getDetallesSchema()

    const { data, error } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Movimiento no encontrado" })

    res.json(normalizarMovimiento(data))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear movimiento de caja
router.post("/", async (req, res) => {
  try {
    const { fecha, caja_codigo, tipo, detalle, observaciones, monto_total, desglose, detalles_medio_pago, categoria, con_iva, cliente_id, presupuesto_id, destinatario } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()
    const cajaCodigoNormalizada = String(caja_codigo || "").toLowerCase()
    const tipoNormalizado = String(tipo || "").toLowerCase()
    const destinatarioNormalizado = String(destinatario || "").trim()
    const observacionesNormalizadas = String(observaciones || "").trim()

    // Validaciones
    if (!fecha || !cajaCodigoNormalizada || !tipoNormalizado || !detalle || !monto_total) {
      return res.status(400).json({ error: "Campos requeridos: fecha, caja_codigo, tipo, detalle, monto_total" })
    }

    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida. Debe ser tesla, teslita o juani" })
    }

    if (!["ingreso", "egreso"].includes(tipoNormalizado)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }

    if (tipoNormalizado === "ingreso" && !categoria) {
      return res.status(400).json({ error: "La categoría es obligatoria para ingresos" })
    }

    if (tipoNormalizado === "egreso" && !destinatarioNormalizado) {
      return res.status(400).json({ error: "El destinatario es obligatorio para egresos" })
    }

    if (categoria && !CATEGORIAS_CAJA.includes(categoria)) {
      return res.status(400).json({ error: "Categoria inválida. Debe ser 'mano_obra', 'materiales' o 'varios'" })
    }

    if (monto_total <= 0) {
      return res.status(400).json({ error: "Monto total debe ser mayor a 0" })
    }

    const detallesPago = construirDetallesPago({ desglose, detalles_medio_pago })
    validarDetallesPago(detallesPago)

    const sumaDesglose = totalDetallesPago(detallesPago)
    if (Math.abs(sumaDesglose - monto_total) > 0.01) { // Tolerancia de 0.01
      return res.status(400).json({ 
        error: `La suma del desglose (${sumaDesglose}) no coincide con el monto total (${monto_total})` 
      })
    }

    await validarPresupuestoCliente(presupuesto_id, cliente_id)

    // Crear movimiento (solo los campos básicos, sin desglose)
    const { data: movimiento, error: errorMovimiento } = await db
      .from("movimientos_caja")
      .insert([
        {
          fecha: fecha,
          caja_codigo: cajaCodigoNormalizada,
          tipo: tipoNormalizado,
          [detalleColumn]: detalle,
          observaciones: observacionesNormalizadas || null,
          monto_total: parseFloat(monto_total),
          categoria: tipoNormalizado === "ingreso" ? (categoria || null) : null,
          con_iva: normalizarBoolean(con_iva, true),
          destinatario: tipoNormalizado === "egreso" ? destinatarioNormalizado : null,
          cliente_id: tipoNormalizado === "ingreso" ? (cliente_id || null) : null,
          presupuesto_id: tipoNormalizado === "ingreso" ? (presupuesto_id || null) : null,
        }
      ])
      .select()

    if (errorMovimiento) {
      console.error("Error al insertar movimiento:", errorMovimiento)
      return res.status(400).json({ error: errorMovimiento.message })
    }

    const movimientoId = movimiento[0].id

    // Crear detalles de medio de pago por separado
    let errorDetalles = null
    if (detallesSchema.mode === "filas") {
      const detalles = detallesPago.map((item) => ({
        movimiento_id: movimientoId,
        medio_pago: item.medio_pago,
        monto: parseFloat(item.monto),
        identificador: item.identificador,
        banco: item.banco,
        fecha_cobro: item.fecha_cobro,
      }))

      if (detalles.length > 0) {
        const resultDetalles = await db.from("detalles_medio_pago").insert(detalles)
        errorDetalles = resultDetalles.error
      }
    } else {
      const detalleFila = {
        movimiento_id: movimientoId,
        efectivo: parseFloat(desglose.efectivo) || 0,
        transferencia: parseFloat(desglose.transferencia) || 0,
        cheque: parseFloat(desglose.cheque) || 0,
        echeq: parseFloat(desglose.echeq) || 0,
        retencion: parseFloat(desglose.retencion) || 0,
      }
      const resultDetalles = await db.from("detalles_medio_pago").insert([detalleFila])
      errorDetalles = resultDetalles.error
    }

    if (errorDetalles) {
      console.error("Error al insertar detalles:", errorDetalles)
      await db.from("movimientos_caja").delete().eq("id", movimientoId)
      return res.status(400).json({ error: "Error al registrar detalles de pago: " + errorDetalles.message })
    }

    await asignarCajaSemanalAMovimiento({
      movimientoId,
      fecha,
      caja_codigo: cajaCodigoNormalizada,
    })

    // Retornar movimiento completo
    const { data: movimientoCompleto } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", movimientoId)
      .single()

    getIo()?.emit('caja:changed')
    res.status(201).json(normalizarMovimiento(movimientoCompleto))
  } catch (err) {
    console.error("Error en POST /caja:", err)
    res.status(500).json({ error: err.message })
  }
})

// Actualizar movimiento
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { fecha, caja_codigo, tipo, detalle, observaciones, monto_total, desglose, detalles_medio_pago, categoria, con_iva, cliente_id, presupuesto_id, destinatario } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()
    const cajaCodigoNormalizada = caja_codigo !== undefined ? String(caja_codigo || "").toLowerCase() : undefined
    const tipoNormalizado = tipo !== undefined ? String(tipo || "").toLowerCase() : undefined
    const destinatarioNormalizado = destinatario !== undefined ? String(destinatario || "").trim() : undefined
    const observacionesNormalizadas = observaciones !== undefined ? String(observaciones || "").trim() : undefined

    const { data: movimientoActual } = await db
      .from("movimientos_caja")
      .select("*")
      .eq("id", id)
      .single()

    if (!movimientoActual) {
      return res.status(404).json({ error: "Movimiento no encontrado" })
    }

    const tipoFinal = tipoNormalizado || String(movimientoActual.tipo || "").toLowerCase()

    // Validaciones básicas
    if (tipoNormalizado && !["ingreso", "egreso"].includes(tipoNormalizado)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }

    if (cajaCodigoNormalizada && !CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida. Debe ser tesla, teslita o juani" })
    }

    if (monto_total && monto_total <= 0) {
      return res.status(400).json({ error: "Monto total debe ser mayor a 0" })
    }

    if (tipoFinal === "ingreso" && categoria !== undefined && !categoria) {
      return res.status(400).json({ error: "La categoría es obligatoria para ingresos" })
    }

    if (tipoFinal === "egreso" && destinatario !== undefined && !destinatarioNormalizado) {
      return res.status(400).json({ error: "El destinatario es obligatorio para egresos" })
    }

    if (categoria !== undefined && categoria !== null && categoria !== "" && !CATEGORIAS_CAJA.includes(categoria)) {
      return res.status(400).json({ error: "Categoria inválida. Debe ser 'mano_obra', 'materiales' o 'varios'" })
    }

    const clienteFinal = cliente_id !== undefined ? cliente_id : movimientoActual.cliente_id
    const presupuestoFinal = presupuesto_id !== undefined ? presupuesto_id : movimientoActual.presupuesto_id
    await validarPresupuestoCliente(presupuestoFinal, clienteFinal)

    // Actualizar movimiento
    const actualizaciones = {}
    if (fecha !== undefined) actualizaciones.fecha = fecha
    if (caja_codigo !== undefined) actualizaciones.caja_codigo = cajaCodigoNormalizada || "tesla"
    if (tipo !== undefined) actualizaciones.tipo = tipoNormalizado
    if (detalle !== undefined) actualizaciones[detalleColumn] = detalle
    if (observaciones !== undefined) actualizaciones.observaciones = observacionesNormalizadas || null
    if (monto_total !== undefined) actualizaciones.monto_total = monto_total
    if (categoria !== undefined) actualizaciones.categoria = tipoFinal === "ingreso" ? (categoria || null) : null
    if (con_iva !== undefined) actualizaciones.con_iva = normalizarBoolean(con_iva, true)
    if (destinatario !== undefined) actualizaciones.destinatario = tipoFinal === "egreso" ? destinatarioNormalizado : null
    if (cliente_id !== undefined) actualizaciones.cliente_id = tipoFinal === "ingreso" ? (cliente_id || null) : null
    if (presupuesto_id !== undefined) actualizaciones.presupuesto_id = tipoFinal === "ingreso" ? (presupuesto_id || null) : null

    if (tipo !== undefined && tipoFinal === "egreso") {
      actualizaciones.categoria = null
      if (cliente_id === undefined) actualizaciones.cliente_id = null
      if (presupuesto_id === undefined) actualizaciones.presupuesto_id = null
    }

    if (tipo !== undefined && tipoFinal === "ingreso" && destinatario === undefined) {
      actualizaciones.destinatario = null
    }

    const cajaSemanalAnteriorId = movimientoActual.caja_semanal_id
    const fechaFinalMovimiento = fecha !== undefined ? fecha : movimientoActual.fecha
    const cajaFinalMovimiento = caja_codigo !== undefined ? (cajaCodigoNormalizada || "tesla") : movimientoActual.caja_codigo

    const { data: movimientoActualizado, error: errorActualizacion } = await db
      .from("movimientos_caja")
      .update(actualizaciones)
      .eq("id", id)
      .select()

    if (errorActualizacion) return res.status(400).json({ error: errorActualizacion.message })
    if (movimientoActualizado.length === 0) return res.status(404).json({ error: "Movimiento no encontrado" })

    // Actualizar detalles si se proporciona desglose o detalles de pago
    if (desglose || detalles_medio_pago) {
      const detallesPago = construirDetallesPago({ desglose, detalles_medio_pago })
      validarDetallesPago(detallesPago)
      const montoBaseValidacion = monto_total ?? movimientoActualizado[0]?.monto_total ?? movimientoActual.monto_total ?? 0
      const montoTotalValidacion = parseFloat(montoBaseValidacion || 0)
      const sumaDesglose = totalDetallesPago(detallesPago)
      if (Math.abs(sumaDesglose - montoTotalValidacion) > 0.01) {
        return res.status(400).json({
          error: `La suma del desglose (${sumaDesglose}) no coincide con el monto total (${montoTotalValidacion})`
        })
      }

      // Eliminar detalles anteriores
      await db.from("detalles_medio_pago").delete().eq("movimiento_id", id)

      if (detallesSchema.mode === "filas") {
        const detalles = detallesPago.map((item) => ({
          movimiento_id: id,
          medio_pago: item.medio_pago,
          monto: parseFloat(item.monto),
          identificador: item.identificador,
          banco: item.banco,
          fecha_cobro: item.fecha_cobro,
        }))

        if (detalles.length > 0) {
          const { error: errorDetalles } = await db.from("detalles_medio_pago").insert(detalles)
          if (errorDetalles) return res.status(400).json({ error: errorDetalles.message })
        }
      } else {
        const detalleFila = {
          movimiento_id: id,
          efectivo: parseFloat(desglose.efectivo) || 0,
          transferencia: parseFloat(desglose.transferencia) || 0,
          cheque: parseFloat(desglose.cheque) || 0,
          echeq: parseFloat(desglose.echeq) || 0,
          retencion: parseFloat(desglose.retencion) || 0,
        }

        const { error: errorDetalles } = await db.from("detalles_medio_pago").insert([detalleFila])
        if (errorDetalles) return res.status(400).json({ error: errorDetalles.message })
      }
    }

    const semanaAsignada = await asignarCajaSemanalAMovimiento({
      movimientoId: id,
      fecha: fechaFinalMovimiento,
      caja_codigo: cajaFinalMovimiento,
    })

    if (cajaSemanalAnteriorId && String(cajaSemanalAnteriorId) !== String(semanaAsignada?.id || "")) {
      await recalcularCajaSemanal(cajaSemanalAnteriorId)
    }

    // Retornar movimiento actualizado
    const { data: movimientoFinal } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", id)
      .single()

    getIo()?.emit('caja:changed')
    res.json(normalizarMovimiento(movimientoFinal))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar movimiento (cascade delete de detalles)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data: movimientoActual, error: errorMovimientoActual } = await db
      .from("movimientos_caja")
      .select("id, caja_semanal_id")
      .eq("id", id)
      .single()

    if (errorMovimientoActual || !movimientoActual) {
      return res.status(404).json({ error: "Movimiento no encontrado" })
    }

    // Eliminar detalles primero
    await db.from("detalles_medio_pago").delete().eq("movimiento_id", id)

    // Eliminar movimiento
    const { data, error } = await db
      .from("movimientos_caja")
      .delete()
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Movimiento no encontrado" })

    await recalcularCajaSemanal(movimientoActual.caja_semanal_id)

    getIo()?.emit('caja:changed')
    res.json({ mensaje: "Movimiento eliminado", data: data[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
