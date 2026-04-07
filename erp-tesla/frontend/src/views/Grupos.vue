<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import { formatHoursAsClock } from "../utils/hourFormat"

const grupos = ref([])
const loading = ref(false)
const error = ref("")
const vistaActual = ref("lista") // "lista" | "detalle"
const grupoSeleccionado = ref(null)
const resumen = ref(null)
const showForm = ref(false)
const showConfirmRename = ref(false)
const editingId = ref(null)
const filtroBusqueda = ref("")

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

const gruposFiltrados = computed(() => {
  const termino = filtroBusqueda.value.trim().toLowerCase()
  if (!termino) return grupos.value

  return grupos.value.filter((grupo) => {
    const searchable = [grupo.nombre, grupo.descripcion]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return searchable.includes(termino)
  })
})

const gruposConDescripcion = computed(() => grupos.value.filter((grupo) => String(grupo.descripcion || "").trim()).length)

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
      <div v-if="vistaActual === 'lista'" class="grupos-list-view">
        <section class="grupos-topbar">
          <div class="grupos-topbar-copy">
            <span class="section-kicker">Base de equipos</span>
            <h2>Gestión de grupos</h2>
          </div>
          <button class="btn-primary grupos-new-btn" @click="abrirFormNuevo">+ Nuevo grupo</button>
        </section>

        <section class="grupos-stats">
          <article class="grupo-stat-card grupo-stat-card-primary">
            <span>Total de grupos</span>
            <strong>{{ grupos.length }}</strong>
            <small>Equipos registrados actualmente en el sistema.</small>
          </article>
          <article class="grupo-stat-card">
            <span>Con descripción</span>
            <strong>{{ gruposConDescripcion }}</strong>
            <small>Grupos con información descriptiva cargada.</small>
          </article>
          <article class="grupo-stat-card grupo-stat-card-muted">
            <span>Visibles</span>
            <strong>{{ gruposFiltrados.length }}</strong>
            <small>Resultados que coinciden con la búsqueda actual.</small>
          </article>
        </section>

        <section class="grupos-toolbar">
          <label class="grupos-search-field">
            <span>Buscar en tiempo real</span>
            <input
              v-model="filtroBusqueda"
              type="text"
              placeholder="Nombre del grupo o descripción"
            />
          </label>
          <div class="grupos-toolbar-count">
            Mostrando {{ gruposFiltrados.length }} de {{ grupos.length }} grupos
          </div>
        </section>

        <div v-if="error" class="error-alert">{{ error }}</div>
        <div v-if="loading" class="loading">Cargando...</div>

        <div v-if="!loading && gruposFiltrados.length > 0" class="grupos-grid-shell">
          <div class="grupos-grid-header">
            <div>
              <span class="section-kicker">Listado</span>
              <h3>Grupos registrados</h3>
            </div>
          </div>

          <div class="grupos-grid">
          <div
            v-for="grupo in gruposFiltrados"
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
        </div>

        <div v-if="!loading && grupos.length === 0" class="empty-state">
          <p>No hay grupos registrados</p>
        </div>

        <div v-if="!loading && grupos.length > 0 && gruposFiltrados.length === 0" class="empty-state empty-state-search">
          <p>No hay coincidencias para la búsqueda actual</p>
          <button class="btn-secondary" @click="filtroBusqueda = ''">Limpiar búsqueda</button>
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
            <span class="stat-value">{{ formatHoursAsClock(resumen.resumen.totalHoras) }}</span>
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
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Equipo de trabajo</span>
              <h3>{{ editingId ? "Editar grupo" : "Nuevo grupo" }}</h3>
              <p>Definí el nombre del equipo y agregá una descripción breve para dejarlo mejor identificado.</p>
            </div>
            <button class="btn-close" @click="showForm = false">×</button>
          </div>
          <form @submit.prevent="guardarGrupo" class="modal-form">
            <div v-if="error" class="error-alert">{{ error }}</div>
            <div class="modal-form-grid">
              <label class="form-group form-group-full">
                <span>Nombre *</span>
                <input v-model="formGrupo.nombre" type="text" placeholder="Nombre del grupo" required />
              </label>
              <label class="form-group form-group-full">
                <span>Descripción</span>
                <input v-model="formGrupo.descripcion" type="text" placeholder="Descripción opcional" />
              </label>
            </div>
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
  display: grid;
  gap: 1.75rem;
}

.grupos-list-view {
  display: grid;
  gap: 1.5rem;
}

.section-kicker {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.grupos-topbar,
.grupos-toolbar,
.grupos-grid-shell,
.grupo-stat-card,
.empty-state {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.45);
}

.grupos-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.grupos-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.grupos-topbar-copy h2,
.grupos-grid-header h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.grupos-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 60ch;
  line-height: 1.45;
}

.grupos-new-btn {
  white-space: nowrap;
}

.grupos-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.35rem;
}

.grupo-stat-card {
  padding: 1.15rem 1.2rem;
  border-radius: 0.95rem;
  display: grid;
  gap: 0.4rem;
}

.grupo-stat-card span {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.grupo-stat-card strong {
  font-size: 1.55rem;
  color: #f8fafc;
}

.grupo-stat-card small {
  color: #94a3b8;
  line-height: 1.35;
}

.grupo-stat-card-primary {
  border-color: rgba(96, 165, 250, 0.28);
}

.grupo-stat-card-muted strong {
  color: #cbd5e1;
}

.grupos-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.15rem;
  flex-wrap: wrap;
  padding: 1.1rem 1.2rem;
  border-radius: 1rem;
}

.grupos-search-field {
  display: grid;
  gap: 0.45rem;
  flex: 1;
  min-width: min(100%, 420px);
}

.grupos-search-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.grupos-search-field input {
  width: 100%;
  min-height: 3rem;
  padding: 0.85rem 0.95rem;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.grupos-search-field input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.grupos-toolbar-count {
  color: #94a3b8;
  font-size: 0.88rem;
  white-space: nowrap;
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
.grupos-grid-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.grupos-grid-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.15rem 0.75rem;
}

.grupos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  padding: 0 1rem 1rem;
}

.grupo-card {
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 1rem;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
}

.grupo-card:hover {
  border-color: rgba(59, 130, 246, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.3);
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
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.12);
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  border-radius: 999px;
  transition: background 0.15s, border-color 0.15s;
}

.btn-edit-inline:hover {
  background: rgba(148, 163, 184, 0.15);
  border-color: rgba(148, 163, 184, 0.28);
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
  border-radius: 1rem;
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
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.85rem;
  overflow: hidden;
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
  padding: 1.5rem;
  background: rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(10px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  width: min(720px, 100%);
  max-height: min(88vh, 920px);
  overflow-y: auto;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 1.15rem;
  box-shadow: 0 34px 80px rgba(2, 6, 23, 0.58);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  padding: 1.45rem 1.6rem 1.1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.modal-header-copy {
  display: grid;
  gap: 0.28rem;
}

.modal-kicker {
  color: #93c5fd;
}

.modal-header h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.modal-header p {
  margin: 0;
  color: #94a3b8;
  line-height: 1.45;
}

.btn-close {
  width: 2.5rem;
  height: 2.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  color: #94a3b8;
  font-size: 1.7rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
  transition: all 0.2s;
}
.btn-close:hover {
  color: #e2e8f0;
  border-color: rgba(147, 197, 253, 0.34);
  background: rgba(30, 41, 59, 0.95);
}

.modal-form {
  padding: 1.3rem 1.6rem 1.6rem;
  display: grid;
  gap: 1.25rem;
}

.modal-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.48rem;
}

.form-group-full {
  grid-column: 1 / -1;
}

.form-group span {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.form-group input {
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 0.8rem;
  color: #e2e8f0;
  font-size: 0.94rem;
  transition: all 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: rgba(96, 165, 250, 0.9);
  background: rgba(15, 23, 42, 0.98);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
}

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.15rem;
}

.modal-actions .btn-primary,
.modal-actions .btn-secondary {
  min-height: 3rem;
  border-radius: 0.8rem;
  font-weight: 700;
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

@media (max-width: 760px) {
  .grupos-topbar,
  .grupos-toolbar,
  .detalle-header {
    flex-direction: column;
    align-items: stretch;
  }

  .grupos-toolbar-count {
    white-space: normal;
  }

  .modal-overlay {
    padding: 1rem;
    align-items: flex-start;
  }

  .modal {
    width: 100%;
    margin-top: 1rem;
  }

  .modal-header,
  .modal-form {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .modal-form-grid {
    grid-template-columns: 1fr;
  }

  .form-group-full {
    grid-column: auto;
  }

  .modal-actions,
  .detalle-header {
    gap: 0.9rem;
  }
}
</style>
