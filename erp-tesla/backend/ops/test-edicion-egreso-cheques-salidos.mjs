import "dotenv/config"
import jwt from "jsonwebtoken"
import { pool } from "../db.js"
import { getSessionCookieName } from "../utils/http-cookies.js"

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:5001"
const SESSION_COOKIE = getSessionCookieName()
const TEST_LIMIT = Math.max(1, Number(process.env.TEST_LIMIT || 5))

function buildAuthCookie() {
  const secret = String(process.env.JWT_SECRET || "").trim()
  if (!secret) {
    throw new Error("JWT_SECRET no configurado")
  }

  const token = jwt.sign(
    {
      sub: 1,
      email: "test@local",
      rol: "admin",
      nombre: "Test Local",
    },
    secret,
    { expiresIn: "10m" }
  )

  return `${SESSION_COOKIE}=${token}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function buildDesglose(detalles = []) {
  const base = {
    efectivo: 0,
    transferencia: 0,
    banco: 0,
    retencion: 0,
  }

  for (const item of Array.isArray(detalles) ? detalles : []) {
    const medio = String(item?.medio_pago || "").toLowerCase()
    if (Object.prototype.hasOwnProperty.call(base, medio)) {
      base[medio] += toNumber(item?.monto)
    }
  }

  return base
}

async function obtenerChequeSalidaAjeno({ movimientoId, cajaCodigo }) {
  const result = await pool.query(
    `
      SELECT id
      FROM libro_cheques_caja
      WHERE caja_codigo = $1
        AND estado = 'salido'
        AND movimiento_salida_id IS NOT NULL
        AND movimiento_salida_id <> $2
      ORDER BY id DESC
      LIMIT 1
    `,
    [String(cajaCodigo || "").toLowerCase(), Number(movimientoId)]
  )

  const id = Number(result.rows?.[0]?.id || 0)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function pickMovimientosCandidatos(limit = TEST_LIMIT) {
  const reopenedOld = await pool.query(
    `
      SELECT m.id, s.id AS semana_id, s.fecha_inicio, s.fecha_fin, s.estado
      FROM movimientos_caja m
      JOIN cajas_semanales s ON s.id = m.caja_semanal_id
      WHERE LOWER(m.tipo) = 'egreso'
        AND LOWER(COALESCE(s.estado, '')) = 'abierta'
        AND s.fecha_inicio < (CURRENT_DATE - INTERVAL '5 days')
        AND EXISTS (
          SELECT 1
          FROM libro_cheques_caja l
          WHERE l.movimiento_salida_id = m.id
        )
      ORDER BY s.fecha_inicio DESC, m.id DESC
      LIMIT $1
    `
    , [limit]
  )

  const candidatos = reopenedOld.rows.map((row) => ({
    movimientoId: Number(row.id),
    semanaId: Number(row.semana_id),
    semanaInicio: row.fecha_inicio,
    semanaFin: row.fecha_fin,
    semanaEstado: row.estado,
    source: "old-open-week",
  }))

  const idsYaIncluidos = new Set(candidatos.map((item) => item.movimientoId))
  const restante = Math.max(0, limit - candidatos.length)

  if (restante > 0) {
    const fallback = await pool.query(
      `
        SELECT m.id, s.id AS semana_id, s.fecha_inicio, s.fecha_fin, s.estado
        FROM movimientos_caja m
        LEFT JOIN cajas_semanales s ON s.id = m.caja_semanal_id
        WHERE LOWER(m.tipo) = 'egreso'
          AND EXISTS (
            SELECT 1
            FROM libro_cheques_caja l
            WHERE l.movimiento_salida_id = m.id
          )
        ORDER BY m.id DESC
        LIMIT $1
      `,
      [restante * 3]
    )

    for (const row of fallback.rows) {
      const movimientoId = Number(row.id)
      if (!movimientoId || idsYaIncluidos.has(movimientoId)) continue
      idsYaIncluidos.add(movimientoId)
      candidatos.push({
        movimientoId,
        semanaId: Number(row.semana_id || 0),
        semanaInicio: row.fecha_inicio,
        semanaFin: row.fecha_fin,
        semanaEstado: row.estado,
        source: "fallback-any-week",
      })
      if (candidatos.length >= limit) break
    }
  }

  return candidatos
}

async function main() {
  const cookie = buildAuthCookie()
  const candidatos = await pickMovimientosCandidatos(TEST_LIMIT)

  if (!Array.isArray(candidatos) || candidatos.length === 0) {
    throw new Error("No hay movimientos de egreso con cheques salidos para probar")
  }

  console.log(`[test] Candidatos a validar: ${candidatos.length}`)

  const resultados = []

  for (const candidato of candidatos) {
    const movimientoId = candidato.movimientoId
    console.log(`[test] Movimiento candidato: ${movimientoId}`)
    console.log(`[test] Fuente candidato: ${candidato.source}`)
    console.log(`[test] Semana: id=${candidato.semanaId || "-"}, inicio=${candidato.semanaInicio || "-"}, fin=${candidato.semanaFin || "-"}, estado=${candidato.semanaEstado || "-"}`)

    const getResp = await fetch(`${BASE_URL}/caja/${movimientoId}`, {
      headers: {
        Cookie: cookie,
        Accept: "application/json",
      },
    })

    const getBody = await getResp.json()
    if (!getResp.ok) {
      throw new Error(`GET /caja/${movimientoId} fallo (${getResp.status}): ${JSON.stringify(getBody)}`)
    }

    const mov = getBody || {}
    const detalles = Array.isArray(mov.detalles_medio_pago) ? mov.detalles_medio_pago : []
    const chequesSalidaIds = Array.isArray(mov.cheques_salida_ids) ? mov.cheques_salida_ids : []

    if (!chequesSalidaIds.length) {
      throw new Error(`El movimiento ${movimientoId} no tiene cheques_salida_ids`)
    }

    const payload = {
      fecha: String(mov.fecha || "").split("T")[0],
      caja_codigo: mov.caja_codigo,
      tipo: mov.tipo,
      detalle: mov.detalle,
      observaciones: mov.observaciones || null,
      monto_total: toNumber(mov.monto_total),
      desglose: buildDesglose(detalles),
      detalles_medio_pago: detalles.map((item) => ({
        medio_pago: item?.medio_pago,
        monto: toNumber(item?.monto),
        identificador: item?.identificador || "",
        numero_cheque: item?.numero_cheque || "",
        librador_endosante: item?.librador_endosante || "",
        banco: item?.banco || "",
        fecha_cheque: item?.fecha_cheque || null,
        fecha_entrada: item?.fecha_entrada || item?.fecha_cobro || null,
        libro_cheque_id: item?.libro_cheque_id || null,
        endosado_a: item?.endosado_a || null,
      })),
      categoria: mov.categoria || null,
      categoria_id: mov.categoria_id || null,
      con_iva: mov.con_iva !== false,
      destinatario: mov.destinatario || mov.endosado_a_cheques || "",
      cliente_id: mov.cliente_id || null,
      presupuesto_id: mov.presupuesto_id || null,
      presupuesto_ids: Array.isArray(mov.presupuestos_ids) ? mov.presupuestos_ids : [],
      caja_semanal_id: mov.caja_semanal_id,
      presupuestos_asignaciones: Array.isArray(mov.presupuestos_asignaciones) ? mov.presupuestos_asignaciones : [],
      cheques_salida: chequesSalidaIds.map((id) => ({ libro_cheque_id: Number(id) })),
      fecha_salida_cheques: mov.fecha_salida_cheques || String(mov.fecha || "").split("T")[0],
      endosado_a_cheques: mov.endosado_a_cheques || mov.destinatario || "",
    }

    const putResp = await fetch(`${BASE_URL}/caja/${movimientoId}`, {
      method: "PUT",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    })

    const putBody = await putResp.json()
    if (!putResp.ok) {
      throw new Error(`PUT /caja/${movimientoId} fallo (${putResp.status}): ${JSON.stringify(putBody)}`)
    }

    resultados.push({
      id: putBody?.id,
      tipo: putBody?.tipo,
      caja: putBody?.caja_codigo,
      source: candidato.source,
    })

    console.log(`[test] OK id=${putBody?.id} tipo=${putBody?.tipo} caja=${putBody?.caja_codigo}`)

    const chequeAjenoId = await obtenerChequeSalidaAjeno({
      movimientoId,
      cajaCodigo: mov.caja_codigo,
    })

    if (chequeAjenoId) {
      const chequesAlterados = [...payload.cheques_salida]
      chequesAlterados[0] = { libro_cheque_id: chequeAjenoId }

      const putRespInvalido = await fetch(`${BASE_URL}/caja/${movimientoId}`, {
        method: "PUT",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...payload,
          cheques_salida: chequesAlterados,
        }),
      })

      const bodyInvalido = await putRespInvalido.json()
      if (putRespInvalido.ok) {
        throw new Error(`Se acepto un cheque salido ajeno (id ${chequeAjenoId}) en movimiento ${movimientoId}`)
      }

      console.log(`[test] OK rechazo cheque ajeno id=${chequeAjenoId}: ${bodyInvalido?.error || putRespInvalido.status}`)
    } else {
      console.log("[test] INFO no se encontro cheque salido ajeno para validar rechazo")
    }
  }

  console.log(`[test] OK total: ${resultados.length} movimientos validados`)
}

main()
  .catch((err) => {
    console.error(`[test] ERROR: ${err.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
