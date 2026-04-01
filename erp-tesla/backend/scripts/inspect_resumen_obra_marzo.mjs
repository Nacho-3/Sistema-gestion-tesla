import db from "../db.js"

const MES = 3
const ANIO = 2026

const inicio = new Date(ANIO, MES - 1, 1).toISOString().split("T")[0]
const fin = new Date(ANIO, MES, 0).toISOString().split("T")[0]

const { data: horas, error: horasError } = await db
  .from("horas")
  .select("id, empleado_id, cliente_id, obra_id, fecha, cantidad_horas, es_hora_extra, tipo_hora_extra")
  .gte("fecha", inicio)
  .lte("fecha", fin)

if (horasError) {
  console.error("Error horas:", horasError.message)
  process.exit(1)
}

const { data: empleados } = await db.from("empleados").select("id, nombre, apellido, grupo_id")
const { data: grupos } = await db.from("grupos").select("id, nombre")
const { data: clientes } = await db.from("clientes").select("id, empresa, razon_social")
const { data: obras } = await db.from("obras").select("id, nombre, cliente_id")

const horasSinObra = (horas || []).filter((h) => !h.obra_id)

console.log(`Periodo ${MES}/${ANIO}: registros totales = ${(horas || []).length}`)
console.log(`Registros con obra_id NULL = ${horasSinObra.length}`)

for (const h of horasSinObra.slice(0, 200)) {
  const emp = (empleados || []).find((e) => e.id === h.empleado_id)
  const grupo = (grupos || []).find((g) => g.id === emp?.grupo_id)
  const cli = (clientes || []).find((c) => c.id === h.cliente_id)
  console.log(JSON.stringify({
    id: h.id,
    fecha: h.fecha,
    empleado_id: h.empleado_id,
    empleado: emp ? `${emp.nombre} ${emp.apellido}` : null,
    grupo: grupo?.nombre || null,
    cliente_id: h.cliente_id,
    cliente: cli ? (cli.empresa || cli.razon_social) : null,
    es_hora_extra: h.es_hora_extra,
    tipo_hora_extra: h.tipo_hora_extra,
    cantidad_horas: h.cantidad_horas,
  }))
}

const resumenSinObra = {}
for (const h of horasSinObra) {
  const key = h.cliente_id ? `cliente_${h.cliente_id}` : "sin_cliente"
  resumenSinObra[key] = (resumenSinObra[key] || 0) + Number(h.cantidad_horas || 0)
}

console.log("Resumen horas sin obra por cliente:", resumenSinObra)

// Cross-check: horas con obra existente
const obraIds = new Set((obras || []).map((o) => o.id))
const horasConObraInexistente = (horas || []).filter((h) => h.obra_id && !obraIds.has(h.obra_id))
console.log(`Registros con obra_id inexistente = ${horasConObraInexistente.length}`)
if (horasConObraInexistente.length) {
  console.log(horasConObraInexistente.slice(0, 20))
}

process.exit(0)
