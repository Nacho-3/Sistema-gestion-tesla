import { syncLiquidacionesPeriodo } from "../routes/liquidaciones.js"

const month = Number(process.argv[2])
const year = Number(process.argv[3])

if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
  console.error("Uso: node ops/sync-liquidaciones-period.mjs <mes> <anio>")
  process.exit(1)
}

syncLiquidacionesPeriodo(month, year)
  .then(() => {
    console.log(JSON.stringify({ sincronizado: true, periodo: `${String(month).padStart(2, "0")}/${year}` }, null, 2))
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })