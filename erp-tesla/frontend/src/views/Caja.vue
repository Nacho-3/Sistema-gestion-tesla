<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

const movimientos = ref([])
const vistaActual = ref("lista") // "lista" o "detalle"
const movimientoSeleccionado = ref(null)
const totales = ref({})
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const showConfirm = ref(false)
const movimientoAEliminar = ref(null)
const editandoMovimientoId = ref(null)
const generandoPdf = ref(false)
const generandoPdfDetalle = ref(false)

// Filtros
const filtroFechaInicio = ref("")
const filtroFechaFin = ref("")
const filtroTipo = ref("")

// Formulario
const form = ref({
  fecha: new Date().toISOString().split('T')[0],
  tipo: "ingreso",
  detalle: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    cheque: 0,
    echeq: 0,
    retencion: 0
  }
})

const mediosDePago = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "echeq", label: "Echeq" },
  { id: "retencion", label: "Retención" },
  { id: "cheque", label: "Cheque" }
]

const esFormularioValido = computed(() => {
  if (!form.value.fecha || !form.value.detalle || !form.value.monto_total || form.value.monto_total <= 0) {
    return false
  }

  const sumaDesglose = Object.values(form.value.desglose).reduce((sum, val) => sum + parseFloat(val || 0), 0)
  return Math.abs(sumaDesglose - form.value.monto_total) < 0.01
})

const tieneErrorDesglose = computed(() => {
  const sumaDesglose = Object.values(form.value.desglose).reduce((sum, val) => sum + parseFloat(val || 0), 0)
  return Math.abs(sumaDesglose - form.value.monto_total) > 0.01
})

const movimientosFiltrados = computed(() => {
  let resultado = movimientos.value

  if (filtroTipo.value) {
    resultado = resultado.filter(m => m.tipo === filtroTipo.value)
  }

  // Los filtros de fecha se aplican en la API
  return resultado.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
})

const cargarDatos = async () => {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filtroFechaInicio.value) params.append("fecha_inicio", filtroFechaInicio.value)
    if (filtroFechaFin.value) params.append("fecha_fin", filtroFechaFin.value)
    if (filtroTipo.value) params.append("tipo", filtroTipo.value)

    const res = await api.getMovimientosCaja(
      filtroFechaInicio.value,
      filtroFechaFin.value,
      filtroTipo.value
    )
    movimientos.value = res.data.movimientos || []
    totales.value = res.data.totales || {}
  } catch (err) {
    error.value = `Error al cargar: ${err.response?.data?.error || err.message}`
  } finally {
    loading.value = false
  }
}

const aplicarFiltros = () => {
  cargarDatos()
}

const textoTipoFiltro = () => {
  if (filtroTipo.value === "ingreso") return "solo ingresos"
  if (filtroTipo.value === "egreso") return "solo egresos"
  return "ingresos y egresos"
}

const textoRangoFechas = () => {
  const desde = filtroFechaInicio.value
    ? new Date(`${filtroFechaInicio.value}T00:00:00`).toLocaleDateString("es-AR")
    : "sin fecha de inicio"
  const hasta = filtroFechaFin.value
    ? new Date(`${filtroFechaFin.value}T00:00:00`).toLocaleDateString("es-AR")
    : "sin fecha de fin"
  return `desde ${desde} hasta ${hasta}`
}

const descargarResumenPdf = async () => {
  const ok = window.confirm(
    `Se va a generar el resumen de caja ${textoRangoFechas()}, incluyendo ${textoTipoFiltro()}.\n\n¿Deseás continuar?`
  )
  if (!ok) return

  try {
    generandoPdf.value = true
    const res = await api.getResumenCajaPdf(
      filtroFechaInicio.value,
      filtroFechaFin.value,
      filtroTipo.value
    )

    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url

    const hoy = new Date()
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`
    link.download = `Resumen Caja ${fecha}.pdf`

    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = `Error al generar PDF: ${err.response?.data?.error || err.message}`
  } finally {
    generandoPdf.value = false
  }
}

const descargarMovimientoPdf = async () => {
  if (!movimientoSeleccionado.value?.id) return

  const fechaMovimiento = new Date(movimientoSeleccionado.value.fecha).toLocaleDateString("es-AR")
  const tipoMovimiento = movimientoSeleccionado.value.tipo === "ingreso" ? "ingreso" : "egreso"
  const ok = window.confirm(
    `Se va a generar el PDF del movimiento del ${fechaMovimiento}, tipo ${tipoMovimiento}.\n\n¿Deseás continuar?`
  )
  if (!ok) return

  try {
    generandoPdfDetalle.value = true
    const res = await api.getMovimientoCajaPdf(movimientoSeleccionado.value.id)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `Movimiento Caja ${movimientoSeleccionado.value.id}.pdf`
    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = `Error al generar PDF del movimiento: ${err.response?.data?.error || err.message}`
  } finally {
    generandoPdfDetalle.value = false
  }
}

const crearFormularioVacio = () => ({
  fecha: new Date().toISOString().split('T')[0],
  tipo: "ingreso",
  detalle: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    cheque: 0,
    echeq: 0,
    retencion: 0
  }
})

const normalizarDesglose = (detalles = []) => {
  const base = {
    efectivo: 0,
    transferencia: 0,
    cheque: 0,
    echeq: 0,
    retencion: 0
  }

  detalles.forEach((item) => {
    const medio = String(item?.medio_pago || "").toLowerCase()
    if (Object.prototype.hasOwnProperty.call(base, medio)) {
      base[medio] = parseFloat(item.monto) || 0
    }
  })

  return base
}

const cerrarFormulario = () => {
  showForm.value = false
  editandoMovimientoId.value = null
  error.value = ""
}

const abrirFormulario = () => {
  form.value = crearFormularioVacio()
  editandoMovimientoId.value = null
  error.value = ""
  showForm.value = true
}

const abrirEdicion = (movimiento) => {
  form.value = {
    fecha: String(movimiento.fecha || "").split("T")[0],
    tipo: movimiento.tipo || "ingreso",
    detalle: movimiento.detalle || "",
    monto_total: parseFloat(movimiento.monto_total) || 0,
    desglose: normalizarDesglose(movimiento.detalles_medio_pago || [])
  }
  editandoMovimientoId.value = movimiento.id
  error.value = ""
  showForm.value = true
}

const payloadMovimiento = () => ({
  fecha: form.value.fecha,
  tipo: form.value.tipo,
  detalle: form.value.detalle,
  monto_total: parseFloat(form.value.monto_total),
  desglose: {
    efectivo: parseFloat(form.value.desglose.efectivo) || 0,
    transferencia: parseFloat(form.value.desglose.transferencia) || 0,
    cheque: parseFloat(form.value.desglose.cheque) || 0,
    echeq: parseFloat(form.value.desglose.echeq) || 0,
    retencion: parseFloat(form.value.desglose.retencion) || 0
  }
})

const guardarMovimiento = async () => {
  if (!esFormularioValido.value) {
    error.value = "Por favor completa todos los campos correctamente"
    return
  }

  try {
    const payload = payloadMovimiento()
    if (editandoMovimientoId.value) {
      await api.updateMovimientoCaja(editandoMovimientoId.value, payload)
    } else {
      await api.createMovimientoCaja(payload)
    }

    await cargarDatos()
    cerrarFormulario()
  } catch (err) {
    error.value = editandoMovimientoId.value
      ? `Error al modificar: ${err.response?.data?.error || err.message}`
      : `Error al crear: ${err.response?.data?.error || err.message}`
  }
}

const verDetalle = async (movimiento) => {
  try {
    loading.value = true
    const res = await api.getMovimientoCaja(movimiento.id)
    movimientoSeleccionado.value = res.data
    vistaActual.value = "detalle"
  } catch (err) {
    error.value = `Error al cargar detalle: ${err.response?.data?.error || err.message}`
  } finally {
    loading.value = false
  }
}

const volverALista = () => {
  vistaActual.value = "lista"
  movimientoSeleccionado.value = null
}

const confirmarEliminar = (movimiento) => {
  movimientoAEliminar.value = movimiento
  showConfirm.value = true
}

const eliminarMovimiento = async () => {
  try {
    await api.deleteMovimientoCaja(movimientoAEliminar.value.id)
    await cargarDatos()
    showConfirm.value = false
    movimientoAEliminar.value = null
    error.value = ""
  } catch (err) {
    error.value = `Error al eliminar: ${err.response?.data?.error || err.message}`
    showConfirm.value = false
  }
}

const obtenerLabelMedio = (codigo) => {
  const medio = mediosDePago.find(m => m.id === codigo)
  return medio ? medio.label : codigo
}

const formatoMoneda = (valor) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS'
  }).format(valor)
}

onMounted(() => {
  cargarDatos()
  socket.on('caja:changed', cargarDatos)
})
onUnmounted(() => {
  socket.off('caja:changed', cargarDatos)
})
</script>

<template>
  <LayoutShell title="Caja" subtitle="Movimientos de ingresos y egresos">
    <!-- LISTA VIEW -->
    <div v-if="vistaActual === 'lista'" class="container">
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <!-- Toolbar con filtros -->
      <div class="toolbar">
        <div class="filtros">
          <label>
            Desde:
            <input v-model="filtroFechaInicio" type="date" class="input-sm" />
          </label>
          <label>
            Hasta:
            <input v-model="filtroFechaFin" type="date" class="input-sm" />
          </label>
          <label>
            Tipo:
            <select v-model="filtroTipo" class="select-sm">
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </label>
          <button class="btn btn-sm btn-secondary" @click="aplicarFiltros">Filtrar</button>
        </div>
        <div class="toolbar-acciones">
          <button class="btn btn-pdf" :disabled="generandoPdf" @click="descargarResumenPdf">
            {{ generandoPdf ? "Generando PDF..." : "📄 Descargar Resumen PDF" }}
          </button>
          <button class="btn btn-primary" @click="abrirFormulario">
            + Nuevo Movimiento
          </button>
        </div>
      </div>

      <!-- Resumen de totales -->
      <div class="resumen-totales">
        <div class="total-card total-ingresos">
          <span class="label">Total Ingresos</span>
          <span class="value">{{ formatoMoneda(totales.totalIngresos || 0) }}</span>
        </div>
        <div class="total-card total-egresos">
          <span class="label">Total Egresos</span>
          <span class="value">{{ formatoMoneda(totales.totalEgresos || 0) }}</span>
        </div>
        <div class="total-card total-balance">
          <span class="label">Balance</span>
          <span class="value">{{ formatoMoneda((totales.totalIngresos || 0) - (totales.totalEgresos || 0)) }}</span>
        </div>
      </div>

      <!-- Desglose por medio de pago -->
      <div class="desglose-medios">
        <h3>Desglose por Medio de Pago</h3>
        <div class="medios-grid">
          <div class="medio-card" v-for="medio in mediosDePago" :key="medio.id">
            <span class="label">{{ medio.label }}</span>
            <span class="value">{{ formatoMoneda(totales.desglose?.[medio.id] || 0) }}</span>
          </div>
        </div>
      </div>

      <!-- Tabla de movimientos -->
      <div v-if="loading" class="spinner">Cargando...</div>
      <div v-else-if="movimientosFiltrados.length === 0" class="empty">
        No hay movimientos registrados
      </div>
      <table v-else class="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Detalle</th>
            <th>Monto Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mov in movimientosFiltrados" :key="mov.id" :class="`row-${mov.tipo}`">
            <td>{{ new Date(mov.fecha).toLocaleDateString('es-AR') }}</td>
            <td>
              <span :class="`badge badge-${mov.tipo}`">
                {{ mov.tipo === 'ingreso' ? '📥 Ingreso' : '📤 Egreso' }}
              </span>
            </td>
            <td>{{ mov.detalle }}</td>
            <td class="monto-total">{{ formatoMoneda(mov.monto_total) }}</td>
            <td class="acciones">
              <button class="btn btn-sm btn-info" @click="abrirEdicion(mov)">
                Editar
              </button>
              <button class="btn btn-sm btn-info" @click="verDetalle(mov)">
                Ver detalle
              </button>
              <button class="btn btn-sm btn-danger" @click="confirmarEliminar(mov)">
                Eliminar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- DETALLE VIEW -->
    <div v-else-if="vistaActual === 'detalle'" class="container">
      <div class="detalle-top-actions">
        <button class="btn btn-secondary" @click="volverALista">← Volver a lista</button>
        <button class="btn btn-pdf" :disabled="generandoPdfDetalle" @click="descargarMovimientoPdf">
          {{ generandoPdfDetalle ? "Generando PDF..." : "📄 Descargar PDF" }}
        </button>
      </div>

      <div v-if="movimientoSeleccionado" class="detalle-card">
        <!-- Header -->
        <div class="detalle-header">
          <div>
            <h2>{{ movimientoSeleccionado.tipo === 'ingreso' ? '📥 Ingreso' : '📤 Egreso' }}</h2>
            <p class="subtitle">{{ new Date(movimientoSeleccionado.fecha).toLocaleDateString('es-AR') }}</p>
          </div>
        </div>

        <!-- Detalles principales -->
        <div class="section">
          <h3>Datos del Movimiento</h3>
          <div class="info-grid">
            <div class="info-item">
              <label>Detalle</label>
              <p>{{ movimientoSeleccionado.detalle }}</p>
            </div>
            <div class="info-item">
              <label>Monto Total</label>
              <p class="monto-grande">{{ formatoMoneda(movimientoSeleccionado.monto_total) }}</p>
            </div>
            <div class="info-item">
              <label>Tipo</label>
              <p>{{ movimientoSeleccionado.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}</p>
            </div>
            <div class="info-item">
              <label>Fecha</label>
              <p>{{ new Date(movimientoSeleccionado.fecha).toLocaleDateString('es-AR') }}</p>
            </div>
          </div>
        </div>

        <!-- Desglose de medios de pago -->
        <div class="section">
          <h3>Desglose por Medio de Pago</h3>
          <div v-if="movimientoSeleccionado.detalles_medio_pago?.length > 0" class="desglose-grid">
            <div v-for="detalle in movimientoSeleccionado.detalles_medio_pago" 
                 :key="detalle.id" 
                 class="desglose-item">
              <span class="medio-label">{{ obtenerLabelMedio(detalle.medio_pago) }}</span>
              <span class="medio-monto">{{ formatoMoneda(detalle.monto) }}</span>
            </div>
          </div>
          <p v-else class="empty-desglose">Sin detalles de medio de pago</p>
        </div>
      </div>
    </div>
  </LayoutShell>

  <!-- Modal para crear movimiento -->
  <div v-if="showForm" class="modal-overlay" @click.self="cerrarFormulario">
    <div class="modal">
      <div class="modal-header">
        <h3>{{ editandoMovimientoId ? "Modificar Movimiento" : "Nuevo Movimiento" }}</h3>
        <button class="btn-close" @click="cerrarFormulario">×</button>
      </div>

      <form @submit.prevent="guardarMovimiento" class="modal-form">
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        
        <!-- Primera fila: Fecha, Tipo -->
        <div class="form-row">
          <label class="form-group">
            <span>Fecha *</span>
            <input v-model="form.fecha" type="date" required />
          </label>
          <label class="form-group">
            <span>Tipo *</span>
            <select v-model="form.tipo" required>
              <option value="ingreso">Ingreso</option>
              <option value="egreso">Egreso</option>
            </select>
          </label>
        </div>

        <!-- Segunda fila: Detalle -->
        <label class="form-group">
          <span>Detalle *</span>
          <input v-model="form.detalle" type="text" placeholder="Descripción del movimiento" required />
        </label>

        <!-- Tercera fila: Monto Total -->
        <label class="form-group">
          <span>Monto Total *</span>
          <input v-model.number="form.monto_total" type="number" placeholder="0.00" step="0.01" required />
        </label>

        <!-- Desglose compacto en grid -->
        <div class="desglose-compacto">
          <h4>Desglose por Medio de Pago</h4>
          <div class="desglose-grid-compact">
            <div v-for="medio in mediosDePago" :key="medio.id" class="desglose-compact-item">
              <label>{{ medio.label }}</label>
              <input 
                v-model.number="form.desglose[medio.id]" 
                type="number" 
                placeholder="0.00" 
                step="0.01"
              />
            </div>
          </div>
          <div class="desglose-validacion-compact">
            <span>{{ formatoMoneda(Object.values(form.desglose).reduce((sum, val) => sum + parseFloat(val || 0), 0)) }}</span>
            <span v-if="tieneErrorDesglose" class="error-badge">❌</span>
            <span v-else class="success-badge">✓</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="submit" class="btn-primary" :disabled="!esFormularioValido">
            {{ editandoMovimientoId ? "Guardar Cambios" : "Crear Movimiento" }}
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
        <p v-if="movimientoAEliminar">
          ¿Estás seguro de que deseas eliminar este movimiento de caja?<br>
          <strong>{{ movimientoAEliminar.detalle }} - {{ formatoMoneda(movimientoAEliminar.monto_total) }}</strong>
        </p>

        <div class="modal-actions">
          <button type="button" class="btn-primary btn-danger" @click="eliminarMovimiento">
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

.toolbar-acciones {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.detalle-top-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.btn-pdf {
  background: linear-gradient(135deg, #0ea5e9, #2563eb);
  color: white;
  border: 1px solid rgba(14, 165, 233, 0.4);
  box-shadow: 0 8px 16px rgba(37, 99, 235, 0.25);
}

.btn-pdf:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 12px 20px rgba(37, 99, 235, 0.35);
}

.btn-pdf:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.filtros {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.filtros label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #d1d5db;
  font-size: 0.875rem;
}

.input-sm,
.select-sm {
  padding: 0.375rem 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  background: rgba(30, 41, 59, 0.5);
  color: #e5e7eb;
  font-size: 0.8rem;
}

.input-sm:focus,
.select-sm:focus {
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

/* Resumen de totales */
.resumen-totales {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.total-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  transition: all 0.2s ease;
}

.total-card:hover {
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.6);
}

.total-card .label {
  color: #9ca3af;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.total-card .value {
  font-size: 1.75rem;
  font-weight: bold;
}

.total-ingresos .value {
  color: #86efac;
}

.total-egresos .value {
  color: #f87171;
}

.total-balance .value {
  color: #60a5fa;
}

/* Desglose por medio de pago */
.desglose-medios {
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  padding: 1.5rem;
}

.desglose-medios h3 {
  color: #d1d5db;
  font-size: 1rem;
  margin: 0 0 1rem 0;
}

.medios-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.medio-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
}

.medio-card .label {
  color: #9ca3af;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}

.medio-card .value {
  color: #3b82f6;
  font-size: 1.25rem;
  font-weight: bold;
}

/* Tabla */
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

.tabla .monto-total {
  font-weight: bold;
  color: #60a5fa;
}

.tabla .row-ingreso {
  border-left: 4px solid #86efac;
}

.tabla .row-egreso {
  border-left: 4px solid #f87171;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-ingreso {
  background: rgba(134, 239, 172, 0.2);
  color: #86efac;
  border: 1px solid rgba(134, 239, 172, 0.3);
}

.badge-egreso {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.3);
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

/* Detalle card */
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
  font-size: 1rem;
  margin: 0;
}

.monto-grande {
  font-size: 1.5rem !important;
  font-weight: bold;
  color: #60a5fa !important;
}

.desglose-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.desglose-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
}

.medio-label {
  color: #9ca3af;
  font-size: 0.875rem;
}

.medio-monto {
  color: #3b82f6;
  font-weight: bold;
}

.empty-desglose {
  color: #9ca3af;
  font-size: 0.875rem;
  margin: 0;
}

/* Form styles */
.form-group {
  display: flex;
  flex-direction: column;
  margin-bottom: 1rem;
}

.form-group label {
  color: #d1d5db;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
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

.form-section {
  background: rgba(30, 41, 59, 0.3);
  padding: 1rem;
  border-radius: 0.5rem;
  margin-top: 1rem;
}

.form-section h4 {
  color: #d1d5db;
  font-size: 0.95rem;
  margin: 0 0 0.75rem 0;
}

.info-text {
  color: #9ca3af;
  font-size: 0.875rem;
  margin: 0.5rem 0 1rem 0;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.error-badge {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
}

.success-badge {
  background: rgba(134, 239, 172, 0.2);
  color: #86efac;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
}

.desglose-inputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.desglose-input-group {
  display: flex;
  flex-direction: column;
}

.desglose-input-group label {
  color: #d1d5db;
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
}

.input-desglose {
  padding: 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  background: rgba(30, 41, 59, 0.5);
  color: #e5e7eb;
  font-size: 0.875rem;
}

.input-desglose:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 0.8);
}

.desglose-validacion {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: rgba(30, 41, 59, 0.4);
  border-radius: 0.375rem;
  border-left: 3px solid #3b82f6;
}

.desglose-validacion .label {
  color: #9ca3af;
  font-size: 0.875rem;
}

.desglose-validacion .value {
  color: #3b82f6;
  font-weight: bold;
  font-size: 1rem;
}

/* DESGLOSE COMPACTO */
.desglose-compacto {
  background: rgba(30, 41, 59, 0.5);
  padding: 0.75rem;
  border-radius: 0.5rem;
  margin-top: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.desglose-compacto h4 {
  color: #cbd5e1;
  font-size: 0.875rem;
  margin: 0 0 0.75rem 0;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
}

.desglose-grid-compact {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.desglose-compact-item:last-child {
  grid-column: 1 / -1;
  max-width: 50%;
  margin: 0 auto;
}

.desglose-compact-item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.desglose-compact-item label {
  color: #cbd5e1;
  font-size: 0.875rem;
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
}

.desglose-compact-item input {
  padding: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
  font-size: 0.9375rem;
  font-weight: 400;
  transition: all 0.2s ease;
}

.desglose-compact-item input:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 0.9);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.desglose-validacion-compact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem;
  background: rgba(15, 23, 42, 0.8);
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
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
  width: 90%;
  max-width: 480px;
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
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
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

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
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
</style>

