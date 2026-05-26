import { pool } from "../db.js"

const CHEQUES = [
  { fechaEntrada: "22/04/2026", librador: "Bustos martin", banco: "patagonia", numeroCheque: "30018142", importe: 500000, fechaCheque: "22/05/2026", identificador: "A1262" },
  { fechaEntrada: "22/04/2026", librador: "Bustos martin", banco: "patagonia", numeroCheque: "30018141", importe: 500000, fechaCheque: "30/05/2026", identificador: "A1263" },
  { fechaEntrada: "22/04/2026", librador: "Bustos martin", banco: "patagonia", numeroCheque: "30018140", importe: 500000, fechaCheque: "05/06/2026", identificador: "A1264" },
  { fechaEntrada: "22/04/2026", librador: "Bustos martin", banco: "patagonia", numeroCheque: "30018139", importe: 500000, fechaCheque: "10/06/2026", identificador: "A1265" },
  { fechaEntrada: "23/04/2026", librador: "Ever wear", banco: "provincia", numeroCheque: "11834606", importe: 1090700, fechaCheque: "15/05/2026", identificador: "A1267" },
  { fechaEntrada: "23/04/2026", librador: "Ever wear", banco: "nacion", numeroCheque: "315", importe: 3600000, fechaCheque: "16/05/2026", identificador: "A1268" },
  { fechaEntrada: "23/04/2026", librador: "Ever wear", banco: "santander", numeroCheque: "50700284", importe: 1185600, fechaCheque: "20/05/2026", identificador: "A1269" },
  { fechaEntrada: "23/04/2026", librador: "Ever wear", banco: "nacion", numeroCheque: "5712", importe: 1860000, fechaCheque: "28/05/2026", identificador: "A1270" },
  { fechaEntrada: "04/05/2026", librador: "edificio laboulaye", banco: "BBVA", numeroCheque: "01123703", importe: 3860000, fechaCheque: "27/06/2026", identificador: "A1273" },
  { fechaEntrada: "04/05/2026", librador: "EDIFICIO laboulaye", banco: "supervielle", numeroCheque: "86149561", importe: 2000000, fechaCheque: "22/06/2026", identificador: "A1274" },
  { fechaEntrada: "04/05/2026", librador: "EDIFICIO laboulaye", banco: "supervielle", numeroCheque: "86149407", importe: 2585000, fechaCheque: "27/05/2026", identificador: "A1275" },
  { fechaEntrada: "12/05/2026", librador: "cordoba motos", banco: "BBVA", numeroCheque: "706752", importe: 1114549, fechaCheque: "10/05/2026", identificador: "A1277" },
  { fechaEntrada: "12/05/2026", librador: "cordoba motos", banco: "BBVA", numeroCheque: "704232", importe: 645000, fechaCheque: "20/05/2026", identificador: "A1278" },
  { fechaEntrada: "12/05/2026", librador: "Cordoba motos", banco: "Credicoop", numeroCheque: "15900381", importe: 173440, fechaCheque: "03/06/2026", identificador: "A1279" },
  { fechaEntrada: "12/05/2026", librador: "Cordoba motos", banco: "credicoop", numeroCheque: "85706167", importe: 1250000, fechaCheque: "06/06/2026", identificador: "A1280" },
  { fechaEntrada: "12/05/2026", librador: "Cordoba motos", banco: "BBVA", numeroCheque: "706756", importe: 950839, fechaCheque: "14/06/2026", identificador: "A1281" },
  { fechaEntrada: "12/05/2026", librador: "cordoba motos", banco: "ICBC", numeroCheque: "12596142", importe: 202885, fechaCheque: "15/06/2026", identificador: "A1282" },
  { fechaEntrada: "12/05/2026", librador: "cordoba motos", banco: "nacion", numeroCheque: "4039", importe: 877600, fechaCheque: "05/06/2026", identificador: "A1283" },
  { fechaEntrada: "12/05/2026", librador: "cordoba motos", banco: "galicia", numeroCheque: "46873337", importe: 1000000, fechaCheque: "20/05/2026", identificador: "A1284" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "santa fe", numeroCheque: "90325310", importe: 500000, fechaCheque: "27/05/2026", identificador: "A1285" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "santander", numeroCheque: "5259", importe: 199200, fechaCheque: "30/05/2026", identificador: "A1286" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "macro", numeroCheque: "53902195", importe: 357000, fechaCheque: "01/06/2026", identificador: "A1287" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "nacion", numeroCheque: "0003", importe: 945333.33, fechaCheque: "04/06/2026", identificador: "A1288" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "bancor", numeroCheque: "39177764", importe: 700000, fechaCheque: "30/05/2026", identificador: "A1289" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "bancor", numeroCheque: "39022707", importe: 500000, fechaCheque: "29/05/2026", identificador: "A1290" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "nacion", numeroCheque: "195428", importe: 629144, fechaCheque: "28/05/2026", identificador: "A1291" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "bancor", numeroCheque: "39191270", importe: 700000, fechaCheque: "23/05/2026", identificador: "A1292" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "Santiago del estero", numeroCheque: "16548242", importe: 208000, fechaCheque: "30/05/2026", identificador: "A1293" },
  { fechaEntrada: "13/05/2026", librador: "ronconi", banco: "bancor", numeroCheque: "39039074", importe: 100000, fechaCheque: "05/06/2026", identificador: "A1294" },
  { fechaEntrada: "08/05/2026", librador: "ever wear", banco: "macro", numeroCheque: "64340474", importe: 850000, fechaCheque: "10/06/2026", identificador: "T117" },
]

const parseDate = (value) => {
  const [d, m, y] = String(value).split("/")
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
}

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100

const formatMoneyAr = (value) => new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value)

async function main() {
  const apply = process.argv.includes("--apply")
  const cheques = CHEQUES.map((item) => ({
    ...item,
    fechaEntrada: parseDate(item.fechaEntrada),
    fechaCheque: parseDate(item.fechaCheque),
    importe: roundMoney(item.importe),
  }))

  const total = roundMoney(cheques.reduce((acc, item) => acc + item.importe, 0))

  console.log(`Cheques a procesar: ${cheques.length}`)
  console.log(`Total cheques: ${formatMoneyAr(total)}`)

  if (!apply) {
    console.log("Modo verificacion: no se inserto nada. Ejecutar con --apply para insertar.")
    return
  }

  const client = await pool.connect()
  let inserted = 0
  let skipped = 0

  try {
    await client.query("BEGIN")

    for (const cheque of cheques) {
      const obsTag = `Carga historica cheque anterior - Identificador: ${cheque.identificador}`

      const dup = await client.query(
        `
        SELECT id
        FROM libro_cheques_caja
        WHERE caja_codigo = 'tesla'
          AND observaciones = $1
        LIMIT 1
        `,
        [obsTag]
      )

      if (dup.rowCount > 0) {
        skipped += 1
        continue
      }

      const movRes = await client.query(
        `
        INSERT INTO movimientos_caja (
          fecha, caja_codigo, tipo, detalle, observaciones, categoria,
          con_iva, destinatario, cliente_id, presupuesto_id, monto_total
        ) VALUES (
          $1, 'tesla', 'ingreso', $2, $3, 'varios',
          true, NULL, NULL, NULL, $4
        )
        RETURNING id
        `,
        [
          cheque.fechaEntrada,
          `Ingreso historico cheque ${cheque.identificador}`,
          `Carga historica de cheque anterior. ${obsTag}`,
          cheque.importe,
        ]
      )

      const movimientoId = movRes.rows[0].id

      const detRes = await client.query(
        `
        INSERT INTO detalles_medio_pago (
          movimiento_id, medio_pago, monto, identificador, banco, fecha_cobro,
          librador_endosante, numero_cheque, fecha_cheque, fecha_entrada, endosado_a, libro_cheque_id
        ) VALUES (
          $1, 'cheque', $2, $3, $4, $5,
          $6, $7, $8, $9, NULL, NULL
        )
        RETURNING id
        `,
        [
          movimientoId,
          cheque.importe,
          cheque.identificador,
          cheque.banco,
          cheque.fechaCheque,
          cheque.librador,
          cheque.numeroCheque,
          cheque.fechaCheque,
          cheque.fechaEntrada,
        ]
      )

      const detalleId = detRes.rows[0].id

      await client.query(
        `
        INSERT INTO libro_cheques_caja (
          caja_codigo, medio_pago, movimiento_entrada_id, movimiento_salida_id,
          detalle_medio_pago_entrada_id, fecha_entrada, librador_endosante, banco,
          numero_cheque, importe, fecha_cheque, fecha_salida, endosado_a, estado, observaciones
        ) VALUES (
          'tesla', 'cheque', $1, NULL,
          $2, $3, $4, $5,
          $6, $7, $8, NULL, NULL, 'disponible', $9
        )
        `,
        [
          movimientoId,
          detalleId,
          cheque.fechaEntrada,
          cheque.librador,
          cheque.banco,
          cheque.numeroCheque,
          cheque.importe,
          cheque.fechaCheque,
          obsTag,
        ]
      )

      inserted += 1
    }

    await client.query("COMMIT")
    console.log(`Insertados: ${inserted}`)
    console.log(`Omitidos por duplicado: ${skipped}`)
  } catch (error) {
    await client.query("ROLLBACK")
    console.error("Error en insercion:", error.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(async (error) => {
  console.error("Error inesperado:", error.message)
  try {
    await pool.end()
  } catch {
    // noop
  }
  process.exitCode = 1
})
