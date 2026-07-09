<script setup>
import { computed, onMounted, ref, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"

const mes = ref(new Date().getMonth() + 1)
const anio = ref(new Date().getFullYear())

const tipos = ref([
  { key: "tesla", titulo: "Gastos Tesla" },
  { key: "facu", titulo: "Gastos Facu" },
  { key: "juani", titulo: "Gastos Juani" },
])

const tiposVisibles = ref(["tesla", "facu", "juani"])
const catalogoFijos = ref({ tesla: [], facu: [], juani: [] })
const gastos = ref({
  tesla: { fijos: [], temporales: [] },
  facu: { fijos: [], temporales: [] },
  juani: { fijos: [], temporales: [] },
})

const loading = ref(false)
const guardandoTipo = ref("")
const error = ref("")
const ok = ref("")
const generandoPdf = ref(false)
const showResumenModal = ref(false)

const autoSaveTimers = {
  tesla: null,
  facu: null,
  juani: null,
}

const formatCurrency = (value) =>
  `$ ${Number(value || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const normalizarDescripcion = (value) => String(value || "").trim().toLowerCase()

const nuevaFila = (descripcion = "") => ({
  id: null,
  descripcion,
  iva_impuesto: 0,
  subtotal: 0,
  total: 0,
  pago_tesla: 0,
})

const cargarCatalogo = async () => {
  const { data } = await api.getGastosCatalogoFijos()

  const mapCatalogo = (items = []) =>
    (Array.isArray(items) ? items : []).map((item) => {
      if (typeof item === "string") {
        return { id: null, descripcion: item }
      }
      return {
        id: Number(item?.id || 0) || null,
        descripcion: String(item?.descripcion || "").trim(),
      }
    })

  catalogoFijos.value = {
    tesla: mapCatalogo(data?.tesla),
    facu: mapCatalogo(data?.facu),
    juani: mapCatalogo(data?.juani),
  }
}

const construirTipo = (tipo, rows = []) => {
  const labelsFijos = catalogoFijos.value[tipo] || []
  const mapRows = new Map((rows || []).map((row) => [normalizarDescripcion(row.descripcion), row]))

  const fijos = labelsFijos.map((item) => {
    const descripcion = String(item?.descripcion || "")
    const row = mapRows.get(normalizarDescripcion(descripcion))
    return {
      catalogo_id: item?.id || null,
      id: row?.id || null,
      descripcion,
      iva_impuesto: Number(row?.iva_impuesto || 0),
      subtotal: Number(row?.subtotal || 0),
      total: Number(row?.total || 0),
      pago_tesla: Number(row?.pago_tesla || 0),
    }
  })

  const fixedSet = new Set(labelsFijos.map((item) => normalizarDescripcion(item?.descripcion)))
  const temporales = (rows || [])
    .filter((row) => !fixedSet.has(normalizarDescripcion(row.descripcion)))
    .map((row) => ({
      id: row.id,
      descripcion: row.descripcion || "",
      iva_impuesto: Number(row.iva_impuesto || 0),
      subtotal: Number(row.subtotal || 0),
      total: Number(row.total || 0),
      pago_tesla: Number(row.pago_tesla || 0),
    }))

  return { fijos, temporales }
}

const cargarGastos = async () => {
  loading.value = true
  error.value = ""
  ok.value = ""

  try {
    const [tesla, facu, juani] = await Promise.all([
      api.getGastos("tesla", mes.value, anio.value),
      api.getGastos("facu", mes.value, anio.value),
      api.getGastos("juani", mes.value, anio.value),
    ])

    gastos.value = {
      tesla: construirTipo("tesla", tesla.data || []),
      facu: construirTipo("facu", facu.data || []),
      juani: construirTipo("juani", juani.data || []),
    }
  } catch (err) {
    error.value = "Error al cargar gastos: " + (err?.response?.data?.error || err.message)
  } finally {
    loading.value = false
  }
}

const agregarTemporal = (tipo) => {
  const descripcion = window.prompt(`Nuevo gasto temporal para ${tipo.toUpperCase()}:`)
  if (descripcion === null) return

  const descripcionLimpia = String(descripcion || "").trim()
  if (!descripcionLimpia) {
    error.value = "La descripcion del gasto temporal no puede quedar vacia"
    return
  }

  //evitar duplicado

  const existe = (gastos.value[tipo]?.temporales || []).some(
    (row) => normalizarDescripcion(row.descripcion) === normalizarDescripcion(descripcionLimpia)
  )
}

const agregarFijo = async (tipo) => {
  const descripcion = window.prompt(`Nuevo gasto fijo para ${tipo.toUpperCase()}:`)
  const descripcionLimpia = String(descripcion || "").trim()
  if (!descripcionLimpia) return

  error.value = ""
  ok.value = ""

  try {
    await api.createGastoFijoCatalogo({ tipo, descripcion: descripcionLimpia })
    await cargarCatalogo()
    await cargarGastos()
    ok.value = `Gasto fijo agregado en ${tipo.toUpperCase()}`
  } catch (err) {
    error.value = "Error al agregar gasto fijo: " + (err?.response?.data?.error || err.message)
  }
}

const quitarTemporal = (tipo, index) => {
  gastos.value[tipo].temporales.splice(index, 1)
  programarGuardadoTipo(tipo)
}

const quitarFijo = async (tipo, index) => {
  const row = gastos.value[tipo].fijos[index]
  if (!row) return

  if (!row.catalogo_id) {
    gastos.value[tipo].fijos.splice(index, 1)
    return
  }

  const confirmar = window.confirm(`Eliminar el gasto fijo "${row.descripcion}" de ${tipo.toUpperCase()}?`)
  if (!confirmar) return

  error.value = ""
  ok.value = ""

  try {
    await api.deleteGastoFijoCatalogo(row.catalogo_id)
    await cargarCatalogo()
    await cargarGastos()
    ok.value = `Gasto fijo eliminado en ${tipo.toUpperCase()}`
  } catch (err) {
    error.value = "Error al eliminar gasto fijo: " + (err?.response?.data?.error || err.message)
  }
}

const editarFijoDescripcion = async (tipo, row) => {
  const descripcion = String(row?.descripcion || "").trim()
  if (!descripcion) {
    error.value = "La descripcion del gasto fijo no puede quedar vacia"
    await cargarCatalogo()
    await cargarGastos()
    return
  }

  if (!row?.catalogo_id) return

  try {
    await api.updateGastoFijoCatalogo(row.catalogo_id, { tipo, descripcion })
    await cargarCatalogo()
    await cargarGastos()
    ok.value = `Gasto fijo actualizado en ${tipo.toUpperCase()}`
  } catch (err) {
    error.value = "Error al editar gasto fijo: " + (err?.response?.data?.error || err.message)
  }
}

const abrirEditarFijo = async (tipo, row) => {
  if (!row?.catalogo_id) return

  const actual = String(row.descripcion || "").trim()
  const nuevo = window.prompt(
    "Editar descripcion del gasto fijo:",
    actual
  )
  if(nuevo === null) return

  const descripcion = String(nuevo || "").trim()

  if (!descripcion || descripcion === actual) return

  await editarFijoDescripcion(tipo, {
    ...row,
    descripcion,
  })
}

const totalizar = (rows = []) =>
  rows.reduce(
    (acc, row) => {
      acc.iva += Number(row.iva_impuesto || 0)
      acc.subtotal += Number(row.subtotal || 0)
      acc.total += Number(row.total || 0)
      acc.pago_tesla += Number(row.pago_tesla || 0)
      return acc
    },
    { iva: 0, subtotal: 0, total: 0, pago_tesla: 0 }
  )

const resumenPorTipo = computed(() => {
  const out = {}
  for (const tipo of tipos.value.map((item) => item.key)) {
    const info = gastos.value[tipo] || { fijos: [], temporales: [] }
    out[tipo] = totalizar([...(info.fijos || []), ...(info.temporales || [])])
  }
  return out
})

const guardarTipo = async (tipo, silent = true) => {
  if (guardandoTipo.value === tipo) return

  error.value = ""
  if (!silent) ok.value = ""
  guardandoTipo.value = tipo

  try {
    const info = gastos.value[tipo] || { fijos: [], temporales: [] }
    const temporalesDraft = (info.temporales || [])
      .filter((row) => !row.id && !String(row.descripcion || "").trim())
      .map((row) => ({
        id: null,
        descripcion: "",
        iva_impuesto: Number(row.iva_impuesto || 0),
        subtotal: Number(row.subtotal || 0),
        total: Number(row.total || 0),
        pago_tesla: Number(row.pago_tesla || 0),
      }))

    const payload = {
      tipo,
      mes: Number(mes.value),
      anio: Number(anio.value),
      fijos: (info.fijos || []).map((row) => ({
        id: row.id,
        descripcion: String(row.descripcion || "").trim(),
        iva_impuesto: Number(row.iva_impuesto || 0),
        subtotal: Number(row.subtotal || 0),
        total: Number(row.total || 0),
        pago_tesla: Number(row.pago_tesla || 0),
      })),
      temporales: (info.temporales || [])
        .filter((row) => String(row.descripcion || "").trim())
        .map((row) => ({
          id: row.id,
          descripcion: String(row.descripcion || "").trim(),
          iva_impuesto: Number(row.iva_impuesto || 0),
          subtotal: Number(row.subtotal || 0),
          total: Number(row.total || 0),
          pago_tesla: Number(row.pago_tesla || 0),
        })),
    }

    const res = await api.syncGastosPeriodo(payload)
    const reconstruido = construirTipo(tipo, res.data || [])
    if (temporalesDraft.length) {
      reconstruido.temporales.push(...temporalesDraft)
    }
    gastos.value[tipo] = reconstruido
    if (!silent) {
      ok.value = `Gastos de ${tipo.toUpperCase()} guardados correctamente`
    }
  } catch (err) {
    error.value = "Error al guardar gastos: " + (err?.response?.data?.error || err.message)
  } finally {
    guardandoTipo.value = ""
  }
}

const programarGuardadoTipo = (tipo) => {
  if (autoSaveTimers[tipo]) {
    clearTimeout(autoSaveTimers[tipo])
  }

  autoSaveTimers[tipo] = setTimeout(() => {
    guardarTipo(tipo, true)
  }, 650)
}

const abrirModalResumenPdf = () => {
  showResumenModal.value = true
}

const cerrarModalResumenPdf = () => {
  if (generandoPdf.value) return
  showResumenModal.value = false
}

const descargarResumenPdf = async (tiposSeleccionados = tipos.value.map((tipo) => tipo.key), sufijo = "General") => {
  generandoPdf.value = true
  error.value = ""
  try {
    const res = await api.getGastosResumenPdf(mes.value, anio.value, tiposSeleccionados)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `Resumen Gastos ${sufijo} ${String(mes.value).padStart(2, "0")}-${anio.value}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    showResumenModal.value = false
  } catch (err) {
    error.value = "Error al generar PDF de gastos: " + (err?.response?.data?.error || err.message)
  } finally {
    generandoPdf.value = false
  }
}

watch([mes, anio], cargarGastos)

onMounted(async () => {
  loading.value = true
  try {
    await cargarCatalogo()
    await cargarGastos()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <LayoutShell title="Gastos" subtitle="Items fijos y gastos temporales por periodo">
    <section class="gastos-base">
      <div class="gastos-filtros">
        <div class="filtro-box">
          <span class="filtro-titulo">Periodo</span>
          <label>
            Mes
            <select v-model.number="mes">
              <option value="1">Enero</option>
              <option value="2">Febrero</option>
              <option value="3">Marzo</option>
              <option value="4">Abril</option>
              <option value="5">Mayo</option>
              <option value="6">Junio</option>
              <option value="7">Julio</option>
              <option value="8">Agosto</option>
              <option value="9">Septiembre</option>
              <option value="10">Octubre</option>
              <option value="11">Noviembre</option>
              <option value="12">Diciembre</option>
            </select>
          </label>
          <label>
            Año
            <input v-model.number="anio" type="number" min="2020" max="2100" />
          </label>
        </div>

        <div class="filtro-box">
          <span class="filtro-titulo">Tipos</span>
          <div class="filtro-tipos">
            <label v-for="tipo in tipos" :key="tipo.key" class="filtro-pill" :class="{ activo: tiposVisibles.includes(tipo.key) }">
              <input type="checkbox" :value="tipo.key" v-model="tiposVisibles" hidden />
              {{ tipo.titulo }}
            </label>
          </div>
        </div>

        <button class="btn-imprimir-resumen" :disabled="generandoPdf || loading" @click="abrirModalResumenPdf">
          {{ generandoPdf ? "Generando..." : "Imprimir resumen" }}
        </button>
      </div>

      <div v-if="ok" class="msg-ok">{{ ok }}</div>
      <div v-if="error" class="msg-error">{{ error }}</div>

      <div class="gastos-grid">
        <article v-for="tipo in tipos.filter((t) => tiposVisibles.includes(t.key))" :key="tipo.key" class="gastos-card">
          <div class="card-header">
            <div>
              <h3>{{ tipo.titulo }}</h3>
              <p class="card-hint">Fijos: solo monto. Temporales: podés agregar y quitar por mes.</p>
            </div>
            <div class="card-actions">
              <button class="btn-agregar" @click="agregarFijo(tipo.key)">+ Fijo</button>
              <button class="btn-agregar" @click="agregarTemporal(tipo.key)">+ Temporal</button>
            </div>
          </div>

          <p v-if="loading" class="msg-cargando">Cargando gastos...</p>
          <template v-else>
            <h4 class="section-title">Items fijos</h4>
            <table class="gastos-tabla">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>IVA / Imp.</th>
                  <th>Subtotal</th>
                  <th>Total</th>
                  <th>Pago tesla</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in gastos[tipo.key].fijos" :key="`fijo-${tipo.key}-${row.catalogo_id || idx}`">
                  <td><input v-model="row.descripcion" type="text" placeholder="Descripcion fija" disabled /></td>
                  <td><input v-model.number="row.iva_impuesto" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.subtotal" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.total" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                    <td><input v-model.number="row.pago_tesla" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>

                  <td>
                    <div class="acciones-fijo">
                      <button class="btn-editar" @click="abrirEditarFijo(tipo.key, row)">
                        Editar
                      </button>

                      <button class="btn-eliminar" @click="quitarFijo(tipo.key, idx)">
                        Quitar
                      </button>
                    </div>
                  </td>

                </tr>
                <tr v-if="gastos[tipo.key].fijos.length === 0">
                  <td colspan="6" class="sin-datos">No hay items fijos definidos para este tipo</td>
                </tr>
              </tbody>
            </table>

            <h4 class="section-title">Temporales del mes</h4>
            <table class="gastos-tabla">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>IVA / Imp.</th>
                  <th>Subtotal</th>
                  <th>Total</th>
                  <th>Pago tesla</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in gastos[tipo.key].temporales" :key="`tmp-${tipo.key}-${row.id || idx}`">
                  <td><input v-model="row.descripcion" type="text" placeholder="Detalle temporal" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.iva_impuesto" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.subtotal" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.total" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><input v-model.number="row.pago_tesla" type="number" step="0.01" min="0" @change="programarGuardadoTipo(tipo.key)" /></td>
                  <td><button class="btn-eliminar" @click="quitarTemporal(tipo.key, idx)">Quitar</button></td>
                </tr>
                <tr v-if="gastos[tipo.key].temporales.length === 0">
                  <td colspan="6" class="sin-datos">Sin gastos temporales en este periodo</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Totales</strong></td>
                  <td>{{ formatCurrency(resumenPorTipo[tipo.key].iva) }}</td>
                  <td>{{ formatCurrency(resumenPorTipo[tipo.key].subtotal) }}</td>
                  <td>{{ formatCurrency(resumenPorTipo[tipo.key].total) }}</td>
                  <td>{{ formatCurrency(resumenPorTipo[tipo.key].pago_tesla) }}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </template>
        </article>
      </div>
    </section>

    <div v-if="showResumenModal" class="modal-overlay" @click.self="cerrarModalResumenPdf">
      <div class="modal modal-resumen-opciones">
        <h3>Descargar resumen de gastos</h3>
        <p class="modal-resumen-texto">Elegí qué resumen querés descargar para {{ String(mes).padStart(2, "0") }}/{{ anio }}.</p>

        <div class="modal-resumen-botones">
          <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['tesla'], 'Tesla')">Gastos Tesla</button>
          <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['facu'], 'Facu')">Gastos Facu</button>
          <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['juani'], 'Juani')">Gastos Juani</button>
          <button type="button" class="btn-resumen-general" :disabled="generandoPdf" @click="descargarResumenPdf(['tesla', 'facu', 'juani'], 'General')">Resumen General (los 3)</button>
        </div>

        <div class="modal-actions">
          <button type="button" @click="cerrarModalResumenPdf" :disabled="generandoPdf">Cerrar</button>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.gastos-base {
  display: grid;
  gap: 1rem;
}

.gastos-filtros {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.gastos-filtros label {
  display: grid;
  gap: 0.35rem;
  color: #cbd5e1;
}

.gastos-filtros select,
.gastos-filtros input,
.gastos-tabla input {
  min-width: 120px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  padding: 0.45rem 0.6rem;
  background: rgba(15, 23, 42, 0.8);
  color: #e2e8f0;
}

.gastos-filtros .filtro-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 10px;
  padding: 0.6rem 1rem;
  background: rgba(15, 23, 42, 0.72);
}

.filtro-titulo {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-right: 0.25rem;
}

.filtro-tipos {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0.5rem;
}

.filtro-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.6);
  color: #94a3b8;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.filtro-pill.activo {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(59, 130, 246, 0.5);
  color: #93c5fd;
}

.btn-imprimir-resumen,
.btn-imprimir-resumen {
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 8px;
  padding: 0.55rem 0.9rem;
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.btn-imprimir-resumen:disabled,
.btn-imprimir-resumen:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.msg-ok,
.msg-error,
.msg-cargando {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
}

.msg-ok {
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(74, 222, 128, 0.25);
  color: #bbf7d0;
}

.msg-error {
  background: rgba(239, 68, 68, 0.14);
  border: 1px solid rgba(248, 113, 113, 0.25);
  color: #fecaca;
}

.msg-cargando {
  color: #cbd5e1;
}

.gastos-grid {
  display: grid;
  gap: 0.9rem;
}

.gastos-card {
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 14px;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.72);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

.card-header h3 {
  margin: 0;
}

.card-hint {
  margin: 0.2rem 0 0;
  color: #94a3b8;
  font-size: 0.82rem;
}

.card-actions {
  display: inline-flex;
  gap: 0.45rem;
}

.btn-agregar {
  padding: 0.35rem 0.85rem;
  background: rgba(74, 222, 128, 0.15);
  color: #86efac;
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 8px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-eliminar {
  padding: 0.3rem 0.65rem;
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
}

.acciones-fijo {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
}

.btn-editar {
  padding: 0.3rem 0.65rem;
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.22);
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
}

.section-title {
  margin: 0.8rem 0 0.45rem;
  font-size: 0.86rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #93c5fd;
}

.gastos-tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
  margin-bottom: 0.35rem;
}

.gastos-tabla thead tr {
  background: rgba(30, 41, 59, 0.8);
}

.gastos-tabla th,
.gastos-tabla td {
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  text-align: left;
  color: #e2e8f0;
}

.gastos-tabla th {
  font-weight: 700;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.gastos-tabla tfoot tr {
  background: rgba(30, 41, 59, 0.6);
}

.sin-datos {
  text-align: center;
  color: #64748b;
  padding: 0.8rem 0 !important;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 1.5rem;
  width: min(92vw, 520px);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: #e2e8f0;
}

.modal-resumen-botones {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.45rem;
}

.modal-resumen-botones button {
  width: 100%;
  padding: 0.62rem 0.8rem;
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  font-weight: 700;
  cursor: pointer;
}

.modal-resumen-botones .btn-resumen-general {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.16);
  color: #bbf7d0;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
}

.modal-actions button {
  padding: 0.55rem 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
  cursor: pointer;
}
</style>
