<script setup>
import { ref, onMounted, computed } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"

const presupuestos = ref([])
const clientes = ref([])
const obras = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref("")
const ok = ref("")

const showForm = ref(false)
const numeroSiguiente = ref(1)

const newMaterialItem = () => ({ uid: Date.now() + Math.random(), descripcion: "", cantidad: 1, precio_unitario: 0 })
const newManoObraItem = () => ({ uid: Date.now() + Math.random(), descripcion: "", precio_unitario: 0 })

const form = ref({
  cliente_id: "",
  obra_id: "",
  fecha: new Date().toISOString().slice(0, 10),
  validez_dias: 15,
  forma_pago: "Contado",
  aplica_iva: true,
  iva_porcentaje: 21,
  observaciones: "",
  items_materiales: [newMaterialItem()],
  items_mano_obra: [newManoObraItem()],
})

const obrasDelCliente = computed(() => {
  if (!form.value.cliente_id) return []
  return obras.value.filter((obra) => String(obra.cliente_id) === String(form.value.cliente_id))
})

const setCliente = (clienteId) => {
  form.value.cliente_id = clienteId
  const obrasCliente = obras.value.filter((obra) => String(obra.cliente_id) === String(clienteId))
  if (!obrasCliente.some((obra) => String(obra.id) === String(form.value.obra_id))) {
    form.value.obra_id = obrasCliente[0]?.id || ""
  }
}

const materialRowsValidas = computed(() =>
  form.value.items_materiales.filter((item) => item.descripcion && Number(item.cantidad) > 0)
)

const manoObraRowsValidas = computed(() =>
  form.value.items_mano_obra.filter((item) => item.descripcion && Number(item.precio_unitario) > 0)
)

const subtotalMateriales = computed(() =>
  materialRowsValidas.value.reduce((acc, item) => acc + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0)
)

const subtotalManoObra = computed(() =>
  manoObraRowsValidas.value.reduce((acc, item) => acc + (Number(item.precio_unitario) || 0), 0)
)

const ivaMonto = computed(() => {
  if (!form.value.aplica_iva) return 0
  return subtotalMateriales.value * ((Number(form.value.iva_porcentaje) || 0) / 100)
})

const total = computed(() => subtotalMateriales.value + subtotalManoObra.value + ivaMonto.value)

const formatMoney = (value) => {
  const n = Number(value) || 0
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

const getClienteNombre = (id) => {
  const c = clientes.value.find((item) => item.id === id)
  return c ? c.razon_social : "-"
}

const getObraNombre = (id) => {
  const o = obras.value.find((item) => item.id === id)
  return o ? o.nombre : "-"
}

const addMaterialRow = () => {
  form.value.items_materiales.push(newMaterialItem())
}

const removeMaterialRow = (uid) => {
  if (form.value.items_materiales.length === 1) return
  form.value.items_materiales = form.value.items_materiales.filter((item) => item.uid !== uid)
}

const addManoObraRow = () => {
  form.value.items_mano_obra.push(newManoObraItem())
}

const removeManoObraRow = (uid) => {
  if (form.value.items_mano_obra.length === 1) return
  form.value.items_mano_obra = form.value.items_mano_obra.filter((item) => item.uid !== uid)
}

const resetForm = () => {
  form.value = {
    cliente_id: "",
    obra_id: "",
    fecha: new Date().toISOString().slice(0, 10),
    validez_dias: 15,
    forma_pago: "Contado",
    aplica_iva: true,
    iva_porcentaje: 21,
    observaciones: "",
    items_materiales: [newMaterialItem()],
    items_mano_obra: [newManoObraItem()],
  }
}

const loadData = async () => {
  loading.value = true
  error.value = ""
  try {
    const [resPresupuestos, resClientes, resObras, resNumero] = await Promise.all([
      api.getPresupuestos(),
      api.getClientes(),
      api.getObras(),
      api.getNumeroSiguientePresupuesto(),
    ])

    presupuestos.value = resPresupuestos.data || []
    clientes.value = resClientes.data || []
    obras.value = resObras.data || []
    numeroSiguiente.value = Number(resNumero.data?.numero_siguiente) || 1
  } catch (err) {
    error.value = "No se pudieron cargar los datos de presupuestos"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const openForm = () => {
  resetForm()
  showForm.value = true
}

const closeForm = () => {
  showForm.value = false
  resetForm()
}

const savePresupuesto = async () => {
  ok.value = ""
  error.value = ""

  if (!form.value.cliente_id || !form.value.obra_id) {
    error.value = "Cliente y obra son obligatorios"
    return
  }

  const payload = {
    cliente_id: Number(form.value.cliente_id),
    obra_id: Number(form.value.obra_id),
    fecha: form.value.fecha,
    validez_dias: Number(form.value.validez_dias) || 15,
    forma_pago: form.value.forma_pago,
    aplica_iva: Boolean(form.value.aplica_iva),
    iva_porcentaje: Number(form.value.iva_porcentaje) || 0,
    observaciones: form.value.observaciones,
    items_materiales: form.value.items_materiales.map((item) => ({
      descripcion: String(item.descripcion || "").trim(),
      cantidad: Number(item.cantidad) || 0,
      precio_unitario: Number(item.precio_unitario) || 0,
    })),
    items_mano_obra: form.value.items_mano_obra.map((item) => ({
      descripcion: String(item.descripcion || "").trim(),
      cantidad: 1,
      precio_unitario: Number(item.precio_unitario) || 0,
    })),
  }

  saving.value = true
  try {
    await api.createPresupuesto(payload)
    await loadData()
    closeForm()
    ok.value = "Presupuesto generado correctamente"
  } catch (err) {
    error.value = err?.response?.data?.error || "No se pudo generar el presupuesto"
    console.error(err)
  } finally {
    saving.value = false
  }
}

const descargarPdf = async (id, numero) => {
  try {
    const res = await api.getPresupuestoPdf(id)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `Presupuesto-${numero}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = "No se pudo descargar el PDF"
    console.error(err)
  }
}

const cambiarEstado = async (id, estado) => {
  try {
    await api.updateEstadoPresupuesto(id, estado)
    await loadData()
  } catch (err) {
    error.value = "No se pudo actualizar el estado"
    console.error(err)
  }
}

onMounted(async () => {
  await loadData()
})
</script>

<template>
  <LayoutShell title="Presupuestos" subtitle="Carga rapida de mano de obra + materiales en un unico PDF">
    <div class="presupuestos-page">
      <div class="hero-card">
        <div class="hero-text">
          <span class="hero-kicker">Presupuestos Tesla</span>
          <h2>Generador de presupuestos</h2>
          <p>Carga rapida de mano de obra y materiales en un unico PDF con numeracion automatica.</p>
        </div>
        <div class="hero-actions">
          <div class="next-number">Proximo: #{{ numeroSiguiente }}</div>
          <button class="btn-primary hero-new-btn" @click="openForm">+ Nuevo presupuesto</button>
        </div>
      </div>

      <div v-if="ok" class="ok-msg">{{ ok }}</div>
      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="loading" class="loading">Cargando...</div>

      <div v-if="showForm" class="form-card">
        <div class="form-header">
          <h3>Nuevo presupuesto</h3>
          <div class="next-number-inline">Numero sugerido: #{{ numeroSiguiente }}</div>
        </div>

        <div class="grid-form">
          <div>
            <label>Cliente</label>
            <select :value="form.cliente_id" @change="(e) => setCliente(e.target.value)">
              <option value="">Seleccionar</option>
              <option v-for="c in clientes" :key="c.id" :value="c.id">{{ c.razon_social }}</option>
            </select>
          </div>

          <div>
            <label>Obra</label>
            <select v-model="form.obra_id">
              <option value="">Seleccionar</option>
              <option v-for="o in obrasDelCliente" :key="o.id" :value="o.id">{{ o.nombre }}</option>
            </select>
          </div>

          <div>
            <label>Fecha</label>
            <input v-model="form.fecha" type="date" />
          </div>

          <div>
            <label>Validez (dias)</label>
            <input v-model.number="form.validez_dias" type="number" min="1" />
          </div>

          <div>
            <label>Forma de pago</label>
            <input v-model="form.forma_pago" type="text" placeholder="Contado / Transferencia" />
          </div>

          <div class="iva-box">
            <label>
              <input v-model="form.aplica_iva" type="checkbox" /> Aplicar IVA a materiales
            </label>
            <input v-model.number="form.iva_porcentaje" type="number" min="0" step="0.01" :disabled="!form.aplica_iva" />
          </div>
        </div>

        <div class="items-grid">
          <div class="items-section section-mano-obra">
            <div class="section-head">
              <h4>Mano de obra</h4>
              <button class="btn-secondary" @click="addManoObraRow">+ Item</button>
            </div>
          <table>
            <thead>
              <tr>
                <th>Descripcion</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in form.items_mano_obra" :key="row.uid">
                <td><input v-model="row.descripcion" type="text" placeholder="Detalle de tarea" /></td>
                <td><input v-model.number="row.precio_unitario" type="number" min="0" step="0.01" /></td>
                <td><button class="btn-link danger" @click="removeManoObraRow(row.uid)">Quitar</button></td>
              </tr>
            </tbody>
          </table>
          </div>

          <div class="items-section section-materiales">
            <div class="section-head">
              <h4>Materiales</h4>
              <button class="btn-secondary" @click="addMaterialRow">+ Item</button>
            </div>
          <table>
            <thead>
              <tr>
                <th>Descripcion</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in form.items_materiales" :key="row.uid">
                <td><input v-model="row.descripcion" type="text" placeholder="Material" /></td>
                <td><input v-model.number="row.cantidad" type="number" min="0" step="0.01" /></td>
                <td><input v-model.number="row.precio_unitario" type="number" min="0" step="0.01" /></td>
                <td>{{ formatMoney((Number(row.cantidad) || 0) * (Number(row.precio_unitario) || 0)) }}</td>
                <td><button class="btn-link danger" @click="removeMaterialRow(row.uid)">Quitar</button></td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <div class="resumen-card">
          <div>Subtotal mano de obra: <strong>{{ formatMoney(subtotalManoObra) }}</strong></div>
          <div>Subtotal materiales: <strong>{{ formatMoney(subtotalMateriales) }}</strong></div>
          <div>IVA: <strong>{{ formatMoney(ivaMonto) }}</strong></div>
          <div class="total">TOTAL: {{ formatMoney(total) }}</div>
        </div>

        <div>
          <label>Observaciones</label>
          <textarea v-model="form.observaciones" rows="3" placeholder="Condiciones, alcance, notas"></textarea>
        </div>

        <div class="actions">
          <button class="btn-secondary" @click="closeForm">Cancelar</button>
          <button class="btn-primary" :disabled="saving" @click="savePresupuesto">
            {{ saving ? "Guardando..." : "Guardar presupuesto" }}
          </button>
        </div>
      </div>

      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>Nro</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Obra</th>
              <th>Total</th>
              <th>Estado</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in presupuestos" :key="p.id">
              <td>{{ p.numero }}</td>
              <td>{{ p.fecha ? new Date(p.fecha).toLocaleDateString("es-AR") : "-" }}</td>
              <td>{{ p.cliente || getClienteNombre(p.cliente_id) }}</td>
              <td>{{ p.obra || getObraNombre(p.obra_id) }}</td>
              <td>{{ formatMoney(p.total) }}</td>
              <td>
                <select :value="p.estado" @change="(e) => cambiarEstado(p.id, e.target.value)">
                  <option value="pendiente">Pendiente</option>
                  <option value="enviado">Enviado</option>
                  <option value="aceptado">Aceptado</option>
                  <option value="rechazado">Rechazado</option>
                </select>
              </td>
              <td>
                <button class="btn-link" @click="descargarPdf(p.id, p.numero)">Descargar</button>
              </td>
            </tr>
            <tr v-if="!loading && presupuestos.length === 0">
              <td colspan="7" class="empty">No hay presupuestos cargados.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.presupuestos-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: #0f172a;
}

.hero-card {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  background:
    radial-gradient(circle at 12% 20%, rgba(20, 184, 166, 0.18), transparent 40%),
    linear-gradient(125deg, #0b1226 0%, #0f172a 48%, #102136 100%);
  color: #f8fafc;
  border-radius: 12px;
  padding: 18px 18px 20px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow:
    0 14px 30px -18px rgba(2, 6, 23, 0.9),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.hero-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-kicker {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5eead4;
}

.hero-card h2 {
  margin: 0;
  font-size: 2rem;
  line-height: 1.06;
  text-wrap: balance;
}

.hero-card p {
  margin: 3px 0 0;
  color: #cbd5e1;
  font-size: 1rem;
  max-width: 680px;
}

.hero-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.next-number,
.next-number-inline {
  font-weight: 700;
  letter-spacing: 0.4px;
  background: rgba(15, 23, 42, 0.62);
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.6);
  border-radius: 999px;
  padding: 8px 14px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

.next-number-inline {
  color: #0f172a;
  background: #e2e8f0;
  border-color: #cbd5e1;
}

.form-card,
.table-card {
  background: #fff;
  border: 1px solid #dbe7f1;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 12px 30px -25px rgba(15, 23, 42, 0.5);
}

.form-card h3,
.items-section h4 {
  color: #0f172a;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.grid-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

label {
  display: block;
  font-size: 12px;
  color: #415a77;
  margin-bottom: 4px;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px;
}

.iva-box {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.iva-box label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.iva-box input[type="checkbox"] {
  width: auto;
}

.items-section {
  margin-top: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 12px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-mano-obra h4 {
  color: #0f172a;
}

.section-materiales h4 {
  color: #7c2d12;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
}

th,
td {
  border-bottom: 1px solid #e2e8f0;
  padding: 8px;
  text-align: left;
  vertical-align: middle;
}

.table-card {
  overflow-x: auto;
}

.table-card table {
  min-width: 860px;
  color: #0f172a;
}

.table-card thead th {
  background: #f1f5f9;
  color: #334155;
  font-weight: 700;
  border-bottom: 1px solid #cbd5e1;
}

.table-card tbody tr:nth-child(even) {
  background: #f8fafc;
}

.table-card tbody tr:hover {
  background: #eef6ff;
}

.table-card td {
  color: #0f172a;
}

.table-card td:nth-child(5) {
  font-weight: 700;
  color: #0f766e;
}

.table-card select {
  min-width: 150px;
  background: #fff;
  color: #0f172a;
  border: 1px solid #94a3b8;
}

.table-card .btn-link {
  font-weight: 600;
}

.resumen-card {
  margin-top: 12px;
  background: linear-gradient(140deg, #f8fafc 0%, #eef2ff 100%);
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 6px;
}

.total {
  font-size: 18px;
  font-weight: 700;
}

.actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-primary,
.btn-secondary {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 9px 13px;
  cursor: pointer;
  font-weight: 600;
}

.btn-primary {
  background: linear-gradient(135deg, #0f766e 0%, #0e7490 100%);
  color: #fff;
  border-color: #0f766e;
  box-shadow: 0 8px 18px -12px rgba(15, 118, 110, 0.6);
}

.hero-new-btn {
  padding: 10px 15px;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0;
  border: 1px solid #0f766e;
  background: linear-gradient(135deg, #0f766e 0%, #0e7490 100%);
  box-shadow: 0 8px 16px -12px rgba(15, 118, 110, 0.55);
}

.hero-new-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px -12px rgba(15, 118, 110, 0.65);
}

.btn-secondary {
  background: #f1f5f9;
  color: #0f172a;
  border-color: #cbd5e1;
}

.btn-link {
  border: none;
  background: transparent;
  color: #0369a1;
  cursor: pointer;
  padding: 0;
}

.btn-link.danger {
  color: #b91c1c;
}

.ok-msg {
  color: #166534;
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 8px;
  padding: 8px;
}

.error-msg {
  color: #991b1b;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  padding: 8px;
}

.loading,
.empty {
  color: #334155;
}

.empty {
  text-align: center;
  font-weight: 600;
}

@media (max-width: 700px) {
  .hero-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-card h2 {
    font-size: 1.55rem;
  }

  .hero-card p {
    font-size: 0.92rem;
  }

  .hero-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .items-grid {
    grid-template-columns: 1fr;
  }
}
</style>

