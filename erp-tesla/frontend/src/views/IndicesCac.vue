<script setup>
import { ref, onMounted, computed } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"

const indices = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref("")
const ok = ref("")

const showForm = ref(false)
const editingId = ref(null)

const emptyForm = () => ({
  periodo: "",
  valor: "",
  fecha_publicacion: "",
  notas: "",
})

const form = ref(emptyForm())

const totalIndices = computed(() => indices.value.length)

const formatMoney = (v) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)

const formatDate = (v) => {
  if (!v) return "-"
  const d = new Date(v + "T00:00:00")
  return d.toLocaleDateString("es-AR")
}

const cargar = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getIndicesCac()
    indices.value = res.data
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al cargar índices CAC")
  } finally {
    loading.value = false
  }
}

onMounted(cargar)

const abrirNuevo = () => {
  editingId.value = null
  form.value = emptyForm()
  showForm.value = true
  error.value = ""
  ok.value = ""
}

const abrirEditar = (indice) => {
  editingId.value = indice.id
  form.value = {
    periodo: indice.periodo,
    valor: String(indice.valor),
    fecha_publicacion: indice.fecha_publicacion || "",
    notas: indice.notas || "",
  }
  showForm.value = true
  error.value = ""
  ok.value = ""
}

const cancelar = () => {
  showForm.value = false
  editingId.value = null
  form.value = emptyForm()
}

const guardar = async () => {
  error.value = ""
  ok.value = ""
  const periodo = String(form.value.periodo || "").trim()
  const valor = Number(form.value.valor)
  if (!periodo) {
    error.value = "El período es obligatorio"
    return
  }
  if (!valor || valor <= 0) {
    error.value = "El valor del índice debe ser mayor a 0"
    return
  }

  saving.value = true
  try {
    const payload = {
      periodo,
      valor,
      fecha_publicacion: form.value.fecha_publicacion || null,
      notas: String(form.value.notas || "").trim(),
    }
    if (editingId.value) {
      await api.updateIndiceCac(editingId.value, payload)
      ok.value = "Índice actualizado"
    } else {
      await api.createIndiceCac(payload)
      ok.value = "Índice registrado"
    }
    await cargar()
    cancelar()
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al guardar")
  } finally {
    saving.value = false
  }
}

const eliminar = async (indice) => {
  if (!confirm(`¿Eliminar el índice "${indice.periodo}" (${indice.valor})?`)) return
  error.value = ""
  ok.value = ""
  try {
    await api.deleteIndiceCac(indice.id)
    ok.value = "Índice eliminado"
    await cargar()
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al eliminar")
  }
}

const indicesOrdenados = computed(() =>
  [...indices.value].sort((a, b) => {
    if (a.fecha_publicacion && b.fecha_publicacion) {
      return b.fecha_publicacion.localeCompare(a.fecha_publicacion)
    }
    return b.id - a.id
  })
)
</script>

<template>
  <LayoutShell title="Índices CAC" subtitle="Registro histórico del índice de la Cámara Argentina de la Construcción">
    <div class="indices-page">
      <section class="indices-hero">
        <div>
          <span class="hero-kicker">Actualización contractual</span>
          <h2>Registro de Índices CAC</h2>
          <p>Cargá cada publicación para usarla luego en presupuestos y certificados sin reescribir valores.</p>
        </div>
        <div class="hero-actions">
          <div class="hero-stat">
            <span>Registros</span>
            <strong>{{ totalIndices }}</strong>
          </div>
          <button class="btn-primary" @click="abrirNuevo">+ Registrar índice</button>
        </div>
      </section>

      <div class="view-container">
        <div class="top-bar">
          <span class="topbar-caption">Gestioná, editá y eliminá índices publicados</span>
        </div>

        <div v-if="error" class="alert-error">{{ error }}</div>
        <div v-if="ok" class="alert-ok">{{ ok }}</div>

        <div v-if="showForm" class="form-card">
          <h3 class="form-title">{{ editingId ? "Editar índice" : "Nuevo índice CAC" }}</h3>
          <div class="form-grid">
            <div class="field">
              <label>Período <span class="req">*</span></label>
              <input v-model="form.periodo" placeholder="Ej: Enero 2026" />
            </div>
            <div class="field">
              <label>Valor del índice <span class="req">*</span></label>
              <input v-model="form.valor" type="number" step="0.01" min="0.01" placeholder="Ej: 15026.2" />
            </div>
            <div class="field">
              <label>Fecha de publicación</label>
              <input v-model="form.fecha_publicacion" type="date" />
            </div>
            <div class="field field-full">
              <label>Notas</label>
              <input v-model="form.notas" placeholder="Opcional" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-primary" :disabled="saving" @click="guardar">
              {{ saving ? "Guardando..." : editingId ? "Actualizar" : "Guardar" }}
            </button>
            <button class="btn-secondary" @click="cancelar">Cancelar</button>
          </div>
        </div>

        <div v-if="loading" class="loading-msg">Cargando...</div>
        <div v-else-if="indicesOrdenados.length === 0 && !showForm" class="empty-msg">
          No hay índices registrados todavía.
        </div>
        <div v-else class="table-wrapper">
          <table class="tabla">
            <thead>
              <tr>
                <th>Período</th>
                <th class="num">Valor</th>
                <th>Fecha publicación</th>
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="indice in indicesOrdenados" :key="indice.id">
                <td><strong>{{ indice.periodo }}</strong></td>
                <td class="num">{{ formatMoney(indice.valor) }}</td>
                <td>{{ formatDate(indice.fecha_publicacion) }}</td>
                <td class="text-muted">{{ indice.notas || "-" }}</td>
                <td class="acciones">
                  <button class="btn-secondary btn-mini" @click="abrirEditar(indice)">Editar</button>
                  <button class="btn-danger btn-mini" @click="eliminar(indice)">Eliminar</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.indices-page {
  display: grid;
  gap: 16px;
}

.indices-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 1.2rem 1.25rem;
  border-radius: 1rem;
  border: 1px solid rgba(96, 165, 250, 0.2);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 30%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.82));
}

.indices-hero h2 {
  margin: 0;
  font-size: 1.5rem;
  color: #f8fafc;
}

.indices-hero p {
  margin: 0.35rem 0 0;
  max-width: 64ch;
  color: #94a3b8;
}

.hero-kicker {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.hero-actions {
  display: flex;
  gap: 0.7rem;
  align-items: center;
  flex-wrap: wrap;
}

.hero-stat {
  display: grid;
  gap: 0.1rem;
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  border: 1px solid rgba(125, 211, 252, 0.2);
  background: rgba(30, 64, 175, 0.18);
}

.hero-stat span {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: #93c5fd;
}

.hero-stat strong {
  color: #dbeafe;
}

.view-container {
  padding: 1.15rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.09), transparent 35%),
    rgba(15, 23, 42, 0.55);
}

.top-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.8rem;
}

.topbar-caption {
  font-size: 0.8rem;
  color: #94a3b8;
}

.alert-error {
  background: rgba(127, 29, 29, 0.5);
  color: #fecaca;
  border-radius: 8px;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  border: 1px solid rgba(248, 113, 113, 0.35);
}

.alert-ok {
  background: rgba(20, 83, 45, 0.5);
  color: #bbf7d0;
  border-radius: 8px;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  border: 1px solid rgba(74, 222, 128, 0.32);
}

.form-card {
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  padding: 1.1rem 1.2rem;
  margin-bottom: 1rem;
}

.form-title {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 1rem;
  color: #e2e8f0;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
}

.field-full {
  grid-column: 1 / -1;
}

.field label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
  color: #cbd5e1;
}

.field input {
  width: 100%;
  padding: 0.52rem 0.65rem;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 8px;
  font-size: 0.9rem;
  box-sizing: border-box;
  background: rgba(15, 23, 42, 0.75);
  color: #e2e8f0;
}

.req {
  color: #ef4444;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.tabla thead tr {
  background: rgba(30, 41, 59, 0.75);
}

.tabla th,
.tabla td {
  padding: 0.62rem 0.78rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  text-align: left;
}

.tabla th {
  font-weight: 700;
  font-size: 0.82rem;
  color: #e2e8f0;
}

.tabla tbody tr:hover {
  background: rgba(59, 130, 246, 0.1);
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.text-muted {
  color: #94a3b8;
}

.acciones {
  display: flex;
  gap: 0.4rem;
}

.loading-msg,
.empty-msg {
  color: #94a3b8;
  font-size: 0.9rem;
  padding: 1.5rem 0;
  text-align: center;
}

.btn-primary {
  border: 1px solid #22c55e;
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #fff;
  border-radius: 9px;
  padding: 0.5rem 1rem;
  font-size: 0.87rem;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.05);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-secondary {
  background: rgba(30, 41, 59, 0.7);
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 9px;
  padding: 0.45rem 0.9rem;
  font-size: 0.87rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary:hover {
  background: rgba(51, 65, 85, 0.8);
}

.btn-danger {
  background: rgba(127, 29, 29, 0.5);
  color: #fecaca;
  border: 1px solid rgba(252, 165, 165, 0.4);
  border-radius: 9px;
  padding: 0.45rem 0.9rem;
  font-size: 0.87rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-danger:hover {
  background: rgba(153, 27, 27, 0.56);
}

.btn-mini {
  padding: 0.28rem 0.62rem;
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .indices-hero {
    flex-direction: column;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
