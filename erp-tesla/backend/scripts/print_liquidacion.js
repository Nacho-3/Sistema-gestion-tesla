import db from "../db.js"

const printLiq = async (id) => {
  const { data: liq, error } = await db.from("liquidaciones").select("*").eq("id", id).single()
  if (error || !liq) {
    console.error("Liquidación no encontrada:", error?.message)
    process.exit(1)
  }

  const { data: pagos } = await db.from("pagos_sueldo").select("*").eq("liquidacion_id", id).order("created_at", { ascending: true })
  const totalPagado = (pagos || []).reduce((s, p) => s + Number(p.monto || 0), 0)

  console.log("--- Liquidación ---")
  console.log(JSON.stringify(liq, null, 2))
  console.log(`\nTotal pagado (sum pagos_sueldo): ${totalPagado}`)
  if (pagos && pagos.length) console.log(`Pagos:\n${pagos.map(p=>` - ${p.id}: ${p.monto} (${p.medio_pago||"-"})`).join("\n")}`)
}

const id = process.argv[2]
if (!id) {
  console.error("Uso: node print_liquidacion.js <id>")
  process.exit(1)
}

printLiq(Number(id)).catch(err=>{ console.error(err); process.exit(1) })
