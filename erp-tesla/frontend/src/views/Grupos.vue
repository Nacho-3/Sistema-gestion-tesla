<script setup>
import { ref, onMounted, onUnmounted } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

const grupos = ref([])
const loading = ref(false)
const error = ref("")
const vistaActual = ref("lista") // "lista" | "detalle"
const grupoSeleccionado = ref(null)
const resumen = ref(null)
const showForm = ref(false)
const showConfirmRename = ref(false)
const editingId = ref(null)

const formGrupo = ref({ nombre: "", descripcion: "" })

const loadGrupos = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getGrupos()
    grupos.value = res.data || []
  } catch (err) {
    error.value = "Error al cargar grupos"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const verDetalle = async (grupo) => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getGrupoResumen(grupo.id)
    grupoSeleccionado.value = res.data.grupo
    resumen.value = res.data
    vistaActual.value = "detalle"
  } catch (err) {
    error.value = "Error al cargar el resumen del grupo"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const volverALista = () => {
  vistaActual.value = "lista"
  grupoSeleccionado.value = null
  resumen.value = null
}

const abrirFormNuevo = () => {
  editingId.value = null
  formGrupo.value = { nombre: "", descripcion: "" }
  showForm.value = true
}

const abrirFormEditar = (grupo) => {
  editingId.value = grupo.id
  formGrupo.value = { nombre: grupo.nombre, descripcion: grupo.descripcion || "" }
  showForm.value = true
}

const guardarGrupo = async () => {
  error.value = ""
  if (!formGrupo.value.nombre.trim()) {
    error.value = "El nombre es obligatorio"
    return
  }
  loading.value = true
  try {
    if (editingId.value) {
      await api.updateGrupo(editingId.value, formGrupo.value)
    } else {
      await api.createGrupo(formGrupo.value)
    }
    showForm.value = false
    await loadGrupos()
  } catch (err) {
    error.value = "Error al guardar grupo"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const formatearFecha = (fecha) => {
  if (!fecha) return "-"
  return new Date(fecha).toLocaleDateString("es-AR")
}

const normalizeEstado = (estado = "") => {
  if (estado === "activa") return "Activa"
  if (estado === "finalizada") return "Finalizada"
  if (estado === "cerrada") return "Cerrada"
  return estado || "-"
}

onMounted(() => {
  loadGrupos()
  socket.on('grupos:changed', loadGrupos)
})
onUnmounted(() => {
  socket.off('grupos:changed', loadGrupos)
})
</script>

<template>
  <LayoutShell title="Grupos" subtitle="Gestión de grupos de trabajo">
    <div class="grupos-container">

      <!-- VISTA LISTA -->
      <div v-if="vistaActual === 'lista'">
        <div class="grupos-header">
          <button class="btn-primary" @click="abrirFormNuevo">+ Nuevo grupo</button>
        </div>

        <div v-if="error" class="error-alert">{{ error }}</div>
        <div v-if="loading" class="loading">Cargando...</div>

        <div v-if="!loading && grupos.length > 0" class="grupos-grid">
          <div
            v-for="grupo in grupos"
            :key="grupo.id"
            class="grupo-card"
          >
            <div class="grupo-card-header">
              <h3>{{ grupo.nombre }}</h3>
              <button class="btn-edit-inline" @click.stop="abrirFormEditar(grupo)" title="Renombrar">✏️</button>
            </div>
            <p class="grupo-desc">{{ grupo.descripcion || "Sin descripción" }}</p>
            <button class="btn-detalle" @click="verDetalle(grupo)">📋 Ver resumen</button>
          </div>
        </div>

        <div v-if="!loading && grupos.length === 0" class="empty-state">
          <p>No hay grupos registrados</p>
        </div>
      </div>

      <!-- VISTA DETALLE-->
      <div v-if="vistaActual === 'detalle' && resumen" class="detalle-container">
        <div class="detalle-header">
          <button class="btn-volver" @click="volverALista">← Volver a grupos</button>
          <button class="btn-edit" @click="abrirFormEditar(grupoSeleccionado)">✏️ Renombrar</button>
        </div>

        <div v-if="error" class="error-alert">{{ error }}</div>

        <!-- Info principal -->
        <div class="ficha-seccion datos-principales">
          <h2>{{ resumen.grupo.nombre }}</h2>
          <p class="grupo-desc-detalle">{{ resumen.grupo.descripcion || "Sin descripción" }}</p>
        </div>

        <!-- Tarjetas resumen -->
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-value">{{ resumen.resumen.totalEmpleados }}</span>
            <span class="stat-label">Empleados</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ resumen.resumen.totalObras }}</span>
            <span class="stat-label">Obras totales</span>
          </div>
          <div class="stat-card activas">
            <span class="stat-value">{{ resumen.resumen.obrasActivas }}</span>
            <span class="stat-label">Obras activas</span>
          </div>
          <div class="stat-card finalizadas">
            <span class="stat-value">{{ resumen.resumen.obrasFinalizadas }}</span>
            <span class="stat-label">Obras finalizadas</span>
          </div>
          <div class="stat-card horas">
            <span class="stat-value">{{ resumen.resumen.totalHoras.toFixed(1) }}</span>
            <span class="stat-label">Horas registradas</span>
          </div>
        </div>

        <!-- Empleados -->
        <div class="ficha-seccion">
          <h3>👷 Empleados del grupo</h3>
          <div v-if="resumen.empleados.length > 0" class="tabla-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Apellido</th>
                  <th>DNI</th>
                  <th>Valor hora</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="emp in resumen.empleados" :key="emp.id">
                  <td>{{ emp.nombre }}</td>
                  <td>{{ emp.apellido }}</td>
                  <td>{{ emp.dni }}</td>
                  <td>${{ Number(emp.valor_hora).toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">No hay empleados en este grupo</p>
        </div>

        <!-- Obras -->
        <div class="ficha-seccion">
          <h3>🏗️ Obras del grupo</h3>
          <div v-if="resumen.obras.length > 0" class="tabla-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Fecha inicio</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="obra in resumen.obras" :key="obra.id">
                  <td>{{ obra.nombre }}</td>
                  <td>
                    <span class="badge-estado" :class="`estado-${obra.estado}`">
                      {{ normalizeEstado(obra.estado) }}
                    </span>
                  </td>
                  <td>{{ formatearFecha(obra.fecha_inicio) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">No hay obras asignadas a este grupo</p>
        </div>
      </div>

      <!-- Modal nuevo/editar grupo -->
      <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
        <div class="modal">
          <div class="modal-header">
            <h3>{{ editingId ? "Editar grupo" : "Nuevo grupo" }}</h3>
            <button class="btn-close" @click="showForm = false">×</button>
          </div>
          <form @submit.prevent="guardarGrupo" class="modal-form">
            <div v-if="error" class="error-alert">{{ error }}</div>
            <label class="form-group">
              <span>Nombre *</span>
              <input v-model="formGrupo.nombre" type="text" placeholder="Nombre del grupo" required />
            </label>
            <label class="form-group">
              <span>Descripción</span>
              <input v-model="formGrupo.descripcion" type="text" placeholder="Descripción opcional" />
            </label>
            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Guardando..." : "Guardar" }}
              </button>
              <button type="button" class="btn-secondary" @click="showForm = false">Cancelar</button>
            </div>
          </form>
        </div>
      </div>

    </div>
  </LayoutShell>
</template>

<style scoped>
.grupos-container {
  padding: 1.5rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.grupos-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 2rem;
}

.error-alert {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
}

/* Cards en lista */
.grupos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
}

.grupo-card {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: border-color 0.2s, transform 0.15s;
}

.grupo-card:hover {
  border-color: rgba(59, 130, 246, 0.4);
  transform: translateY(-2px);
}

.grupo-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.grupo-card-header h3 {
  margin: 0;
  color: #f9fafb;
  font-size: 1.25rem;
  font-weight: 700;
}

.btn-edit-inline {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  transition: background 0.15s;
}

.btn-edit-inline:hover {
  background: rgba(148, 163, 184, 0.15);
}

.grupo-desc {
  color: #94a3b8;
  font-size: 0.9rem;
  margin: 0;
}

.btn-detalle {
  padding: 0.5rem 1rem;
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
  align-self: flex-start;
}

.btn-detalle:hover {
  background: rgba(59, 130, 246, 0.35);
}

.empty-state {
  text-align: center;
  padding: 3rem 2rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #94a3b8;
  font-size: 1.1rem;
}

/* Detalle */
.detalle-container { animation: fadeIn 0.3s; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.detalle-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.btn-volver {
  padding: 0.75rem 1.5rem;
  background: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  border: none;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-volver:hover { background: rgba(148, 163, 184, 0.3); }

.btn-edit {
  padding: 0.6rem 1.2rem;
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-edit:hover { background: rgba(59, 130, 246, 0.3); }

.ficha-seccion {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
}

.ficha-seccion h3 {
  margin: 0 0 1.25rem;
  color: #e2e8f0;
  font-size: 1.1rem;
  font-weight: 600;
}

.datos-principales {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(15, 23, 42, 0.6));
  border-color: rgba(59, 130, 246, 0.3);
}

.datos-principales h2 {
  margin: 0 0 0.5rem;
  color: #f9fafb;
  font-size: 1.75rem;
  font-weight: 700;
}

.grupo-desc-detalle {
  color: #94a3b8;
  margin: 0;
  font-size: 0.95rem;
}

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem;
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  gap: 0.5rem;
  transition: border-color 0.2s;
}

.stat-card:hover { border-color: rgba(148, 163, 184, 0.4); }

.stat-card.activas  { border-color: rgba(34, 197, 94, 0.3); }
.stat-card.finalizadas { border-color: rgba(148, 163, 184, 0.35); }
.stat-card.horas    { border-color: rgba(251, 191, 36, 0.3); }

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #3b82f6;
}
.stat-card.activas  .stat-value  { color: #86efac; }
.stat-card.finalizadas .stat-value { color: #cbd5e1; }
.stat-card.horas    .stat-value  { color: #fde047; }

.stat-label {
  font-size: 0.8rem;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  text-align: center;
}

/* Tablas */
.tabla-wrapper { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(15, 23, 42, 0.5);
}

thead {
  background: rgba(30, 41, 59, 0.8);
  border-bottom: 2px solid rgba(148, 163, 184, 0.3);
}

th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  color: #cbd5e1;
  font-size: 0.865rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

tbody tr {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background 0.15s;
}

tbody tr:hover { background: rgba(148, 163, 184, 0.06); }

td {
  padding: 0.75rem 1rem;
  color: #cbd5e1;
  font-size: 0.9375rem;
}

.badge-estado {
  padding: 0.2rem 0.65rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.estado-activa    { background: rgba(34,197,94,0.2);   color: #86efac; }
.estado-finalizada { background: rgba(148,163,184,0.2); color: #cbd5e1; }
.estado-cerrada   { background: rgba(239,68,68,0.15);  color: #fca5a5; }

.sin-datos {
  color: #94a3b8;
  font-style: italic;
  text-align: center;
  padding: 1rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.modal {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 130%;
  max-width: 480px;
  max-height: 96vh;
  overflow-y: auto;
  box-shadow: 0 40px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.modal-header h3 {
  margin: 0;
  color: #e2e8f0;
  font-size: 1.25rem;
}

.btn-close {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s;
}
.btn-close:hover { color: #cbd5e1; }

.modal-form {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group span {
  font-size: 0.875rem;
  font-weight: 500;
  color: #cbd5e1;
}

.form-group input {
  padding: 0.75rem;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.9375rem;
  font-family: inherit;
  transition: all 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.5rem;
}

.btn-primary {
  flex: 1;
  padding: 0.75rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}
.btn-primary:hover:not(:disabled) { background: #2563eb; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-secondary {
  flex: 1;
  padding: 0.75rem;
  background: transparent;
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
}
.btn-secondary:hover {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.5);
}
</style>
