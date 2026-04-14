<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import { formatHoursAsClock } from "../utils/hourFormat"

// Estado
const obras = ref([])
const clientes = ref([])
const grupos = ref([])
const horas = ref([])
const presupuestos = ref([])
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const editingId = ref(null)
const vistaActual = ref("lista") // "lista" o "detalle"
const obraSeleccionada = ref(null)
const filtroCliente = ref("")
const filtroBusqueda = ref("")

// Formulario
const form = ref({
  nombre: "",
  cliente_id: "",
  grupo_id: "",
  estado: "activa",
  fecha_inicio: ""
})

// Cargar obras
const loadObras = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getObras()
    obras.value = res.data || []
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al cargar obras")
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Cargar clientes para el dropdown
const loadClientes = async () => {
  try {
    const res = await api.getClientes()
    clientes.value = res.data || []
  } catch (err) {
    console.error("Error al cargar clientes:", err)
  }
}

// Cargar grupos para el dropdown
const loadGrupos = async () => {
  try {
    const res = await api.getGrupos()
    grupos.value = res.data || []
  } catch (err) {
    console.error("Error al cargar grupos:", err)
  }
}

// Ver detalle de obra
const verDetalle = async (obra) => {
  obraSeleccionada.value = obra
  vistaActual.value = "detalle"
  
  // Cargar horas y presupuestos de la obra
  loading.value = true
  try {
    const [resHoras, resPresupuestos] = await Promise.all([
      api.getHoras(undefined, undefined, undefined, obra.id),
      api.getPresupuestos(),
    ])
    horas.value = resHoras.data || []
    presupuestos.value = (resPresupuestos.data || []).filter((p) => String(p.obra_id) === String(obra.id))
  } catch (err) {
    console.error("Error al cargar detalle de la obra:", err)
    horas.value = []
    presupuestos.value = []
  } finally {
    loading.value = false
  }
}

// Volver a la lista
const volverALista = () => {
  vistaActual.value = "lista"
  obraSeleccionada.value = null
  horas.value = []
  presupuestos.value = []
}

// Abrir formulario
const openForm = (obra = null) => {
  if (obra) {
    editingId.value = obra.id
    form.value = {
      nombre: obra.nombre,
      cliente_id: obra.cliente_id,
      grupo_id: obra.grupo_id,
      estado: obra.estado,
      fecha_inicio: obra.fecha_inicio
    }
  } else {
    editingId.value = null
    form.value = {
      nombre: "",
      cliente_id: "",
      grupo_id: "",
      estado: "activa",
      fecha_inicio: ""
    }
  }
  showForm.value = true
}

// Cerrar formulario
const closeForm = () => {
  showForm.value = false
  editingId.value = null
  form.value = {
    nombre: "",
    cliente_id: "",
    grupo_id: "",
    estado: "activa",
    fecha_inicio: ""
  }
}

// Guardar obra
const saveObra = async () => {
  error.value = ""
  if (!form.value.nombre || !form.value.cliente_id || !form.value.grupo_id) {
    error.value = "Nombre, cliente y grupo son obligatorios"
    return
  }

  loading.value = true
  try {
    if (editingId.value) {
      await api.updateObra(editingId.value, form.value)
    } else {
      await api.createObra(form.value)
    }
    await loadObras()
    
    // Si estamos viendo la ficha de la obra editada, actualizarla
    if (obraSeleccionada.value && editingId.value === obraSeleccionada.value.id) {
      obraSeleccionada.value = { ...obraSeleccionada.value, ...form.value }
    }
    
    closeForm()
  } catch (err) {
    error.value = editingId.value
      ? extractApiErrorMessage(err, "Error al actualizar obra")
      : extractApiErrorMessage(err, "Error al crear obra")
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Eliminar obra
const deleteObra = async (id) => {
  if (!confirm("¿Está seguro que desea eliminar esta obra?")) return

  loading.value = true
  try {
    await api.deleteObra(id)
    await loadObras()
    
    // Si estamos viendo la ficha de la obra eliminada, volver a la lista
    if (obraSeleccionada.value && obraSeleccionada.value.id === id) {
      volverALista()
    }
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al eliminar obra")
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Cambiar estado de obra
const cambiarEstado = async (id, nuevoEstado) => {
  try {
    await api.updateObraEstado(id, nuevoEstado)
    await loadObras()
    
    if (obraSeleccionada.value && obraSeleccionada.value.id === id) {
      obraSeleccionada.value.estado = nuevoEstado
    }
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al cambiar estado de la obra")
    console.error(err)
  }
}

// Calculado: total de horas de la obra
const totalHorasObra = computed(() => {
  return horas.value.reduce((sum, h) => {
    const horasNum = Number(h?.cantidad_horas ?? h?.horas_trabajadas ?? 0)
    return sum + (Number.isFinite(horasNum) ? horasNum : 0)
  }, 0)
})

// Obras filtradas por cliente (excluyendo obras administrativas)
const ADMIN_REGEX = /admin/i

const obrasFiltradas = computed(() => {
  const termino = filtroBusqueda.value.trim().toLowerCase()

  const lista = filtroCliente.value
    ? obras.value.filter((o) => String(o.cliente_id) === String(filtroCliente.value))
    : obras.value

  return lista.filter((o) => {
    if (ADMIN_REGEX.test(String(o.nombre || ""))) return false
    const grupo = grupos.value.find((g) => g.id === o.grupo_id)

    if (ADMIN_REGEX.test(String(grupo?.nombre || ""))) return false

    if (!termino) return true

    const cliente = clientes.value.find((c) => c.id === o.cliente_id)
    const searchable = [
      o.nombre,
      o.estado,
      cliente?.empresa,
      cliente?.razon_social,
      grupo?.nombre,
      o.fecha_inicio,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    return searchable.includes(termino)
  })
})

const obrasActivas = computed(() => obrasFiltradas.value.filter((o) => o.estado === "activa"))
const obrasFinalizadas = computed(() => obrasFiltradas.value.filter((o) => o.estado === "finalizada"))
const obrasConInicio = computed(() => obrasFiltradas.value.filter((o) => o.fecha_inicio))

// Obtener nombre del cliente
const getNombreCliente = (clienteId) => {
  const cliente = clientes.value.find((c) => c.id === clienteId)
  return cliente ? (cliente.empresa || cliente.razon_social) : "-"
}

// Obtener nombre del grupo
const getNombreGrupo = (grupoId) => {
  const grupo = grupos.value.find((g) => g.id === grupoId)
  return grupo ? grupo.nombre : "-"
}

// Formatear fecha
const formatearFecha = (fecha) => {
  if (!fecha) return "-"
  return new Date(fecha).toLocaleDateString("es-AR")
}

const formatearMonto = (valor) => {
  const numero = Number(valor) || 0
  return numero.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatearHoras = (valor) => {
  return formatHoursAsClock(valor)
}

onMounted(async () => {
  await Promise.all([loadObras(), loadClientes(), loadGrupos()])
  socket.on('obras:changed', loadObras)
  socket.on('clientes:changed', loadClientes)
  socket.on('grupos:changed', loadGrupos)
})
onUnmounted(() => {
  socket.off('obras:changed', loadObras)
  socket.off('clientes:changed', loadClientes)
  socket.off('grupos:changed', loadGrupos)
})
</script>

<template>
  <LayoutShell
    title="Obras"
    subtitle="Administración de obras y sus proyectos"
  >
    <div class="obras-container">
      <!-- VISTA: LISTA DE OBRAS -->
      <div v-if="vistaActual === 'lista'" class="obras-list-view">
        <section class="obras-topbar">
          <div class="obras-topbar-copy">
            <span class="section-kicker">Base operativa</span>
            <h2>Gestión de obras</h2>
          </div>
          <button class="btn-primary obras-new-btn" @click="openForm()">+ Nueva obra</button>
        </section>

        <section class="obras-stats">
          <article class="obras-stat-card obras-stat-card-active">
            <span>Total visibles</span>
            <strong>{{ obrasFiltradas.length }}</strong>
            <small>Obras disponibles según los filtros actuales.</small>
          </article>
          <article class="obras-stat-card">
            <span>Activas</span>
            <strong>{{ obrasActivas.length }}</strong>
            <small>Frentes en ejecución o todavía abiertos.</small>
          </article>
          <article class="obras-stat-card obras-stat-card-muted">
            <span>Finalizadas</span>
            <strong>{{ obrasFinalizadas.length }}</strong>
            <small>Obras cerradas y listas para consulta histórica.</small>
          </article>
          <article class="obras-stat-card">
            <span>Con inicio cargado</span>
            <strong>{{ obrasConInicio.length }}</strong>
            <small>Registros con fecha de arranque ya documentada.</small>
          </article>
        </section>

        <section class="obras-toolbar">
          <label class="obras-search-field">
            <span>Buscar en tiempo real</span>
            <input
              v-model="filtroBusqueda"
              type="text"
              placeholder="Nombre de obra, cliente, grupo, estado o fecha"
            />
          </label>

          <label class="obras-filter-field">
            <span>Filtrar por cliente</span>
            <select v-model="filtroCliente" class="filtro-cliente">
              <option value="">Todos los clientes</option>
              <option v-for="c in clientes" :key="c.id" :value="c.id">
                {{ c.empresa || c.razon_social }}
              </option>
            </select>
          </label>

          <div class="obras-toolbar-count">
            Mostrando {{ obrasFiltradas.length }} obra<span v-if="obrasFiltradas.length !== 1">s</span>
          </div>
        </section>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">{{ error }}</div>

        <!-- Cargando -->
        <div v-if="loading" class="loading">Cargando...</div>

        <template v-if="!loading">
          <!-- OBRAS ACTIVAS -->
          <section class="seccion-obras obras-table-shell">
            <div class="obras-table-header-row">
              <div>
                <span class="section-kicker">Seguimiento</span>
                <h3 class="seccion-titulo activas">Obras activas <span class="badge-count">{{ obrasActivas.length }}</span></h3>
              </div>
            </div>
            <div v-if="obrasActivas.length > 0" class="obras-table">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Cliente</th>
                    <th>Grupo</th>
                    <th>Fecha Inicio</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="obra in obrasActivas" :key="obra.id">
                    <td><strong>{{ obra.nombre }}</strong></td>
                    <td>{{ getNombreCliente(obra.cliente_id) }}</td>
                    <td>{{ getNombreGrupo(obra.grupo_id) }}</td>
                    <td>{{ formatearFecha(obra.fecha_inicio) }}</td>
                    <td>
                      <button class="btn-detalle" @click="verDetalle(obra)">📋 Ver detalle</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="empty-seccion">No hay obras activas</div>
          </section>

          <!-- OBRAS FINALIZADAS -->
          <section class="seccion-obras obras-table-shell">
            <div class="obras-table-header-row">
              <div>
                <span class="section-kicker">Historial</span>
                <h3 class="seccion-titulo finalizadas">Obras finalizadas <span class="badge-count">{{ obrasFinalizadas.length }}</span></h3>
              </div>
            </div>
            <div v-if="obrasFinalizadas.length > 0" class="obras-table">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Cliente</th>
                    <th>Grupo</th>
                    <th>Fecha Inicio</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="obra in obrasFinalizadas" :key="obra.id">
                    <td><strong>{{ obra.nombre }}</strong></td>
                    <td>{{ getNombreCliente(obra.cliente_id) }}</td>
                    <td>{{ getNombreGrupo(obra.grupo_id) }}</td>
                    <td>{{ formatearFecha(obra.fecha_inicio) }}</td>
                    <td>
                      <button class="btn-detalle" @click="verDetalle(obra)">📋 Ver detalle</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="empty-seccion">No hay obras finalizadas</div>
          </section>

          <div v-if="obras.length > 0 && obrasFiltradas.length === 0" class="empty-state empty-state-search">
            <p>No hay coincidencias para la búsqueda o el cliente seleccionado</p>
            <button class="btn-secondary" @click="filtroBusqueda = ''; filtroCliente = ''">
              Limpiar filtros
            </button>
          </div>
        </template>
      </div>

      <!-- VISTA: DETALLE DE OBRA -->
      <div v-if="vistaActual === 'detalle' && obraSeleccionada" class="detalle-container">
        <!-- Encabezado con botón volver -->
        <div class="detalle-header">
          <button class="btn-volver" @click="volverALista">
            ← Volver a la lista
          </button>
          <div class="detalle-acciones">
            <button class="btn-edit" @click="openForm(obraSeleccionada)">
              ✏️ Editar
            </button>
            <button
              v-if="obraSeleccionada.estado === 'activa'"
              class="btn-status"
              @click="cambiarEstado(obraSeleccionada.id, 'finalizada')"
            >
              ✓ Finalizar
            </button>
            <button
              v-else
              class="btn-status-reopen"
              @click="cambiarEstado(obraSeleccionada.id, 'activa')"
            >
              ↻ Reabrir
            </button>
            <button class="btn-delete" @click="deleteObra(obraSeleccionada.id)">
              🗑️ Eliminar
            </button>
          </div>
        </div>

        <!-- Información general -->
        <div class="detalle-seccion datos-principales">
          <h2>{{ obraSeleccionada.nombre }}</h2>
          <div class="datos-grid">
            <div class="dato-item">
              <span class="dato-label">Cliente:</span>
              <span class="dato-valor">{{ getNombreCliente(obraSeleccionada.cliente_id) }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Grupo:</span>
              <span class="dato-valor">{{ getNombreGrupo(obraSeleccionada.grupo_id) }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Estado:</span>
              <span :class="['badge', `badge-${obraSeleccionada.estado}`]">
                {{ obraSeleccionada.estado === "activa" ? "Activa" : "Finalizada" }}
              </span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Fecha inicio:</span>
              <span class="dato-valor">{{ formatearFecha(obraSeleccionada.fecha_inicio) }}</span>
            </div>
          </div>
        </div>

        <!-- Total acumulado de horas -->
        <div class="detalle-seccion resumen-horas">
          <h3>📊 Total acumulado de horas</h3>
          <div class="total-horas">
            <div class="horas-stat">
              <span class="horas-label">Horas totales:</span>
              <span class="horas-value">{{ formatearHoras(totalHorasObra) }}</span>
            </div>
            <div class="horas-stat">
              <span class="horas-label">Registro de horas:</span>
              <span class="horas-value">{{ horas.length }}</span>
            </div>
          </div>
        </div>

        <!-- Horas trabajadas -->
        <div class="detalle-seccion">
          <h3>⏱️ Horas trabajadas</h3>
          <div v-if="horas.length > 0" class="horas-lista">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Horas</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="hora in horas" :key="hora.id">
                  <td>{{ formatearFecha(hora.fecha) }}</td>
                  <td>{{ formatearHoras(hora.cantidad_horas ?? hora.horas_trabajadas) }}</td>
                  <td>
                    <span v-if="hora.es_prestada" class="badge badge-prestada">
                      Prestada
                    </span>
                    <span v-else class="badge badge-normal">Normal</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">No hay registros de horas para esta obra</p>
        </div>

        <div class="detalle-seccion">
          <h3>📄 Presupuestos asociados</h3>
          <div v-if="presupuestos.length > 0" class="horas-lista">
            <table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="presupuesto in presupuestos" :key="presupuesto.id">
                  <td>#{{ presupuesto.numero }}</td>
                  <td>{{ formatearFecha(presupuesto.fecha) }}</td>
                  <td>
                    <span :class="['badge', `badge-${String(presupuesto.estado || '').toLowerCase()}`]">
                      {{ presupuesto.estado || '-' }}
                    </span>
                  </td>
                  <td>$ {{ formatearMonto(presupuesto.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">No hay presupuestos asociados a esta obra</p>
        </div>

        <!-- Certificados emitidos -->
        <div class="detalle-seccion">
          <h3>📄 Certificados emitidos</h3>
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Certificados</p>
        </div>

        <!-- Facturas vinculadas -->
        <div class="detalle-seccion">
          <h3>🧾 Facturas vinculadas</h3>
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Facturas</p>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading-overlay">
          Cargando datos...
        </div>
      </div>

      <!-- Modal formulario -->
      <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Ficha de obra</span>
              <h3>{{ editingId ? "Editar obra" : "Nueva obra" }}</h3>
              <p>Definí los datos base del proyecto para dejarlo listo dentro del circuito operativo.</p>
            </div>
            <button class="btn-close" @click="closeForm">×</button>
          </div>

          <form @submit.prevent="saveObra" class="modal-form">
            <div class="modal-form-grid">
            <label class="form-group form-group-full">
              <span>Nombre *</span>
              <input
                v-model="form.nombre"
                type="text"
                placeholder="Descripción de la obra"
                required
              />
            </label>

            <label class="form-group">
              <span>Cliente *</span>
              <select v-model="form.cliente_id" required>
                <option value="">Seleccionar cliente...</option>
                <option v-for="cliente in clientes" :key="cliente.id" :value="cliente.id">
                  {{ cliente.empresa || cliente.razon_social }}
                </option>
              </select>
            </label>

            <label class="form-group">
              <span>Grupo de trabajo *</span>
              <select v-model="form.grupo_id" required>
                <option value="">Seleccionar grupo...</option>
                <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                  {{ grupo.nombre }}
                </option>
              </select>
            </label>

            <label class="form-group">
              <span>Estado</span>
              <select v-model="form.estado">
                <option value="activa">Activa</option>
                <option value="finalizada">Finalizada</option>
              </select>
            </label>

            <label class="form-group">
              <span>Fecha de inicio</span>
              <input v-model="form.fecha_inicio" type="date" />
            </label>
            </div>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Guardando..." : "Guardar obra" }}
              </button>
              <button type="button" class="btn-secondary" @click="closeForm">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.obras-container {
  padding: 1.5rem;
  display: grid;
  gap: 1.75rem;
}

.obras-list-view {
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

.obras-topbar,
.obras-toolbar,
.obras-table-shell,
.obras-stat-card,
.empty-state,
.empty-seccion {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.45);
}

.obras-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.obras-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.obras-topbar-copy h2,
.obras-table-header-row h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.obras-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 60ch;
  line-height: 1.45;
}

.obras-new-btn {
  white-space: nowrap;
}

.obras-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.35rem;
}

.obras-stat-card {
  padding: 1.15rem 1.2rem;
  border-radius: 0.95rem;
  display: grid;
  gap: 0.4rem;
}

.obras-stat-card span {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.obras-stat-card strong {
  font-size: 1.55rem;
  color: #f8fafc;
}

.obras-stat-card small {
  color: #94a3b8;
  line-height: 1.35;
}

.obras-stat-card-active {
  border-color: rgba(96, 165, 250, 0.28);
}

.obras-stat-card-muted strong {
  color: #cbd5e1;
}

.obras-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.15rem;
  flex-wrap: wrap;
  padding: 1.1rem 1.2rem;
  border-radius: 1rem;
}

.obras-search-field,
.obras-filter-field {
  display: grid;
  gap: 0.45rem;
}

.obras-search-field {
  flex: 1 1 320px;
}

.obras-filter-field {
  min-width: min(100%, 260px);
}

.obras-search-field span,
.obras-filter-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.obras-search-field input,
.filtro-cliente {
  width: 100%;
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  background-color: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.obras-search-field input:focus,
.filtro-cliente:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.obras-toolbar-count {
  color: #94a3b8;
  font-size: 0.88rem;
  white-space: nowrap;
}

.seccion-obras {
  margin-bottom: 0;
}

.seccion-titulo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  padding: 0;
  border-bottom: 0;
}

.seccion-titulo.activas { color: #86efac; }
.seccion-titulo.finalizadas { color: #94a3b8; }

.badge-count {
  background-color: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.6rem;
  border-radius: 9999px;
}

.empty-seccion {
  padding: 1rem 1.25rem 1.2rem;
  border-radius: 0.85rem;
  color: #64748b;
  font-size: 0.875rem;
  margin: 0 1rem 1rem;
}

.error-alert {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.obras-table {
  overflow-x: auto;
  padding: 0 1rem 1rem;
}

.obras-table-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.obras-table-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.15rem 0.75rem;
}

.obras-table-header-row h3 {
  font-size: 1.1rem;
}

.btn-detalle {
  padding: 0.4rem 0.8rem;
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-detalle:hover {
  background-color: rgba(34, 197, 94, 0.3)  ;
}

table {
  width: 100%;
  border-collapse: collapse;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.85rem;
  overflow: hidden;
}

thead {
  background-color: rgba(30, 41, 59, 0.8);
  border-bottom: 2px solid rgba(148, 163, 184, 0.3);
}

th {
  padding: 1rem;
  text-align: left;
  font-weight: 600;
  color: #cbd5e1;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

tbody tr {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background-color 0.2s;
}

tbody tr:hover {
  background-color: rgba(148, 163, 184, 0.05);
}

td {
  padding: 1rem;
  color: #cbd5e1;
  font-size: 0.9375rem;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-activa {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.badge-finalizada {
  background-color: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}

.acciones {
  display: flex;
  gap: 0.5rem;
}

.btn-edit,
.btn-status,
.btn-status-reopen {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-edit {
  background-color: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.btn-edit:hover {
  background-color: rgba(59, 130, 246, 0.3);
}

.btn-status {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.btn-status:hover {
  background-color: rgba(239, 68, 68, 0.3);
}

.btn-status-reopen {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.btn-status-reopen:hover {
  background-color: rgba(34, 197, 94, 0.3);
}

.empty-state {
  text-align: center;
  padding: 3rem 2rem;
  border-radius: 1rem;
  color: #94a3b8;
}

.empty-state p {
  margin-bottom: 1.5rem;
  font-size: 1.125rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
}

/* Detalle de obra */
.detalle-container {
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detalle-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.btn-volver {
  padding: 0.75rem 1.5rem;
  background-color: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  border: none;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-volver:hover {
  background-color: rgba(148, 163, 184, 0.3);
}

.detalle-acciones {
  display: flex;
  gap: 0.75rem;
}

.detalle-acciones .btn-edit,
.detalle-acciones .btn-delete,
.detalle-acciones .btn-status,
.detalle-acciones .btn-status-reopen {
  padding: 0.75rem 1.25rem;
  font-size: 0.875rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.detalle-acciones .btn-edit {
  background-color: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.detalle-acciones .btn-edit:hover {
  background-color: rgba(59, 130, 246, 0.3);
}

.detalle-acciones .btn-delete {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.detalle-acciones .btn-delete:hover {
  background-color: rgba(239, 68, 68, 0.3);
}

.detalle-acciones .btn-status {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.detalle-acciones .btn-status:hover {
  background-color: rgba(239, 68, 68, 0.3);
}

.detalle-acciones .btn-status-reopen {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.detalle-acciones .btn-status-reopen:hover {
  background-color: rgba(34, 197, 94, 0.3);
}

.detalle-seccion {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
}

.detalle-seccion h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #e2e8f0;
  font-size: 1.125rem;
  font-weight: 600;
}

.datos-principales {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(15, 23, 42, 0.6));
  border-color: rgba(59, 130, 246, 0.3);
}

.datos-principales h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #f9fafb;
  font-size: 1.75rem;
  font-weight: 700;
}

.datos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 1.5rem;
}

.dato-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dato-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dato-valor {
  font-size: 1rem;
  color: #e2e8f0;
  font-weight: 500;
}

.resumen-horas {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(15, 23, 42, 0.6));
  border-color: rgba(34, 197, 94, 0.3);
}

.total-horas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.horas-stat {
  padding: 1.25rem;
  background-color: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: center;
}

.horas-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
  text-transform: uppercase;
}

.horas-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: #86efac;
}

.horas-lista {
  overflow-x: auto;
}

.horas-lista table {
  width: 100%;
  margin-bottom: 1rem;
}

.sin-datos {
  color: #94a3b8;
  font-style: italic;
  text-align: center;
  padding: 1rem;
}

.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 1.5rem 2rem;
  background-color: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.5rem;
  color: #cbd5e1;
  font-weight: 500;
}

.empty-state {
  text-align: center;
  padding: 3rem 2rem;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #94a3b8;
}

.empty-state p {
  margin-bottom: 1.5rem;
  font-size: 1.125rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: #94a3b8;
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
}

.modal {
  width: min(760px, 100%);
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
  line-height: 1;
  cursor: pointer;
  padding: 0;
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

@media (max-width: 760px) {
  .obras-topbar,
  .obras-toolbar,
  .detalle-header {
    flex-direction: column;
    align-items: stretch;
  }

  .obras-toolbar-count {
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
  .detalle-acciones {
    flex-direction: column;
  }
}
</style>

