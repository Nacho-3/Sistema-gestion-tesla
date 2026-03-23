<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

const empleados = ref([])
const grupos = ref([])
const vistaActual = ref("lista") // "lista" o "detalle"
const empleadoSeleccionado = ref(null)
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const editingId = ref(null)
const showConfirm = ref(false)
const empleadoAEliminar = ref(null)

// Acordeón
const expandedIds = ref(new Set())
const horasPorEmpleado = ref({})
const loadingHorasId = ref(null)

// Filtros
const filtroGrupo = ref("")

const TIPOS_CONTRATO = [
  { value: "monotributista", label: "Monotributista" },
  { value: "empleado_dependiente", label: "Empleado dependiente" }
]

// Formulario
const form = ref({
  nombre: "",
  apellido: "",
  dni: "",
  cuit: "",
  fecha_nacimiento: "",
  direccion: "",
  telefono: "",
  tipo: "",
  alias: "",
  grupo_id: "",
  valor_hora: 0
})

const getEmptyForm = () => ({
  nombre: "",
  apellido: "",
  dni: "",
  cuit: "",
  fecha_nacimiento: "",
  direccion: "",
  telefono: "",
  tipo: "",
  alias: "",
  grupo_id: "",
  valor_hora: 0
})

const esFormularioValido = computed(() => {
  return form.value.nombre && 
         form.value.apellido && 
         form.value.dni && 
      form.value.cuit && 
      form.value.fecha_nacimiento && 
      form.value.direccion && 
      form.value.telefono && 
      form.value.tipo && 
      form.value.alias && 
         form.value.grupo_id && 
         form.value.valor_hora > 0
})

const empleadosFiltrados = computed(() => {
  let resultado = empleados.value
  if (filtroGrupo.value) {
    resultado = resultado.filter(e => String(e.grupo_id) === String(filtroGrupo.value))
  }
  return [...resultado].sort((a, b) => a.apellido.localeCompare(b.apellido))
})

const toggleEmpleado = async (emp) => {
  const id = emp.id
  if (expandedIds.value.has(id)) {
    expandedIds.value = new Set([...expandedIds.value].filter(x => x !== id))
    return
  }
  expandedIds.value = new Set([...expandedIds.value, id])
  // Carga lazy: sólo si aún no se cargaron las horas
  if (horasPorEmpleado.value[id] !== undefined) return
  loadingHorasId.value = id
  try {
    const res = await api.getHoras(null, null, id)
    const horas = res.data || []
    // Agrupar por fecha
    const porFecha = {}
    horas.forEach(h => {
      const fecha = h.fecha ? h.fecha.split("T")[0] : "Sin fecha"
      if (!porFecha[fecha]) porFecha[fecha] = []
      porFecha[fecha].push(h)
    })
    // Convertir a array ordenado desc por fecha
    horasPorEmpleado.value = {
      ...horasPorEmpleado.value,
      [id]: Object.entries(porFecha)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([fecha, registros]) => ({
          fecha,
          totalHoras: registros.reduce((s, r) => s + Number(r.cantidad_horas ?? r.cantidad_hora ?? r.horas ?? 0), 0),
          registros
        }))
    }
  } catch (err) {
    horasPorEmpleado.value = { ...horasPorEmpleado.value, [id]: [] }
  } finally {
    loadingHorasId.value = null
  }
}

const formatFecha = (fecha) => {
  if (!fecha || fecha === "Sin fecha") return fecha
  const [y, m, d] = fecha.split("-")
  return `${d}/${m}/${y}`
}

const cargarDatos = async () => {
  loading.value = true
  try {
    const [resEmpleados, resGrupos] = await Promise.all([
      api.getEmpleados(),
      api.getGrupos()
    ])
    empleados.value = resEmpleados.data || []
    grupos.value = resGrupos.data || []
  } catch (err) {
    error.value = `Error al cargar: ${err.response?.data?.error || err.message}`
  } finally {
    loading.value = false
  }
}

const abrirFormulario = (empleado = null) => {
  if (empleado) {
    editingId.value = empleado.id
    form.value = {
      ...getEmptyForm(),
      ...empleado,
      grupo_id: empleado.grupo_id ?? "",
      valor_hora: Number(empleado.valor_hora || 0),
      fecha_nacimiento: empleado.fecha_nacimiento
        ? String(empleado.fecha_nacimiento).split("T")[0]
        : "",
    }
  } else {
    editingId.value = null
    form.value = getEmptyForm()
  }

  showForm.value = true
}

const cerrarFormulario = () => {
  showForm.value = false
  editingId.value = null
  form.value = getEmptyForm()
}

const guardarEmpleado = async () => {
  if (!esFormularioValido.value) {
    error.value = "Por favor completa todos los campos"
    return
  }

  try {
    const payload = {
      nombre: form.value.nombre,
      apellido: form.value.apellido,
      dni: form.value.dni,
      cuit: form.value.cuit,
      fecha_nacimiento: form.value.fecha_nacimiento,
      direccion: form.value.direccion,
      telefono: form.value.telefono,
      tipo: form.value.tipo,
      alias: form.value.alias,
      grupo_id: form.value.grupo_id,
      valor_hora: parseFloat(form.value.valor_hora)
    }

    if (editingId.value) {
      await api.updateEmpleado(editingId.value, payload)
    } else {
      await api.createEmpleado(payload)
    }

    await cargarDatos()
    if (empleadoSeleccionado.value && editingId.value === empleadoSeleccionado.value.id) {
      empleadoSeleccionado.value = {
        ...empleadoSeleccionado.value,
        ...payload,
      }
    }

    cerrarFormulario()
    error.value = ""
  } catch (err) {
    error.value = editingId.value
      ? `Error al modificar: ${err.response?.data?.error || err.message}`
      : `Error al crear: ${err.response?.data?.error || err.message}`
  }
}

const verDetalle = (empleado) => {
  try {
    console.log("Abriendo detalle de empleado:", empleado)
    error.value = ""
    const toNumber = (val) => {
      const num = Number(val)
      return Number.isFinite(num) ? num : 0
    }
    empleadoSeleccionado.value = {
      ...empleado,
      valor_hora: toNumber(empleado.valor_hora),
      resumen: {
        totalHoras: 0,
        horasPrestadas: 0,
        liquidacionesPendientes: 0,
        liquidacionesPagadas: 0
      }
    }
    console.log("empleadoSeleccionado asignado:", empleadoSeleccionado.value)
    vistaActual.value = "detalle"
    console.log("vistaActual cambiado a:", vistaActual.value)
  } catch (err) {
    error.value = `Error al cargar detalle: ${err.message}`
    console.error(err)
  }
}

const volverALista = () => {
  vistaActual.value = "lista"
  empleadoSeleccionado.value = null
}

const confirmarEliminar = (empleado) => {
  empleadoAEliminar.value = empleado
  showConfirm.value = true
}

const eliminarEmpleado = async () => {
  try {
    await api.deleteEmpleado(empleadoAEliminar.value.id)
    await cargarDatos()
    showConfirm.value = false
    empleadoAEliminar.value = null
    error.value = ""
  } catch (err) {
    error.value = `Error al eliminar: ${err.response?.data?.error || err.message}`
    showConfirm.value = false
  }
}

const obtenerNombreGrupo = (grupoId) => {
  const grupo = grupos.value.find(g => g.id === grupoId)
  return grupo ? grupo.nombre : "Sin grupo"
}

onMounted(() => {
  cargarDatos()
  socket.on('empleados:changed', cargarDatos)
})
onUnmounted(() => {
  socket.off('empleados:changed', cargarDatos)
})
</script>

<template>
  <LayoutShell title="Empleados" subtitle="Gestión de empleados">
    <!-- LISTA VIEW -->
    <div v-if="vistaActual === 'lista'" class="container">
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <!-- Toolbar -->
      <div class="toolbar">
        <div class="filtros">
          <label>
            Filtrar por grupo:
            <select v-model="filtroGrupo" class="select">
              <option value="">Todos</option>
              <option v-for="g in grupos" :key="g.id" :value="g.id">
                {{ g.nombre }}
              </option>
            </select>
          </label>
        </div>
        <button class="btn btn-primary" @click="abrirFormulario">
          + Nuevo Empleado
        </button>
      </div>

      <!-- Lista desplegable de empleados -->
      <div v-if="loading" class="spinner">Cargando...</div>
      <div v-else-if="empleadosFiltrados.length === 0" class="empty">
        No hay empleados registrados
      </div>
      <div v-else class="empleados-lista">
        <div v-for="emp in empleadosFiltrados" :key="emp.id" class="empleado-row">
          <div class="empleado-info">
            <span class="emp-nombre">{{ emp.apellido }}, {{ emp.nombre }}</span>
            <span class="emp-grupo">{{ obtenerNombreGrupo(emp.grupo_id) }}</span>
            <span class="emp-dni">DNI {{ emp.dni }}</span>
            <span class="emp-hora">${{ Number(emp.valor_hora).toFixed(2) }}/h</span>
          </div>
          
          <!-- Botones dentro del recuadro -->
          <div class="empleado-acciones">
            <button @click="verDetalle(emp)" class="btn-action btn-detail">👁️ Ver detalle</button>
            <button @click="abrirFormulario(emp)" class="btn-action btn-edit">✏️ Modificar</button>
            <button @click="confirmarEliminar(emp)" class="btn-action btn-delete">🗑️ Eliminar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- DETALLE VIEW -->
    <div v-else-if="vistaActual === 'detalle'" class="container">
      <button class="btn btn-secondary" @click="volverALista">← Volver a lista</button>

      <div v-if="empleadoSeleccionado" class="detalle-card">
        <!-- Header -->
        <div class="detalle-header">
          <div>
            <h2>{{ empleadoSeleccionado.nombre }} {{ empleadoSeleccionado.apellido }}</h2>
            <p class="subtitle">{{ obtenerNombreGrupo(empleadoSeleccionado.grupo_id) }}</p>
          </div>
          <button class="btn-action btn-edit" @click="abrirFormulario(empleadoSeleccionado)">✏️ Modificar</button>
        </div>

        <!-- Información básica -->
        <div class="section">
          <h3>Información Personal</h3>
          <div class="info-grid">
            <div class="info-item">
              <label>DNI</label>
              <p>{{ empleadoSeleccionado.dni }}</p>
            </div>
            <div class="info-item">
              <label>CUIT</label>
              <p>{{ empleadoSeleccionado.cuit || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Fecha Nacimiento</label>
              <p>{{ empleadoSeleccionado.fecha_nacimiento || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Dirección</label>
              <p>{{ empleadoSeleccionado.direccion || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Teléfono</label>
              <p>{{ empleadoSeleccionado.telefono || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Tipo</label>
              <p>{{ empleadoSeleccionado.tipo === "monotributista" ? "Monotributista" : (empleadoSeleccionado.tipo === "empleado_dependiente" ? "Empleado dependiente" : "-") }}</p>
            </div>
            <div class="info-item">
              <label>Alias</label>
              <p>{{ empleadoSeleccionado.alias || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Valor Hora</label>
              <p>${{ empleadoSeleccionado.valor_hora.toFixed(2) }}</p>
            </div>
            <div class="info-item">
              <label>Grupo</label>
              <p>{{ obtenerNombreGrupo(empleadoSeleccionado.grupo_id) }}</p>
            </div>
          </div>
        </div>

        <!-- Resumen -->
        <div class="section">
          <h3>Resumen</h3>
          <div class="resumen-grid">
            <div class="resumen-card">
              <span class="label">Total Horas</span>
              <span class="value">{{ empleadoSeleccionado.resumen.totalHoras }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Horas Prestadas</span>
              <span class="value">{{ empleadoSeleccionado.resumen.horasPrestadas }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Liquidaciones Pendientes</span>
              <span class="value">{{ empleadoSeleccionado.resumen.liquidacionesPendientes }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Liquidaciones Pagadas</span>
              <span class="value">{{ empleadoSeleccionado.resumen.liquidacionesPagadas }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </LayoutShell>

  <!-- Modal para crear empleado -->
  <div v-if="showForm" class="modal-overlay" @click.self="cerrarFormulario">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ editingId ? "Modificar Empleado" : "Nuevo Empleado" }}</h3>
        <button class="btn-close" @click="cerrarFormulario">×</button>
      </div>

      <form @submit.prevent="guardarEmpleado" class="modal-form">
        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <label class="form-group">
          <span>Nombre *</span>
          <input v-model="form.nombre" type="text" placeholder="Nombre" required />
        </label>

        <label class="form-group">
          <span>Apellido *</span>
          <input v-model="form.apellido" type="text" placeholder="Apellido" required />
        </label>

        <label class="form-group">
          <span>DNI *</span>
          <input v-model="form.dni" type="text" placeholder="DNI" required />
        </label>

        <label class="form-group">
          <span>CUIT *</span>
          <input v-model="form.cuit" type="text" placeholder="CUIT" required />
        </label>

        <label class="form-group">
          <span>Fecha de nacimiento *</span>
          <input v-model="form.fecha_nacimiento" type="date" required />
        </label>

        <label class="form-group">
          <span>Dirección *</span>
          <input v-model="form.direccion" type="text" placeholder="Dirección" required />
        </label>

        <label class="form-group">
          <span>Teléfono *</span>
          <input v-model="form.telefono" type="text" placeholder="Teléfono" required />
        </label>

        <label class="form-group">
          <span>Tipo *</span>
          <select v-model="form.tipo" required>
            <option value="" disabled>Selecciona un tipo</option>
            <option v-for="tipoOption in TIPOS_CONTRATO" :key="tipoOption.value" :value="tipoOption.value">
              {{ tipoOption.label }}
            </option>
          </select>
        </label>

        <label class="form-group">
          <span>Alias *</span>
          <input v-model="form.alias" type="text" placeholder="Alias" required />
        </label>

        <label class="form-group">
          <span>Grupo *</span>
          <select v-model="form.grupo_id" required>
            <option value="">Selecciona un grupo</option>
            <option v-for="g in grupos" :key="g.id" :value="g.id">
              {{ g.nombre }}
            </option>
          </select>
        </label>

        <label class="form-group">
          <span>Valor Hora *</span>
          <input v-model.number="form.valor_hora" type="number" placeholder="0.00" step="0.01" required />
        </label>

        <div class="modal-actions">
          <button type="submit" class="btn-primary" :disabled="!esFormularioValido">
            {{ editingId ? "Guardar cambios" : "Crear Empleado" }}
          </button>
          <button type="button" class="btn-secondary" @click="cerrarFormulario">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Modal de confirmación de eliminación -->
  <div v-if="showConfirm" class="modal-overlay" @click.self="showConfirm = false">
    <div class="modal">
      <div class="modal-header">
        <h3>Confirmar eliminación</h3>
        <button class="btn-close" @click="showConfirm = false">×</button>
      </div>

      <div class="modal-form">
        <p v-if="empleadoAEliminar">
          ¿Estás seguro de que deseas eliminar a <strong>{{ empleadoAEliminar.nombre }} {{ empleadoAEliminar.apellido }}</strong>?
        </p>

        <div class="modal-actions">
          <button type="button" class="btn-primary btn-danger" @click="eliminarEmpleado">
            Eliminar
          </button>
          <button type="button" class="btn-secondary" @click="showConfirm = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.alert {
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.alert-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.filtros {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.filtros label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #d1d5db;
}

.select {
  padding: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  background: rgba(30, 41, 59, 0.5);
  color: #e5e7eb;
  font-size: 0.875rem;
}

.select:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 0.8);
}

.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(59, 130, 246, 0.3);
}

.btn-secondary {
  background: rgba(107, 114, 128, 0.5);
  color: #d1d5db;
}

.btn-secondary:hover {
  background: rgba(107, 114, 128, 0.7);
}

.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
}

.btn-info {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.btn-info:hover {
  background: rgba(59, 130, 246, 0.3);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.3);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  overflow: hidden;
}

.tabla thead {
  background: rgba(30, 41, 59, 0.8);
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
}

.tabla th {
  padding: 0.75rem 1rem;
  text-align: left;
  color: #d1d5db;
  font-weight: 500;
  font-size: 0.875rem;
}

.tabla td {
  padding: 0.75rem 1rem;
  color: #e5e7eb;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.tabla tbody tr:hover {
  background: rgba(30, 41, 59, 0.5);
}

.acciones {
  display: flex;
  gap: 0.5rem;
}

.spinner {
  text-align: center;
  color: #9ca3af;
  padding: 2rem;
}

.empty {
  text-align: center;
  color: #9ca3af;
  padding: 2rem;
}

.detalle-card {
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  padding: 2rem;
}

.detalle-header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.detalle-header h2 {
  color: #f9fafb;
  margin: 0;
}

.subtitle {
  color: #9ca3af;
  font-size: 0.875rem;
  margin: 0.25rem 0 0 0;
}

.section {
  margin-bottom: 2rem;
}

.section h3 {
  color: #d1d5db;
  font-size: 1rem;
  margin: 0 0 1rem 0;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.info-item {
  display: flex;
  flex-direction: column;
}

.info-item label {
  color: #9ca3af;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.info-item p {
  color: #e5e7eb;
  font-size: 1.125rem;
  margin: 0;
}

.resumen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.resumen-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  transition: all 0.2s ease;
}

.resumen-card:hover {
  background: rgba(30, 41, 59, 0.8);
  border-color: rgba(148, 163, 184, 0.4);
}

.resumen-card .label {
  color: #9ca3af;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.resumen-card .value {
  color: #3b82f6;
  font-size: 2rem;
  font-weight: bold;
}

/* Form styles */
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

.form-group input,
.form-group select {
  padding: 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.9375rem;
  transition: all 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  background-color: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group select option {
  background-color: #0f172a;
  color: #e2e8f0;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.modal {
  background-color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 130%;
  max-width: 530px;
  max-height: 96vh;
  overflow-y: auto;
  box-shadow: 0 40px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal button,
.modal input,
.modal select,
.modal textarea {
  font-family: inherit;
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

.btn-close:hover {
  color: #cbd5e1;
}

.modal-form {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

/* ============ ACORDEÓN ============ */
.acordeon-lista {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.acordeon-item {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.6rem;
  overflow: hidden;
  transition: border-color 0.2s;
}

.acordeon-item.expandido {
  border-color: rgba(59, 130, 246, 0.4);
}

.acordeon-fila {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.acordeon-fila:hover {
  background: rgba(30, 41, 59, 0.6);
}

.acordeon-toggle {
  flex-shrink: 0;
  width: 1.25rem;
  display: flex;
  align-items: center;
}

.flecha {
  color: #64748b;
  font-size: 0.65rem;
  transition: transform 0.2s;
}

.flecha.rotada {
  transform: rotate(90deg);
  color: #3b82f6;
}

.acordeon-datos {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.emp-nombre {
  color: #f1f5f9;
  font-weight: 600;
  font-size: 0.975rem;
}

.emp-grupo {
  color: #64748b;
  font-size: 0.8rem;
}

.acordeon-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  flex-shrink: 0;
}

.emp-dni {
  color: #94a3b8;
  font-size: 0.8rem;
}

.emp-hora {
  color: #60a5fa;
  font-size: 0.8rem;
  font-weight: 500;
}

.acordeon-acciones {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Panel expandido */
.acordeon-panel {
  border-top: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(8, 14, 30, 0.6);
  padding: 1rem 1.5rem 1.25rem;
  animation: slideDown 0.18s ease-out;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.horas-loading,
.horas-empty {
  color: #64748b;
  font-size: 0.875rem;
  padding: 0.5rem 0;
  font-style: italic;
}

.horas-tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.horas-tabla th {
  text-align: left;
  padding: 0.4rem 0.75rem;
  color: #94a3b8;
  font-weight: 500;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.3px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}

.horas-tabla td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.07);
  vertical-align: middle;
}

.horas-tabla tbody tr:last-child td {
  border-bottom: none;
}

.horas-tabla tbody tr:hover td {
  background: rgba(30, 41, 59, 0.4);
}

.fecha-col {
  color: #e2e8f0;
  font-weight: 500;
  white-space: nowrap;
}

.horas-col {
  color: #60a5fa;
  font-weight: 600;
  white-space: nowrap;
}

.detalle-col {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.registro-badge {
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.registro-badge.normal {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
}

.registro-badge.prestada {
  background: rgba(251, 191, 36, 0.15);
  color: #fde047;
}

.btn-primary {
  flex: 1;
  padding: 0.75rem;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary.btn-danger {
  background-color: #ef4444;
}

.btn-primary.btn-danger:hover:not(:disabled) {
  background-color: #dc2626;
}

.btn-secondary {
  flex: 1;
  padding: 0.75rem;
  background-color: transparent;
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background-color: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.5);
}

.input {
  padding: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  background: rgba(30, 41, 59, 0.5);
  color: #e5e7eb;
  font-size: 0.875rem;
}

.input:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 0.8);
}

/* ============ DROPDOWN MENU ============ */
.empleados-lista {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empleado-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.6rem;
  transition: all 0.2s;
}

.empleado-row:hover {
  background: rgba(30, 41, 59, 0.6);
  border-color: rgba(148, 163, 184, 0.3);
}

.empleado-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.empleado-info .emp-nombre {
  color: #f1f5f9;
  font-weight: 600;
  font-size: 1rem;
}

.empleado-info .emp-grupo {
  color: #64748b;
  font-size: 0.875rem;
}

.empleado-info .emp-dni {
  color: #94a3b8;
  font-size: 0.8rem;
}

.empleado-info .emp-hora {
  color: #60a5fa;
  font-size: 0.85rem;
  font-weight: 500;
}

.empleado-acciones {
  display: flex;
  gap: 0.75rem;
  margin-left: 1rem;
  flex-shrink: 0;
}

.btn-action {
  padding: 0.5rem 0.875rem;
  background: none;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.btn-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.btn-detail {
  color: #93c5fd;
  border-color: rgba(59, 130, 246, 0.3);
}

.btn-detail:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.5);
}

.btn-edit {
  color: #fcd34d;
  border-color: rgba(245, 158, 11, 0.35);
}

.btn-edit:hover {
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.55);
}

.btn-delete {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
}

.dropdown-menu {
  position: relative;
  margin-left: 1rem;
}

.btn-menu {
  background: none;
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #94a3b8;
  font-size: 1.25rem;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-menu:hover {
  background: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.5);
  color: #cbd5e1;
}

.dropdown-content {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.5rem;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.5rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
  min-width: 180px;
  z-index: 100;
  display: none;
  flex-direction: column;
  overflow: hidden;
}

.dropdown-menu:hover .dropdown-content {
  display: flex;
}

.dropdown-item {
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: #e5e7eb;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.dropdown-item:hover {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
}

.dropdown-item.danger {
  color: #fca5a5;
}

.dropdown-item.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fda8a8;
}
</style>
