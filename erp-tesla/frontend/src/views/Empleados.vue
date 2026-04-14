<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import { formatHoursAsClock } from "../utils/hourFormat"

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
const loadingDetalleResumen = ref(false)

// Acordeón
const expandedIds = ref(new Set())
const horasPorEmpleado = ref({})
const loadingHorasId = ref(null)

// Filtros
const filtroGrupo = ref("")
const filtroBusqueda = ref("")

const TIPOS_CONTRATO = [
  { value: "monotributista", label: "Monotributista" },
  { value: "empleado_dependiente", label: "Empleado dependiente" },
  { value: "no_corresponde", label: "No corresponde" }
]

const OPCIONES_VALOR_HORA = [
  { value: "con_valor", label: "Con valor hora" },
  { value: "sin_valor", label: "No tiene" }
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
  valor_hora: 0,
  modo_valor_hora: "con_valor"
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
  valor_hora: 0,
  modo_valor_hora: "con_valor"
})

const getTipoLabel = (tipo) => {
  const option = TIPOS_CONTRATO.find((item) => item.value === tipo)
  return option ? option.label : "-"
}

const createResumenEmpleadoVacio = () => ({
  totalHoras: 0,
  horasPrestadas: 0,
  liquidacionesPendientes: 0,
  liquidacionesPagadas: 0,
})

const roundResumenValue = (value) => {
  const numero = Number(value || 0)
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : 0
}

const getCantidadHorasRegistro = (registro = {}) => {
  const valor = registro.cantidad_horas ?? registro.horas_trabajadas ?? registro.cantidad_hora ?? registro.horas ?? 0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const formatearResumenValor = (valor) => {
  return formatHoursAsClock(valor)
}

const formatValorHora = (valorHora) => {
  const valor = Number(valorHora || 0)
  return valor > 0 ? `$${valor.toFixed(2)}/h` : "No tiene"
}

const formatFechaNacimiento = (fecha) => {
  if (!fecha) return "-"
  return String(fecha).split("T")[0]
}

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
         (form.value.modo_valor_hora === "sin_valor" || form.value.valor_hora > 0)
})

const empleadosFiltrados = computed(() => {
  const termino = filtroBusqueda.value.trim().toLowerCase()
  let resultado = empleados.value

  if (filtroGrupo.value) {
    resultado = resultado.filter(e => String(e.grupo_id) === String(filtroGrupo.value))
  }

  if (termino) {
    resultado = resultado.filter((empleado) => {
      const searchable = [
        empleado.nombre,
        empleado.apellido,
        empleado.dni,
        empleado.cuit,
        empleado.alias,
        empleado.telefono,
        getTipoLabel(empleado.tipo),
        obtenerNombreGrupo(empleado.grupo_id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return searchable.includes(termino)
    })
  }

  return [...resultado].sort((a, b) => a.apellido.localeCompare(b.apellido))
})

const empleadosConGrupo = computed(() => empleados.value.filter((empleado) => empleado.grupo_id).length)
const empleadosConValorHora = computed(() => empleados.value.filter((empleado) => Number(empleado.valor_hora || 0) > 0).length)

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
    error.value = extractApiErrorMessage(err, "Error al cargar empleados y grupos")
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
      modo_valor_hora: Number(empleado.valor_hora || 0) > 0 ? "con_valor" : "sin_valor",
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
      valor_hora: form.value.modo_valor_hora === "sin_valor"
        ? 0
        : parseFloat(form.value.valor_hora)
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
      ? extractApiErrorMessage(err, "Error al modificar empleado")
      : extractApiErrorMessage(err, "Error al crear empleado")
  }
}

const verDetalle = (empleado) => {
  const toNumber = (val) => {
    const num = Number(val)
    return Number.isFinite(num) ? num : 0
  }

  error.value = ""
  empleadoSeleccionado.value = {
    ...empleado,
    valor_hora: toNumber(empleado.valor_hora),
    resumen: createResumenEmpleadoVacio()
  }
  vistaActual.value = "detalle"
  loadingDetalleResumen.value = true

  Promise.all([
    api.getHoras(undefined, undefined, empleado.id),
    api.getLiquidaciones(undefined, undefined, empleado.id),
  ])
    .then(([horasRes, liquidacionesRes]) => {
      if (!empleadoSeleccionado.value || String(empleadoSeleccionado.value.id) !== String(empleado.id)) return

      const horas = horasRes?.data || []
      const liquidaciones = liquidacionesRes?.data || []
      const totalHoras = roundResumenValue(
        horas.reduce((sum, registro) => sum + getCantidadHorasRegistro(registro), 0)
      )
      const horasPrestadas = roundResumenValue(
        horas
          .filter((registro) => registro.es_prestada === true || String(registro.tipo || "").toLowerCase() === "prestada")
          .reduce((sum, registro) => sum + getCantidadHorasRegistro(registro), 0)
      )
      const liquidacionesPagadas = liquidaciones.filter((liquidacion) => String(liquidacion.estado || "").toLowerCase() === "pagada").length
      const liquidacionesPendientes = liquidaciones.filter((liquidacion) => String(liquidacion.estado || "").toLowerCase() !== "pagada").length

      empleadoSeleccionado.value = {
        ...empleadoSeleccionado.value,
        resumen: {
          totalHoras,
          horasPrestadas,
          liquidacionesPendientes,
          liquidacionesPagadas,
        },
      }
    })
    .catch((err) => {
      error.value = extractApiErrorMessage(err, "Error al cargar detalle del empleado")
    })
    .finally(() => {
      loadingDetalleResumen.value = false
    })
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
    error.value = extractApiErrorMessage(err, "Error al eliminar empleado")
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
    <div v-if="vistaActual === 'lista'" class="container empleados-list-view">
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <section class="empleados-topbar">
        <div class="empleados-topbar-copy">
          <span class="section-kicker">Base de personal</span>
          <h2>Gestión de empleados</h2>
        </div>
        <button class="btn btn-primary empleados-new-btn" @click="abrirFormulario">
          + Nuevo Empleado
        </button>
      </section>

      <section class="empleados-stats">
        <article class="empleado-stat-card empleado-stat-card-primary">
          <span>Total de empleados</span>
          <strong>{{ empleados.length }}</strong>
          <small>Legajos disponibles actualmente en el sistema.</small>
        </article>
        <article class="empleado-stat-card">
          <span>Con grupo</span>
          <strong>{{ empleadosConGrupo }}</strong>
          <small>Empleados asignados a un equipo de trabajo.</small>
        </article>
        <article class="empleado-stat-card empleado-stat-card-muted">
          <span>Con valor hora</span>
          <strong>{{ empleadosConValorHora }}</strong>
          <small>Registros con costo horario informado.</small>
        </article>
      </section>

      <section class="empleados-toolbar">
        <label class="empleados-search-field">
          <span>Buscar en tiempo real</span>
          <input
            v-model="filtroBusqueda"
            type="text"
            placeholder="Nombre, apellido, DNI, CUIT, alias, teléfono o grupo"
          />
        </label>

        <label class="empleados-filter-field">
          <span>Filtrar por grupo</span>
          <select v-model="filtroGrupo" class="select">
            <option value="">Todos</option>
            <option v-for="g in grupos" :key="g.id" :value="g.id">
              {{ g.nombre }}
            </option>
          </select>
        </label>

        <div class="empleados-toolbar-count">
          Mostrando {{ empleadosFiltrados.length }} de {{ empleados.length }} empleados
        </div>
      </section>

      <!-- Lista desplegable de empleados -->
      <div v-if="loading" class="spinner">Cargando...</div>
      <div v-else-if="empleados.length === 0" class="empty">
        No hay empleados registrados
      </div>
      <div v-else-if="empleadosFiltrados.length === 0" class="empty empty-search">
        No hay coincidencias para la búsqueda actual
      </div>
      <div v-else class="empleados-list-shell">
        <div class="empleados-list-header">
          <div>
            <span class="section-kicker">Listado</span>
            <h3>Empleados registrados</h3>
          </div>
        </div>

        <div class="empleados-lista">
        <div v-for="emp in empleadosFiltrados" :key="emp.id" class="empleado-row">
          <div class="empleado-info">
            <span class="emp-nombre">{{ emp.apellido }}, {{ emp.nombre }}</span>
            <span class="emp-grupo">{{ obtenerNombreGrupo(emp.grupo_id) }}</span>
            <span class="emp-dni">DNI {{ emp.dni }}</span>
            <span class="emp-hora">{{ formatValorHora(emp.valor_hora) }}</span>
          </div>
          
          <!-- Botones dentro del recuadro -->
          <div class="empleado-acciones">
            <button @click="verDetalle(emp)" class="btn-action btn-detail">
              <span class="btn-icon">📋</span>
              <span>Ver detalle</span>
            </button>
            <button @click="abrirFormulario(emp)" class="btn-action btn-edit">
              <span class="btn-icon">✎</span>
              <span>Modificar</span>
            </button>
            <button @click="confirmarEliminar(emp)" class="btn-action btn-delete">
              <span class="btn-icon">×</span>
              <span>Eliminar</span>
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>

    <!-- DETALLE VIEW -->
    <div v-else-if="vistaActual === 'detalle'" class="container">
      <button class="btn btn-secondary detail-back-btn" @click="volverALista">← Volver a lista</button>

      <div v-if="empleadoSeleccionado" class="detalle-card">
        <div class="detalle-header">
          <div class="detalle-hero">
            <div class="detalle-avatar">
              {{ String(empleadoSeleccionado.nombre || "").slice(0, 1) }}{{ String(empleadoSeleccionado.apellido || "").slice(0, 1) }}
            </div>
            <div class="detalle-hero-copy">
              <span class="detalle-kicker">Ficha de empleado</span>
              <h2>{{ empleadoSeleccionado.nombre }} {{ empleadoSeleccionado.apellido }}</h2>
              <div class="detalle-chips">
                <span class="detalle-chip detalle-chip-grupo">{{ obtenerNombreGrupo(empleadoSeleccionado.grupo_id) }}</span>
                <span class="detalle-chip">{{ getTipoLabel(empleadoSeleccionado.tipo) }}</span>
                <span class="detalle-chip">{{ formatValorHora(empleadoSeleccionado.valor_hora) }}</span>
              </div>
            </div>
          </div>
          <button class="btn-action btn-edit detail-edit-btn" @click="abrirFormulario(empleadoSeleccionado)">
            <span class="btn-icon">✎</span>
            <span>Modificar</span>
          </button>
        </div>

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
              <p>{{ formatFechaNacimiento(empleadoSeleccionado.fecha_nacimiento) }}</p>
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
              <p>{{ getTipoLabel(empleadoSeleccionado.tipo) }}</p>
            </div>
            <div class="info-item">
              <label>Alias</label>
              <p class="info-highlight">{{ empleadoSeleccionado.alias || "-" }}</p>
            </div>
            <div class="info-item">
              <label>Valor Hora</label>
              <p class="info-highlight">{{ formatValorHora(empleadoSeleccionado.valor_hora) }}</p>
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
              <span class="value">{{ loadingDetalleResumen ? "..." : formatearResumenValor(empleadoSeleccionado.resumen.totalHoras) }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Horas Prestadas</span>
              <span class="value">{{ loadingDetalleResumen ? "..." : formatearResumenValor(empleadoSeleccionado.resumen.horasPrestadas) }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Liquidaciones Pendientes</span>
              <span class="value">{{ loadingDetalleResumen ? "..." : formatearResumenValor(empleadoSeleccionado.resumen.liquidacionesPendientes) }}</span>
            </div>
            <div class="resumen-card">
              <span class="label">Liquidaciones Pagadas</span>
              <span class="value">{{ loadingDetalleResumen ? "..." : formatearResumenValor(empleadoSeleccionado.resumen.liquidacionesPagadas) }}</span>
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
        <div class="modal-header-copy">
          <span class="section-kicker modal-kicker">Legajo interno</span>
          <h3>{{ editingId ? "Modificar Empleado" : "Nuevo Empleado" }}</h3>
          <p>Completá los datos principales del empleado para dejar el registro listo dentro de la nómina.</p>
        </div>
        <button class="btn-close" @click="cerrarFormulario">×</button>
      </div>

      <form @submit.prevent="guardarEmpleado" class="modal-form">
        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <div class="modal-form-grid">

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
          <select v-model="form.modo_valor_hora">
            <option v-for="opcion in OPCIONES_VALOR_HORA" :key="opcion.value" :value="opcion.value">
              {{ opcion.label }}
            </option>
          </select>
        </label>

        <label v-if="form.modo_valor_hora === 'con_valor'" class="form-group">
          <span>Monto por hora *</span>
          <input v-model.number="form.valor_hora" type="number" placeholder="0.00" step="0.01" min="0.01" required />
        </label>

        </div>

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

.empleados-list-view {
  gap: 1.6rem;
}

.section-kicker {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #7dd3fc;
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

.empleados-topbar,
.empleados-toolbar,
.empleados-list-shell,
.empleado-stat-card,
.empty {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.45);
}

.empleados-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.empleados-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.empleados-topbar-copy h2,
.empleados-list-header h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.empleados-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 62ch;
  line-height: 1.45;
}

.empleados-new-btn {
  white-space: nowrap;
}

.empleados-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.35rem;
}

.empleado-stat-card {
  padding: 1.15rem 1.2rem;
  border-radius: 0.95rem;
  display: grid;
  gap: 0.4rem;
}

.empleado-stat-card span {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.empleado-stat-card strong {
  font-size: 1.55rem;
  color: #f8fafc;
}

.empleado-stat-card small {
  color: #94a3b8;
  line-height: 1.35;
}

.empleado-stat-card-primary {
  border-color: rgba(96, 165, 250, 0.28);
}

.empleado-stat-card-muted strong {
  color: #cbd5e1;
}

.empleados-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.15rem;
  flex-wrap: wrap;
  padding: 1.1rem 1.2rem;
  border-radius: 1rem;
}

.empleados-search-field,
.empleados-filter-field {
  display: grid;
  gap: 0.45rem;
}

.empleados-search-field {
  flex: 1 1 360px;
}

.empleados-filter-field {
  min-width: min(100%, 250px);
}

.empleados-search-field span,
.empleados-filter-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.empleados-search-field input,
.select {
  width: 100%;
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  background: rgba(15, 23, 42, 0.86);
  color: #e5e7eb;
  font-size: 0.95rem;
}

.empleados-search-field input:focus,
.select:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.empleados-toolbar-count {
  color: #94a3b8;
  font-size: 0.88rem;
  white-space: nowrap;
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
  padding: 3rem 2rem;
  border-radius: 1rem;
}

.empleados-list-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.empleados-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.15rem 0.75rem;
}

.detalle-card {
  position: relative;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(12, 18, 34, 0.96), rgba(7, 11, 24, 0.96));
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: 0 24px 60px rgba(2, 6, 23, 0.45);
}

.detalle-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.detalle-header h2 {
  color: #f9fafb;
  margin: 0;
  font-size: 2rem;
  line-height: 1.05;
}

.subtitle {
  color: #9ca3af;
  font-size: 0.875rem;
  margin: 0.25rem 0 0 0;
}

.detail-back-btn {
  align-self: flex-start;
  padding: 0.8rem 1.25rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(8, 12, 24, 0.75);
}

.detalle-hero {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.detalle-avatar {
  width: 4rem;
  height: 4rem;
  border-radius: 1.1rem;
  display: grid;
  place-items: center;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #eff6ff;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.9), rgba(15, 23, 42, 0.95));
  border: 1px solid rgba(96, 165, 250, 0.35);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.detalle-hero-copy {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.detalle-kicker {
  color: #93c5fd;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.72rem;
  font-weight: 700;
}

.detalle-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.detalle-chip {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
  font-size: 0.8rem;
  font-weight: 600;
}

.detalle-chip-grupo {
  color: #dbeafe;
  border-color: rgba(96, 165, 250, 0.28);
  background: rgba(30, 64, 175, 0.18);
}

.detail-edit-btn {
  align-self: center;
}

.section {
  margin-bottom: 2rem;
}

.section h3 {
  color: #f8fafc;
  font-size: 1.05rem;
  margin: 0 0 1rem 0;
  letter-spacing: 0.01em;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem 1.05rem;
  border-radius: 0.9rem;
  background: rgba(15, 23, 42, 0.52);
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.info-item label {
  color: #9ca3af;
  font-size: 0.78rem;
  margin-bottom: 0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.info-item p {
  color: #f8fafc;
  font-size: 1.08rem;
  font-weight: 600;
  margin: 0;
}

.info-highlight {
  color: #93c5fd;
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
  padding: 1.55rem;
  min-height: 132px;
  background: linear-gradient(180deg, rgba(28, 39, 57, 0.72), rgba(18, 25, 41, 0.88));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.9rem;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  transition: all 0.2s ease;
}

.resumen-card:hover {
  transform: translateY(-2px);
  background: linear-gradient(180deg, rgba(34, 48, 69, 0.86), rgba(19, 27, 43, 0.96));
  border-color: rgba(96, 165, 250, 0.22);
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
  gap: 0.48rem;
}

.form-group span {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.form-group input,
.form-group select {
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  background-color: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 0.8rem;
  color: #e2e8f0;
  font-size: 0.94rem;
  transition: all 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: rgba(96, 165, 250, 0.9);
  background-color: rgba(15, 23, 42, 0.98);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
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
  padding: 1.5rem;
  background: rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(10px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.modal {
  width: min(860px, 100%);
  max-height: min(88vh, 920px);
  overflow-y: auto;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 1.15rem;
  box-shadow: 0 34px 80px rgba(2, 6, 23, 0.58);
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
  font-size: 2rem;
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
  padding: 1rem 1.15rem;
  background: linear-gradient(180deg, rgba(14, 20, 36, 0.9), rgba(10, 15, 28, 0.88));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.95rem;
  box-shadow: 0 16px 35px rgba(2, 6, 23, 0.18);
  transition: all 0.2s;
}

.empleado-row:hover {
  transform: translateY(-1px);
  background: linear-gradient(180deg, rgba(18, 27, 47, 0.94), rgba(12, 18, 31, 0.92));
  border-color: rgba(96, 165, 250, 0.2);
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
  gap: 0.55rem;
  margin-left: 1rem;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.btn-action {
  min-height: 2.35rem;
  padding: 0.62rem 1.05rem;
  border: 1px solid transparent;
  border-radius: 0.55rem;
  font-size: 0.84rem;
  font-weight: 600;
  letter-spacing: 0;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  display: flex;
  gap: 0.48rem;
  align-items: center;
  justify-content: center;
  box-shadow: none;
}

.btn-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(2, 6, 23, 0.16);
}

.btn-icon {
  width: auto;
  height: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.76rem;
  border-radius: 0;
  background: transparent;
  flex-shrink: 0;
}

.btn-detail {
  padding: 0.4rem 1rem;
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-detail:hover {
  background: rgba(20, 83, 45, 0.68);
  border-color: rgba(74, 222, 128, 0.42);
}


.btn-edit {
  padding: 0.4rem 1rem;
  background-color: rgba(30, 64, 175, 0.42);
  color: #bfdbfe;

  border-color: rgba(96, 165, 250, 0.36);
  background: rgba(30, 64, 175, 0.42);

  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-edit:hover {
  background: rgba(30, 64, 175, 0.58);
  border-color: rgba(147, 197, 253, 0.5);
}

.btn-delete {
  padding: 0.4rem 1rem;
  background-color: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.26);
  background: rgba(127, 29, 29, 0.42);
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-delete:hover {
  background: rgba(153, 27, 27, 0.58);
  border-color: rgba(252, 165, 165, 0.42);
}

@media (max-width: 900px) {
  .empleados-topbar,
  .empleados-toolbar,
  .detalle-header {
    flex-direction: column;
    align-items: stretch;
  }

  .empleados-toolbar-count {
    white-space: normal;
  }

  .detail-edit-btn {
    align-self: flex-start;
  }
}

@media (max-width: 720px) {
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

  .modal-actions {
    flex-direction: column;
  }

  .empleado-row {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }

  .empleado-acciones {
    margin-left: 0;
    width: 100%;
    flex-wrap: wrap;
  }

  .btn-action {
    flex: 1 1 140px;
    justify-content: center;
  }

  .detalle-card {
    padding: 1.3rem;
  }

  .detalle-hero {
    align-items: flex-start;
  }

  .detalle-header h2 {
    font-size: 1.55rem;
  }
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
