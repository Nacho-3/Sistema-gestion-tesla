import pg from "pg"
import dotenv from "dotenv"

dotenv.config()

const { Pool } = pg

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "erp_tesla",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function isValidIdentifier(value) {
  return VALID_IDENTIFIER.test(value)
}

function sanitizeIdentifier(value, kind = "identifier") {
  if (!isValidIdentifier(value)) {
    throw new Error(`${kind} inválido: ${value}`)
  }
  return `"${value}"`
}

function parseColumns(columnsRaw) {
  if (!columnsRaw || columnsRaw.trim() === "*" || columnsRaw.includes("(") || columnsRaw.includes("*")) {
    return "*"
  }

  const columns = columnsRaw
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)

  if (columns.length === 0) return "*"

  return columns
    .map((column) => {
      if (!isValidIdentifier(column)) {
        throw new Error(`Columna inválida: ${column}`)
      }
      return sanitizeIdentifier(column, "columna")
    })
    .join(", ")
}

let detallesJoinSchemaCache = null

async function getDetallesJoinSchema() {
  if (detallesJoinSchemaCache) return detallesJoinSchemaCache

  const result = await pool.query(`
    SELECT a.attname AS column_name
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass('detalles_medio_pago')
      AND a.attnum > 0
      AND NOT a.attisdropped
  `)

  const columns = result.rows.map((row) => row.column_name)
  if (columns.includes("medio_pago") && columns.includes("monto")) {
    detallesJoinSchemaCache = { mode: "filas" }
  } else {
    detallesJoinSchemaCache = { mode: "columnas" }
  }

  return detallesJoinSchemaCache
}

class QueryBuilder {
  constructor(table) {
    this.table = table
    this.action = "select"
    this.columns = "*"
    this.filters = []
    this.orders = []
    this.limitValue = null
    this.insertData = null
    this.updateData = null
    this.returning = false
    this.singleRow = false
  }

  select(columns = "*") {
    this.columns = columns
    if (this.action !== "select") {
      this.returning = true
    }
    return this
  }

  insert(data) {
    this.action = "insert"
    this.insertData = Array.isArray(data) ? data : [data]
    return this
  }

  update(data) {
    this.action = "update"
    this.updateData = data || {}
    return this
  }

  delete() {
    this.action = "delete"
    return this
  }

  eq(column, value) {
    this.filters.push({ type: "=", column, value })
    return this
  }

  neq(column, value) {
    this.filters.push({ type: "!=", column, value })
    return this
  }

  gte(column, value) {
    this.filters.push({ type: ">=", column, value })
    return this
  }

  lte(column, value) {
    this.filters.push({ type: "<=", column, value })
    return this
  }

  lt(column, value) {
    this.filters.push({ type: "<", column, value })
    return this
  }

  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false })
    return this
  }

  limit(value) {
    this.limitValue = Number(value)
    return this
  }

  single() {
    this.singleRow = true
    if (!this.limitValue) {
      this.limitValue = 1
    }
    return this
  }

  _buildWhere(startIndex = 1) {
    if (this.filters.length === 0) {
      return { whereSql: "", values: [], nextParam: startIndex }
    }

    const clauses = []
    const values = []
    let paramIndex = startIndex

    for (const filter of this.filters) {
      const column = sanitizeIdentifier(filter.column, "columna")
      clauses.push(`${column} ${filter.type} $${paramIndex}`)
      values.push(filter.value)
      paramIndex += 1
    }

    return {
      whereSql: ` WHERE ${clauses.join(" AND ")}`,
      values,
      nextParam: paramIndex,
    }
  }

  _buildOrder() {
    if (this.orders.length === 0) return ""

    const orderSql = this.orders
      .map(({ column, ascending }) => {
        const safeColumn = sanitizeIdentifier(column, "columna de orden")
        return `${safeColumn} ${ascending ? "ASC" : "DESC"}`
      })
      .join(", ")

    return ` ORDER BY ${orderSql}`
  }

  _needsDetallesJoin() {
    return this.table === "movimientos_caja" && this.columns.includes("detalles_medio_pago(")
  }

  _needsGruposJoin() {
    return this.table === "empleados" && this.columns.includes("grupos(")
  }

  async _attachDetalles(rows) {
    if (!rows || rows.length === 0) return rows

    const ids = rows.map((row) => row.id).filter(Boolean)
    if (ids.length === 0) return rows.map((row) => ({ ...row, detalles_medio_pago: [] }))

    const detallesSchema = await getDetallesJoinSchema()

    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(",")
    const query = detallesSchema.mode === "filas"
      ? `
          SELECT id, movimiento_id, medio_pago, monto, created_at
          FROM detalles_medio_pago
          WHERE movimiento_id IN (${placeholders})
          ORDER BY id ASC
        `
      : `
          SELECT id, movimiento_id, efectivo, transferencia, cheque, echeq, retencion, created_at
          FROM detalles_medio_pago
          WHERE movimiento_id IN (${placeholders})
          ORDER BY id ASC
        `
    const result = await pool.query(query, ids)

    const byMovimiento = new Map()
    for (const detalle of result.rows) {
      if (!byMovimiento.has(detalle.movimiento_id)) {
        byMovimiento.set(detalle.movimiento_id, [])
      }
      byMovimiento.get(detalle.movimiento_id).push(detalle)
    }

    return rows.map((row) => ({
      ...row,
      detalles_medio_pago: byMovimiento.get(row.id) || [],
    }))
  }

  async _attachGrupo(rows) {
    if (!rows || rows.length === 0) return rows

    const grupoIds = [...new Set(rows.map((row) => row.grupo_id).filter(Boolean))]
    if (grupoIds.length === 0) {
      return rows.map((row) => ({ ...row, grupos: null }))
    }

    const placeholders = grupoIds.map((_, idx) => `$${idx + 1}`).join(",")
    const query = `SELECT id, nombre FROM grupos WHERE id IN (${placeholders})`
    const result = await pool.query(query, grupoIds)

    const map = new Map(result.rows.map((grupo) => [grupo.id, grupo]))

    return rows.map((row) => ({
      ...row,
      grupos: row.grupo_id ? map.get(row.grupo_id) || null : null,
    }))
  }

  async execute() {
    try {
      const table = sanitizeIdentifier(this.table, "tabla")

      if (this.action === "select") {
        const selectedColumns = parseColumns(this.columns)
        const { whereSql, values, nextParam } = this._buildWhere(1)
        const orderSql = this._buildOrder()
        const limitSql = Number.isFinite(this.limitValue) && this.limitValue > 0 ? ` LIMIT $${nextParam}` : ""
        const params = [...values]

        if (limitSql) {
          params.push(this.limitValue)
        }

        const query = `SELECT ${selectedColumns} FROM ${table}${whereSql}${orderSql}${limitSql}`
        const result = await pool.query(query, params)

        let rows = result.rows

        if (this._needsDetallesJoin()) {
          rows = await this._attachDetalles(rows)
        }

        if (this._needsGruposJoin()) {
          rows = await this._attachGrupo(rows)
        }

        if (this.singleRow) {
          return { data: rows[0] || null, error: rows[0] ? null : new Error("No encontrado") }
        }

        return { data: rows, error: null }
      }

      if (this.action === "insert") {
        if (!this.insertData || this.insertData.length === 0) {
          return { data: [], error: null }
        }

        const keys = Object.keys(this.insertData[0]).filter((key) => this.insertData[0][key] !== undefined)
        if (keys.length === 0) {
          return { data: [], error: new Error("No hay columnas para insertar") }
        }

        const safeColumns = keys.map((key) => sanitizeIdentifier(key, "columna"))
        const values = []
        const valueGroups = this.insertData.map((row, rowIndex) => {
          const placeholders = keys.map((key, colIndex) => {
            values.push(row[key])
            return `$${rowIndex * keys.length + colIndex + 1}`
          })
          return `(${placeholders.join(",")})`
        })

        const returningSql = this.returning ? " RETURNING *" : ""
        const query = `INSERT INTO ${table} (${safeColumns.join(",")}) VALUES ${valueGroups.join(",")}${returningSql}`
        const result = await pool.query(query, values)

        const data = this.returning ? result.rows : []
        return { data: this.singleRow ? data[0] || null : data, error: null }
      }

      if (this.action === "update") {
        const entries = Object.entries(this.updateData || {}).filter(([, value]) => value !== undefined)
        if (entries.length === 0) {
          return { data: [], error: null }
        }

        const values = []
        const setSql = entries
          .map(([key, value], index) => {
            values.push(value)
            return `${sanitizeIdentifier(key, "columna")} = $${index + 1}`
          })
          .join(", ")

        const { whereSql, values: whereValues } = this._buildWhere(entries.length + 1)
        values.push(...whereValues)

        const returningSql = this.returning ? " RETURNING *" : ""
        const query = `UPDATE ${table} SET ${setSql}${whereSql}${returningSql}`
        const result = await pool.query(query, values)

        const data = this.returning ? result.rows : []
        return { data: this.singleRow ? data[0] || null : data, error: null }
      }

      if (this.action === "delete") {
        const { whereSql, values } = this._buildWhere(1)
        const returningSql = this.returning ? " RETURNING *" : ""
        const query = `DELETE FROM ${table}${whereSql}${returningSql}`
        const result = await pool.query(query, values)
        const data = this.returning ? result.rows : []
        return { data: this.singleRow ? data[0] || null : data, error: null }
      }

      return { data: null, error: new Error("Acción no soportada") }
    } catch (error) {
      return { data: null, error }
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject)
  }
}

const db = {
  from(table) {
    return new QueryBuilder(table)
  },
  async query(text, params = []) {
    return pool.query(text, params)
  },
}

export default db
