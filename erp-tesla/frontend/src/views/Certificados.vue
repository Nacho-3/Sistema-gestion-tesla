<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRoute } from "vue-router"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import Modal from "../components/Modal.vue"
import socket from "../socket.js"

const route = useRoute()
const certificados = ref([])
const presupuestos = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref("")
const ok = ref("")
const editingId = ref(null)
const showAdvanceModal = ref(false)
const selectedGroupId = ref("")

const buildInitialForm = () => ({
  presupuesto_id: "",
  fecha: new Date().toISOString().slice(0, 10),
  tipo_registro: "porcentaje",
  porcentaje_avance: 0,
  monto_base: 0,
  indice_cac: 1,
  estado: "pendiente",
  pagos: 0,
  observaciones: "",
})

const form = ref(buildInitialForm())

const presupuestoSeleccionado = computed(() =>
  presupuestos.value.find((p) => String(p.id) === String(form.value.presupuesto_id)) || null
)

const presupuestosDisponiblesParaPrimerCertificado = computed(() =>
  presupuestos.value.filter((p) => Number(p.cantidad_certificados || 0) === 0)
)

const certificadosAgrupados = computed(() => {
  const grouped = new Map()
  for (const certificado of certificados.value) {
    const key = String(certificado.presupuesto_id)
    const current = grouped.get(key) || []
    current.push(certificado)
    grouped.set(key, current)
  }
  return Array.from(grouped.entries())
    .map(([presupuestoId, items]) => {
      const presupuesto = presupuestos.value.find((p) => String(p.id) === presupuestoId)
      return {
        presupuestoId,
        presupuesto,
        items: items.sort((a, b) => Number(a.secuencia) - Number(b.secuencia)),
      }
    })
    .sort((a, b) => Number(b.presupuesto?.numero || 0) - Number(a.presupuesto?.numero || 0))
})

const certificadosDelPresupuesto = computed(() =>
  certificados.value
    .filter((c) => String(c.presupuesto_id) === String(form.value.presupuesto_id || selectedGroupId.value))
    .sort((a, b) => Number(a.secuencia) - Number(b.secuencia))
)

const ultimoCertificado = computed(() => certificadosDelPresupuesto.value.at(-1) || null)
const siguienteSecuencia = computed(() => (ultimoCertificado.value?.secuencia || 0) + 1)
const importeOriginal = computed(() => Number(presupuestoSeleccionado.value?.total) || 0)
const montoBaseCalculado = computed(() => {
  if (form.value.tipo_registro === "monto") return Number(form.value.monto_base) || 0
  return importeOriginal.value * ((Number(form.value.porcentaje_avance) || 0) / 100)
})
const actualizacion = computed(() => montoBaseCalculado.value * ((Number(form.value.indice_cac) || 1) - 1))
const totalCertSinIva = computed(() => montoBaseCalculado.value + actualizacion.value)
const iva = computed(() => totalCertSinIva.value * ((Number(presupuestoSeleccionado.value?.iva_porcentaje) || 21) / 100))
const totalCertConIva = computed(() => totalCertSinIva.value + iva.value)
const acumuladoConActual = computed(() => {
  if (editingId.value) {
    const actual = certificados.value.find((c) => c.id === editingId.value)
    const previos = certificadosDelPresupuesto.value
      .filter((c) => c.id !== editingId.value && Number(c.secuencia) < Number(actual?.secuencia || 0))
      .at(-1)
    return (Number(previos?.acumulado_certificado) || 0) + totalCertSinIva.value
  }
  return (Number(ultimoCertificado.value?.acumulado_certificado) || 0) + totalCertSinIva.value
})
const saldoPreOriginal = computed(() => Math.max(0, importeOriginal.value - acumuladoConActual.value))
const saldoPendiente = computed(() => Math.max(0, totalCertConIva.value - (Number(form.value.pagos) || 0)))

const formatMoney = (value) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0)

const formatPercent = (value) => `${(Number(value) || 0).toFixed(2)}%`

const syncFromRoute = () => {
  const presupuestoId = String(route.query?.presupuesto_id || "")
  const modo = String(route.query?.modo || "")

  if (!presupuestoId) return

  if (modo === "avances") {
    openAdvanceModal(presupuestoId)
    return
  }

  openGenerator(presupuestoId)
}

const resetForm = () => {
  editingId.value = null
  form.value = buildInitialForm()
}

const openGenerator = (presupuestoId = "") => {
  resetForm()
  selectedGroupId.value = ""
  form.value.presupuesto_id = String(presupuestoId)
  showAdvanceModal.value = false
}

const openAdvanceModal = (presupuestoId) => {
  resetForm()
  selectedGroupId.value = String(presupuestoId)
  form.value.presupuesto_id = String(presupuestoId)
  showAdvanceModal.value = true
}

const editCertificado = (certificado) => {
  editingId.value = certificado.id
  selectedGroupId.value = String(certificado.presupuesto_id)
  showAdvanceModal.value = true
  form.value = {
    presupuesto_id: String(certificado.presupuesto_id),
    fecha: String(certificado.fecha || "").slice(0, 10),
    tipo_registro: certificado.tipo_registro || "porcentaje",
    porcentaje_avance: Number(certificado.porcentaje_avance) || 0,
    monto_base: Number(certificado.monto_base) || 0,
    indice_cac: Number(certificado.indice_cac) || 1,
    estado: certificado.estado || "pendiente",
    pagos: Number(certificado.pagos) || 0,
    observaciones: certificado.observaciones || "",
  }
}

const loadData = async () => {
  loading.value = true
  error.value = ""
  try {
    const [resCertificados, resPresupuestos] = await Promise.all([
      api.getCertificados(),
      api.getPresupuestos(),
    ])
    certificados.value = resCertificados.data || []
    presupuestos.value = resPresupuestos.data || []
  } catch (err) {
    error.value = "No se pudieron cargar los certificados"
  } finally {
    loading.value = false
  }
}

const saveCertificado = async () => {
  error.value = ""
  ok.value = ""
  saving.value = true
  try {
    const payload = {
      presupuesto_id: Number(form.value.presupuesto_id),
      fecha: form.value.fecha,
      tipo_registro: form.value.tipo_registro,
      porcentaje_avance: Number(form.value.porcentaje_avance) || 0,
      monto_base: Number(form.value.monto_base) || 0,
      indice_cac: Number(form.value.indice_cac) || 1,
      estado: form.value.estado,
      pagos: Number(form.value.pagos) || 0,
      observaciones: form.value.observaciones,
    }

    if (editingId.value) {
      await api.updateCertificado(editingId.value, payload)
      ok.value = "Certificado actualizado"
    } else {
      await api.createCertificado(payload)
      ok.value = "Certificado generado"
    }

    resetForm()
    showAdvanceModal.value = false
    selectedGroupId.value = ""
    await loadData()
  } catch (err) {
    error.value = err?.response?.data?.error || "No se pudo guardar el certificado"
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadData()
  syncFromRoute()
  socket.on("certificados:changed", loadData)
  socket.on("presupuestos:changed", loadData)
})

onUnmounted(() => {
  socket.off("certificados:changed", loadData)
  socket.off("presupuestos:changed", loadData)
})
</script>

<template>
  <LayoutShell title="Certificados" subtitle="Avances secuenciales por presupuesto original, con CAC, estado y saldo">
    <div class="certificados-page">
      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="ok" class="ok-msg">{{ ok }}</div>

      <section class="form-card">
        <div class="section-head">
          <div>
            <h3>Generador de certificados</h3>
            <p>Solo muestra presupuestos originales que todavia no tienen certificados.</p>
          </div>
          <button class="btn-secondary" type="button" @click="openGenerator()">Nuevo generador</button>
        </div>

        <div class="grid-form">
          <div class="full-span">
            <label>Presupuesto original</label>
            <select v-model="form.presupuesto_id">
              <option value="">Seleccionar</option>
              <option v-for="p in presupuestosDisponiblesParaPrimerCertificado" :key="p.id" :value="String(p.id)">
                #{{ p.numero }} - {{ p.cliente }} - {{ p.obra }}
              </option>
            </select>
          </div>

          <div>
            <label>Fecha</label>
            <input v-model="form.fecha" type="date" />
          </div>

          <div>
            <label>Estado</label>
            <select v-model="form.estado">
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
            </select>
          </div>

          <div>
            <label>Tipo de avance</label>
            <select v-model="form.tipo_registro">
              <option value="porcentaje">Por porcentaje</option>
              <option value="monto">Por monto</option>
            </select>
          </div>

          <div v-if="form.tipo_registro === 'porcentaje'">
            <label>Porcentaje de avance</label>
            <input v-model.number="form.porcentaje_avance" type="number" min="0" step="0.01" />
          </div>

          <div v-else>
            <label>Monto base</label>
            <input v-model.number="form.monto_base" type="number" min="0" step="0.01" />
          </div>

          <div>
            <label>Indice CAC</label>
            <input v-model.number="form.indice_cac" type="number" min="0" step="0.0001" />
          </div>

          <div>
            <label>Pagos</label>
            <input v-model.number="form.pagos" type="number" min="0" step="0.01" />
          </div>

          <div class="full-span">
            <label>Observaciones</label>
            <input v-model="form.observaciones" type="text" />
          </div>
        </div>

        <div class="stats-grid preview-grid">
          <div class="stat-card"><span>Importe original</span><strong>{{ formatMoney(importeOriginal) }}</strong></div>
          <div class="stat-card"><span>Monto base</span><strong>{{ formatMoney(montoBaseCalculado) }}</strong></div>
          <div class="stat-card"><span>Actualizacion CAC</span><strong>{{ formatMoney(actualizacion) }}</strong></div>
          <div class="stat-card"><span>IVA</span><strong>{{ formatMoney(iva) }}</strong></div>
          <div class="stat-card"><span>Total cert. sin IVA</span><strong>{{ formatMoney(totalCertSinIva) }}</strong></div>
          <div class="stat-card"><span>Total cert. con IVA</span><strong>{{ formatMoney(totalCertConIva) }}</strong></div>
          <div class="stat-card"><span>Acumulado con este cert.</span><strong>{{ formatMoney(acumuladoConActual) }}</strong></div>
          <div class="stat-card"><span>Saldo presupuesto</span><strong>{{ formatMoney(saldoPreOriginal) }}</strong></div>
          <div class="stat-card"><span>Saldo pendiente del cert.</span><strong>{{ formatMoney(saldoPendiente) }}</strong></div>
        </div>

        <div class="actions">
          <button class="btn-secondary" type="button" @click="resetForm">Limpiar</button>
          <button class="btn-primary" :disabled="saving || !form.presupuesto_id" @click="saveCertificado">
            {{ saving ? "Guardando..." : "Generar certificado original" }}
          </button>
        </div>
      </section>

      <section class="table-card">
        <div class="section-head">
          <h3>Historial por presupuesto</h3>
          <span>{{ certificados.length }} certificados cargados</span>
        </div>

        <div v-if="loading" class="loading">Cargando...</div>
        <div v-else class="groups-list">
          <article v-for="group in certificadosAgrupados" :key="group.presupuestoId" class="group-card">
            <div class="group-head">
              <div>
                <strong>#{{ group.presupuesto?.numero }} - {{ group.presupuesto?.cliente }}</strong>
                <p>{{ group.presupuesto?.obra }}</p>
              </div>
              <div class="group-actions">
                <span class="group-badge">{{ group.items.length }} certificados</span>
                <button class="btn-secondary" type="button" @click="openAdvanceModal(group.presupuestoId)">Agregar avance</button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Cert.</th>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Avance</th>
                  <th>CAC</th>
                  <th>Neto</th>
                  <th>Total c/IVA</th>
                  <th>Pagos</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in group.items" :key="c.id" @click="editCertificado(c)">
                  <td>Certificado {{ c.secuencia }}</td>
                  <td>{{ c.fecha }}</td>
                  <td>{{ c.tipo_registro === "monto" ? "Monto" : "Porcentaje" }}</td>
                  <td>{{ c.tipo_registro === "monto" ? formatMoney(c.monto_base) : formatPercent(c.porcentaje_avance) }}</td>
                  <td>{{ Number(c.indice_cac || 1).toFixed(4) }}</td>
                  <td>{{ formatMoney(c.total_cert_sin_iva) }}</td>
                  <td>{{ formatMoney(c.total_cert_con_iva) }}</td>
                  <td>{{ formatMoney(c.pagos) }}</td>
                  <td>{{ formatMoney(c.saldo_pendiente) }}</td>
                  <td><span :class="['estado-pill', c.estado === 'pagado' ? 'estado-pagado' : 'estado-pendiente']">{{ c.estado }}</span></td>
                </tr>
              </tbody>
            </table>
          </article>
        </div>
      </section>

      <Modal v-if="showAdvanceModal" @close="showAdvanceModal = false">
        <template #header>
          <div>
            <h2>{{ editingId ? 'Editar avance' : `Nuevo avance ${siguienteSecuencia}` }}</h2>
            <p v-if="presupuestoSeleccionado">
              Presupuesto #{{ presupuestoSeleccionado.numero }} · {{ presupuestoSeleccionado.cliente }} · {{ presupuestoSeleccionado.obra }}
            </p>
          </div>
        </template>

        <template #body>
          <div class="grid-form modal-form">
            <div>
              <label>Fecha</label>
              <input v-model="form.fecha" type="date" />
            </div>

            <div>
              <label>Estado</label>
              <select v-model="form.estado">
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>

            <div>
              <label>Tipo de avance</label>
              <select v-model="form.tipo_registro">
                <option value="porcentaje">Por porcentaje</option>
                <option value="monto">Por monto</option>
              </select>
            </div>

            <div v-if="form.tipo_registro === 'porcentaje'">
              <label>Porcentaje de avance</label>
              <input v-model.number="form.porcentaje_avance" type="number" min="0" step="0.01" />
            </div>

            <div v-else>
              <label>Monto base</label>
              <input v-model.number="form.monto_base" type="number" min="0" step="0.01" />
            </div>

            <div>
              <label>Indice CAC</label>
              <input v-model.number="form.indice_cac" type="number" min="0" step="0.0001" />
            </div>

            <div>
              <label>Pagos</label>
              <input v-model.number="form.pagos" type="number" min="0" step="0.01" />
            </div>

            <div class="full-span">
              <label>Observaciones</label>
              <input v-model="form.observaciones" type="text" />
            </div>
          </div>

          <div class="stats-grid preview-grid modal-preview-grid">
            <div class="stat-card"><span>Importe original</span><strong>{{ formatMoney(importeOriginal) }}</strong></div>
            <div class="stat-card"><span>Monto base</span><strong>{{ formatMoney(montoBaseCalculado) }}</strong></div>
            <div class="stat-card"><span>Actualizacion CAC</span><strong>{{ formatMoney(actualizacion) }}</strong></div>
            <div class="stat-card"><span>Total con IVA</span><strong>{{ formatMoney(totalCertConIva) }}</strong></div>
            <div class="stat-card"><span>Acumulado</span><strong>{{ formatMoney(acumuladoConActual) }}</strong></div>
            <div class="stat-card"><span>Saldo presupuesto</span><strong>{{ formatMoney(saldoPreOriginal) }}</strong></div>
          </div>

          <div v-if="certificadosDelPresupuesto.length" class="history-inline modal-history">
            <h4>Historial del presupuesto</h4>
            <div class="history-list">
              <button
                v-for="c in certificadosDelPresupuesto"
                :key="c.id"
                type="button"
                class="history-chip"
                @click="editCertificado(c)"
              >
                Certificado {{ c.secuencia }} · {{ formatMoney(c.total_cert_con_iva) }} · {{ c.estado }}
              </button>
            </div>
          </div>
        </template>

        <template #footer>
          <button class="btn-secondary" type="button" @click="showAdvanceModal = false">Cerrar</button>
          <button class="btn-primary" :disabled="saving || !form.presupuesto_id" @click="saveCertificado">
            {{ saving ? "Guardando..." : editingId ? "Actualizar avance" : "Guardar avance" }}
          </button>
        </template>
      </Modal>
    </div>
  </LayoutShell>
</template>

<style scoped>
.certificados-page {
  display: grid;
  gap: 16px;
}

.form-card,
.table-card {
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  padding: 16px;
}

.section-head,
.group-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.section-head p,
.group-head p {
  margin: 4px 0 0;
  color: #94a3b8;
}

.muted {
  color: #94a3b8;
}

.sequence-chip,
.group-badge {
  background: rgba(34, 197, 94, 0.14);
  color: #bbf7d0;
  border: 1px solid rgba(34, 197, 94, 0.35);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 0.82rem;
}

.grid-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.full-span {
  grid-column: 1 / -1;
}

.preview-grid {
  margin-top: 14px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.stat-card {
  background: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  padding: 12px;
  display: grid;
  gap: 6px;
}

.stat-card span {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #94a3b8;
}

.history-inline {
  margin-top: 14px;
}

.modal-form,
.modal-preview-grid,
.modal-history {
  margin-top: 0;
}

.history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.history-chip {
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(30, 64, 175, 0.18);
  color: #dbeafe;
  padding: 8px 10px;
  border-radius: 999px;
  cursor: pointer;
}

.actions,
.group-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.groups-list {
  display: grid;
  gap: 14px;
}

.group-card {
  background: rgba(15, 23, 42, 0.42);
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 12px;
  padding: 14px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 10px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  text-align: left;
}

tbody tr {
  cursor: pointer;
}

label {
  display: block;
  margin-bottom: 6px;
  font-size: 0.8rem;
  color: #cbd5e1;
}

input, select {
  width: 100%;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.75);
  color: #e2e8f0;
}

.btn-primary,
.btn-secondary {
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 700;
}

.btn-primary {
  border: 1px solid #22c55e;
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
  color: white;
}

.btn-secondary {
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(30, 41, 59, 0.7);
  color: #e2e8f0;
}

.estado-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 92px;
  padding: 6px 10px;
  border-radius: 999px;
  text-transform: capitalize;
}

.estado-pendiente {
  background: rgba(245, 158, 11, 0.18);
  color: #fde68a;
}

.estado-pagado {
  background: rgba(34, 197, 94, 0.16);
  color: #bbf7d0;
}

.error-msg {
  color: #fecaca;
}

.ok-msg {
  color: #bbf7d0;
}

@media (max-width: 900px) {
  .section-head,
  .group-head,
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .group-actions {
    justify-content: space-between;
  }
}
</style>

