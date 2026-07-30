import express from "express"
import db, { pool } from "../db.js"
import { getIo } from '../socket.js'
import PDFDocument from "pdfkit"
import path from "path"
import { fileURLToPath } from "url"
import { drawPremiumHeader, setupPremiumFooter, drawPremiumSectionTitle, PDF_COLORS, sanitizeFileText } from "../pdf/premiumTheme.js"

const router = express.Router()
const MEDIOS_PAGO = ["efectivo", "transferencia", "banco", "cheque", "echeq", "retencion"]
const MEDIOS_CHEQUE = ["cheque", "echeq"]
const CAJAS_DISPONIBLES = ["tesla", "teslita", "juani"]
const TIPOS_MOVIMIENTO = ["ingreso", "egreso"]
const CATEGORIAS_CAJA = ["mano_obra", "materiales", "varios"]
const LABEL_CAJA = {
  tesla: "Caja Tesla",
  teslita: "Caja Teslita",
  juani: "Caja Juani",
}
const LABEL_MEDIO = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  banco: "Banco",
  cheque: "Cheque",
  echeq: "Echeq",
  retencion: "Retencion",
}
const ESTADOS_LIBRO_CHEQUES = ["disponible", "salido", "anulado"]
const LABEL_CATEGORIA = {
  mano_obra: "Mano de obra",
  materiales: "Materiales",
  varios: "Varios", 
}
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, "..", "assets", "logo_presupuesto.png")

// Función auxiliar para sanitizar texto
const sanitizeText = (value) => String(value || "").trim()

let detalleColumnCache = null
let detallesSchemaCache = null
let libroChequesSchemaReady = false
let movimientosCajaPresupuestosSchemaReady = false
let detallesMedioPagoConstraintReady = false
let movimientosCajaRulesSchemaReady = false
let cajasSemanalesSchemaReady = false

const roundMoney = (valor) => Math.round((Number(valor) || 0) * 100) / 100

async function ensureLibroChequesSchema() {
  if (libroChequesSchemaReady) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS libro_cheques_caja (
      id SERIAL PRIMARY KEY,
      caja_codigo VARCHAR(20) NOT NULL CHECK (caja_codigo IN ('tesla', 'teslita', 'juani')),
      medio_pago VARCHAR(20) NOT NULL CHECK (medio_pago IN ('cheque', 'echeq')),
      movimiento_entrada_id INTEGER NOT NULL REFERENCES movimientos_caja(id),
      movimiento_salida_id INTEGER REFERENCES movimientos_caja(id),
      detalle_medio_pago_entrada_id INTEGER REFERENCES detalles_medio_pago(id) ON DELETE SET NULL,
      fecha_entrada DATE NOT NULL,
      librador_endosante TEXT NOT NULL,
      banco TEXT NOT NULL,
      numero_cheque TEXT NOT NULL,
      importe NUMERIC(12,2) NOT NULL CHECK (importe > 0),
      fecha_cheque DATE NOT NULL,
      fecha_salida DATE,
      endosado_a TEXT,
      estado VARCHAR(20) NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'salido', 'anulado')),
      observaciones TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await pool.query(`
    ALTER TABLE IF EXISTS detalles_medio_pago
      ADD COLUMN IF NOT EXISTS librador_endosante TEXT,
      ADD COLUMN IF NOT EXISTS numero_cheque TEXT,
      ADD COLUMN IF NOT EXISTS fecha_cheque DATE,
      ADD COLUMN IF NOT EXISTS fecha_entrada DATE,
      ADD COLUMN IF NOT EXISTS endosado_a TEXT,
      ADD COLUMN IF NOT EXISTS libro_cheque_id INTEGER;
  `)

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_detalles_libro_cheque'
          AND conrelid = 'detalles_medio_pago'::regclass
      ) THEN
        ALTER TABLE detalles_medio_pago
          ADD CONSTRAINT fk_detalles_libro_cheque
          FOREIGN KEY (libro_cheque_id) REFERENCES libro_cheques_caja(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `)

  await pool.query("CREATE INDEX IF NOT EXISTS idx_libro_cheques_estado ON libro_cheques_caja(estado);")
  await pool.query("CREATE INDEX IF NOT EXISTS idx_libro_cheques_caja_estado ON libro_cheques_caja(caja_codigo, estado);")
  await pool.query("CREATE INDEX IF NOT EXISTS idx_libro_cheques_numero ON libro_cheques_caja(numero_cheque);")

  libroChequesSchemaReady = true
}

async function ensureMovimientosCajaPresupuestosSchema() {
  if (movimientosCajaPresupuestosSchemaReady) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movimientos_caja_presupuestos (
      movimiento_id INTEGER NOT NULL REFERENCES movimientos_caja(id) ON DELETE CASCADE,
      presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
      monto_asignado NUMERIC(12,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (movimiento_id, presupuesto_id)
    );
  `)

  await pool.query("ALTER TABLE movimientos_caja_presupuestos ADD COLUMN IF NOT EXISTS monto_asignado NUMERIC(12,2);")
  await pool.query(`
    UPDATE movimientos_caja_presupuestos mcp
    SET monto_asignado = mc.monto_total
    FROM movimientos_caja mc
    WHERE mcp.movimiento_id = mc.id
      AND (mcp.monto_asignado IS NULL OR mcp.monto_asignado <= 0)
  `)

  await pool.query("CREATE INDEX IF NOT EXISTS idx_movimientos_caja_presupuestos_movimiento_id ON movimientos_caja_presupuestos(movimiento_id);")
  await pool.query("CREATE INDEX IF NOT EXISTS idx_movimientos_caja_presupuestos_presupuesto_id ON movimientos_caja_presupuestos(presupuesto_id);")

  movimientosCajaPresupuestosSchemaReady = true
}

async function ensureMovimientosCajaRulesSchema() {
  if (movimientosCajaRulesSchemaReady) return

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('movimientos_caja') IS NULL THEN
        RETURN;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_movimientos_reglas_tipo'
          AND conrelid = 'movimientos_caja'::regclass
      ) THEN
        ALTER TABLE movimientos_caja DROP CONSTRAINT chk_movimientos_reglas_tipo;
      END IF;

      ALTER TABLE movimientos_caja
        ADD CONSTRAINT chk_movimientos_reglas_tipo CHECK (
          (
            tipo = 'ingreso'
            AND categoria IN ('mano_obra', 'materiales', 'varios')
            AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NULL
            AND (presupuesto_id IS NULL OR cliente_id IS NOT NULL)
          )
          OR
          (
            tipo = 'egreso'
            AND categoria IS NULL
            AND presupuesto_id IS NULL
            AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NOT NULL
          )
        );
    END $$;
  `)

  movimientosCajaRulesSchemaReady = true
}

async function ensureCajasSemanalesSchema() {
  if (cajasSemanalesSchemaReady) return

  await pool.query(`ALTER TABLE IF EXISTS cajas_semanales ALTER COLUMN fecha_fin DROP NOT NULL;`)

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('cajas_semanales') IS NULL THEN
        RETURN;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_cajas_semanales_rango'
          AND conrelid = 'cajas_semanales'::regclass
      ) THEN
        ALTER TABLE cajas_semanales DROP CONSTRAINT chk_cajas_semanales_rango;
      END IF;

      ALTER TABLE cajas_semanales
        ADD CONSTRAINT chk_cajas_semanales_rango
        CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio);
    END $$;
  `)

  cajasSemanalesSchemaReady = true
}

async function ensureDetallesMedioPagoConstraint() {
  if (detallesMedioPagoConstraintReady) return

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('detalles_medio_pago') IS NULL THEN
        RETURN;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_detalles_medio_pago_codigo'
          AND conrelid = 'detalles_medio_pago'::regclass
      ) THEN
        ALTER TABLE detalles_medio_pago DROP CONSTRAINT chk_detalles_medio_pago_codigo;
      END IF;

      ALTER TABLE detalles_medio_pago
        ADD CONSTRAINT chk_detalles_medio_pago_codigo
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'banco', 'cheque', 'echeq', 'retencion'));
    END $$;
  `)

  detallesMedioPagoConstraintReady = true
}

const normalizeChequeDate = (value, fallback = null) => {
  const normalized = normalizarFechaISO(value)
  return normalized || fallback
}

const sanitizeChequeText = (value) => String(value || "").trim()

const isChequePayment = (medioPago) => ["cheque", "echeq"].includes(String(medioPago || "").toLowerCase())

const validarCamposChequeIngreso = (item = {}) => {
  const esEcheq = String(item.medio_pago || "").toLowerCase() === "echeq"
  const libradorEndosante = sanitizeChequeText(item.librador_endosante)
  const banco = sanitizeChequeText(item.banco)
  const numeroCheque = sanitizeChequeText(item.numero_cheque || item.identificador)
  const fechaCheque = normalizeChequeDate(item.fecha_cheque)
  const fechaEntrada = normalizeChequeDate(item.fecha_entrada, normalizeChequeDate(item.fecha_cobro))

  if (!esEcheq && !libradorEndosante) throw new Error("Cada cheque de ingreso debe informar librador o endosante")
  if (!esEcheq && !banco) throw new Error("Cada cheque de ingreso debe informar banco")
  if (!numeroCheque) throw new Error("Cada cheque de ingreso debe informar numero de cheque")
  if (!esEcheq && !fechaCheque) throw new Error("Cada cheque de ingreso debe informar fecha de cheque")
  if (!fechaEntrada) throw new Error("Cada cheque de ingreso debe informar fecha de entrada")

  return {
    librador_endosante: esEcheq ? (libradorEndosante || "") : libradorEndosante,
    banco: esEcheq ? (banco || "") : banco,
    numero_cheque: numeroCheque,
    fecha_cheque: esEcheq ? (fechaCheque || fechaEntrada) : fechaCheque,
    fecha_entrada: fechaEntrada,
  }
}

async function crearChequesLibroDesdeIngreso({ client, movimientoId, cajaCodigo, fechaMovimiento, detallesPago = [] }) {
  const chequesIngreso = detallesPago.filter((item) => String(item?.medio_pago || "").toLowerCase() === "cheque")
  if (!chequesIngreso.length) return

  const existentes = await client.query(
    `
      SELECT COUNT(*)::int AS total
      FROM libro_cheques_caja
      WHERE movimiento_entrada_id = $1
    `,
    [movimientoId]
  )
  if (Number(existentes.rows?.[0]?.total || 0) > 0) {
    throw new Error("El movimiento ya tiene cheques registrados en el libro")
  }

  const fechaDefault = normalizeChequeDate(fechaMovimiento)
  const filas = chequesIngreso.map((item) => {
    const camposCheque = validarCamposChequeIngreso(item)
    return {
      caja_codigo: cajaCodigo,
      medio_pago: String(item.medio_pago).toLowerCase(),
      movimiento_entrada_id: movimientoId,
      fecha_entrada: camposCheque.fecha_entrada || fechaDefault,
      librador_endosante: camposCheque.librador_endosante,
      banco: camposCheque.banco,
      numero_cheque: camposCheque.numero_cheque,
      importe: roundMoney(Number(item.monto || 0)),
      fecha_cheque: camposCheque.fecha_cheque,
      observaciones: sanitizeChequeText(item.observaciones) || null,
    }
  })

  for (const fila of filas) {
    const duplicado = await client.query(
      `
        SELECT id
        FROM libro_cheques_caja
        WHERE caja_codigo = $1
          AND LOWER(COALESCE(numero_cheque, '')) = LOWER($2)
          AND LOWER(COALESCE(banco, '')) = LOWER($3)
          AND fecha_cheque = $4
          AND importe = $5
          AND estado <> 'anulado'
        LIMIT 1
      `,
      [fila.caja_codigo, fila.numero_cheque, fila.banco, fila.fecha_cheque, fila.importe]
    )

    if (duplicado.rowCount > 0) {
      throw new Error(`Cheque duplicado detectado (${fila.numero_cheque}) en libro de cheques`)
    }

    const values = [
      fila.caja_codigo,
      fila.medio_pago,
      fila.movimiento_entrada_id,
      fila.fecha_entrada,
      fila.librador_endosante,
      fila.banco,
      fila.numero_cheque,
      fila.importe,
      fila.fecha_cheque,
      fila.observaciones,
    ]

    await client.query(
      `
      INSERT INTO libro_cheques_caja (
        caja_codigo, medio_pago, movimiento_entrada_id, fecha_entrada,
        librador_endosante, banco, numero_cheque, importe, fecha_cheque, observaciones
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      values
    )
  }
}

async function registrarSalidaCheques({
  client,
  movimientoId,
  cajaCodigo,
  fechaSalida,
  fechaMovimiento = null,
  endosadoA,
  chequesSalida = [],
  expectedChequeTotal = null,
}) {
  if (!Array.isArray(chequesSalida) || !chequesSalida.length) return []

  const ids = chequesSalida
    .map((item) => Number(item?.libro_cheque_id || item?.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)

  if (!ids.length) throw new Error("Debe seleccionar al menos un cheque disponible para el egreso")

  const idsUnicos = Array.from(new Set(ids))
  if (idsUnicos.length !== ids.length) {
    throw new Error("Hay cheques repetidos en la selección de salida")
  }

  const fechaMovimientoNorm = normalizeChequeDate(fechaMovimiento)
  let fechaSalidaNorm = normalizeChequeDate(fechaSalida, fechaMovimientoNorm)
  if (!fechaSalidaNorm) throw new Error("La fecha de salida de cheque es obligatoria")

  // Nunca permitir una salida de cheque anterior a la fecha del movimiento de egreso.
  // Si llega una fecha anterior por desfasaje/normalización del front, se corrige al vuelo.
  if (fechaMovimientoNorm && fechaSalidaNorm < fechaMovimientoNorm) {
    fechaSalidaNorm = fechaMovimientoNorm
  }

  const endosadoTexto = sanitizeChequeText(endosadoA)
  if (!endosadoTexto) throw new Error("Debe indicar a quien se endosa el cheque")

  const placeholders = idsUnicos.map((_, i) => `$${i + 1}`).join(",")
  const placeholdersUpdate = idsUnicos.map((_, i) => `$${i + 4}`).join(",")
  const consulta = await client.query(
    `
      SELECT id, caja_codigo, estado, importe, movimiento_salida_id
      FROM libro_cheques_caja
      WHERE id IN (${placeholders})
      FOR UPDATE
    `,
    idsUnicos
  )

  if (consulta.rowCount !== idsUnicos.length) {
    throw new Error("Uno o mas cheques seleccionados no existen en el libro")
  }

  const movimientoSalidaIdActual = Number(movimientoId || 0)
  const invalidos = consulta.rows.filter((row) => {
    if (row.caja_codigo !== cajaCodigo) return true

    if (row.estado === "disponible") return false

    // Permitir re-editar un egreso manteniendo cheques que ya estaban
    // asociados a este mismo movimiento.
    const movimientoSalidaIdCheque = Number(row.movimiento_salida_id || 0)
    return !(row.estado === "salido" && movimientoSalidaIdCheque === movimientoSalidaIdActual)
  })
  if (invalidos.length) {
    throw new Error("Hay cheques seleccionados que no estan disponibles para salida")
  }

  if (expectedChequeTotal !== null && expectedChequeTotal !== undefined) {
    const totalSeleccionado = roundMoney(consulta.rows.reduce((acc, row) => acc + Number(row.importe || 0), 0))
    const totalEsperado = roundMoney(Number(expectedChequeTotal || 0))
    if (Math.abs(totalSeleccionado - totalEsperado) > 0.01) {
      throw new Error(`La suma de cheques seleccionados (${totalSeleccionado}) no coincide con el monto en desglose (${totalEsperado})`)
    }
  }

  await client.query(
    `
      UPDATE libro_cheques_caja
      SET estado = 'salido',
          movimiento_salida_id = $1,
          fecha_salida = $2,
          endosado_a = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholdersUpdate})
    `,
    [movimientoId, fechaSalidaNorm, endosadoTexto, ...idsUnicos]
  )

  return consulta.rows
}

function validarEgresoConChequesLibro({ detallesPago = [], chequesSalida = [] } = {}) {
  const chequesDetalle = (detallesPago || []).filter((item) => isChequePayment(item?.medio_pago))
  if (!chequesDetalle.length) return { totalChequesDetalle: 0 }

  const idsDetalles = chequesDetalle
    .map((item) => Number(item?.libro_cheque_id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)

  if (idsDetalles.length !== chequesDetalle.length) {
    throw new Error("En egresos, todos los cheques del desglose deben estar vinculados al libro de cheques")
  }

  const idsSalida = (Array.isArray(chequesSalida) ? chequesSalida : [])
    .map((item) => Number(item?.libro_cheque_id || item?.id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)

  if (!idsSalida.length) {
    throw new Error("Debe seleccionar cheques del libro para registrar egresos con cheque/eCheq")
  }

  const setSalida = new Set(idsSalida)
  const faltantes = idsDetalles.filter((id) => !setSalida.has(id))
  if (faltantes.length > 0) {
    throw new Error("Hay cheques en el desglose que no fueron seleccionados en la salida")
  }

  const totalChequesDetalle = roundMoney(chequesDetalle.reduce((acc, item) => acc + Number(item?.monto || 0), 0))
  return { totalChequesDetalle }
}

async function revertirSalidaChequesPorMovimiento({ client, movimientoId }) {
  await client.query(
    `
      UPDATE libro_cheques_caja
      SET estado = 'disponible',
          movimiento_salida_id = NULL,
          fecha_salida = NULL,
          endosado_a = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE movimiento_salida_id = $1
    `,
    [movimientoId]
  )
}

async function obtenerChequesSalidaPorMovimiento(movimientoId) {
  const id = Number(movimientoId || 0)
  if (!Number.isInteger(id) || id <= 0) return []

  const result = await pool.query(
    `
      SELECT id, medio_pago, importe, numero_cheque, banco, librador_endosante, fecha_cheque, fecha_salida, endosado_a
      FROM libro_cheques_caja
      WHERE movimiento_salida_id = $1
      ORDER BY id ASC
    `,
    [id]
  )

  return result.rows || []
}

async function obtenerChequesIngresoPorMovimiento(movimientoId) {
  const id = Number(movimientoId || 0)
  if (!Number.isInteger(id) || id <= 0) return []

  const result = await pool.query(
    `
      SELECT id, medio_pago, importe, numero_cheque, banco, librador_endosante, fecha_cheque, fecha_entrada
      FROM libro_cheques_caja
      WHERE movimiento_entrada_id = $1
      ORDER BY id ASC
    `,
    [id]
  )

  return result.rows || []
}

async function validarIngresoEliminable({ client, movimientoId }) {
  const res = await client.query(
    `
      SELECT COUNT(*)::int AS total
      FROM libro_cheques_caja
      WHERE movimiento_entrada_id = $1
        AND estado = 'salido'
    `,
    [movimientoId]
  )
  if (Number(res.rows?.[0]?.total || 0) > 0) {
    throw new Error("No se puede eliminar/modificar este ingreso porque ya tiene cheques dados de salida")
  }
}

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

  return null
}

const normalizarFechaISO_conHora = (valor) => {
  if (!valor) return null

  const formatearLocal = (fecha) => {
    const y = fecha.getFullYear()
    const m = String(fecha.getMonth() + 1).padStart(2, "0")
    const d = String(fecha.getDate()).padStart(2, "0")
    const hh = String(fecha.getHours()).padStart(2, "0")
    const mm = String(fecha.getMinutes()).padStart(2, "0")
    const ss = String(fecha.getSeconds()).padStart(2, "0")
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
  }

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return formatearLocal(valor)
  }

  const texto = String(valor).trim()

  // Si ya viene timestamp textual (YYYY-MM-DDTHH:mm[:ss] o con espacio),
  // conservarlo sin convertir zona horaria.
  const matchFechaHora = texto.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/) 
  if (matchFechaHora) {
    const [, fecha, hh, mm, ss] = matchFechaHora
    return `${fecha} ${hh}:${mm}:${ss || "00"}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return `${texto} 00:00:00`
  }

  const fecha = new Date(texto)
  if (!Number.isNaN(fecha.getTime())) {
    return formatearLocal(fecha)
  }

  return null
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

async function obtenerCajaSemanalAnterior(caja_codigo, fecha_inicio, semanaActualId = null) {
  const cajaCodigo = String(caja_codigo || "").toLowerCase().trim()
  const fechaInicio = normalizarFechaISO(fecha_inicio)
  const semanaIdExcluir = normalizarCajaSemanalId(semanaActualId)

  if (!cajaCodigo || !fechaInicio) return null

  const params = [cajaCodigo, fechaInicio]
  let filtroExcluir = ""
  if (semanaIdExcluir) {
    params.push(semanaIdExcluir)
    filtroExcluir = ` AND id <> $${params.length}`
  }

  const result = await pool.query(
    `
      SELECT *
      FROM cajas_semanales
      WHERE caja_codigo = $1
        AND fecha_fin <= $2
        ${filtroExcluir}
      ORDER BY fecha_fin DESC, id DESC
      LIMIT 1
    `,
    params
  )

  return result.rows?.[0] || null
}

async function obtenerChequesDisponiblesAlCierreSemana({ cajaCodigo, fechaFin }) {
  if (!cajaCodigo || !fechaFin) return []

  const result = await pool.query(
    `
      SELECT l.*
      FROM libro_cheques_caja l
      WHERE l.caja_codigo = $1
        AND l.medio_pago = 'cheque'
        AND LOWER(COALESCE(l.estado, '')) <> 'anulado'
        AND l.fecha_entrada <= $2
        AND (l.fecha_salida IS NULL OR l.fecha_salida > $2)
      ORDER BY l.fecha_cheque DESC NULLS LAST, l.id ASC
    `,
    [cajaCodigo, fechaFin]
  )

  return result.rows || []
}

async function obtenerChequesControladosSemana(cajaSemanalId) {
  const id = Number(cajaSemanalId || 0)
  if (!Number.isInteger(id) || id <= 0) return []

  const result = await pool.query(
    `
      SELECT l.*
      FROM cajas_semanales_cheques_control c
      JOIN libro_cheques_caja l ON l.id = c.libro_cheque_id
      WHERE c.caja_semanal_id = $1
      ORDER BY l.fecha_cheque DESC NULLS LAST, l.id ASC
    `,
    [id]
  )

  return result.rows || []
}

async function obtenerChequesDisponiblesSemana({ cajaCodigo, cajaSemanalId, fechaReferencia }) {
  const semanaId = Number(cajaSemanalId || 0)
  if (!Number.isInteger(semanaId) || semanaId <= 0) return []

  const semanaQ = await pool.query(
    `SELECT * FROM cajas_semanales WHERE id = $1 LIMIT 1`,
    [semanaId]
  )
  const semana = semanaQ.rows?.[0]
  if (!semana) return []

  if (!semana.control_inicial_realizado) {
    // Regla de negocio: hasta registrar el control semanal inicial,
    // no hay cheques disponibles para egresar en la semana activa.
    return []
  }

  const controlados = await obtenerChequesControladosSemana(semanaId)

  const ingresosSemanaQ = await pool.query(
    `
      SELECT l.*
      FROM libro_cheques_caja l
      JOIN movimientos_caja m ON m.id = l.movimiento_entrada_id
      WHERE m.caja_semanal_id = $1
        AND m.caja_codigo = $2
        AND LOWER(COALESCE(l.estado, '')) = 'disponible'
        AND l.medio_pago = 'cheque'
      ORDER BY l.fecha_cheque DESC NULLS LAST, l.id ASC
    `,
    [semanaId, cajaCodigo]
  )

  const mapa = new Map()
  ;[...(controlados || []), ...(ingresosSemanaQ.rows || [])].forEach((row) => {
    if (!row?.id) return
    if (String(row.estado || "").toLowerCase() !== "disponible") return
    mapa.set(Number(row.id), row)
  })

  return Array.from(mapa.values())
}

async function obtenerSemanaAbierta(cajaCodigo) {
  await ensureCajasSemanalesSchema()

  const codigo = String(cajaCodigo || "").toLowerCase().trim()
  if (!codigo) return null

  const result = await pool.query(
    `
      SELECT *
      FROM cajas_semanales
      WHERE caja_codigo = $1
        AND BTRIM(LOWER(COALESCE(estado, ''))) IN ('abierta', 'abierto')
      ORDER BY fecha_inicio DESC, id DESC
      LIMIT 1
    `,
    [codigo]
  )
  const semana = result.rows?.[0] || null
  if (!semana) return null

  // Auto-correccion: una semana abierta no debe tener fecha_fin hasta cerrarse.
  if (semana.fecha_fin) {
    const actualizada = await pool.query(
      `
        UPDATE cajas_semanales
        SET fecha_fin = NULL
        WHERE id = $1
        RETURNING *
      `,
      [semana.id]
    )
    return actualizada.rows?.[0] || semana
  }

  return semana
}

async function resolverSemanaDestinoMovimiento({ caja_codigo, caja_semanal_id, permitirCerrada = false }) {
  const codigo = String(caja_codigo || "").toLowerCase().trim()
  if (!CAJAS_DISPONIBLES.includes(codigo)) {
    throw new Error("Caja inválida")
  }

  const semanaId = normalizarCajaSemanalId(caja_semanal_id)

  if (semanaId) {
    const semanaQ = await pool.query(
      `SELECT * FROM cajas_semanales WHERE id = $1 LIMIT 1`,
      [semanaId]
    )
    const semana = semanaQ.rows?.[0]
    if (!semana) throw new Error("Semana de caja no encontrada")
    if (String(semana.caja_codigo || "").toLowerCase() !== codigo) {
      throw new Error("La semana seleccionada no pertenece a la caja indicada")
    }
    if (!permitirCerrada && ["cerrada", "cerrado"].includes(String(semana.estado || "").trim().toLowerCase())) {
      throw new Error("La semana seleccionada está cerrada")
    }
    return semana
  }

  const semanaAbierta = await obtenerSemanaAbierta(codigo)
  if (!semanaAbierta) {
    throw new Error("No hay una semana abierta para la caja seleccionada. Abrí una semana primero")
  }

  return semanaAbierta
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

async function reconciliarAsignacionesSemanales(cajaCodigo) {
  const codigo = cajaCodigo ? String(cajaCodigo).toLowerCase().trim() : null
  if (codigo && !CAJAS_DISPONIBLES.includes(codigo)) {
    throw new Error("Caja inválida")
  }

  const semanasQ = await pool.query(
    `
      SELECT id, caja_codigo, fecha_inicio, fecha_fin, estado
      FROM cajas_semanales
      WHERE ($1::text IS NULL OR caja_codigo = $1)
      ORDER BY caja_codigo ASC, fecha_inicio ASC, id ASC
    `,
    [codigo]
  )

  const semanasPorCaja = new Map()
  const semanaPorId = new Map()

  for (const row of semanasQ.rows || []) {
    const caja = String(row.caja_codigo || "").toLowerCase().trim()
    const inicio = normalizarFechaISO(row.fecha_inicio)
    const fin = normalizarFechaISO(row.fecha_fin)
    if (!caja || !inicio) continue

    const semana = {
      id: Number(row.id),
      caja_codigo: caja,
      fecha_inicio: inicio,
      fecha_fin: fin || null,
      estado: String(row.estado || "").toLowerCase(),
    }

    semanaPorId.set(semana.id, semana)
    if (!semanasPorCaja.has(caja)) semanasPorCaja.set(caja, [])
    semanasPorCaja.get(caja).push(semana)
  }

  const movimientosQ = await pool.query(
    `
      SELECT id, caja_codigo, fecha, caja_semanal_id, es_control_semanal
      FROM movimientos_caja
      WHERE ($1::text IS NULL OR caja_codigo = $1)
      ORDER BY caja_codigo ASC, fecha ASC, id ASC
    `,
    [codigo]
  )

  const cambios = []
  const semanasARecalcular = new Set()

  for (const movimiento of movimientosQ.rows || []) {
    const caja = String(movimiento.caja_codigo || "").toLowerCase().trim()
    const fecha = normalizarFechaISO(movimiento.fecha)
    if (!caja || !fecha) continue

    const semanasCaja = semanasPorCaja.get(caja) || []
    const semanaActualId = normalizarCajaSemanalId(movimiento.caja_semanal_id)
    const semanaActual = semanaActualId ? semanaPorId.get(semanaActualId) : null

    // Si el movimiento ya está asignado a una semana válida de la misma caja,
    // preservar esa asignación para evitar migraciones indeseadas entre semanas
    // (especialmente cuando existen cierres/aperturas en el mismo día).
    const asignacionActualValida = Boolean(
      semanaActual
      && String(semanaActual.caja_codigo || "").toLowerCase() === caja
    )

    if (asignacionActualValida) {
      continue
    }

    const candidatas = semanasCaja.filter((semana) => {
      const inicio = String(semana.fecha_inicio || "")
      const fin = String(semana.fecha_fin || "")
      return (!inicio || fecha >= inicio) && (!fin || fecha <= fin)
    })

    let semanaDestinoId = null

    if (candidatas.length === 1) {
      semanaDestinoId = Number(candidatas[0].id)
    } else if (candidatas.length > 1) {
      const esControl = Boolean(movimiento.es_control_semanal)
      if (esControl) {
        const candidatasInicio = candidatas.filter((semana) => String(semana.fecha_inicio || "") === fecha)
        if (candidatasInicio.length > 0) {
          candidatasInicio.sort((a, b) => Number(b.id) - Number(a.id))
          semanaDestinoId = Number(candidatasInicio[0].id)
        }
      }

      if (!semanaDestinoId) {
        candidatas.sort((a, b) => {
          const inicioA = String(a.fecha_inicio || "")
          const inicioB = String(b.fecha_inicio || "")
          if (inicioA !== inicioB) return inicioB.localeCompare(inicioA)
          return Number(b.id) - Number(a.id)
        })
        semanaDestinoId = Number(candidatas[0].id)
      }
    }

    const destinoNormalizado = semanaDestinoId || null
    const actualNormalizado = semanaActualId || null

    if (destinoNormalizado === actualNormalizado) continue

    cambios.push({
      movimientoId: Number(movimiento.id),
      semanaAnteriorId: actualNormalizado,
      semanaNuevaId: destinoNormalizado,
    })

    if (actualNormalizado) semanasARecalcular.add(Number(actualNormalizado))
    if (destinoNormalizado) semanasARecalcular.add(Number(destinoNormalizado))
  }

  for (const cambio of cambios) {
    await pool.query(
      `UPDATE movimientos_caja SET caja_semanal_id = $2 WHERE id = $1`,
      [cambio.movimientoId, cambio.semanaNuevaId]
    )
  }

  for (const semanaId of semanasARecalcular) {
    await recalcularCajaSemanal(semanaId)
  }

  return {
    movimientosActualizados: cambios.length,
    semanasRecalculadas: semanasARecalcular.size,
  }
}

async function asignarCajaSemanalAMovimiento({ movimientoId, caja_codigo, caja_semanal_id, permitirCerrada = false }) {
  const semana = await resolverSemanaDestinoMovimiento({
    caja_codigo,
    caja_semanal_id,
    permitirCerrada,
  })

  if (!permitirCerrada && ["cerrada", "cerrado"].includes(String(semana.estado || "").trim().toLowerCase())) {
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
    presupuestos_ids: Array.isArray(movimiento.presupuestos_ids)
      ? movimiento.presupuestos_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : (movimiento.presupuesto_id ? [Number(movimiento.presupuesto_id)] : []),
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
  await ensureDetallesMedioPagoConstraint()

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
    if (!inicio) return

    const estadoSemana = String(semana?.estado || "").toLowerCase()
    const clave = fin ? `${inicio}-${fin}` : `${inicio}-${estadoSemana || 'abierta'}`
    const existente = mapa.get(clave)
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

const MEDIOS_SIMPLES = ["efectivo", "transferencia", "banco", "retencion"]
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
        librador_endosante: String(item?.librador_endosante || "").trim() || null,
        numero_cheque: String(item?.numero_cheque || "").trim() || null,
        fecha_cheque: item?.fecha_cheque || null,
        fecha_entrada: item?.fecha_entrada || null,
        endosado_a: String(item?.endosado_a || "").trim() || null,
        libro_cheque_id: Number(item?.libro_cheque_id || 0) || null,
      })
    })
  }

  return detalles
}

function validarDetallesPago(detalles = [], tipoMovimiento = "ingreso") {
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

    if (MEDIOS_MULTIPLES.includes(medio) && Number(item?.libro_cheque_id || 0) > 0) {
      continue
    }

    if (MEDIOS_MULTIPLES.includes(medio) && String(tipoMovimiento || "").toLowerCase() === "ingreso") {
      validarCamposChequeIngreso(item)
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

function normalizarPresupuestosIds(presupuestoIdsRaw, presupuestoIdRaw) {
  if (Array.isArray(presupuestoIdsRaw)) {
    return Array.from(new Set(
      presupuestoIdsRaw
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ))
  }

  const idUnico = Number(presupuestoIdRaw || 0)
  return Number.isInteger(idUnico) && idUnico > 0 ? [idUnico] : []
}

function normalizarPresupuestosAsignaciones(asignacionesRaw = []) {
  if (!Array.isArray(asignacionesRaw)) return []

  return asignacionesRaw
    .map((item) => ({
      presupuesto_id: Number(item?.presupuesto_id || item?.id || 0),
      monto_asignado: roundMoney(Number(item?.monto_asignado ?? item?.monto ?? 0)),
    }))
    .filter((item) => Number.isInteger(item.presupuesto_id) && item.presupuesto_id > 0 && item.monto_asignado > 0)
}

function construirAsignacionesPresupuestos({ presupuestosIds = [], asignacionesRaw = [], montoTotal = 0 }) {
  const ids = Array.from(new Set((presupuestosIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
  if (!ids.length) return []

  const totalEsperado = roundMoney(Number(montoTotal || 0))
  if (!(totalEsperado > 0)) {
    throw new Error("El monto total debe ser mayor a 0 para imputar presupuestos")
  }

  const asignaciones = normalizarPresupuestosAsignaciones(asignacionesRaw)
  if (!asignaciones.length) {
    if (ids.length === 1) {
      return [{ presupuesto_id: ids[0], monto_asignado: totalEsperado }]
    }
    throw new Error("Debe indicar el monto asignado para cada presupuesto seleccionado")
  }

  const idsAsignados = Array.from(new Set(asignaciones.map((item) => item.presupuesto_id)))
  if (idsAsignados.length !== asignaciones.length) {
    throw new Error("Hay presupuestos repetidos en la imputacion")
  }

  const setIds = new Set(ids)
  const faltantes = ids.filter((id) => !idsAsignados.includes(id))
  const extras = idsAsignados.filter((id) => !setIds.has(id))
  if (faltantes.length || extras.length) {
    throw new Error("La imputacion por presupuesto no coincide con los presupuestos seleccionados")
  }

  const totalAsignado = roundMoney(asignaciones.reduce((acc, item) => acc + Number(item.monto_asignado || 0), 0))
  if (totalAsignado - totalEsperado > 0.01) {
    throw new Error(`La suma de imputaciones (${totalAsignado}) no puede superar el monto total (${totalEsperado})`)
  }

  return asignaciones
}

async function validarPresupuestosCliente(presupuestosIds = [], clienteId = null) {
  const ids = Array.from(new Set((presupuestosIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
  if (!ids.length) return []

  const result = await pool.query(
    `
      SELECT id, cliente_id
      FROM presupuestos
      WHERE id = ANY($1::int[])
    `,
    [ids]
  )
  const presupuestos = result.rows || []

  if (!Array.isArray(presupuestos) || presupuestos.length !== ids.length) {
    throw new Error("Uno o más presupuestos son inválidos")
  }

  if (clienteId) {
    const invalido = presupuestos.find((p) => String(p.cliente_id) !== String(clienteId))
    if (invalido) {
      throw new Error("Uno o más presupuestos seleccionados no pertenecen al cliente indicado")
    }
  }

  return presupuestos
}

async function sincronizarMovimientosCajaPresupuestos({ client, movimientoId, presupuestosIds = [], presupuestosAsignaciones = [] }) {
  await ensureMovimientosCajaPresupuestosSchema()

  await client.query("DELETE FROM movimientos_caja_presupuestos WHERE movimiento_id = $1", [movimientoId])

  const ids = Array.from(new Set((presupuestosIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
  if (!ids.length) return

  const mapaAsignaciones = new Map(
    (normalizarPresupuestosAsignaciones(presupuestosAsignaciones) || []).map((item) => [item.presupuesto_id, item.monto_asignado])
  )

  const values = []
  const placeholders = ids.map((id, index) => {
    const base = index * 3
    const montoAsignado = roundMoney(Number(mapaAsignaciones.get(id) || 0))
    values.push(movimientoId, id, montoAsignado > 0 ? montoAsignado : null)
    return `($${base + 1}, $${base + 2}, $${base + 3})`
  }).join(",")

  await client.query(
    `INSERT INTO movimientos_caja_presupuestos (movimiento_id, presupuesto_id, monto_asignado) VALUES ${placeholders}`,
    values
  )
}

async function obtenerPresupuestosAsignacionesPorMovimientos(movimientosIds = []) {
  await ensureMovimientosCajaPresupuestosSchema()
  const ids = Array.from(new Set((movimientosIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
  if (!ids.length) return new Map()

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",")
  const result = await pool.query(
    `
      SELECT movimiento_id, presupuesto_id, monto_asignado
      FROM movimientos_caja_presupuestos
      WHERE movimiento_id IN (${placeholders})
      ORDER BY movimiento_id, presupuesto_id
    `,
    ids
  )

  const mapa = new Map()
  ids.forEach((id) => mapa.set(id, []))
  result.rows.forEach((row) => {
    const movId = Number(row.movimiento_id)
    const presId = Number(row.presupuesto_id)
    const monto = roundMoney(Number(row.monto_asignado || 0))
    if (!mapa.has(movId)) mapa.set(movId, [])
    mapa.get(movId).push({ presupuesto_id: presId, monto_asignado: monto })
  })

  return mapa
}

async function obtenerPresupuestosIdsPorMovimientos(movimientosIds = []) {
  const mapaAsignaciones = await obtenerPresupuestosAsignacionesPorMovimientos(movimientosIds)
  const mapaIds = new Map()
  mapaAsignaciones.forEach((items, movId) => {
    mapaIds.set(movId, (items || []).map((item) => Number(item.presupuesto_id)).filter((id) => Number.isInteger(id) && id > 0))
  })
  return mapaIds
}

async function obtenerPresupuestosIdsPorMovimiento(movimientoId) {
  const mapa = await obtenerPresupuestosIdsPorMovimientos([movimientoId])
  return mapa.get(Number(movimientoId)) || []
}

async function obtenerPresupuestosAsignacionesPorMovimiento(movimientoId) {
  const mapa = await obtenerPresupuestosAsignacionesPorMovimientos([movimientoId])
  return mapa.get(Number(movimientoId)) || []
}

async function obtenerMovimientosYTotales({ fecha_inicio, fecha_fin, tipo, caja_codigo, caja_semanal_id, cliente_id } = {}) {
  await getDetallesSchema()
  await ensureMovimientosCajaPresupuestosSchema()

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

  if (cliente_id) {
    query = query.eq("cliente_id", cliente_id)
  }

  const { data, error } = await query.order("fecha", { ascending: false })
  if (error) throw error

  const totales = {
    totalIngresos: 0,
    totalEgresos: 0,
    desglose: {
      efectivo: 0,
      transferencia: 0,
      banco: 0,
      cheque: 0,
      echeq: 0,
      retencion: 0,
    },
  }

  const movimientos = (data || []).map(normalizarMovimiento)
  const mapaPresupuestos = await obtenerPresupuestosIdsPorMovimientos(movimientos.map((mov) => mov.id))
  const mapaAsignaciones = await obtenerPresupuestosAsignacionesPorMovimientos(movimientos.map((mov) => mov.id))

  movimientos.forEach((mov) => {
    const asociados = mapaPresupuestos.get(Number(mov.id)) || []
    const asignaciones = mapaAsignaciones.get(Number(mov.id)) || []
    if (asociados.length > 0) {
      mov.presupuestos_ids = asociados
      mov.presupuesto_id = mov.presupuesto_id || asociados[0]
    }
    mov.presupuestos_asignaciones = asignaciones
  })

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
    const { fecha_inicio, fecha_fin, tipo, caja_codigo, caja_semanal_id, busqueda, cliente_id } = req.query

    if (caja_codigo && !CAJAS_DISPONIBLES.includes(String(caja_codigo).toLowerCase())) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const cajaCodigoNormalizada = caja_codigo ? String(caja_codigo).toLowerCase() : undefined
    if (cajaCodigoNormalizada) {
      await reconciliarAsignacionesSemanales(cajaCodigoNormalizada)
    }

    const cajaSemanalIdNormalizada = normalizarCajaSemanalId(caja_semanal_id)
    const clienteIdNormalizado = Number(cliente_id)

    let { movimientos, totales } = await obtenerMovimientosYTotales({
      fecha_inicio,
      fecha_fin,
      tipo,
      caja_codigo: cajaCodigoNormalizada,
      caja_semanal_id: cajaSemanalIdNormalizada,
      cliente_id: Number.isInteger(clienteIdNormalizado) && clienteIdNormalizado > 0 ? clienteIdNormalizado : undefined,
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

router.get("/libro-cheques", async (req, res) => {
  try {
    await ensureLibroChequesSchema()

    const cajaCodigo = String(req.query.caja_codigo || "tesla").toLowerCase()
    const estado = String(req.query.estado || "").toLowerCase().trim()
    const busqueda = String(req.query.busqueda || "").trim().toLowerCase()
    const fechaInicio = normalizarFechaISO(req.query.fecha_inicio)
    const fechaFin = normalizarFechaISO(req.query.fecha_fin)
    const filtroSemanal = Boolean(fechaInicio && fechaFin)

    if (!CAJAS_DISPONIBLES.includes(cajaCodigo)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    if ((req.query.fecha_inicio && !fechaInicio) || (req.query.fecha_fin && !fechaFin)) {
      return res.status(400).json({ error: "Rango semanal inválido" })
    }

    if (filtroSemanal && fechaInicio > fechaFin) {
      return res.status(400).json({ error: "Rango semanal inválido" })
    }

    const params = [cajaCodigo]
    const where = ["l.caja_codigo = $1", "l.medio_pago = 'cheque'"]

    if (estado) {
      if (!ESTADOS_LIBRO_CHEQUES.includes(estado)) {
        return res.status(400).json({ error: "Estado de cheque inválido" })
      }

      if (!filtroSemanal) {
        params.push(estado)
        where.push(`l.estado = $${params.length}`)
      }
    }

    if (busqueda) {
      params.push(`%${busqueda}%`)
      const idx = params.length
      where.push(`(
        LOWER(COALESCE(l.numero_cheque, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.banco, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.librador_endosante, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.endosado_a, '')) LIKE $${idx}
      )`)
    }

    const query = `
      SELECT
        l.*,
        mi.fecha AS movimiento_entrada_fecha,
        ms.fecha AS movimiento_salida_fecha
      FROM libro_cheques_caja l
      LEFT JOIN movimientos_caja mi ON mi.id = l.movimiento_entrada_id
      LEFT JOIN movimientos_caja ms ON ms.id = l.movimiento_salida_id
      WHERE ${where.join(" AND ")}
      ORDER BY l.estado ASC, l.fecha_entrada DESC, l.id DESC
    `

    const result = await pool.query(query, params)
    const rows = result.rows || []

    if (!filtroSemanal) {
      res.json(rows)
      return
    }

    const rowsSemana = rows
      .map((row) => {
        const fechaEntradaCheque = normalizarFechaISO(row.fecha_entrada)
        const fechaSalidaCheque = normalizarFechaISO(row.fecha_salida)
        const estadoActual = String(row.estado || "").toLowerCase()

        if (estadoActual === "anulado") return null

        const disponibleAlCorte = Boolean(
          fechaEntradaCheque
          && fechaEntradaCheque <= fechaFin
          && (!fechaSalidaCheque || fechaSalidaCheque > fechaFin)
        )

        const salioEnSemana = Boolean(
          fechaSalidaCheque
          && fechaSalidaCheque >= fechaInicio
          && fechaSalidaCheque <= fechaFin
        )

        if (!disponibleAlCorte && !salioEnSemana) return null

        const estadoVista = disponibleAlCorte ? "disponible" : "no_disponible"
        return {
          ...row,
          estado_vista: estadoVista,
          semana_inicio: fechaInicio,
          semana_fin: fechaFin,
        }
      })
      .filter(Boolean)

    const filtradosPorEstado = estado
      ? rowsSemana.filter((row) => row.estado_vista === (estado === "disponible" ? "disponible" : "no_disponible"))
      : rowsSemana

    res.json(filtradosPorEstado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get("/libro-cheques/disponibles", async (req, res) => {
  try {
    await ensureLibroChequesSchema()
    const cajaCodigo = String(req.query.caja_codigo || "tesla").toLowerCase()

    if (!CAJAS_DISPONIBLES.includes(cajaCodigo)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const result = await pool.query(
      `
      SELECT *
      FROM libro_cheques_caja
      WHERE caja_codigo = $1
        AND medio_pago = 'cheque'
        AND estado = 'disponible'
      ORDER BY fecha_cheque DESC, id ASC
      `,
      [cajaCodigo]
    )

    res.json(result.rows || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get("/libro-cheques/pdf", async (req, res) => {
  try {
    await ensureLibroChequesSchema()

    const cajaCodigo = String(req.query.caja_codigo || "tesla").toLowerCase()
    const listado = String(req.query.listado || "ambos").toLowerCase().trim()
    const busqueda = String(req.query.busqueda || "").trim().toLowerCase()
    const fechaInicio = normalizarFechaISO(req.query.fecha_inicio)
    const fechaFin = normalizarFechaISO(req.query.fecha_fin)
    const filtroSemanal = Boolean(fechaInicio && fechaFin)

    if (!CAJAS_DISPONIBLES.includes(cajaCodigo)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const listadoValido = ["disponibles", "no_disponibles", "ambos"]
    if (!listadoValido.includes(listado)) {
      return res.status(400).json({ error: "Listado inválido" })
    }

    const params = [cajaCodigo]
    const where = ["l.caja_codigo = $1", "l.medio_pago = 'cheque'"]

    if (busqueda) {
      params.push(`%${busqueda}%`)
      const idx = params.length
      where.push(`(
        LOWER(COALESCE(l.numero_cheque, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.banco, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.librador_endosante, '')) LIKE $${idx}
        OR LOWER(COALESCE(l.endosado_a, '')) LIKE $${idx}
      )`)
    }

    const result = await pool.query(
      `
      SELECT l.*
      FROM libro_cheques_caja l
      WHERE ${where.join(" AND ")}
      `,
      params
    )

    const allRows = result.rows || []

    let disponibles, noDisponibles

    if (filtroSemanal) {
      // Mismo cálculo que /libro-cheques: disponibles al corte y salidos en semana
      const rowsSemana = allRows
        .filter((row) => String(row.estado || "").toLowerCase() !== "anulado")
        .map((row) => {
          const fechaEntradaCheque = normalizarFechaISO(row.fecha_entrada)
          const fechaSalidaCheque = normalizarFechaISO(row.fecha_salida)
          const disponibleAlCorte = Boolean(
            fechaEntradaCheque
            && fechaEntradaCheque <= fechaFin
            && (!fechaSalidaCheque || fechaSalidaCheque > fechaFin)
          )
          const salioEnSemana = Boolean(
            fechaSalidaCheque
            && fechaSalidaCheque >= fechaInicio
            && fechaSalidaCheque <= fechaFin
          )
          if (!disponibleAlCorte && !salioEnSemana) return null
          return { ...row, estado_vista: disponibleAlCorte ? "disponible" : "no_disponible" }
        })
        .filter(Boolean)

      disponibles = rowsSemana
        .filter((row) => row.estado_vista === "disponible")
        .sort((a, b) => {
          const fechaA = normalizarFechaISO(a.fecha_cheque) || ""
          const fechaB = normalizarFechaISO(b.fecha_cheque) || ""
          if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
          return String(a.numero_cheque || "").localeCompare(String(b.numero_cheque || ""))
        })

      noDisponibles = rowsSemana
        .filter((row) => row.estado_vista === "no_disponible")
        .sort((a, b) => {
          const fechaA = normalizarFechaISO(a.fecha_salida || a.fecha_cheque) || ""
          const fechaB = normalizarFechaISO(b.fecha_salida || b.fecha_cheque) || ""
          if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
          return String(a.numero_cheque || "").localeCompare(String(b.numero_cheque || ""))
        })
    } else {
      disponibles = allRows
        .filter((row) => String(row.estado || "").toLowerCase() === "disponible")
        .sort((a, b) => {
          const fechaA = normalizarFechaISO(a.fecha_cheque) || ""
          const fechaB = normalizarFechaISO(b.fecha_cheque) || ""
          if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
          return String(a.numero_cheque || "").localeCompare(String(b.numero_cheque || ""))
        })

      noDisponibles = allRows
        .filter((row) => String(row.estado || "").toLowerCase() !== "disponible")
        .sort((a, b) => {
          const fechaA = normalizarFechaISO(a.fecha_salida || a.fecha_cheque) || ""
          const fechaB = normalizarFechaISO(b.fecha_salida || b.fecha_cheque) || ""
          if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
          return String(a.numero_cheque || "").localeCompare(String(b.numero_cheque || ""))
        })
    }

    const rowsParaTotal = listado === "disponibles" ? disponibles : listado === "no_disponibles" ? noDisponibles : [...disponibles, ...noDisponibles]
    const totalImporte = rowsParaTotal.reduce((acc, row) => acc + Number(row.importe || 0), 0)

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fechaArchivo = new Date().toISOString().slice(0, 10)
    const sufijoPdf = filtroSemanal ? ` semana ${fechaInicio}` : ""
    const nombreArchivo = `Libro cheques ${LABEL_CAJA[cajaCodigo]} ${listado}${sufijoPdf} ${fechaArchivo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(nombreArchivo)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Libro de cheques" })

    const etiquetaListado = listado === "disponibles"
      ? "Cheques disponibles"
      : listado === "no_disponibles"
        ? "Cheques no disponibles"
        : "Cheques disponibles y no disponibles"

    const etiquetaSemana = filtroSemanal
      ? ` · Semana ${new Date(`${fechaInicio}T00:00:00`).toLocaleDateString("es-AR")} al ${new Date(`${fechaFin}T00:00:00`).toLocaleDateString("es-AR")}`
      : ""

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: `Libro de cheques - ${LABEL_CAJA[cajaCodigo]}`,
      accentText: `${etiquetaListado}${etiquetaSemana}`,
      logoPath: LOGO_PATH,
    })

    doc.fillColor(PDF_COLORS.ink)
    const resumenY = headerBottom + 14
    const resumenH = 56
    const resumenLeft = 45
    const resumenW = pageWidth - 90

    const esAmbos = listado === "ambos"
    const totalDisponibles = disponibles.reduce((acc, row) => acc + Number(row.importe || 0), 0)
    const totalNoDisponibles = noDisponibles.reduce((acc, row) => acc + Number(row.importe || 0), 0)
    const resumenHAjustado = esAmbos ? 80 : 56

    doc.roundedRect(resumenLeft, resumenY, resumenW, resumenHAjustado, 6).fill(PDF_COLORS.card)
    doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(10)
    doc.text("Resumen", resumenLeft + 13, resumenY + 8, { width: 120 })
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10.4)

    if (esAmbos) {
      const col1W = resumenW / 2
      doc.text(`Disponibles: ${disponibles.length} cheque(s)`, resumenLeft + 13, resumenY + 28, { width: col1W - 13 })
      doc.text(`Total disponible: ${formatoMoneda(totalDisponibles)}`, resumenLeft + col1W, resumenY + 28, { width: col1W - 13, align: "right" })
      doc.moveTo(resumenLeft + 13, resumenY + 48).lineTo(resumenLeft + resumenW - 13, resumenY + 48).strokeColor(PDF_COLORS.line).lineWidth(0.5).stroke()
      doc.text(`No disponibles: ${noDisponibles.length} cheque(s)`, resumenLeft + 13, resumenY + 56, { width: col1W - 13 })
      doc.text(`Total salido: ${formatoMoneda(totalNoDisponibles)}`, resumenLeft + col1W, resumenY + 56, { width: col1W - 13, align: "right" })
    } else {
      const cantidadTotal = listado === "disponibles" ? disponibles.length : noDisponibles.length
      doc.text(`Cantidad de cheques: ${cantidadTotal}`, resumenLeft + 13, resumenY + 26, { width: 250 })
      doc.text(`Importe total: ${formatoMoneda(totalImporte)}`, resumenLeft + 260, resumenY + 26, { width: resumenW - 273, align: "right" })
    }

    doc.y = resumenY + resumenHAjustado + 14

    const ensureRowSpace = (alturaRequerida = 50, onNewPage = null) => {
      if (doc.y + alturaRequerida > doc.page.height - 72) {
        doc.addPage()
        const continuedBottom = drawPremiumHeader(doc, {
          title: "TESLA MONTAJES ELECTRICOS",
          subtitle: `Libro de cheques - ${LABEL_CAJA[cajaCodigo]}`,
          accentText: etiquetaListado,
          logoPath: LOGO_PATH,
        })
        doc.fillColor(PDF_COLORS.ink)
        doc.y = continuedBottom + 14
        if (typeof onNewPage === "function") onNewPage()
        return true
      }
      return false
    }

    const truncateText = (value, maxLen) => {
      const txt = String(value || "-")
      if (txt.length <= maxLen) return txt
      return `${txt.slice(0, Math.max(0, maxLen - 1))}…`
    }

    const drawSectionTitleCentered = (title) => {
      if (doc.y > doc.page.height - 90) doc.addPage()
      doc.moveDown(0.6)
      doc
        .font("Helvetica-Bold")
        .fontSize(11.5)
        .fillColor(PDF_COLORS.ink)
        .text(title, 45, doc.y, { width: pageWidth - 90, align: "center" })
      const y = doc.y + 2
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, y).lineTo(pageWidth - 45, y).stroke()
      doc.y = y + 6
    }

    const drawSection = (title, sectionRows, { showSalida = false } = {}) => {
      if (!sectionRows.length) {
        ensureRowSpace(30)
        doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.slate)
        doc.text("Sin cheques para este criterio.", 58, doc.y + 2, { width: pageWidth - 116 })
        doc.fillColor(PDF_COLORS.ink)
        doc.y += 20
        return
      }

      const tableLeft = 45
      const tableWidth = pageWidth - 90
      const colDefs = [
        { key: "idx", label: "#", w: 22, align: "left" },
        { key: "numero", label: "Numero", w: 70, align: "left" },
        { key: "banco", label: "Banco", w: 90, align: "left" },
        { key: "librador", label: "Librador/Endosante", w: 118, align: "left" },
        { key: "fcheque", label: "F. cheque", w: 60, align: "left" },
        { key: "fentrada", label: "F. entrada", w: 60, align: "left" },
        { key: "importe", label: "Importe", w: 85, align: "right" },
      ]

      const headerH = 22
      const rowH = 20
      const detailH = 15

      const drawGridHeader = () => {
        ensureRowSpace(headerH + rowH + (showSalida ? detailH : 0) + 12)

        const headerY = doc.y
        doc.rect(tableLeft, headerY, tableWidth, headerH).fill(PDF_COLORS.card)

        let colX = tableLeft
        doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(8)
        colDefs.forEach((col) => {
          doc.text(col.label, colX + 4, headerY + 7, {
            width: col.w - 8,
            align: col.align === "right" ? "right" : "left",
            lineBreak: false,
          })
          colX += col.w
        })

        doc
          .strokeColor(PDF_COLORS.border)
          .lineWidth(0.8)
          .rect(tableLeft, headerY, tableWidth, headerH)
          .stroke()

        colX = tableLeft
        for (let i = 0; i < colDefs.length - 1; i += 1) {
          colX += colDefs[i].w
          doc
            .strokeColor(PDF_COLORS.border)
            .lineWidth(0.5)
            .moveTo(colX, headerY)
            .lineTo(colX, headerY + headerH)
            .stroke()
        }

        doc.y = headerY + headerH
      }

      const writeCellText = (text, x, y, w, align = "left") => {
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8)
        doc.text(text, x + 4, y + 6, {
          width: w - 8,
          align,
          lineBreak: false,
        })
      }

      drawGridHeader()

      sectionRows.forEach((row, idx) => {
        const currentRowH = showSalida ? rowH + detailH : rowH
        ensureRowSpace(currentRowH + 6, () => {
          drawGridHeader()
        })

        const rowY = doc.y
        const data = {
          idx: String(idx + 1),
          numero: truncateText(row.numero_cheque, 12),
          banco: truncateText(row.banco, 16),
          librador: truncateText(row.librador_endosante, 19),
          fcheque: formatoFecha(row.fecha_cheque),
          fentrada: formatoFecha(row.fecha_entrada),
          importe: formatoMoneda(row.importe || 0),
        }

        if (idx % 2 === 0) {
          doc.rect(tableLeft, rowY, tableWidth, currentRowH).fill(PDF_COLORS.light)
        }

        let colX = tableLeft
        colDefs.forEach((col) => {
          writeCellText(data[col.key] || "-", colX, rowY, col.w, col.align === "right" ? "right" : "left")
          colX += col.w
        })

        if (showSalida) {
          const fechaSalida = formatoFecha(row.fecha_salida)
          const endosadoA = truncateText(row.endosado_a, 54)
          const estadoTexto = String(row.estado || "").toLowerCase() === "disponible" ? "Disponible" : "No disponible"
          doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(7.5)
          doc.text(`Estado: ${estadoTexto} | Salida: ${fechaSalida} | Endosado a: ${endosadoA}`, tableLeft + 26, rowY + rowH + 4, {
            width: tableWidth - 34,
            lineBreak: false,
          })
        }

        doc
          .strokeColor(PDF_COLORS.border)
          .lineWidth(0.6)
          .rect(tableLeft, rowY, tableWidth, currentRowH)
          .stroke()

        colX = tableLeft
        for (let i = 0; i < colDefs.length - 1; i += 1) {
          colX += colDefs[i].w
          doc
            .strokeColor(PDF_COLORS.border)
            .lineWidth(0.4)
            .moveTo(colX, rowY)
            .lineTo(colX, rowY + rowH)
            .stroke()
        }

        doc.y = rowY + currentRowH
      })

      doc.fillColor(PDF_COLORS.ink)
    }

    const drawSectionHeader = (title) => {
      ensureRowSpace(34)
      const hY = doc.y + 6
      doc.rect(45, hY, pageWidth - 90, 24).fill(PDF_COLORS.navy)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(11)
      doc.text(title, 58, hY + 6, { width: pageWidth - 116 })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = hY + 24 + 6
    }

    if (listado === "disponibles" || listado === "ambos") {
      if (esAmbos) drawSectionHeader("Cheques disponibles")
      drawSection("Cheques disponibles", disponibles, { showSalida: false })
    }

    if (listado === "no_disponibles" || listado === "ambos") {
      if (esAmbos) { doc.moveDown(0.8); drawSectionHeader("Cheques no disponibles") }
      drawSection("Cheques no disponibles", noDisponibles, { showSalida: true })
    }

    doc.end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get("/semanas", async (req, res) => {
  try {
    const cajaCodigoNormalizada = String(req.query.caja_codigo || "tesla").toLowerCase()
    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    await reconciliarAsignacionesSemanales(cajaCodigoNormalizada)

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

    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    const semanaAbierta = await obtenerSemanaAbierta(cajaCodigoNormalizada)
    if (!semanaAbierta) {
      return res.json(null)
    }

    const semanaActualizada = await recalcularCajaSemanal(semanaAbierta.id)
    res.json(semanaActualizada || semanaAbierta)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post("/semanas/abrir", async (req, res) => {
  try {
    await ensureCajasSemanalesSchema()

    const cajaCodigoNormalizada = String(req.body?.caja_codigo || "").toLowerCase().trim()
    const fechaInicioRaw = req.body?.fecha_inicio || new Date()
    const fechaInicioSoloDia = normalizarFechaISO(fechaInicioRaw)
    let fechaInicio = normalizarFechaISO_conHora(fechaInicioRaw)

    // Si viene solo fecha (input type="date") y es hoy, usar hora actual para
    // permitir cerrar y reabrir en el mismo día sin solape artificial.
    if (fechaInicioSoloDia && !String(fechaInicioRaw).includes("T")) {
      const hoy = normalizarFechaISO(new Date())
      if (fechaInicioSoloDia === hoy) {
        fechaInicio = new Date().toISOString()
      }
    }

    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida" })
    }

    if (!fechaInicio) {
      return res.status(400).json({ error: "Debés informar una fecha de inicio válida" })
    }

    const abierta = await obtenerSemanaAbierta(cajaCodigoNormalizada)
    if (abierta) {
      return res.status(400).json({ error: "Ya existe una semana abierta para esta caja. Cerrala antes de abrir otra" })
    }

    const cierreMismoDiaQ = await pool.query(
      `
        SELECT fecha_fin
        FROM cajas_semanales
        WHERE caja_codigo = $1
          AND fecha_fin IS NOT NULL
          AND DATE(fecha_fin) = DATE($2::timestamp)
        ORDER BY fecha_fin DESC
        LIMIT 1
      `,
      [cajaCodigoNormalizada, fechaInicio]
    )

    const ultimoCierreMismoDia = cierreMismoDiaQ.rows?.[0]?.fecha_fin
    if (ultimoCierreMismoDia) {
      const aperturaComparable = normalizarFechaISO_conHora(fechaInicio)
      const cierreComparable = normalizarFechaISO_conHora(ultimoCierreMismoDia)
      if (aperturaComparable && cierreComparable && aperturaComparable <= cierreComparable) {
        return res.status(400).json({
          error: "Si abrís una semana el mismo día, la hora de apertura debe ser estrictamente posterior al cierre de la semana anterior",
        })
      }
    }

    const solapeQ = await pool.query(
      `
        SELECT id
        FROM cajas_semanales
        WHERE caja_codigo = $1
          AND fecha_inicio <= $2
          AND COALESCE(fecha_fin, 'infinity'::timestamp) >= $2
        LIMIT 1
      `,
      [cajaCodigoNormalizada, fechaInicio]
    )

    if (solapeQ.rowCount > 0) {
      return res.status(400).json({ error: "El rango informado se superpone con una semana existente" })
    }

    const saldoPrevio = await obtenerSaldoAcumuladoPorMedio(cajaCodigoNormalizada, fechaInicio)

    const { data: creada, error } = await db
      .from("cajas_semanales")
      .insert([{
        caja_codigo: cajaCodigoNormalizada,
        fecha_inicio: fechaInicio,
        fecha_fin: null,
        saldo_inicial: roundMoney(Number(saldoPrevio.total || 0)),
        total_ingresos: 0,
        total_egresos: 0,
        saldo_final: roundMoney(Number(saldoPrevio.total || 0)),
        control_inicial_realizado: false,
        control_inicial_movimiento_id: null,
        estado: "abierta",
      }])
      .select()
      .single()

    if (error) throw error

    getIo()?.emit("caja:changed")
    return res.status(201).json(creada)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
})

router.get("/semanas/:id/control-candidatos", async (req, res) => {
  try {
    await ensureLibroChequesSchema()
    const semanaId = normalizarCajaSemanalId(req.params.id)
    if (!semanaId) return res.status(400).json({ error: "ID de semana inválido" })

    const semanaQ = await pool.query(`SELECT * FROM cajas_semanales WHERE id = $1 LIMIT 1`, [semanaId])
    const semana = semanaQ.rows?.[0]
    if (!semana) return res.status(404).json({ error: "Semana no encontrada" })

    if (String(semana.estado || "").toLowerCase() === "cerrada") {
      return res.status(400).json({ error: "La semana está cerrada" })
    }

    const movsQ = await pool.query(`SELECT COUNT(*)::int AS total FROM movimientos_caja WHERE caja_semanal_id = $1`, [semanaId])
    if (Number(movsQ.rows?.[0]?.total || 0) > 0) {
      return res.status(400).json({ error: "El control semanal solo se puede cargar cuando la semana no tiene movimientos" })
    }

    const anterior = await obtenerCajaSemanalAnterior(semana.caja_codigo, semana.fecha_inicio, semana.id)
    if (!anterior) {
      return res.json([])
    }

    const candidatos = await obtenerChequesDisponiblesAlCierreSemana({
      cajaCodigo: semana.caja_codigo,
      fechaFin: normalizarFechaISO(anterior.fecha_fin),
    })

    return res.json(candidatos || [])
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

router.post("/semanas/:id/control-inicial", async (req, res) => {
  const client = await pool.connect()
  try {
    await ensureLibroChequesSchema()
    await ensureMovimientosCajaRulesSchema()
    await getDetallesSchema()
    const detalleColumn = await getDetalleColumn()

    const semanaId = normalizarCajaSemanalId(req.params.id)
    if (!semanaId) return res.status(400).json({ error: "ID de semana inválido" })

    const efectivoInicial = roundMoney(Number(req.body?.efectivo_inicial || 0))
    const ids = Array.isArray(req.body?.cheques_controlados_ids)
      ? req.body.cheques_controlados_ids.map((valor) => Number(valor)).filter((valor) => Number.isInteger(valor) && valor > 0)
      : []

    if (efectivoInicial < 0) {
      return res.status(400).json({ error: "El efectivo inicial no puede ser negativo" })
    }

    await client.query("BEGIN")

    const semanaQ = await client.query(
      `SELECT * FROM cajas_semanales WHERE id = $1 FOR UPDATE`,
      [semanaId]
    )
    const semana = semanaQ.rows?.[0]
    if (!semana) {
      await client.query("ROLLBACK")
      return res.status(404).json({ error: "Semana no encontrada" })
    }

    if (String(semana.estado || "").toLowerCase() === "cerrada") {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "La semana está cerrada" })
    }

    if (semana.control_inicial_realizado) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "El control semanal ya fue registrado" })
    }

    const movsQ = await client.query(`SELECT COUNT(*)::int AS total FROM movimientos_caja WHERE caja_semanal_id = $1`, [semanaId])
    if (Number(movsQ.rows?.[0]?.total || 0) > 0) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "El control semanal debe ser el primer movimiento de la semana" })
    }

    const anterior = await obtenerCajaSemanalAnterior(semana.caja_codigo, semana.fecha_inicio, semana.id)
    const candidatos = anterior
      ? await obtenerChequesDisponiblesAlCierreSemana({
        cajaCodigo: semana.caja_codigo,
        fechaFin: normalizarFechaISO(anterior.fecha_fin),
      })
      : []

    const mapCandidatos = new Map((candidatos || []).map((item) => [Number(item.id), item]))
    const invalidos = ids.filter((id) => !mapCandidatos.has(id))
    if (invalidos.length > 0) {
      await client.query("ROLLBACK")
      return res.status(400).json({ error: "Hay cheques seleccionados que no pertenecen al cierre de la semana anterior" })
    }

    const chequesSeleccionados = ids.map((id) => mapCandidatos.get(id))
    const totalCheques = roundMoney(chequesSeleccionados.reduce((acc, item) => acc + Number(item?.importe || 0), 0))
    const montoTotal = roundMoney(efectivoInicial + totalCheques)

    const fechaControl = normalizarFechaISO(req.body?.fecha_control || semana.fecha_inicio) || semana.fecha_inicio
    const detalle = String(req.body?.detalle || "Control semanal inicial de caja").trim() || "Control semanal inicial de caja"
    const observaciones = String(req.body?.observaciones || "").trim() || null

    const insertMovQ = await client.query(
      `
      INSERT INTO movimientos_caja (
        fecha, caja_codigo, tipo, ${detalleColumn}, observaciones, monto_total,
        categoria, categoria_id, con_iva, destinatario, cliente_id, presupuesto_id, caja_semanal_id, es_control_semanal
      ) VALUES ($1,$2,'ingreso',$3,$4,$5,'varios',NULL,TRUE,NULL,NULL,NULL,$6,TRUE)
      RETURNING *
      `,
      [fechaControl, semana.caja_codigo, detalle, observaciones, montoTotal, semanaId]
    )
    const movimiento = insertMovQ.rows[0]

    if (efectivoInicial > 0) {
      await client.query(
        `
        INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro)
        VALUES ($1,'efectivo',$2,NULL,NULL,NULL)
        `,
        [movimiento.id, efectivoInicial]
      )
    }

    for (const cheque of chequesSeleccionados) {
      await client.query(
        `
        INSERT INTO detalles_medio_pago (
          movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro,
          librador_endosante, numero_cheque, fecha_cheque, fecha_entrada, libro_cheque_id
        ) VALUES ($1,'cheque',$2,$3,$4,NULL,$5,$6,$7,$8,$9)
        `,
        [
          movimiento.id,
          roundMoney(Number(cheque.importe || 0)),
          String(cheque.numero_cheque || "").trim() || null,
          String(cheque.banco || "").trim() || null,
          String(cheque.librador_endosante || "").trim() || null,
          String(cheque.numero_cheque || "").trim() || null,
          normalizarFechaISO(cheque.fecha_cheque),
          normalizarFechaISO(cheque.fecha_entrada),
          Number(cheque.id),
        ]
      )
    }

    for (const id of ids) {
      await client.query(
        `
        INSERT INTO cajas_semanales_cheques_control (caja_semanal_id, libro_cheque_id)
        VALUES ($1, $2)
        ON CONFLICT (caja_semanal_id, libro_cheque_id) DO NOTHING
        `,
        [semanaId, id]
      )
    }

    await client.query(
      `
      UPDATE cajas_semanales
      SET control_inicial_realizado = TRUE,
          control_inicial_movimiento_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [semanaId, movimiento.id]
    )

    await client.query("COMMIT")

    await recalcularCajaSemanal(semanaId)
    getIo()?.emit("caja:changed")

    return res.status(201).json({ ok: true, movimiento_id: movimiento.id })
  } catch (err) {
    try { await client.query("ROLLBACK") } catch (_) {}
    return res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

const parseOptionalSaldo = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} inválido`)
  }
  return roundMoney(parsed)
}

router.post("/semanas/:id/saldos", async (req, res) => {
  try {
    const { id } = req.params
    const { saldo_banco, saldo_pendiente_echeq, saldo_echeq_depositados, saldo_efectivo, saldo_cheques } = req.body

    const idNumerico = Number(id)
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: "ID de semana inválido" })
    }

    const saldoBancoNormalizado = parseOptionalSaldo(saldo_banco, "Saldo de banco")
    const saldoPendienteEcheqNormalizado = parseOptionalSaldo(saldo_pendiente_echeq, "Saldo de eCheqs a depositar")
    const saldoEcheqDepositadosNormalizado = parseOptionalSaldo(saldo_echeq_depositados, "Saldo de eCheqs depositados")
    const saldoEfectivoNormalizado = parseOptionalSaldo(saldo_efectivo, "Saldo de efectivo")
    const saldoChequesNormalizado = parseOptionalSaldo(saldo_cheques, "Saldo de cheques")

    const { data, error } = await db
      .from("cajas_semanales")
      .update({
        saldo_banco: saldoBancoNormalizado,
        saldo_pendiente_echeq: saldoPendienteEcheqNormalizado,
        saldo_echeq_depositados: saldoEcheqDepositadosNormalizado,
        saldo_efectivo: saldoEfectivoNormalizado,
        saldo_cheques: saldoChequesNormalizado,
      })
      .eq("id", idNumerico)
      .select()
      .single()

    if (error) throw error
    if (!data) {
      return res.status(404).json({ error: "Semana de caja no encontrada" })
    }

    getIo()?.emit('caja:changed')
    res.json(data)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post("/semanas/:id/cerrar", async (req, res) => {
  try {
    const { id } = req.params
    const { fecha_cierre, saldo_banco, saldo_pendiente_echeq, saldo_echeq_depositados, saldo_efectivo, saldo_cheques } = req.body

    const idNumerico = Number(id)
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: "ID de semana inválido" })
    }

    const saldoBancoNormalizado = parseOptionalSaldo(saldo_banco, "Saldo de banco")
    const saldoPendienteEcheqNormalizado = parseOptionalSaldo(saldo_pendiente_echeq, "Saldo pendiente de eCheqs")
    const saldoEcheqDepositadosNormalizado = parseOptionalSaldo(saldo_echeq_depositados, "Saldo de eCheqs depositados")
    const saldoEfectivoNormalizado = parseOptionalSaldo(saldo_efectivo, "Saldo de efectivo")
    const saldoChequesNormalizado = parseOptionalSaldo(saldo_cheques, "Saldo de cheques")

    const semana = await recalcularCajaSemanal(idNumerico)
    if (!semana) {
      return res.status(404).json({ error: "Semana de caja no encontrada" })
    }

    const fechaCierre = normalizarFechaISO_conHora(
      fecha_cierre || semana.fecha_fin || new Date()
    )

    if (!fechaCierre) {
      return res.status(400).json({ error: "No se pudo determinar la fecha de cierre" })
    }

    const fechaInicioSemana = normalizarFechaISO_conHora(semana.fecha_inicio)
    if (fechaInicioSemana && fechaCierre < fechaInicioSemana) {
      return res.status(400).json({ error: "La fecha de cierre no puede ser anterior a la fecha de apertura" })
    }

    // Si se cierra una semana con fecha anterior a algunos movimientos ya cargados,
    // esos movimientos se desasignan para que puedan quedar en la semana que corresponda.
    const movimientosReasignablesQ = await pool.query(
      `
        UPDATE movimientos_caja
        SET caja_semanal_id = NULL
        WHERE caja_semanal_id = $1
          AND fecha > $2
        RETURNING id
      `,
      [idNumerico, fechaCierre]
    )

    await recalcularCajaSemanal(idNumerico)

    // Cerrar la semana y guardar los saldos informativos del cierre
    const { data, error } = await db
      .from("cajas_semanales")
      .update({
        estado: "cerrada",
        fecha_fin: fechaCierre,
        saldo_banco: saldoBancoNormalizado,
        saldo_pendiente_echeq: saldoPendienteEcheqNormalizado,
        saldo_echeq_depositados: saldoEcheqDepositadosNormalizado,
        saldo_efectivo: saldoEfectivoNormalizado,
        saldo_cheques: saldoChequesNormalizado,
      })
      .eq("id", idNumerico)
      .select()
      .single()

    if (error) throw error

    // Asegura modo manual estricto: no debe quedar ninguna semana abierta en la caja.
    const abiertasRestantesQ = await pool.query(
      `
        UPDATE cajas_semanales
        SET estado = 'cerrada'
        WHERE caja_codigo = $1
          AND id <> $2
          AND BTRIM(LOWER(COALESCE(estado, ''))) IN ('abierta', 'abierto')
        RETURNING id
      `,
      [String(semana.caja_codigo || "").toLowerCase(), idNumerico]
    )

    getIo()?.emit('caja:changed')
    res.json({
      semanaCerrada: data,
      semanasCerradasAdicionalmente: (abiertasRestantesQ.rows || []).map((row) => Number(row.id)),
      movimientosDesasignados: (movimientosReasignablesQ.rows || []).map((row) => Number(row.id)),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.post("/semanas/:id/reabrir", async (req, res) => {
  try {
    const { id } = req.params
    const { codigo_admin } = req.body

    const idNumerico = Number(id)
    if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: "ID de semana inválido" })
    }

    if (!codigo_admin) {
      return res.status(400).json({ error: "Código de administrador requerido" })
    }

    const CODIGO_ADMIN_SECRETO = "ADMIN1234"

    if (String(codigo_admin).trim() !== CODIGO_ADMIN_SECRETO) {
      return res.status(403).json({ error: "Código de administrador incorrecto" })
    }

    const semana = await recalcularCajaSemanal(idNumerico)
    if (!semana) {
      return res.status(404).json({ error: "Semana de caja no encontrada" })
    }

    if (String(semana.estado || "").toLowerCase() !== "cerrada") {
      return res.status(400).json({ error: "La semana no está cerrada" })
    }

    // Cerrar todas las demás semanas abiertas en la misma caja
    const abiertasQ = await pool.query(
      `
        UPDATE cajas_semanales
        SET estado = 'cerrada'
        WHERE caja_codigo = $1
          AND id <> $2
          AND BTRIM(LOWER(COALESCE(estado, ''))) IN ('abierta', 'abierto')
        RETURNING id
      `,
      [String(semana.caja_codigo || "").toLowerCase(), idNumerico]
    )

    // Reabrir la semana
    const { data, error } = await db
      .from("cajas_semanales")
      .update({
        estado: "abierta",
      })
      .eq("id", idNumerico)
      .select()
      .single()

    if (error) throw error

    getIo()?.emit('caja:changed')
    res.json({
      semanaReabierta: data,
      semanasClosedForReopen: (abiertasQ.rows || []).map((row) => Number(row.id)),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.get("/resumen/pdf", async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, tipo, caja_codigo, resumen_modo, busqueda, medio_pago, categoria_id } = req.query
    const cajaCodigoNormalizada = caja_codigo ? String(caja_codigo).toLowerCase() : undefined
    const modoResumen = String(resumen_modo || "general").toLowerCase()
    const FILTRO_SIN_CATEGORIA = "__sin_categoria__"

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

    // Filtro por medio de pago si se envía
    if (medio_pago && String(medio_pago).trim() !== "") {
      const medioPagoFiltro = String(medio_pago).trim().toLowerCase()
      movimientos = movimientos.filter(mov => {
        if (!mov.detalles_medio_pago || mov.detalles_medio_pago.length === 0) return false
        return mov.detalles_medio_pago.some((detalle) =>
          String(detalle?.medio_pago || "").toLowerCase() === medioPagoFiltro
        )
      })
    }

    // Filtro por categoria (incluye caso especial "sin categoria")
    if (categoria_id !== undefined && categoria_id !== null && String(categoria_id).trim() !== "") {
      const categoriaFiltro = String(categoria_id).trim()

      if (categoriaFiltro === FILTRO_SIN_CATEGORIA) {
        movimientos = movimientos.filter((mov) => {
          const categoriaId = Number(mov?.categoria_id || 0)
          const tieneCategoriaId = Number.isInteger(categoriaId) && categoriaId > 0
          const categoriaTexto = String(mov?.categoria || "").trim()
          return !tieneCategoriaId && !categoriaTexto
        })
      } else {
        const categoriaIdFiltro = Number(categoriaFiltro)
        if (!Number.isInteger(categoriaIdFiltro) || categoriaIdFiltro <= 0) {
          return res.status(400).json({ error: "categoria_id inválida" })
        }

        movimientos = movimientos.filter((mov) => Number(mov?.categoria_id || 0) === categoriaIdFiltro)
      }
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
            || (semana?.saldo_echeq_depositados !== null && semana?.saldo_echeq_depositados !== undefined)
            || (semana?.saldo_efectivo !== null && semana?.saldo_efectivo !== undefined)
            || (semana?.saldo_cheques !== null && semana?.saldo_cheques !== undefined)
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
        total_ingresos: roundMoney(totalIngresos),
        total_egresos: roundMoney(totalEgresos),
        saldo_final: roundMoney(saldoFinalEfectivo + saldoFinalCheques),
        saldo_final_efectivo: saldoFinalEfectivo,
        saldo_final_cheques: saldoFinalCheques,
        saldo_banco: modoResumen === "general" ? ultimaSemanaConSaldosRegistrados?.saldo_banco ?? null : semanaCaja?.saldo_banco,
        saldo_pendiente_echeq: modoResumen === "general"
          ? ultimaSemanaConSaldosRegistrados?.saldo_pendiente_echeq ?? null
          : semanaCaja?.saldo_pendiente_echeq,
        saldo_echeq_depositados: modoResumen === "general"
          ? ultimaSemanaConSaldosRegistrados?.saldo_echeq_depositados ?? null
          : semanaCaja?.saldo_echeq_depositados,
        saldo_efectivo: modoResumen === "general" ? ultimaSemanaConSaldosRegistrados?.saldo_efectivo ?? null : semanaCaja?.saldo_efectivo,
        saldo_cheques: modoResumen === "general" ? ultimaSemanaConSaldosRegistrados?.saldo_cheques ?? null : semanaCaja?.saldo_cheques,
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

    const drawDetailTitle = () => {
      doc.moveDown(0.6)
      doc.font("Helvetica-Bold").fontSize(11.5).fillColor(PDF_COLORS.ink)
      doc.text("Detalle de movimientos", 45, doc.y, {
        width: pageWidth - 90,
        align: "left",
        lineBreak: false,
      })
      const y = doc.y + 2
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, y).lineTo(pageWidth - 45, y).stroke()
      doc.y = y + 6
    }

    const drawDesgloseTitle = () => {
      doc.moveDown(0.6)
      doc.font("Helvetica-Bold").fontSize(11.5).fillColor(PDF_COLORS.ink)
      doc.text("Desglose por medio de pago", 45, doc.y, {
        width: pageWidth - 90,
        align: "left",
        lineBreak: false,
      })
      const y = doc.y + 2
      doc.strokeColor(PDF_COLORS.line).lineWidth(0.8).moveTo(45, y).lineTo(pageWidth - 45, y).stroke()
      doc.y = y + 6
    }

    const etiquetaMedioPago = {
      "efectivo": "Efectivo",
      "transferencia": "Transferencias",
      "banco": "Banco",
      "cheque": "Cheques",
      "echeq": "E-Cheques",
      "retencion": "Retenciones"
    }

    let etiquetaCategoriaFiltro = ""
    if (categoria_id !== undefined && categoria_id !== null && String(categoria_id).trim() !== "") {
      const categoriaFiltro = String(categoria_id).trim()

      if (categoriaFiltro === FILTRO_SIN_CATEGORIA) {
        etiquetaCategoriaFiltro = "Categoria: Sin categoría"
      } else {
        const categoriaIdFiltro = Number(categoriaFiltro)
        if (Number.isInteger(categoriaIdFiltro) && categoriaIdFiltro > 0) {
          const categoriaDb = await pool.query("SELECT nombre FROM categorias_caja WHERE id = $1 LIMIT 1", [categoriaIdFiltro])
          const nombreCategoriaDb = String(categoriaDb.rows?.[0]?.nombre || "").trim()
          etiquetaCategoriaFiltro = nombreCategoriaDb
            ? `Categoria: ${nombreCategoriaDb}`
            : `Categoria: ${categoriaFiltro}`
        }
      }
    }

    const filtroPeriodo = [
      cajaCodigoNormalizada ? LABEL_CAJA[cajaCodigoNormalizada] : "Todas las cajas",
      fecha_inicio ? `Desde ${formatoFecha(fecha_inicio)}` : "",
      fecha_fin ? `Hasta ${formatoFecha(fecha_fin)}` : "",
      tipo ? `Tipo ${tipo}` : "Todos los tipos",
      medio_pago ? `Medio ${etiquetaMedioPago[String(medio_pago).toLowerCase()] || String(medio_pago)}` : "",
      etiquetaCategoriaFiltro,
    ].filter(Boolean).join(" - ")
    
    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      accentText: filtroPeriodo || "Sin filtros",
      logoPath: LOGO_PATH,
    })  

    doc.fillColor(PDF_COLORS.ink)
    doc.y = headerBottom + 15

    if (esResumenSemanal) {
      const semanalY = doc.y
      const semanalHeight = 56
      doc.roundedRect(45, semanalY, pageWidth - 90, semanalHeight, 8).fill(PDF_COLORS.card)
      doc.fillColor(PDF_COLORS.navy).font("Helvetica-Bold").fontSize(12)
      doc.text("Caja semanal", 58, semanalY + 10, { width: 180 })
      doc.font("Helvetica-Bold").fontSize(11)
      doc.text(etiquetaPeriodo, 58, semanalY + 28, { width: 220 })
      doc.fillColor(PDF_COLORS.slate).font("Helvetica").fontSize(8.8)
      // doc.text("La semana nueva arranca con el saldo final de la anterior y los movimientos quedan encapsulados en su propio período.", 290, semanalY + 18, { width: pageWidth - 348, align: "left" })

      doc.fillColor(PDF_COLORS.ink)
      doc.y = semanalY + semanalHeight + 14
    }

    const resumenY = doc.y
    doc.roundedRect(45, resumenY, pageWidth - 90, 82, 6).fill(PDF_COLORS.card)
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
    const saldoEcheqADepositarInformativo = cajaSemanalResumen?.saldo_pendiente_echeq
    const saldoEcheqDepositadosInformativo = cajaSemanalResumen?.saldo_echeq_depositados
    const saldoEfectivoInformativo = cajaSemanalResumen?.saldo_efectivo
    const saldoChequesInformativo = cajaSemanalResumen?.saldo_cheques
    const formatoMonedaOpcional = (valor) => {
      return valor === null || valor === undefined ? "No informado" : formatoMoneda(valor)
    }

    const calcularTotalResumenBancario = () => {
      let total = 0
      if (saldoBancoInformativo !== null && saldoBancoInformativo !== undefined) total += Number(saldoBancoInformativo)
      if (saldoEcheqADepositarInformativo !== null && saldoEcheqADepositarInformativo !== undefined) total += Number(saldoEcheqADepositarInformativo)
      if (saldoEcheqDepositadosInformativo !== null && saldoEcheqDepositadosInformativo !== undefined) total += Number(saldoEcheqDepositadosInformativo)
      if (saldoEfectivoInformativo !== null && saldoEfectivoInformativo !== undefined) total += Number(saldoEfectivoInformativo)
      if (saldoChequesInformativo !== null && saldoChequesInformativo !== undefined) total += Number(saldoChequesInformativo)
      return total
    }

    const drawResumenBancarioTable = () => {
      drawSectionTitle("Resumen bancario")

      const bankRows = [
        { concepto: "Saldo banco", valor: formatoMonedaOpcional(saldoBancoInformativo) },
        { concepto: "eCheqs a depositar", valor: formatoMonedaOpcional(saldoEcheqADepositarInformativo) },
        { concepto: "eCheqs depositados", valor: formatoMonedaOpcional(saldoEcheqDepositadosInformativo) },
        { concepto: "Efectivo en caja", valor: formatoMonedaOpcional(saldoEfectivoInformativo) },
        { concepto: "Cheques en caja", valor: formatoMonedaOpcional(saldoChequesInformativo) },
      ]

      const tableLeft = 45
      const tableRight = pageWidth - 45
      const colConceptoX = 55
      const colValorX = 400
      const colConceptoWidth = 330
      const colValorWidth = 120

      const drawVerticalSeparator = (y, height) => {
        doc.strokeColor(PDF_COLORS.line).lineWidth(0.8)
        doc.moveTo(colValorX - 12, y).lineTo(colValorX - 12, y + height).stroke()
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

      const headerY = doc.y
      doc.rect(tableLeft, headerY, pageWidth - 90, 22).fill(PDF_COLORS.navy)
      drawVerticalSeparator(headerY, 22)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
      doc.text("CONCEPTO", colConceptoX, headerY + 7, { width: colConceptoWidth })
      doc.text("VALOR", colValorX, headerY + 7, { width: colValorWidth, align: "right", lineBreak: false })
      drawHorizontalSeparator(headerY + 22)
      doc.fillColor(PDF_COLORS.ink)

      const tableTopY = headerY
      let y = headerY + 22

      bankRows.forEach((item, index) => {
        const bg = index % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(tableLeft, y, pageWidth - 90, 20).fill(bg)
        drawVerticalSeparator(y, 20)
        doc.fillColor(PDF_COLORS.ink).font("Helvetica").fontSize(8.8)
        doc.text(item.concepto, colConceptoX, y + 6, { width: colConceptoWidth, lineBreak: false })
        doc.text(item.valor, colValorX, y + 6, { width: colValorWidth, align: "right", lineBreak: false })
        drawHorizontalSeparator(y + 20)
        y += 20
      })

      // Fila de total
      const totalResumen = calcularTotalResumenBancario()
      doc.rect(tableLeft, y, pageWidth - 90, 20).fill(PDF_COLORS.navy)
      drawVerticalSeparator(y, 20)
      doc.fillColor(PDF_COLORS.light).font("Helvetica-Bold").fontSize(9)
      doc.text("TOTAL SALDOS", colConceptoX, y + 6, { width: colConceptoWidth, lineBreak: false })
      doc.text(formatoMoneda(totalResumen), colValorX, y + 6, { width: colValorWidth, align: "right", lineBreak: false })
      drawHorizontalSeparator(y + 20)
      y += 20

      drawTableBorders(tableTopY, y)
      doc.fillColor(PDF_COLORS.ink)
      doc.y = y + 10
    }

    drawResumenBancarioTable()

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

    const drawDesgloseTable = () => {
      drawDesgloseTitle()

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
      doc.y = yDesglose + 10
    }

    const drawDetailPageHeader = () => {
      const detalleHeaderBottom = drawPremiumHeader(doc, {
        title: "TESLA MONTAJES ELECTRICOS",
        accentText: filtroPeriodo || "Sin filtros",
        logoPath: LOGO_PATH,
      })
      doc.fillColor(PDF_COLORS.ink)
      doc.y = detalleHeaderBottom + 14
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

    drawDesgloseTable()
    doc.addPage()
    drawDetailPageHeader()
    drawDetailTitle()
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
          drawDetailPageHeader()
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

// ===================== CATEGORÍAS CAJA =====================

// Obtener todas las categorías
router.get("/categorias", async (req, res) => {
  try {
    const tipo = String(req.query?.tipo || "").trim().toLowerCase()
    if (tipo && !TIPOS_MOVIMIENTO.includes(tipo)) {
      return res.status(400).json({ error: "tipo inválido. Debe ser 'ingreso' o 'egreso'" })
    }

    const queryBase = "SELECT id, nombre, descripcion, tipo, created_at, updated_at FROM categorias_caja"
    const result = tipo
      ? await pool.query(`${queryBase} WHERE tipo = $1 ORDER BY nombre ASC`, [tipo])
      : await pool.query(`${queryBase} ORDER BY tipo ASC, nombre ASC`)

    res.json(result.rows || [])
  } catch (err) {
    console.error("Error al obtener categorías:", err)
    res.status(500).json({ error: err.message })
  }
})

// Crear categoría
router.post("/categorias", async (req, res) => {
  try {
    let { nombre, descripcion, tipo } = req.body

    if (!nombre || typeof nombre !== "string") {
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio y debe ser una cadena de texto." })
    }

    const tipoNormalizado = String(tipo || "").trim().toLowerCase()
    if (!TIPOS_MOVIMIENTO.includes(tipoNormalizado)) {
      return res.status(400).json({ error: "El tipo de la categoría es obligatorio y debe ser 'ingreso' o 'egreso'." })
    }

    nombre = sanitizeText(nombre).trim()

    if (nombre.length < 3) {
      return res.status(400).json({ error: "El nombre de la categoría debe tener al menos 3 caracteres." })
    }

    const checkResult = await pool.query("SELECT id FROM categorias_caja WHERE LOWER(nombre) = LOWER($1) AND tipo = $2", [nombre, tipoNormalizado])
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: "Ya existe una categoría con ese nombre para este tipo." })
    }

    const insertResult = await pool.query(
      "INSERT INTO categorias_caja (nombre, descripcion, tipo) VALUES ($1, $2, $3) RETURNING id, nombre, descripcion, tipo, created_at, updated_at",
      [nombre, sanitizeText(descripcion || "").trim(), tipoNormalizado]
    )

    res.status(201).json(insertResult.rows[0])
  } catch (err) {
    console.error("Error al crear categoría:", err)
    res.status(500).json({ error: err.message })
  }
})

// Actualizar categoría
router.put("/categorias/:id", async (req, res) => {
  try {
    const { id } = req.params
    let { nombre, descripcion, tipo } = req.body

    if (!nombre || typeof nombre !== "string") {
      return res.status(400).json({ error: "El nombre de la categoría es obligatorio y debe ser una cadena de texto." })
    }

    const tipoNormalizado = String(tipo || "").trim().toLowerCase()
    if (!TIPOS_MOVIMIENTO.includes(tipoNormalizado)) {
      return res.status(400).json({ error: "El tipo de la categoría es obligatorio y debe ser 'ingreso' o 'egreso'." })
    }

    nombre = sanitizeText(nombre).trim()

    if (nombre.length < 3) {
      return res.status(400).json({ error: "El nombre de la categoría debe tener al menos 3 caracteres." })
    }

    const checkResult = await pool.query("SELECT id FROM categorias_caja WHERE LOWER(nombre) = LOWER($1) AND tipo = $2 AND id != $3", [nombre, tipoNormalizado, Number(id)])
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: "Ya existe una categoría con ese nombre para este tipo." })
    }

    const updateResult = await pool.query(
      "UPDATE categorias_caja SET nombre = $1, descripcion = $2, tipo = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING id, nombre, descripcion, tipo, created_at, updated_at",
      [nombre, sanitizeText(descripcion || "").trim(), tipoNormalizado, Number(id)]
    )

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: "Categoría no encontrada" })
    }

    res.json(updateResult.rows[0])
  } catch (err) {
    console.error("Error al actualizar categoría:", err)
    res.status(500).json({ error: err.message })
  }
})

// Eliminar categoría
router.delete("/categorias/:id", async (req, res) => {
  try {
    const { id } = req.params

    const checkMovimientos = await pool.query("SELECT id FROM movimientos_caja WHERE categoria_id = $1 LIMIT 1", [Number(id)])
    if (checkMovimientos.rows.length > 0) {
      return res.status(400).json({ error: "No se puede eliminar la categoría porque está asociada a movimientos de caja." })
    }

    const deleteResult = await pool.query("DELETE FROM categorias_caja WHERE id = $1", [Number(id)])

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: "Categoría no encontrada" })
    }

    res.status(204).send()
  } catch (err) {
    console.error("Error al eliminar categoría:", err)
    res.status(500).json({ error: err.message })
  }
})

// ===================== MOVIMIENTOS =====================

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

    const movimiento = normalizarMovimiento(data)
    movimiento.presupuestos_ids = await obtenerPresupuestosIdsPorMovimiento(movimiento.id)
    movimiento.presupuestos_asignaciones = await obtenerPresupuestosAsignacionesPorMovimiento(movimiento.id)
    if (movimiento.presupuestos_ids.length > 0 && !movimiento.presupuesto_id) {
      movimiento.presupuesto_id = movimiento.presupuestos_ids[0]
    }
    if (String(movimiento?.tipo || "").toLowerCase() === "egreso") {
      const chequesSalida = await obtenerChequesSalidaPorMovimiento(movimiento.id)
      movimiento.cheques_salida_ids = chequesSalida.map((item) => Number(item.id)).filter((value) => Number.isInteger(value) && value > 0)
      movimiento.cheques_salida_detalle = chequesSalida
      if (chequesSalida.length > 0) {
        movimiento.fecha_salida_cheques = normalizarFechaISO(chequesSalida[0]?.fecha_salida) || null
        movimiento.endosado_a_cheques = String(chequesSalida[0]?.endosado_a || "").trim() || null
      }
    } else if (String(movimiento?.tipo || "").toLowerCase() === "ingreso") {
      movimiento.cheques_ingreso_detalle = await obtenerChequesIngresoPorMovimiento(movimiento.id)
    }

    res.json(movimiento)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear movimiento de caja
router.post("/", async (req, res) => {
  try {
    const {
      fecha,
      caja_codigo,
      tipo,
      detalle,
      observaciones,
      monto_total,
      desglose,
      detalles_medio_pago,
      categoria,
      categoria_id,
      con_iva,
      cliente_id,
      presupuesto_id,
      presupuesto_ids,
      caja_semanal_id,
      presupuestos_asignaciones,
      destinatario,
      cheques_salida,
      fecha_salida_cheques,
      endosado_a_cheques,
    } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()
    await ensureLibroChequesSchema()
    await ensureMovimientosCajaRulesSchema()
    const cajaCodigoNormalizada = String(caja_codigo || "").toLowerCase()
    const tipoNormalizado = String(tipo || "").toLowerCase()
    const destinatarioNormalizado = String(destinatario || "").trim()
    const observacionesNormalizadas = String(observaciones || "").trim()
    const categoriaIdNormalizada = (categoria_id === undefined || categoria_id === null || categoria_id === "")
      ? null
      : Number(categoria_id)

    if (categoriaIdNormalizada !== null && (!Number.isInteger(categoriaIdNormalizada) || categoriaIdNormalizada <= 0)) {
      return res.status(400).json({ error: "categoria_id inválida" })
    }

    if (categoriaIdNormalizada !== null) {
      const categoriaResult = await pool.query("SELECT id, tipo FROM categorias_caja WHERE id = $1", [categoriaIdNormalizada])
      if (categoriaResult.rows.length === 0) {
        return res.status(400).json({ error: "La categoría seleccionada no existe" })
      }
      const tipoCategoria = String(categoriaResult.rows[0]?.tipo || "").trim().toLowerCase()
      if (tipoCategoria && tipoCategoria !== tipoNormalizado) {
        return res.status(400).json({ error: "La categoría seleccionada no corresponde al tipo de movimiento" })
      }
    }

    // Validaciones
    if (!fecha || !cajaCodigoNormalizada || !tipoNormalizado || !detalle || !monto_total) {
      return res.status(400).json({ error: "Campos requeridos: fecha, caja_codigo, tipo, detalle, monto_total" })
    }

    if (!CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida. Debe ser tesla, teslita o juani" })
    }

    if (!TIPOS_MOVIMIENTO.includes(tipoNormalizado)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }


    const semanaDestino = await resolverSemanaDestinoMovimiento({
      caja_codigo: cajaCodigoNormalizada,
      caja_semanal_id,
    })

    const checkPrimerMov = await pool.query(
      `SELECT COUNT(*)::int AS total FROM movimientos_caja WHERE caja_semanal_id = $1`,
      [Number(semanaDestino.id)]
    )
    const cantidadSemana = Number(checkPrimerMov.rows?.[0]?.total || 0)
    if (cantidadSemana === 0) {
      return res.status(400).json({ error: "Debe registrar primero el control semanal inicial para comenzar la semana" })
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
    validarDetallesPago(detallesPago, tipoNormalizado)

    const chequesSalidaLista = Array.isArray(cheques_salida) ? cheques_salida : []
    let totalChequesDetalle = 0
    if (tipoNormalizado === "egreso") {
      const validacionCheques = validarEgresoConChequesLibro({
        detallesPago,
        chequesSalida: chequesSalidaLista,
      })
      totalChequesDetalle = validacionCheques.totalChequesDetalle
    }
    if (tipoNormalizado === "egreso" && chequesSalidaLista.length > 0) {
      const endosadoTexto = sanitizeChequeText(endosado_a_cheques || destinatarioNormalizado)
      if (!endosadoTexto) {
        return res.status(400).json({ error: "Debe indicar a quien se endosa el cheque" })
      }
    }

    const sumaDesglose = totalDetallesPago(detallesPago)
    if (Math.abs(sumaDesglose - monto_total) > 0.01) { // Tolerancia de 0.01
      return res.status(400).json({ 
        error: `La suma del desglose (${sumaDesglose}) no coincide con el monto total (${monto_total})` 
      })
    }

    const presupuestoIdsFinal = tipoNormalizado === "ingreso"
      ? normalizarPresupuestosIds(presupuesto_ids, presupuesto_id)
      : []

    if (tipoNormalizado === "ingreso" && presupuestoIdsFinal.length > 0 && !cliente_id) {
      return res.status(400).json({ error: "Para asociar presupuestos debe seleccionar un cliente" })
    }

    const montoTotalNormalizado = roundMoney(Number(monto_total || 0))
    const presupuestosAsignacionesFinal = tipoNormalizado === "ingreso"
      ? construirAsignacionesPresupuestos({
        presupuestosIds: presupuestoIdsFinal,
        asignacionesRaw: presupuestos_asignaciones,
        montoTotal: montoTotalNormalizado,
      })
      : []

    if (presupuestoIdsFinal.length === 1) {
      await validarPresupuestoCliente(presupuestoIdsFinal[0], cliente_id)
    }
    await validarPresupuestosCliente(presupuestoIdsFinal, cliente_id)

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
          categoria_id: categoriaIdNormalizada,
          con_iva: normalizarBoolean(con_iva, true),
          destinatario: tipoNormalizado === "egreso" ? destinatarioNormalizado : null,
          cliente_id: cliente_id || null,
          presupuesto_id: tipoNormalizado === "ingreso" ? (presupuestoIdsFinal[0] || null) : null,
          caja_semanal_id: Number(semanaDestino.id),
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
        librador_endosante: item.librador_endosante,
        numero_cheque: item.numero_cheque,
        fecha_cheque: item.fecha_cheque,
        fecha_entrada: item.fecha_entrada,
        endosado_a: item.endosado_a,
        libro_cheque_id: item.libro_cheque_id,
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
        banco: parseFloat(desglose.banco) || 0,
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

    try {
      const client = await pool.connect()
      try {
        await sincronizarMovimientosCajaPresupuestos({
          client,
          movimientoId,
          presupuestosIds: tipoNormalizado === "ingreso" ? presupuestoIdsFinal : [],
          presupuestosAsignaciones: tipoNormalizado === "ingreso" ? presupuestosAsignacionesFinal : [],
        })

        if (tipoNormalizado === "ingreso") {
          await crearChequesLibroDesdeIngreso({
            client,
            movimientoId,
            cajaCodigo: cajaCodigoNormalizada,
            fechaMovimiento: fecha,
            detallesPago,
          })
        }

        if (tipoNormalizado === "egreso" && chequesSalidaLista.length > 0) {
          await registrarSalidaCheques({
            client,
            movimientoId,
            cajaCodigo: cajaCodigoNormalizada,
            fechaSalida: fecha_salida_cheques || fecha,
            fechaMovimiento: fecha,
            endosadoA: endosado_a_cheques || destinatarioNormalizado,
            chequesSalida: chequesSalidaLista,
            expectedChequeTotal: totalChequesDetalle,
          })
        }
      } finally {
        client.release()
      }
    } catch (bookError) {
      await db.from("detalles_medio_pago").delete().eq("movimiento_id", movimientoId)
      await db.from("movimientos_caja").delete().eq("id", movimientoId)
      return res.status(400).json({ error: bookError.message })
    }

    // Retornar movimiento completo
    const { data: movimientoCompleto } = await db
      .from("movimientos_caja")
      .select(`
        *,
        detalles_medio_pago(*)
      `)
      .eq("id", movimientoId)
      .single()

    const movimientoCompletoNormalizado = normalizarMovimiento(movimientoCompleto)
    movimientoCompletoNormalizado.presupuestos_ids = await obtenerPresupuestosIdsPorMovimiento(movimientoId)
    movimientoCompletoNormalizado.presupuestos_asignaciones = await obtenerPresupuestosAsignacionesPorMovimiento(movimientoId)
    if (movimientoCompletoNormalizado.presupuestos_ids.length > 0 && !movimientoCompletoNormalizado.presupuesto_id) {
      movimientoCompletoNormalizado.presupuesto_id = movimientoCompletoNormalizado.presupuestos_ids[0]
    }

    getIo()?.emit('caja:changed')
    res.status(201).json(movimientoCompletoNormalizado)
  } catch (err) {
    console.error("Error en POST /caja:", err)
    res.status(500).json({ error: err.message })
  }
})

// Actualizar movimiento
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const {
      fecha,
      caja_codigo,
      tipo,
      detalle,
      observaciones,
      monto_total,
      desglose,
      detalles_medio_pago,
      categoria,
      categoria_id,
      con_iva,
      cliente_id,
      presupuesto_id,
      presupuesto_ids,
      caja_semanal_id,
      presupuestos_asignaciones,
      destinatario,
      cheques_salida,
      fecha_salida_cheques,
      endosado_a_cheques,
    } = req.body
    const detalleColumn = await getDetalleColumn()
    const detallesSchema = await getDetallesSchema()
    await ensureLibroChequesSchema()
    await ensureMovimientosCajaRulesSchema()
    const cajaCodigoNormalizada = caja_codigo !== undefined ? String(caja_codigo || "").toLowerCase() : undefined
    const tipoNormalizado = tipo !== undefined ? String(tipo || "").toLowerCase() : undefined
    const destinatarioNormalizado = destinatario !== undefined ? String(destinatario || "").trim() : undefined
    const observacionesNormalizadas = observaciones !== undefined ? String(observaciones || "").trim() : undefined
    const categoriaIdNormalizada = (categoria_id === undefined)
      ? undefined
      : ((categoria_id === null || categoria_id === "") ? null : Number(categoria_id))

    const { data: movimientoActual } = await db
      .from("movimientos_caja")
      .select("*")
      .eq("id", id)
      .single()

    if (!movimientoActual) {
      return res.status(404).json({ error: "Movimiento no encontrado" })
    }

    if (Boolean(movimientoActual?.es_control_semanal)) {
      const semanaId = normalizarCajaSemanalId(movimientoActual.caja_semanal_id)
      if (!semanaId) {
        return res.status(400).json({ error: "El movimiento de control semanal no tiene semana asociada" })
      }

      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const semanaQ = await client.query(
          `SELECT * FROM cajas_semanales WHERE id = $1 FOR UPDATE`,
          [semanaId]
        )
        const semana = semanaQ.rows?.[0]
        if (!semana) {
          await client.query("ROLLBACK")
          return res.status(404).json({ error: "Semana no encontrada" })
        }

        if (String(semana.estado || "").toLowerCase() === "cerrada") {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "La semana está cerrada" })
        }

        if (Number(semana.control_inicial_movimiento_id || 0) !== Number(id)) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "Solo se puede editar el movimiento asignado como control semanal" })
        }

        const movsQ = await client.query(
          `SELECT COUNT(*)::int AS total FROM movimientos_caja WHERE caja_semanal_id = $1 AND id <> $2`,
          [semanaId, Number(id)]
        )
        if (Number(movsQ.rows?.[0]?.total || 0) > 0) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "No se puede editar el control semanal cuando ya existen otros movimientos en la semana" })
        }

        const anterior = await obtenerCajaSemanalAnterior(semana.caja_codigo, semana.fecha_inicio, semana.id)
        const candidatos = anterior
          ? await obtenerChequesDisponiblesAlCierreSemana({
            cajaCodigo: semana.caja_codigo,
            fechaFin: normalizarFechaISO(anterior.fecha_fin),
          })
          : []

        const mapCandidatos = new Map((candidatos || []).map((item) => [Number(item.id), item]))

        const idsControl = Array.isArray(detalles_medio_pago)
          ? Array.from(new Set(
            detalles_medio_pago
              .filter((item) => String(item?.medio_pago || "").toLowerCase() === "cheque")
              .map((item) => Number(item?.libro_cheque_id || 0))
              .filter((valor) => Number.isInteger(valor) && valor > 0)
          ))
          : (await client.query(
            `SELECT libro_cheque_id FROM cajas_semanales_cheques_control WHERE caja_semanal_id = $1`,
            [semanaId]
          )).rows.map((item) => Number(item.libro_cheque_id)).filter((valor) => Number.isInteger(valor) && valor > 0)

        const invalidos = idsControl.filter((chequeId) => !mapCandidatos.has(chequeId))
        if (invalidos.length > 0) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "Hay cheques seleccionados que no pertenecen al cierre de la semana anterior" })
        }

        let efectivoInicial = 0
        if (desglose !== undefined) {
          efectivoInicial = roundMoney(Number(desglose?.efectivo || 0))
        } else if (Array.isArray(detalles_medio_pago)) {
          efectivoInicial = roundMoney(
            detalles_medio_pago
              .filter((item) => String(item?.medio_pago || "").toLowerCase() === "efectivo")
              .reduce((acc, item) => acc + Number(item?.monto || 0), 0)
          )
        } else {
          const efectivoQ = await client.query(
            `
              SELECT COALESCE(SUM(monto), 0)::numeric AS total
              FROM detalles_medio_pago
              WHERE movimiento_id = $1
                AND medio_pago = 'efectivo'
            `,
            [Number(id)]
          )
          efectivoInicial = roundMoney(Number(efectivoQ.rows?.[0]?.total || 0))
        }

        if (efectivoInicial < 0) {
          await client.query("ROLLBACK")
          return res.status(400).json({ error: "El efectivo inicial no puede ser negativo" })
        }

        const chequesSeleccionados = idsControl.map((chequeId) => mapCandidatos.get(chequeId)).filter(Boolean)
        const totalCheques = roundMoney(chequesSeleccionados.reduce((acc, item) => acc + Number(item?.importe || 0), 0))
        const montoControl = roundMoney(efectivoInicial + totalCheques)

        const fechaControl = normalizarFechaISO(fecha || movimientoActual.fecha || semana.fecha_inicio) || semana.fecha_inicio
        const detalleControl = String(detalle ?? movimientoActual?.[detalleColumn] ?? "Control semanal inicial de caja").trim() || "Control semanal inicial de caja"
        const observacionesControl = observaciones !== undefined
          ? (String(observaciones || "").trim() || null)
          : (String(movimientoActual?.observaciones || "").trim() || null)

        await client.query(
          `
            UPDATE movimientos_caja
            SET fecha = $2,
                caja_codigo = $3,
                tipo = 'ingreso',
                ${detalleColumn} = $4,
                observaciones = $5,
                monto_total = $6,
                categoria = 'varios',
                categoria_id = NULL,
                con_iva = TRUE,
                destinatario = NULL,
                cliente_id = NULL,
                presupuesto_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [Number(id), fechaControl, semana.caja_codigo, detalleControl, observacionesControl, montoControl]
        )

        await client.query(`DELETE FROM detalles_medio_pago WHERE movimiento_id = $1`, [Number(id)])

        if (efectivoInicial > 0) {
          await client.query(
            `
              INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro)
              VALUES ($1, 'efectivo', $2, NULL, NULL, NULL)
            `,
            [Number(id), efectivoInicial]
          )
        }

        for (const cheque of chequesSeleccionados) {
          await client.query(
            `
              INSERT INTO detalles_medio_pago (
                movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro,
                librador_endosante, numero_cheque, fecha_cheque, fecha_entrada, libro_cheque_id
              ) VALUES ($1, 'cheque', $2, $3, $4, NULL, $5, $6, $7, $8, $9)
            `,
            [
              Number(id),
              roundMoney(Number(cheque.importe || 0)),
              String(cheque.numero_cheque || "").trim() || null,
              String(cheque.banco || "").trim() || null,
              String(cheque.librador_endosante || "").trim() || null,
              String(cheque.numero_cheque || "").trim() || null,
              normalizarFechaISO(cheque.fecha_cheque),
              normalizarFechaISO(cheque.fecha_entrada),
              Number(cheque.id),
            ]
          )
        }

        await client.query(`DELETE FROM cajas_semanales_cheques_control WHERE caja_semanal_id = $1`, [semanaId])
        for (const chequeId of idsControl) {
          await client.query(
            `
              INSERT INTO cajas_semanales_cheques_control (caja_semanal_id, libro_cheque_id)
              VALUES ($1, $2)
              ON CONFLICT (caja_semanal_id, libro_cheque_id) DO NOTHING
            `,
            [semanaId, chequeId]
          )
        }

        await client.query(
          `
            UPDATE cajas_semanales
            SET control_inicial_realizado = TRUE,
                control_inicial_movimiento_id = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [semanaId, Number(id)]
        )

        await client.query("COMMIT")

        await recalcularCajaSemanal(semanaId)

        const { data: movimientoControlFinal } = await db
          .from("movimientos_caja")
          .select(`
            *,
            detalles_medio_pago(*)
          `)
          .eq("id", id)
          .single()

        const movimientoControlNormalizado = normalizarMovimiento(movimientoControlFinal)
        movimientoControlNormalizado.presupuestos_ids = []
        movimientoControlNormalizado.presupuestos_asignaciones = []

        getIo()?.emit('caja:changed')
        return res.json(movimientoControlNormalizado)
      } catch (errorControl) {
        try { await client.query("ROLLBACK") } catch (_) {}
        return res.status(500).json({ error: errorControl.message })
      } finally {
        client.release()
      }
    }

    const tipoFinal = tipoNormalizado || String(movimientoActual.tipo || "").toLowerCase()

    // Validaciones básicas
    if (tipoNormalizado && !TIPOS_MOVIMIENTO.includes(tipoNormalizado)) {
      return res.status(400).json({ error: "Tipo debe ser 'ingreso' o 'egreso'" })
    }

    if (cajaCodigoNormalizada && !CAJAS_DISPONIBLES.includes(cajaCodigoNormalizada)) {
      return res.status(400).json({ error: "Caja inválida. Debe ser tesla, teslita o juani" })
    }

    if (monto_total && monto_total <= 0) {
      return res.status(400).json({ error: "Monto total debe ser mayor a 0" })
    }

    if (categoriaIdNormalizada !== undefined && categoriaIdNormalizada !== null && (!Number.isInteger(categoriaIdNormalizada) || categoriaIdNormalizada <= 0)) {
      return res.status(400).json({ error: "categoria_id inválida" })
    }

    if (categoriaIdNormalizada !== undefined && categoriaIdNormalizada !== null) {
      const categoriaResult = await pool.query("SELECT id, tipo FROM categorias_caja WHERE id = $1", [categoriaIdNormalizada])
      if (categoriaResult.rows.length === 0) {
        return res.status(400).json({ error: "La categoría seleccionada no existe" })
      }
      const tipoCategoria = String(categoriaResult.rows[0]?.tipo || "").trim().toLowerCase()
      if (tipoCategoria && tipoCategoria !== tipoFinal) {
        return res.status(400).json({ error: "La categoría seleccionada no corresponde al tipo de movimiento" })
      }
    }

    if (tipoFinal === "egreso" && destinatario !== undefined && !destinatarioNormalizado) {
      return res.status(400).json({ error: "El destinatario es obligatorio para egresos" })
    }

    if (categoria !== undefined && categoria !== null && categoria !== "" && !CATEGORIAS_CAJA.includes(categoria)) {
      return res.status(400).json({ error: "Categoria inválida. Debe ser 'mano_obra', 'materiales' o 'varios'" })
    }

    const clienteFinal = cliente_id !== undefined ? cliente_id : movimientoActual.cliente_id
    const montoTotalFinal = roundMoney(Number(monto_total ?? movimientoActual.monto_total ?? 0))
    const presupuestosActuales = await obtenerPresupuestosIdsPorMovimiento(id)
    const presupuestosAsignacionesActuales = await obtenerPresupuestosAsignacionesPorMovimiento(id)
    const presupuestoIdsFinal = tipoFinal === "ingreso"
      ? (
        (presupuesto_ids !== undefined || presupuesto_id !== undefined)
          ? normalizarPresupuestosIds(presupuesto_ids, presupuesto_id)
          : presupuestosActuales
      )
      : []

    if (tipoFinal === "ingreso" && presupuestoIdsFinal.length > 0 && !clienteFinal) {
      return res.status(400).json({ error: "Para asociar presupuestos debe seleccionar un cliente" })
    }

    const presupuestosAsignacionesFinal = tipoFinal === "ingreso"
      ? (
        (presupuestos_asignaciones !== undefined || presupuesto_ids !== undefined || presupuesto_id !== undefined || monto_total !== undefined)
          ? construirAsignacionesPresupuestos({
            presupuestosIds: presupuestoIdsFinal,
            asignacionesRaw: presupuestos_asignaciones,
            montoTotal: montoTotalFinal,
          })
          : presupuestosAsignacionesActuales
      )
      : []

    if (presupuestoIdsFinal.length === 1) {
      await validarPresupuestoCliente(presupuestoIdsFinal[0], clienteFinal)
    }
    await validarPresupuestosCliente(presupuestoIdsFinal, clienteFinal)

    const cajaSemanalAnteriorId = movimientoActual.caja_semanal_id
    const fechaFinalMovimiento = fecha !== undefined ? fecha : movimientoActual.fecha
    const cajaFinalMovimiento = caja_codigo !== undefined ? (cajaCodigoNormalizada || "tesla") : movimientoActual.caja_codigo

    let cajaSemanalDestinoId = movimientoActual.caja_semanal_id
    if (caja_semanal_id !== undefined || caja_codigo !== undefined) {
      const semanaDestino = await resolverSemanaDestinoMovimiento({
        caja_codigo: cajaFinalMovimiento,
        caja_semanal_id,
        permitirCerrada: false,
      })
      cajaSemanalDestinoId = Number(semanaDestino.id)

      const checkPrimerMov = await pool.query(
        `SELECT COUNT(*)::int AS total FROM movimientos_caja WHERE caja_semanal_id = $1 AND id <> $2`,
        [Number(cajaSemanalDestinoId), Number(id)]
      )
      const cantidadSemana = Number(checkPrimerMov.rows?.[0]?.total || 0)
      if (cantidadSemana === 0 && !Boolean(movimientoActual?.es_control_semanal)) {
        return res.status(400).json({ error: "Debe registrar primero el control semanal inicial para comenzar la semana" })
      }
    }

    // Actualizar movimiento
    const actualizaciones = {}
    if (fecha !== undefined) actualizaciones.fecha = fecha
    if (caja_codigo !== undefined) actualizaciones.caja_codigo = cajaCodigoNormalizada || "tesla"
    if (tipo !== undefined) actualizaciones.tipo = tipoNormalizado
    if (detalle !== undefined) actualizaciones[detalleColumn] = detalle
    if (observaciones !== undefined) actualizaciones.observaciones = observacionesNormalizadas || null
    if (monto_total !== undefined) actualizaciones.monto_total = monto_total
    if (categoria !== undefined) actualizaciones.categoria = tipoFinal === "ingreso" ? (categoria || null) : null
    if (categoria_id !== undefined) actualizaciones.categoria_id = categoriaIdNormalizada
    if (con_iva !== undefined) actualizaciones.con_iva = normalizarBoolean(con_iva, true)
    if (destinatario !== undefined) actualizaciones.destinatario = tipoFinal === "egreso" ? destinatarioNormalizado : null
    if (cliente_id !== undefined) actualizaciones.cliente_id = cliente_id || null
    if (presupuesto_ids !== undefined || presupuesto_id !== undefined) {
      actualizaciones.presupuesto_id = tipoFinal === "ingreso" ? (presupuestoIdsFinal[0] || null) : null
    }

    if (cajaSemanalDestinoId !== undefined && cajaSemanalDestinoId !== null) {
      actualizaciones.caja_semanal_id = cajaSemanalDestinoId
    }

    if (tipo !== undefined && tipoFinal === "egreso") {
      actualizaciones.categoria = null
      if (presupuesto_id === undefined && presupuesto_ids === undefined) actualizaciones.presupuesto_id = null
    }

    if (tipo !== undefined && tipoFinal === "ingreso" && destinatario === undefined) {
      actualizaciones.destinatario = null
    }

    if (tipo !== undefined && tipoFinal === "ingreso" && presupuesto_id === undefined && presupuesto_ids === undefined) {
      actualizaciones.presupuesto_id = presupuestoIdsFinal[0] || null
    }

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
      validarDetallesPago(detallesPago, tipoFinal)
      const chequesSalidaLista = Array.isArray(cheques_salida) ? cheques_salida : []
      let totalChequesDetalle = 0
      if (tipoFinal === "egreso") {
        const validacionCheques = validarEgresoConChequesLibro({
          detallesPago,
          chequesSalida: chequesSalidaLista,
        })
        totalChequesDetalle = validacionCheques.totalChequesDetalle
      }
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
          librador_endosante: item.librador_endosante,
          numero_cheque: item.numero_cheque,
          fecha_cheque: item.fecha_cheque,
          fecha_entrada: item.fecha_entrada,
          endosado_a: item.endosado_a,
          libro_cheque_id: item.libro_cheque_id,
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
          banco: parseFloat(desglose.banco) || 0,
          cheque: parseFloat(desglose.cheque) || 0,
          echeq: parseFloat(desglose.echeq) || 0,
          retencion: parseFloat(desglose.retencion) || 0,
        }

        const { error: errorDetalles } = await db.from("detalles_medio_pago").insert([detalleFila])
        if (errorDetalles) return res.status(400).json({ error: errorDetalles.message })
      }

      const client = await pool.connect()
      try {
        if (tipoFinal === "ingreso") {
          await validarIngresoEliminable({ client, movimientoId: id })
          await client.query("DELETE FROM libro_cheques_caja WHERE movimiento_entrada_id = $1", [id])
          await crearChequesLibroDesdeIngreso({
            client,
            movimientoId: id,
            cajaCodigo: cajaFinalMovimiento,
            fechaMovimiento: fechaFinalMovimiento,
            detallesPago,
          })
        }

        if (tipoFinal === "egreso" && cheques_salida !== undefined) {
          await revertirSalidaChequesPorMovimiento({ client, movimientoId: id })
          if (chequesSalidaLista.length > 0) {
            await registrarSalidaCheques({
              client,
              movimientoId: id,
              cajaCodigo: cajaFinalMovimiento,
              fechaSalida: fecha_salida_cheques || fechaFinalMovimiento,
              fechaMovimiento: fechaFinalMovimiento,
              endosadoA: endosado_a_cheques || destinatarioNormalizado || movimientoActual.destinatario,
              chequesSalida: chequesSalidaLista,
              expectedChequeTotal: totalChequesDetalle,
            })
          }
        }
      } finally {
        client.release()
      }
    }

    const clientPresupuestos = await pool.connect()
    try {
      await sincronizarMovimientosCajaPresupuestos({
        client: clientPresupuestos,
        movimientoId: id,
        presupuestosIds: tipoFinal === "ingreso" ? presupuestoIdsFinal : [],
        presupuestosAsignaciones: tipoFinal === "ingreso" ? presupuestosAsignacionesFinal : [],
      })
    } finally {
      clientPresupuestos.release()
    }

    if (cajaSemanalAnteriorId && String(cajaSemanalAnteriorId) !== String(cajaSemanalDestinoId || movimientoActual.caja_semanal_id || "")) {
      await recalcularCajaSemanal(cajaSemanalAnteriorId)
    }

    if (cajaSemanalDestinoId) {
      await recalcularCajaSemanal(cajaSemanalDestinoId)
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

    const movimientoFinalNormalizado = normalizarMovimiento(movimientoFinal)
    movimientoFinalNormalizado.presupuestos_ids = await obtenerPresupuestosIdsPorMovimiento(id)
    movimientoFinalNormalizado.presupuestos_asignaciones = await obtenerPresupuestosAsignacionesPorMovimiento(id)
    if (movimientoFinalNormalizado.presupuestos_ids.length > 0 && !movimientoFinalNormalizado.presupuesto_id) {
      movimientoFinalNormalizado.presupuesto_id = movimientoFinalNormalizado.presupuestos_ids[0]
    }

    getIo()?.emit('caja:changed')
    res.json(movimientoFinalNormalizado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post("/libro-cheques/transferir", async (req, res) => {
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await ensureLibroChequesSchema()

    const {
      caja_origen,
      caja_destino,
      fecha,
      cheques,
      detalle,
      observaciones,
    } = req.body || {}

    const cajaOrigen = String(caja_origen || "").toLowerCase().trim()
    const cajaDestino = String(caja_destino || "").toLowerCase().trim()
    const fechaMovimiento = normalizarFechaISO(fecha)
    const detalleBase = String(detalle || "").trim() || `Pasan cheques a ${LABEL_CAJA[cajaDestino] || cajaDestino}`
    const observacionesTexto = String(observaciones || "").trim() || null

    if (!CAJAS_DISPONIBLES.includes(cajaOrigen) || !CAJAS_DISPONIBLES.includes(cajaDestino)) {
      return res.status(400).json({ error: "Debe indicar cajas de origen y destino validas" })
    }

    if (cajaOrigen === cajaDestino) {
      return res.status(400).json({ error: "La caja de destino debe ser distinta a la de origen" })
    }

    if (!fechaMovimiento) {
      return res.status(400).json({ error: "La fecha de transferencia es obligatoria" })
    }

    const chequeIds = (Array.isArray(cheques) ? cheques : [])
      .map((item) => Number(item?.libro_cheque_id || item?.id || item))
      .filter((id) => Number.isInteger(id) && id > 0)

    const idsUnicos = Array.from(new Set(chequeIds))
    if (!idsUnicos.length) {
      return res.status(400).json({ error: "Debe seleccionar al menos un cheque para transferir" })
    }

    await client.query("BEGIN")
    transactionStarted = true

    const placeholders = idsUnicos.map((_, i) => `$${i + 1}`).join(",")
    const chequesResult = await client.query(
      `
        SELECT id, caja_codigo, estado, medio_pago, importe, numero_cheque, banco, librador_endosante, fecha_cheque, fecha_entrada
        FROM libro_cheques_caja
        WHERE id IN (${placeholders})
        FOR UPDATE
      `,
      idsUnicos
    )

    if (chequesResult.rowCount !== idsUnicos.length) {
      throw new Error("Uno o mas cheques seleccionados no existen")
    }

    const noTransferibles = chequesResult.rows.filter((item) => String(item.estado) !== "disponible" || String(item.caja_codigo) !== cajaOrigen)
    if (noTransferibles.length) {
      throw new Error("Solo se pueden transferir cheques disponibles de la caja de origen")
    }

    const totalTransferencia = roundMoney(chequesResult.rows.reduce((acc, item) => acc + Number(item.importe || 0), 0))
    if (!(totalTransferencia > 0)) {
      throw new Error("El total de cheques a transferir debe ser mayor a 0")
    }

    const detalleColumn = await getDetalleColumn()
    const detalleDestino = `Ingreso por transferencia de cheques desde ${LABEL_CAJA[cajaOrigen] || cajaOrigen}`
    const destinatarioOrigen = LABEL_CAJA[cajaDestino] || cajaDestino
    const semanaOrigen = await resolverSemanaDestinoMovimiento({ caja_codigo: cajaOrigen })
    const semanaDestino = await resolverSemanaDestinoMovimiento({ caja_codigo: cajaDestino })

    const movOrigenInsert = await client.query(
      `
        INSERT INTO movimientos_caja (fecha, caja_codigo, tipo, ${detalleColumn}, observaciones, monto_total, categoria, con_iva, destinatario, cliente_id, presupuesto_id)
        VALUES ($1,$2,'egreso',$3,$4,$5,NULL,true,$6,NULL,NULL)
        RETURNING id
      `,
      [fechaMovimiento, cajaOrigen, detalleBase, observacionesTexto, totalTransferencia, destinatarioOrigen]
    )
    const movimientoOrigenId = Number(movOrigenInsert.rows?.[0]?.id || 0)

    const movDestinoInsert = await client.query(
      `
        INSERT INTO movimientos_caja (fecha, caja_codigo, tipo, ${detalleColumn}, observaciones, monto_total, categoria, con_iva, destinatario, cliente_id, presupuesto_id)
        VALUES ($1,$2,'ingreso',$3,$4,$5,'varios',true,$6,NULL,NULL)
        RETURNING id
      `,
      [fechaMovimiento, cajaDestino, detalleDestino, observacionesTexto, totalTransferencia, null]
    )
    const movimientoDestinoId = Number(movDestinoInsert.rows?.[0]?.id || 0)

    if (!movimientoOrigenId || !movimientoDestinoId) {
      throw new Error("No se pudieron registrar los movimientos de transferencia")
    }

    await client.query(`UPDATE movimientos_caja SET caja_semanal_id = $2 WHERE id = $1`, [movimientoOrigenId, Number(semanaOrigen.id)])
    await client.query(`UPDATE movimientos_caja SET caja_semanal_id = $2 WHERE id = $1`, [movimientoDestinoId, Number(semanaDestino.id)])

    for (const item of chequesResult.rows) {
      await client.query(
        `
          INSERT INTO detalles_medio_pago (
            movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro,
            librador_endosante, numero_cheque, fecha_cheque, fecha_entrada, endosado_a, libro_cheque_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          movimientoOrigenId,
          "cheque",
          roundMoney(Number(item.importe || 0)),
          String(item.numero_cheque || ""),
          String(item.banco || ""),
          normalizarFechaISO(item.fecha_cheque),
          String(item.librador_endosante || ""),
          String(item.numero_cheque || ""),
          normalizarFechaISO(item.fecha_cheque),
          fechaMovimiento,
          destinatarioOrigen,
          Number(item.id),
        ]
      )
    }

    for (const item of chequesResult.rows) {
      await client.query(
        `
          INSERT INTO detalles_medio_pago (
            movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro,
            librador_endosante, numero_cheque, fecha_cheque, fecha_entrada, endosado_a, libro_cheque_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          movimientoDestinoId,
          "cheque",
          roundMoney(Number(item.importe || 0)),
          String(item.numero_cheque || ""),
          String(item.banco || ""),
          normalizarFechaISO(item.fecha_cheque),
          String(item.librador_endosante || ""),
          String(item.numero_cheque || ""),
          normalizarFechaISO(item.fecha_cheque),
          normalizarFechaISO(item.fecha_entrada) || fechaMovimiento,
          null,
          null,
        ]
      )
    }

    await registrarSalidaCheques({
      client,
      movimientoId: movimientoOrigenId,
      cajaCodigo: cajaOrigen,
      fechaSalida: fechaMovimiento,
      endosadoA: destinatarioOrigen,
      chequesSalida: idsUnicos.map((id) => ({ libro_cheque_id: id })),
      expectedChequeTotal: totalTransferencia,
    })

    for (const item of chequesResult.rows) {
      await client.query(
        `
          INSERT INTO libro_cheques_caja (
            caja_codigo, medio_pago, movimiento_entrada_id, fecha_entrada,
            librador_endosante, banco, numero_cheque, importe, fecha_cheque,
            observaciones, estado, movimiento_salida_id, fecha_salida, endosado_a
          ) VALUES ($1,'cheque',$2,$3,$4,$5,$6,$7,$8,$9,'disponible',NULL,NULL,NULL)
        `,
        [
          cajaDestino,
          movimientoDestinoId,
          normalizarFechaISO(item.fecha_entrada) || fechaMovimiento,
          String(item.librador_endosante || ""),
          String(item.banco || ""),
          String(item.numero_cheque || ""),
          roundMoney(Number(item.importe || 0)),
          normalizarFechaISO(item.fecha_cheque) || fechaMovimiento,
          observacionesTexto,
        ]
      )
    }

    await client.query("COMMIT")
    transactionStarted = false

    await recalcularCajaSemanal(Number(semanaOrigen.id))
    if (Number(semanaDestino.id) !== Number(semanaOrigen.id)) {
      await recalcularCajaSemanal(Number(semanaDestino.id))
    }

    getIo()?.emit('caja:changed')
    res.json({
      ok: true,
      total_transferido: totalTransferencia,
      cantidad_cheques: idsUnicos.length,
      movimiento_origen_id: movimientoOrigenId,
      movimiento_destino_id: movimientoDestinoId,
    })
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK")
      } catch {
        // no-op
      }
    }
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

// Eliminar movimiento (cascade delete de detalles)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params
    await ensureLibroChequesSchema()

    const { data: movimientoActual, error: errorMovimientoActual } = await db
      .from("movimientos_caja")
      .select("id, caja_semanal_id, tipo")
      .eq("id", id)
      .single()

    if (errorMovimientoActual || !movimientoActual) {
      return res.status(404).json({ error: "Movimiento no encontrado" })
    }

    // Bloquear solo si existe un recibo emitido activo.
    // Si todos los recibos están anulados, se permite borrar el movimiento.
    const recibosMovimiento = await db.query(
      `SELECT id, estado FROM recibos_caja WHERE movimiento_caja_id = $1`,
      [id]
    )
    const recibosEmitidos = (recibosMovimiento.rows || []).filter(
      (row) => String(row?.estado || "").toLowerCase() === "emitido"
    )
    if (recibosEmitidos.length > 0) {
      return res.status(400).json({
        error: "No se puede eliminar este movimiento porque tiene un recibo emitido activo. Primero anulá el recibo."
      })
    }

    const client = await pool.connect()
    try {
      if (String(movimientoActual.tipo || "") === "ingreso") {
        await validarIngresoEliminable({ client, movimientoId: id })
        await client.query("DELETE FROM recibos_caja WHERE movimiento_caja_id = $1", [id])
        await client.query("DELETE FROM libro_cheques_caja WHERE movimiento_entrada_id = $1", [id])
      } else {
        await revertirSalidaChequesPorMovimiento({ client, movimientoId: id })
      }
    } finally {
      client.release()
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

// Resumen previo de importación de sueldos (separado por medio de pago)
router.get("/importar-sueldos/resumen", async (req, res) => {
  try {
    const { mes, anio } = req.query
    const mesInt = parseInt(mes)
    const anioInt = parseInt(anio)

    if (!mesInt || !anioInt || mesInt < 1 || mesInt > 12) {
      return res.status(400).json({ error: "Faltan mes y anio válidos" })
    }

    const inicioISO = new Date(anioInt, mesInt - 1, 1).toISOString().slice(0, 10)
    const finISO = new Date(anioInt, mesInt, 0).toISOString().slice(0, 10)
    const periodo = `${anioInt}-${String(mesInt).padStart(2, "0")}`

    const { data: liquidaciones, error: errLiq } = await db
      .from("liquidaciones")
      .select("id, empleado_id")
      .gte("periodo_inicio", inicioISO)
      .lte("periodo_fin", finISO)

    if (errLiq) return res.status(500).json({ error: errLiq.message })

    if (!liquidaciones || liquidaciones.length === 0) {
      return res.json({
        periodo,
        empleados: [],
        totales: { efectivo: 0, total: 0 },
        importara_a_caja: 0,
      })
    }

    const liquidacionIds = liquidaciones.map((l) => l.id)
    const empleadoIds = [...new Set(liquidaciones.map((l) => l.empleado_id).filter(Boolean))]

    const placeholders = liquidacionIds.map((_, i) => `$${i + 1}`).join(", ")
    const pagosRes = await pool.query(
      `SELECT liquidacion_id, monto, medio_pago FROM pagos_sueldo WHERE liquidacion_id IN (${placeholders})`,
      liquidacionIds
    )
    const pagos = pagosRes.rows || []

    const empleadosMap = new Map()
    if (empleadoIds.length > 0) {
      const placeholdersEmp = empleadoIds.map((_, i) => `$${i + 1}`).join(", ")
      const empleadosRes = await pool.query(
        `SELECT id, nombre, apellido FROM empleados WHERE id IN (${placeholdersEmp})`,
        empleadoIds
      )

      for (const e of empleadosRes.rows || []) {
        empleadosMap.set(e.id, e)
      }
    }

    const liqToEmp = new Map(liquidaciones.map((l) => [l.id, l.empleado_id]))
    const resumenPorEmpleado = new Map()

    const getOrInitEmpleado = (empleadoId) => {
      if (!resumenPorEmpleado.has(empleadoId)) {
        const emp = empleadosMap.get(empleadoId) || {}
        resumenPorEmpleado.set(empleadoId, {
          empleado_id: empleadoId,
          nombre: String(emp.nombre || ""),
          apellido: String(emp.apellido || ""),
          efectivo: 0,
          total: 0,
          pagos: 0,
        })
      }
      return resumenPorEmpleado.get(empleadoId)
    }

    for (const p of pagos) {
      const empleadoId = liqToEmp.get(p.liquidacion_id)
      if (!empleadoId) continue

      const row = getOrInitEmpleado(empleadoId)
      const monto = parseFloat(p.monto || 0)
      const medio = String(p.medio_pago || "").toLowerCase().trim()

      if (medio !== "efectivo") continue
      row.efectivo += monto
      row.total += monto
      row.pagos += 1
    }

    const empleados = Array.from(resumenPorEmpleado.values())
      .map((r) => ({
        ...r,
        efectivo: roundMoney(r.efectivo),
        total: roundMoney(r.total),
      }))
      .filter((r) => r.total > 0.009)
      .sort((a, b) => {
        const nombreA = `${a.apellido} ${a.nombre}`.trim().toLowerCase()
        const nombreB = `${b.apellido} ${b.nombre}`.trim().toLowerCase()
        return nombreA.localeCompare(nombreB)
      })

    const totales = empleados.reduce((acc, r) => {
      acc.efectivo += Number(r.efectivo || 0)
      acc.total += Number(r.total || 0)
      return acc
    }, { efectivo: 0, total: 0 })

    res.json({
      periodo,
      empleados,
      totales: {
        efectivo: roundMoney(totales.efectivo),
        total: roundMoney(totales.total),
      },
      importara_a_caja: roundMoney(totales.efectivo),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get("/importar-sueldos/resumen/pdf", async (req, res) => {
  try {
    const { mes, anio } = req.query
    const mesInt = parseInt(mes)
    const anioInt = parseInt(anio)

    if (!mesInt || !anioInt || mesInt < 1 || mesInt > 12) {
      return res.status(400).json({ error: "Faltan mes y anio válidos" })
    }

    const inicioISO = new Date(anioInt, mesInt - 1, 1).toISOString().slice(0, 10)
    const finISO = new Date(anioInt, mesInt, 0).toISOString().slice(0, 10)
    const periodo = `${anioInt}-${String(mesInt).padStart(2, "0")}`

    const { data: liquidaciones, error: errLiq } = await db
      .from("liquidaciones")
      .select("id, empleado_id")
      .gte("periodo_inicio", inicioISO)
      .lte("periodo_fin", finISO)

    if (errLiq) return res.status(500).json({ error: errLiq.message })

    const liquidacionIds = (liquidaciones || []).map((l) => l.id)
    const empleadoIds = [...new Set((liquidaciones || []).map((l) => l.empleado_id).filter(Boolean))]

    let pagos = []
    if (liquidacionIds.length > 0) {
      const placeholders = liquidacionIds.map((_, i) => `$${i + 1}`).join(", ")
      const pagosRes = await pool.query(
        `SELECT liquidacion_id, monto, medio_pago FROM pagos_sueldo WHERE liquidacion_id IN (${placeholders})`,
        liquidacionIds
      )
      pagos = pagosRes.rows || []
    }

    const empleadosMap = new Map()
    if (empleadoIds.length > 0) {
      const placeholdersEmp = empleadoIds.map((_, i) => `$${i + 1}`).join(", ")
      const empleadosRes = await pool.query(
        `SELECT id, nombre, apellido FROM empleados WHERE id IN (${placeholdersEmp})`,
        empleadoIds
      )

      for (const e of empleadosRes.rows || []) {
        empleadosMap.set(e.id, e)
      }
    }

    const liqToEmp = new Map((liquidaciones || []).map((l) => [l.id, l.empleado_id]))
    const resumenPorEmpleado = new Map()

    const getOrInitEmpleado = (empleadoId) => {
      if (!resumenPorEmpleado.has(empleadoId)) {
        const emp = empleadosMap.get(empleadoId) || {}
        resumenPorEmpleado.set(empleadoId, {
          empleado_id: empleadoId,
          nombre: String(emp.nombre || ""),
          apellido: String(emp.apellido || ""),
          efectivo: 0,
          total: 0,
        })
      }
      return resumenPorEmpleado.get(empleadoId)
    }

    for (const p of pagos) {
      const empleadoId = liqToEmp.get(p.liquidacion_id)
      if (!empleadoId) continue

      const row = getOrInitEmpleado(empleadoId)
      const monto = parseFloat(p.monto || 0)
      const medio = String(p.medio_pago || "").toLowerCase().trim()
      if (medio !== "efectivo") continue
      row.efectivo += monto
      row.total += monto
    }

    const empleados = Array.from(resumenPorEmpleado.values())
      .map((r) => ({
        ...r,
        efectivo: roundMoney(r.efectivo),
        total: roundMoney(r.total),
      }))
      .filter((r) => r.total > 0.009)
      .sort((a, b) => {
        const nombreA = `${a.apellido} ${a.nombre}`.trim().toLowerCase()
        const nombreB = `${b.apellido} ${b.nombre}`.trim().toLowerCase()
        return nombreA.localeCompare(nombreB)
      })

    const totales = empleados.reduce((acc, r) => {
      acc.efectivo += Number(r.efectivo || 0)
      acc.total += Number(r.total || 0)
      return acc
    }, { efectivo: 0, total: 0 })

    const doc = new PDFDocument({ size: "A4", margin: 45 })
    const chunks = []
    const pageWidth = doc.page.width
    const fileName = `Resumen Importacion Sueldos ${periodo}.pdf`

    doc.on("data", (chunk) => chunks.push(chunk))
    doc.on("end", () => {
      const pdfBuffer = Buffer.concat(chunks)
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFileText(fileName)}"`)
      res.send(pdfBuffer)
    })

    setupPremiumFooter(doc, { leftText: "Tesla Montajes Electricos - Resumen importacion sueldos" })

    const headerBottom = drawPremiumHeader(doc, {
      title: "TESLA MONTAJES ELECTRICOS",
      subtitle: "Resumen de importacion a Caja Tesla",
      accentText: `Periodo ${periodo}`,
      logoPath: LOGO_PATH,
    })

    let y = headerBottom + 12

    const cardW = (pageWidth - 90 - 8) / 2
    const cardH = 44
    const cards = [
      { label: "Efectivo que se importa a Caja", value: formatoMoneda(totales.efectivo) },
      { label: "Total pagado", value: formatoMoneda(totales.total) },
    ]

    cards.forEach((card, idx) => {
      const x = 45 + idx * (cardW + 8)
      doc.rect(x, y, cardW, cardH).lineWidth(0.8).strokeColor(PDF_COLORS.line).stroke()
      doc.font("Helvetica").fontSize(8.2).fillColor(PDF_COLORS.slate).text(card.label, x + 8, y + 6)
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(PDF_COLORS.ink).text(card.value, x + 8, y + 20)
    })
    y += cardH + 14

    doc.strokeColor(PDF_COLORS.line).lineWidth(0.7).moveTo(45, y + 11).lineTo(pageWidth - 45, y + 11).stroke()
    doc.fillColor(PDF_COLORS.ink).font("Helvetica-Bold").fontSize(10.2).text("DETALLE POR EMPLEADO", 52, y)
    y += 22

    const rowH = 20
    const xEmp = 50
    const xEf = pageWidth - 250
    const xTot = pageWidth - 145
    const moneyColW = 95

    doc.rect(45, y, pageWidth - 90, rowH).lineWidth(0.8).strokeColor(PDF_COLORS.line).stroke()
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(PDF_COLORS.ink)
    doc.text("Empleado", xEmp, y + 6)
    doc.text("Efectivo", xEf, y + 6, { width: moneyColW, align: "right" })
    doc.text("Total", xTot, y + 6, { width: moneyColW, align: "right" })
    y += rowH

    if (empleados.length === 0) {
      doc.rect(45, y, pageWidth - 90, rowH).lineWidth(0.5).strokeColor(PDF_COLORS.line).stroke()
      doc.font("Helvetica").fontSize(9).fillColor(PDF_COLORS.slate)
      doc.text("Sin pagos registrados en este periodo", 52, y + 6)
      y += rowH
    } else {
      empleados.forEach((emp, idx) => {
        if (y > doc.page.height - doc.page.margins.bottom - 95) {
          doc.addPage()
          y = 62
        }

        const nombre = `${emp.apellido || ""} ${emp.nombre || ""}`.trim() || `Empleado ${emp.empleado_id}`
        const bg = idx % 2 === 0 ? PDF_COLORS.light : PDF_COLORS.lightAlt
        doc.rect(45, y, pageWidth - 90, rowH).fill(bg)
        doc.rect(45, y, pageWidth - 90, rowH).lineWidth(0.4).strokeColor(PDF_COLORS.line).stroke()
        doc.font("Helvetica").fontSize(8.8).fillColor(PDF_COLORS.ink)
        doc.text(nombre, xEmp, y + 6, { width: 290 })
        doc.text(formatoMoneda(emp.efectivo), xEf, y + 6, { width: moneyColW, align: "right" })
        doc.text(formatoMoneda(emp.total), xTot, y + 6, { width: moneyColW, align: "right" })
        y += rowH
      })
    }

    y += 12
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(PDF_COLORS.ink)
    doc.text(`Se importa a Caja Tesla solo efectivo: ${formatoMoneda(totales.efectivo)}`, 52, y)

    doc.end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Consultar estado de importación de sueldos del período
router.get("/importar-sueldos/estado", async (req, res) => {
  try {
    const { mes, anio } = req.query
    const mesInt = parseInt(mes)
    const anioInt = parseInt(anio)

    if (!mesInt || !anioInt || mesInt < 1 || mesInt > 12) {
      return res.status(400).json({ error: "Faltan mes y anio válidos" })
    }

    const inicioISO = new Date(anioInt, mesInt - 1, 1).toISOString().slice(0, 10)
    const finISO = new Date(anioInt, mesInt, 0).toISOString().slice(0, 10)
    const periodo = `${anioInt}-${String(mesInt).padStart(2, "0")}`
    const semanaActualTesla = await obtenerSemanaAbierta("tesla")
    if (!semanaActualTesla) {
      return res.json({ estado: "sin_semana_abierta" })
    }

    // Obtener liquidaciones del período
    const { data: liquidaciones } = await db
      .from("liquidaciones")
      .select("id")
      .gte("periodo_inicio", inicioISO)
      .lte("periodo_fin", finISO)

    if (!liquidaciones || liquidaciones.length === 0) {
      return res.json({ estado: "sin_pagos" })
    }

    const liquidacionIds = liquidaciones.map((l) => l.id)
    const placeholders = liquidacionIds.map((_, i) => `$${i + 1}`).join(", ")
    const pagosRes = await pool.query(
      `SELECT monto, medio_pago FROM pagos_sueldo WHERE liquidacion_id IN (${placeholders})`,
      liquidacionIds
    )
    const pagos = pagosRes.rows

    let montoEfectivo = 0
    let montoTransferencia = 0
    for (const p of pagos) {
      const medio = String(p.medio_pago || "").toLowerCase().trim()
      const monto = parseFloat(p.monto || 0)
      if (medio === "efectivo") montoEfectivo += monto
      else montoTransferencia += monto
    }
    montoEfectivo = parseFloat(montoEfectivo.toFixed(2))
    montoTransferencia = parseFloat(montoTransferencia.toFixed(2))

    const detalleColumn = await getDetalleColumn()

    const buckets = [
      { medio: "efectivo", label: "Efectivo", monto: montoEfectivo },
      { medio: "transferencia", label: "Depósito", monto: montoTransferencia },
    ].filter((b) => b.monto > 0.009)

    const bucketInfo = []
    for (const bucket of buckets) {
      const detalleValor = `Sueldos ${periodo} — ${bucket.label}`
      const existenteRes = await pool.query(
        `SELECT id, monto_total FROM movimientos_caja WHERE ${detalleColumn} = $1 AND caja_codigo = 'tesla' AND tipo = 'egreso' LIMIT 1`,
        [detalleValor]
      )
      const existente = existenteRes.rows[0] || null
      bucketInfo.push({
        medio: bucket.medio,
        montoActual: bucket.monto,
        montoEnCaja: existente ? parseFloat(existente.monto_total) : null,
        importado: !!existente,
        cambio: existente ? Math.abs(parseFloat(existente.monto_total) - bucket.monto) >= 0.01 : false,
      })
    }

    const alguno_importado = bucketInfo.some((b) => b.importado)
    const alguno_sin_importar = bucketInfo.some((b) => !b.importado)
    const hay_cambio = bucketInfo.some((b) => b.cambio)

    let estado
    if (!alguno_importado) estado = "no_importado"
    else if (hay_cambio || alguno_sin_importar) estado = "desactualizado"
    else estado = "importado"

    res.json({ estado, buckets: bucketInfo })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Importar pagos de sueldos del período como egresos en Caja Tesla
// Crea/actualiza DOS movimientos independientes: uno por efectivo, uno por transferencia
router.post("/importar-sueldos", async (req, res) => {
  try {
    const { mes, anio } = req.body
    const mesInt = parseInt(mes)
    const anioInt = parseInt(anio)

    if (!mesInt || !anioInt || mesInt < 1 || mesInt > 12) {
      return res.status(400).json({ error: "Faltan mes y anio válidos" })
    }

    const inicioISO = new Date(anioInt, mesInt - 1, 1).toISOString().slice(0, 10)
    const finISO = new Date(anioInt, mesInt, 0).toISOString().slice(0, 10)
    const periodo = `${anioInt}-${String(mesInt).padStart(2, "0")}`
    const fechaImportacion = new Date().toISOString().slice(0, 10)
    const semanaActualTesla = await obtenerSemanaAbierta("tesla")
    if (!semanaActualTesla) {
      return res.status(400).json({ error: "No hay una semana abierta en Caja Tesla. Abrí una semana primero" })
    }

    // Obtener liquidaciones del período
    const { data: liquidaciones, error: errLiq } = await db
      .from("liquidaciones")
      .select("id")
      .gte("periodo_inicio", inicioISO)
      .lte("periodo_fin", finISO)

    if (errLiq) return res.status(500).json({ error: errLiq.message })

    if (!liquidaciones || liquidaciones.length === 0) {
      return res.json({ status: "sin_pagos", mensaje: "No hay liquidaciones en el período" })
    }

    const liquidacionIds = liquidaciones.map((l) => l.id)

    // Obtener pagos de esas liquidaciones (sin depender de fecha_pago)
    const placeholders = liquidacionIds.map((_, i) => `$${i + 1}`).join(", ")
    const pagosRes = await pool.query(
      `SELECT monto, medio_pago FROM pagos_sueldo WHERE liquidacion_id IN (${placeholders})`,
      liquidacionIds
    )
    const pagos = pagosRes.rows

    // Calcular totales por medio
    let montoEfectivo = 0
    let montoTransferencia = 0
    for (const p of pagos) {
      const medio = String(p.medio_pago || "").toLowerCase().trim()
      const monto = parseFloat(p.monto || 0)
      if (medio === "efectivo") montoEfectivo += monto
      else montoTransferencia += monto
    }
    montoEfectivo = parseFloat(montoEfectivo.toFixed(2))
    montoTransferencia = parseFloat(montoTransferencia.toFixed(2))

    if (montoEfectivo <= 0 && montoTransferencia <= 0) {
      return res.json({ status: "sin_pagos", mensaje: "El total de pagos es cero" })
    }

    const [detallesSchema, detalleColumn] = await Promise.all([getDetallesSchema(), getDetalleColumn()])

    // Solo se importa efectivo — los depósitos no pasan por la caja
    const buckets = [
      { medio: "efectivo", monto: montoEfectivo, label: "Efectivo" },
    ].filter((b) => b.monto > 0.009)

    const resultados = []

    for (const bucket of buckets) {
      // El detalle único identifica el movimiento para deduplicación
      const detalleValor = `Sueldos ${periodo} — ${bucket.label}`

      // Buscar movimiento existente por detalle + caja + tipo (raw SQL)
      const existenteRes = await pool.query(
        `SELECT id, monto_total, caja_semanal_id, observaciones FROM movimientos_caja WHERE ${detalleColumn} = $1 AND caja_codigo = 'tesla' AND tipo = 'egreso' LIMIT 1`,
        [detalleValor]
      )
      const existente = existenteRes.rows[0] || null

      const insertarDetalle = async (movimientoId) => {
        if (detallesSchema.mode === "filas") {
          const { error } = await db.from("detalles_medio_pago").insert([{
            movimiento_id: movimientoId,
            medio_pago: bucket.medio,
            monto: bucket.monto,
          }])
          if (error) throw error
        } else {
          const fila = { movimiento_id: movimientoId, efectivo: 0, transferencia: 0, cheque: 0, echeq: 0, retencion: 0 }
          fila[bucket.medio] = bucket.monto
          const { error } = await db.from("detalles_medio_pago").insert([fila])
          if (error) throw error
        }
      }

      if (existente) {
        const montoExistente = parseFloat(existente.monto_total || 0)
        const mismoMonto = Math.abs(montoExistente - bucket.monto) < 0.01
        const tieneObsVieja = existente.observaciones && existente.observaciones.trim() !== ""
        const semanaExistenteId = Number(existente.caja_semanal_id || 0)
        const semanaActualId = Number(semanaActualTesla?.id || 0)
        const necesitaReasignarSemana = semanaExistenteId !== semanaActualId

        if (mismoMonto && !tieneObsVieja && !necesitaReasignarSemana) {
          resultados.push({ medio: bucket.medio, status: "sin_cambios", monto: bucket.monto })
          continue
        }

        // Actualizar monto y/o limpiar observación vieja
        const { error: errUpdate } = await db
          .from("movimientos_caja")
          .update({ monto_total: bucket.monto, observaciones: null, fecha: fechaImportacion })
          .eq("id", existente.id)

        if (errUpdate) return res.status(500).json({ error: errUpdate.message })

        await db.from("detalles_medio_pago").delete().eq("movimiento_id", existente.id)
        await insertarDetalle(existente.id)

        const cajaSemanalAnteriorId = existente.caja_semanal_id
        try {
          await asignarCajaSemanalAMovimiento({ movimientoId: existente.id, fecha: fechaImportacion, caja_codigo: "tesla" })
        } catch (errSemana) {
          return res.status(400).json({ error: `No se pudo asignar el movimiento a la semana actual de Caja Tesla: ${errSemana.message}` })
        }

        if (cajaSemanalAnteriorId && String(cajaSemanalAnteriorId) !== String(semanaActualTesla?.id || "")) {
          try { await recalcularCajaSemanal(cajaSemanalAnteriorId) } catch (_) { /* no fatal */ }
        }

        resultados.push({ medio: bucket.medio, status: (mismoMonto && !tieneObsVieja) ? "sin_cambios" : "actualizado", montoAnterior: montoExistente, montoNuevo: bucket.monto })
        continue
      }

      // Crear nuevo (atómico: movimiento + detalle + semana)
      let semanaDestino
      try {
        semanaDestino = await resolverSemanaDestinoMovimiento({
          caja_codigo: "tesla",
          permitirCerrada: false,
      })
      } catch (errSemana) {
        return res.status(400).json({
          error: `No se pudo asignar el movimiento a la semana actual de Caja Tesla: ${errSemana.message}`
        })
      }

      const client = await pool.connect()
      let movimientoId = null
      try{
        await client.query("BEGIN")

        const insertMovRes = await client.query(
          `
            INSERT INTO movimientos_caja (
              fecha,
              caja_codigo,
              caja_semanal_id,
              tipo,
              ${detalleColumn},
              observaciones,
              monto_total,
              categoria,
              destinatario,
              con_iva
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING id
          `,
          [
            fechaImportacion,
            "tesla",
            semanaDestino.id,
            "egreso",
            detalleValor,
            null,
            bucket.monto,
            null,
            "Pago de sueldos",
            false
          ]
        )

        movimientoId = Number(insertMovRes.rows?.[0]?.id || 0)

        if (!movimientoId) {
          throw new Error("No se pudo obtener el id del movimiento insertado")
        }

        if (detallesSchema.mode === "filas") {
          await client.query(
            `INSERT INTO detalles_medio_pago (movimiento_id, medio_pago, monto) VALUES ($1,$2,$3)`,
            [movimientoId, bucket.medio, bucket.monto]
          )
        } else {
          const efectivo = bucket.medio === "efectivo" ? bucket.monto : 0
          const transferencia = bucket.medio === "transferencia" ? bucket.monto : 0
          const cheque = bucket.medio === "cheque" ? bucket.monto : 0
          const echeq = bucket.medio === "echeq" ? bucket.monto : 0
          const retencion = bucket.medio === "retencion" ? bucket.monto : 0

          await client.query(
            `INSERT INTO detalles_medio_pago (movimiento_id, efectivo, transferencia, cheque, echeq, retencion) VALUES ($1,$2,$3,$4,$5,$6)`,
            [movimientoId, efectivo, transferencia, cheque, echeq, retencion]
          )
        }

        await client.query("COMMIT")
      } catch (errTX) {
        try { await client.query("ROLLBACK") } catch (_) {}
        return res.status(500).json({ error: `Error al crear el movimiento de forma atómica: ${errTX.message}` })
      } finally {
        client.release()
      }

      try {
        await recalcularCajaSemanal(semanaDestino.id)
      } catch (_) {
        // No rompe consistencia financiera; solo puede quedar desactualizado el agregado semanal
      }

      resultados.push({ medio: bucket.medio, status: "creado", monto: bucket.monto})
  
    }

    getIo()?.emit("caja:changed")

    // Status general: si alguno fue creado/actualizado → activo, si todos sin_cambios → sin_cambios
    const hayAccion = resultados.some((r) => r.status === "creado" || r.status === "actualizado")
    res.json({
      status: hayAccion ? "ok" : "sin_cambios",
      resultados,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
