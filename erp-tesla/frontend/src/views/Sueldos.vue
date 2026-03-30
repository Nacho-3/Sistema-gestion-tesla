<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

// Estado - Lista
const liquidaciones = ref([])
const empleados = ref([])
const loading = ref(false)
const error = ref("")
const vistaActual = ref("lista") // "lista", "detalle" o "tarifas"
const liquidacionSeleccionada = ref(null)
const pagoSeleccionado = ref(null)
const pagos = ref([])
const empleadoEditando = ref(null)
const tarifaEditando = ref("")

// Filtros
const mesSeleccionado = ref(new Date().getMonth() + 1)
const anioSeleccionado = ref(new Date().getFullYear())
const filtroEmpleado = ref("")

// Modal - Nuevo Pago
const showFormPago = ref(false)
const formPago = ref({
  monto: "",
  medio_pago: "Depósito",
  fecha: new Date().toISOString().split("T")[0]
})

// Modal - Editar Conceptos
const showFormConceptos = ref(false)
const formConceptos = ref({
  total_horas: 0,
  monto_bruto: 0,
  presentismo: 0,
  horas_extra_cantidad: 0,
  horas_extra_100_cantidad: 0,
  no_remunerativo: 0,
  aguinaldo: 0,
  vacaciones: 0,
  feriados_cantidad: 0,
  dias_no_trabajados: 0,
  adelantos: 0,
  observaciones: ""
})

const toNumber = (valor) => {
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const normalizarLiquidacion = (liq = {}) => ({
  ...liq,
  horas_computadas: toNumber(liq.horas_computadas ?? liq.total_horas),
  horas_trabajadas_reales: toNumber(liq.horas_trabajadas_reales ?? liq.total_horas),
  total_horas: toNumber(liq.total_horas),
  monto_bruto: toNumber(liq.monto_bruto ?? liq.importe_horas),
  valor_hora: toNumber(liq.valor_hora),
  importe_horas: toNumber(liq.importe_horas),
  presentismo: toNumber(liq.presentismo),
  importe_horas_extra: toNumber(liq.importe_horas_extra),
  importe_horas_extra_100: toNumber(liq.importe_horas_extra_100),
  no_remunerativo: toNumber(liq.no_remunerativo),
  aguinaldo: toNumber(liq.aguinaldo),
  vacaciones: toNumber(liq.vacaciones),
  horas_extra_cantidad: toNumber(liq.horas_extra_cantidad),
  horas_extra_100_cantidad: toNumber(liq.horas_extra_100_cantidad),
  feriados_cantidad: toNumber(liq.feriados_cantidad),
  dias_no_trabajados: toNumber(liq.dias_no_trabajados),
  importe_feriados: toNumber(liq.importe_feriados),
  descuento_dias_no_trabajados: toNumber(liq.descuento_dias_no_trabajados),
  adelantos: toNumber(liq.adelantos),
  total: toNumber(liq.total),
  total_pagado: toNumber(liq.total_pagado),
})

const normalizarPago = (pago = {}) => ({
  ...pago,
  monto: toNumber(pago.monto),
})

const formatearHoras = (valor) => toNumber(valor).toFixed(2)
const formatearCantidad = (valor) => String(Math.round(toNumber(valor)))

// Cargar liquidaciones
const cargarLiquidaciones = async () => {
  loading.value = true
  error.value = ""
  const hardStop = setTimeout(() => {
    if (loading.value) {
      loading.value = false
      if (!error.value) {
        error.value = "La carga de liquidaciones tardó demasiado. Reintentá con 'Actualizar automáticamente'."
      }
    }
  }, 15000)

  try {
    console.log("📋 Cargando liquidaciones para:", {
      mes: mesSeleccionado.value,
      anio: anioSeleccionado.value,
      empleado_id: filtroEmpleado.value || "todos",
    })
    const res = await Promise.race([
      api.getLiquidaciones(mesSeleccionado.value, anioSeleccionado.value, filtroEmpleado.value || undefined),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Tiempo de espera agotado al cargar liquidaciones")), 12000)),
    ])

    liquidaciones.value = (res?.data || []).map(normalizarLiquidacion)
    console.log(`✅ ${liquidaciones.value.length} liquidaciones cargadas`)
  } catch (err) {
    console.error("❌ Error al cargar liquidaciones:", err)
    error.value = "Error al cargar liquidaciones: " + (err.response?.data?.error || err.message)
    liquidaciones.value = []
  } finally {
    clearTimeout(hardStop)
    loading.value = false
  }
}

// Cargar empleados
const cargarEmpleados = async () => {
  try {
    const res = await api.getEmpleados()
    empleados.value = res.data || []
  } catch (err) {
    console.error("Error al cargar empleados:", err)
  }
}

// Ver detalle de liquidación
const verDetalle = async (liquidacion) => {
  liquidacionSeleccionada.value = liquidacion
  vistaActual.value = "detalle"
  
  // Cargar pagos
  loading.value = true
  try {
    const resPagos = await api.getPagos(liquidacion.id)
    pagos.value = (resPagos.data || []).map(normalizarPago)
  } catch (err) {
    console.error("Error al cargar pagos:", err)
    pagos.value = []
  } finally {
    loading.value = false
  }

  // Cargar conceptos en el formulario
  formConceptos.value = {
    total_horas: liquidacion.total_horas || 0,
    monto_bruto: liquidacion.monto_bruto || liquidacion.importe_horas || 0,
    presentismo: liquidacion.presentismo || 0,
    horas_extra_cantidad: liquidacion.horas_extra_cantidad || 0,
    horas_extra_100_cantidad: liquidacion.horas_extra_100_cantidad || 0,
    no_remunerativo: liquidacion.no_remunerativo || 0,
    aguinaldo: liquidacion.aguinaldo || 0,
    vacaciones: liquidacion.vacaciones || 0,
    feriados_cantidad: liquidacion.feriados_cantidad || 0,
    dias_no_trabajados: liquidacion.dias_no_trabajados || 0,
    adelantos: liquidacion.adelantos || 0,
    observaciones: liquidacion.observaciones || ""
  }
}

const abrirEdicionLiquidacion = (liquidacion) => {
  liquidacionSeleccionada.value = liquidacion
  formConceptos.value = {
    total_horas: liquidacion.total_horas || 0,
    monto_bruto: liquidacion.monto_bruto || liquidacion.importe_horas || 0,
    presentismo: liquidacion.presentismo || 0,
    horas_extra_cantidad: liquidacion.horas_extra_cantidad || 0,
    horas_extra_100_cantidad: liquidacion.horas_extra_100_cantidad || 0,
    no_remunerativo: liquidacion.no_remunerativo || 0,
    aguinaldo: liquidacion.aguinaldo || 0,
    vacaciones: liquidacion.vacaciones || 0,
    feriados_cantidad: liquidacion.feriados_cantidad || 0,
    dias_no_trabajados: liquidacion.dias_no_trabajados || 0,
    adelantos: liquidacion.adelantos || 0,
    observaciones: liquidacion.observaciones || ""
  }
  showFormConceptos.value = true
}

const autocompletarSueldoBaseDesdeHoras = () => {
  const horas = toNumber(formConceptos.value.total_horas)
  const valorHora = getValorHoraEmpleado(liquidacionSeleccionada.value?.empleado_id) || toNumber(liquidacionSeleccionada.value?.valor_hora)
  formConceptos.value.monto_bruto = Math.round(horas * valorHora * 100) / 100
}

watch(
  () => formConceptos.value.total_horas,
  () => {
    if (!showFormConceptos.value || !liquidacionSeleccionada.value) return
    autocompletarSueldoBaseDesdeHoras()
  }
)

// Volver a la lista
const volverALista = async () => {
  vistaActual.value = "lista"
  liquidacionSeleccionada.value = null
  pagos.value = []
  empleadoEditando.value = null
  tarifaEditando.value = ""
  // Recargar la lista para reflejar cualquier cambio (pagos registrados)
  await cargarLiquidaciones()
}


// Actualizar conceptos de liquidación
const actualizarConceptos = async () => {
  error.value = ""
  loading.value = true
  try {
    const res = await api.updateLiquidacion(liquidacionSeleccionada.value.id, formConceptos.value)
    liquidacionSeleccionada.value = normalizarLiquidacion(res.data)
    await cargarLiquidaciones()
    showFormConceptos.value = false
  } catch (err) {
    error.value = "Error al actualizar conceptos"
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Crear pago
const crearPago = async () => {
  error.value = ""
  if (!formPago.value.monto || formPago.value.monto <= 0) {
    error.value = "Monto debe ser mayor a 0"
    return
  }

  loading.value = true
  try {
    await api.createPago(liquidacionSeleccionada.value.id, {
      monto: parseFloat(formPago.value.monto),
      medio_pago: formPago.value.medio_pago,
      fecha: formPago.value.fecha
    })
    await verDetalle(liquidacionSeleccionada.value)
    showFormPago.value = false
    formPago.value = {
      monto: "",
      medio_pago: "Depósito",
      fecha: new Date().toISOString().split("T")[0]
    }
  } catch (err) {
    error.value = err.response?.data?.error || "Error al crear pago"
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Eliminar pago
const eliminarPago = async (pagoId) => {
  if (!confirm("¿Está seguro que desea eliminar este pago?")) return

  loading.value = true
  try {
    await api.deletePago(pagoId)
    await verDetalle(liquidacionSeleccionada.value)
  } catch (err) {
    error.value = "Error al eliminar pago"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const descargarPdfLiquidacion = async () => {
  if (!liquidacionSeleccionada.value?.id) return

  loading.value = true
  error.value = ""
  try {
    const res = await api.getLiquidacionPdf(liquidacionSeleccionada.value.id)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    const periodo = `${String(liquidacionSeleccionada.value.mes || "").padStart(2, "0")}-${liquidacionSeleccionada.value.anio || ""}`
    link.href = url
    link.download = `liquidacion_${liquidacionSeleccionada.value.id}_${periodo}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = err?.response?.data?.error || "Error al generar PDF de liquidación"
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Eliminar liquidación
const eliminarLiquidacion = async (id) => {
  if (!confirm("¿Está seguro que desea eliminar esta liquidación? Se eliminarán también todos los pagos registrados.")) return

  loading.value = true
  error.value = ""
  try {
    await api.deleteLiquidacion(id)
    console.log("✅ Liquidación eliminada correctamente")
    
    // Recargar la lista
    await cargarLiquidaciones()
    
    // Volver a la lista principal
    vistaActual.value = "lista"
    liquidacionSeleccionada.value = null
    pagos.value = []
  } catch (err) {
    error.value = "Error al eliminar liquidación: " + (err.response?.data?.error || err.message)
    console.error("❌ Error eliminando:", err)
  } finally {
    loading.value = false
  }
}

// Calculados
const totalPagado = computed(() => {
  return pagos.value.reduce((sum, p) => sum + toNumber(p.monto), 0)
})

const faltaPagar = computed(() => {
  return toNumber(liquidacionSeleccionada.value?.total) - totalPagado.value
})

const estaPagadaDetalle = computed(() => {
  return totalPagado.value >= toNumber(liquidacionSeleccionada.value?.total)
})

const valorHoraDetalle = computed(() => {
  const valorHoraEmpleado = getValorHoraEmpleado(liquidacionSeleccionada.value?.empleado_id)
  return valorHoraEmpleado || toNumber(liquidacionSeleccionada.value?.valor_hora)
})

const sueldoBaseCalculadoPreview = computed(() => {
  const horas = toNumber(formConceptos.value.total_horas)
  const valorHora = getValorHoraEmpleado(liquidacionSeleccionada.value?.empleado_id) || toNumber(liquidacionSeleccionada.value?.valor_hora)
  return Math.round(horas * valorHora * 100) / 100
})

const importeHorasExtraPreview = computed(() => {
  return toNumber(formConceptos.value.horas_extra_cantidad) * valorHoraDetalle.value * 1.5
})

const importeHorasExtra100Preview = computed(() => {
  return toNumber(formConceptos.value.horas_extra_100_cantidad) * valorHoraDetalle.value * 2
})

const importeFeriadosPreview = computed(() => {
  return toNumber(formConceptos.value.feriados_cantidad) * 8 * valorHoraDetalle.value
})

const descuentoDiasNoTrabajadosPreview = computed(() => {
  return toNumber(formConceptos.value.dias_no_trabajados) * 8 * valorHoraDetalle.value
})

// Obtener nombre empleado
const getNombreEmpleado = (empleadoId) => {
  const empleado = empleados.value.find((e) => e.id === empleadoId)
  return empleado ? `${empleado.nombre} ${empleado.apellido}` : "-"
}

const getValorHoraEmpleado = (empleadoId) => {
  const empleado = empleados.value.find((e) => e.id === empleadoId)
  return toNumber(empleado?.valor_hora)
}

// Calcular total pagos (simplificado para la lista)
const pagosDetalleTotal = (liquidacionId) => {
  // En la lista no tenemos los pagos cargados, retornamos 0 por ahora
  // El estado se calcula en la vista de detalle donde sí se cargan los pagos
  return 0
}

// Formatear moneda
const formatearMoneda = (valor) => {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS"
  }).format(toNumber(valor))
}

// Editar tarifa
const iniciarEdicionTarifa = (empleado) => {
  empleadoEditando.value = empleado
  tarifaEditando.value = empleado.valor_hora?.toString() || ""
}

const guardarTarifa = async () => {
  if (!empleadoEditando.value || !tarifaEditando.value) return
  
  loading.value = true
  error.value = ""
  try {
    const valor = parseFloat(tarifaEditando.value)
    if (valor <= 0) throw new Error("El valor debe ser mayor a 0")
    
    await api.updateTarifa(empleadoEditando.value.id, valor)
    
    // Actualizar empleado en el array
    const idx = empleados.value.findIndex((e) => e.id === empleadoEditando.value.id)
    if (idx >= 0) {
      empleados.value[idx].valor_hora = valor
    }
    
    empleadoEditando.value = null
    tarifaEditando.value = ""
  } catch (err) {
    error.value = "Error al actualizar tarifa: " + err.message
    console.error(err)
  } finally {
    loading.value = false
  }
}

const cancelarEdicionTarifa = () => {
  empleadoEditando.value = null
  tarifaEditando.value = ""
}

onMounted(async () => {
  await Promise.all([cargarLiquidaciones(), cargarEmpleados()])
  socket.on('liquidaciones:changed', cargarLiquidaciones)
  socket.on('horas:changed', cargarLiquidaciones)
})
onUnmounted(() => {
  socket.off('liquidaciones:changed', cargarLiquidaciones)
  socket.off('horas:changed', cargarLiquidaciones)
})
</script>

<template>
  <LayoutShell
    title="Sueldos y Liquidaciones"
    subtitle="Generación de liquidaciones y registro de pagos"
  >
    <div class="sueldos-container">
      <!-- VISTA: LISTA DE LIQUIDACIONES -->
      <div v-if="vistaActual === 'lista'">
        <!-- Filtros y acciones -->
        <div class="sueldos-header">
          <div class="filtros">
            <div class="filtro-grupo">
              <label>Mes:</label>
              <select v-model.number="mesSeleccionado" @change="cargarLiquidaciones">
                <option v-for="m in 12" :key="m" :value="m">
                  {{ new Date(2024, m - 1).toLocaleDateString("es-AR", { month: "long" }) }}
                </option>
              </select>
            </div>
            <div class="filtro-grupo">
              <label>Año:</label>
              <select v-model.number="anioSeleccionado" @change="cargarLiquidaciones">
                <option v-for="a in [2024, 2025, 2026]" :key="a" :value="a">
                  {{ a }}
                </option>
              </select>
            </div>
            <div class="filtro-grupo">
              <label>Empleado:</label>
              <select v-model="filtroEmpleado" @change="cargarLiquidaciones">
                <option value="">Todos</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </div>
          </div>
          <div class="header-actions">
            <button class="btn-primary header-btn" @click="cargarLiquidaciones">
              ↻ Actualizar automáticamente
            </button>
            <button class="btn-tarifas header-btn" @click="vistaActual = 'tarifas'">
              💰 Configurar Tarifas
            </button>
          </div>
        </div>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <!-- Tabla de liquidaciones -->
        <div v-if="!loading && liquidaciones.length > 0" class="sueldos-table">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Período</th>
                <th>Horas Pagas</th>
                <th>Sueldo Base</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="liq in liquidaciones" :key="liq.id">
                <td><strong>{{ getNombreEmpleado(liq.empleado_id) }}</strong></td>
                <td>{{ liq.mes }}/{{ liq.anio }}</td>
                <td>{{ formatearHoras(liq.horas_computadas) }}</td>
                <td>{{ formatearMoneda(liq.monto_bruto) }}</td>
                <td><strong>{{ formatearMoneda(liq.total) }}</strong></td>
                <td>
                  <span :class="['badge', liq.estado === 'pagada' ? 'badge-pagada' : 'badge-pendiente']">
                    {{ liq.estado === "pagada" ? "PAGADA" : "PENDIENTE" }}
                  </span>
                </td>
                <td>
                  <div class="acciones">
                    <button class="btn-detalle" @click="verDetalle(liq)">
                      👁️ Ver detalle
                    </button>
                    <button class="btn-edit-inline" @click="abrirEdicionLiquidacion(liq)">
                      ✏️ Editar
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Estado vacío -->
        <div v-if="!loading && liquidaciones.length === 0" class="empty-state">
          <p>No hay liquidaciones para este período</p>
          <button class="btn-primary" @click="cargarLiquidaciones">
            Generar automáticamente
          </button>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading">
          Cargando...
        </div>
      </div>

      <!-- VISTA: DETALLE DE LIQUIDACIÓN -->
      <div v-if="vistaActual === 'detalle' && liquidacionSeleccionada" class="detalle-container">
        <!-- Encabezado -->
        <div class="detalle-header">
          <button class="btn-volver" @click="volverALista">
            ← Volver a la lista
          </button>
          <div class="detalle-acciones">
            <button class="btn-pdf" @click="descargarPdfLiquidacion" :disabled="loading">
              📄 Descargar PDF
            </button>
            <button class="btn-edit" @click="abrirEdicionLiquidacion(liquidacionSeleccionada)">
              ✏️ Editar conceptos
            </button>
            <button class="btn-delete" @click="eliminarLiquidacion(liquidacionSeleccionada.id)">
              🗑️ Eliminar
            </button>
          </div>
        </div>

        <!-- Información general -->
        <div class="detalle-seccion datos-principales">
          <h2>Liquidación {{ mesSeleccionado }}/{{ anioSeleccionado }}</h2>
          <div class="datos-grid">
            <div class="dato-item">
              <span class="dato-label">Empleado:</span>
              <span class="dato-valor">{{ getNombreEmpleado(liquidacionSeleccionada.empleado_id) }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Período:</span>
              <span class="dato-valor">{{ mesSeleccionado }}/{{ anioSeleccionado }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Estado:</span>
              <span :class="['badge', estaPagadaDetalle ? 'badge-pagada' : 'badge-pendiente']">
                {{ estaPagadaDetalle ? "Pagada" : "Pendiente" }}
              </span>
            </div>
          </div>
        </div>

        <!-- Desglose de cálculo -->
        <div class="detalle-seccion">
          <h3>📋 Detalle de cálculo</h3>
          <div class="desglose-grid">
            <div class="desglose-item">
              <span class="desglose-label">Horas computadas / pagadas:</span>
              <span class="desglose-valor">{{ formatearHoras(liquidacionSeleccionada.horas_computadas) }} hs</span>
            </div>
            <div class="desglose-item">
              <span class="desglose-label">Horas trabajadas reales:</span>
              <span class="desglose-help">No afectan en el sueldo base.</span>
              <span class="desglose-valor">{{ formatearHoras(liquidacionSeleccionada.horas_trabajadas_reales) }} hs</span>
            </div>
            <div class="desglose-item">
              <span class="desglose-label">Valor hora:</span>
              <span class="desglose-valor">{{ formatearMoneda(valorHoraDetalle) }}</span>
            </div>
            <div class="desglose-item">
              <span class="desglose-label">Sueldo base:</span>
              <span class="desglose-valor">{{ formatearMoneda(liquidacionSeleccionada.monto_bruto) }}</span>
            </div>
          </div>

          <div class="conceptos-lista">
            <h4>Conceptos adicionales:</h4>
            <div class="concepto">
              <span>Presentismo:</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.presentismo) }}</span>
            </div>
            <div class="concepto">
              <span>Horas extra 50% ({{ formatearCantidad(liquidacionSeleccionada.horas_extra_cantidad) }} hs):</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.importe_horas_extra) }}</span>
            </div>
            <div class="concepto">
              <span>Horas extra 100% ({{ formatearCantidad(liquidacionSeleccionada.horas_extra_100_cantidad) }} hs):</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.importe_horas_extra_100) }}</span>
            </div>
            <div class="concepto">
              <span>Feriados ({{ formatearCantidad(liquidacionSeleccionada.feriados_cantidad) }} días):</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.importe_feriados) }}</span>
            </div>
            <div class="concepto">
              <span>No remunerativo:</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.no_remunerativo) }}</span>
            </div>
            <div class="concepto">
              <span>Aguinaldo:</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.aguinaldo) }}</span>
            </div>
            <div class="concepto">
              <span>Vacaciones:</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.vacaciones) }}</span>
            </div>
            <div class="concepto">
              <span>Adelantos:</span>
              <span class="concepto-negativo">-{{ formatearMoneda(liquidacionSeleccionada.adelantos) }}</span>
            </div>
            <div class="concepto">
              <span>Días no trabajados ({{ formatearCantidad(liquidacionSeleccionada.dias_no_trabajados) }}):</span>
              <span class="concepto-negativo">-{{ formatearMoneda(liquidacionSeleccionada.descuento_dias_no_trabajados) }}</span>
            </div>
            <div class="concepto-observacion">
              <span>Observaciones:</span>
              <p>{{ liquidacionSeleccionada.observaciones || "-" }}</p>
            </div>
          </div>
        </div>

        <!-- Total a pagar -->
        <div class="detalle-seccion resumen-pago">
          <h3>💰 Resumen de pago</h3>
          <div class="resumen-grid">
            <div class="resumen-item">
              <span class="resumen-label">Total liquidación:</span>
              <span class="resumen-valor">{{ formatearMoneda(liquidacionSeleccionada.total) }}</span>
            </div>
            <div class="resumen-item">
              <span class="resumen-label">Total pagado:</span>
              <span class="resumen-valor pagado">{{ formatearMoneda(totalPagado) }}</span>
            </div>
            <div class="resumen-item">
              <span class="resumen-label">Falta pagar:</span>
              <span :class="['resumen-valor', faltaPagar === 0 ? 'pagado' : 'pendiente']">
                {{ formatearMoneda(faltaPagar) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Registro de pagos -->
        <div class="detalle-seccion">
          <div class="seccion-header">
            <h3>💳 Registro de pagos</h3>
            <button
              v-if="faltaPagar > 0"
              class="btn-pago"
              @click="showFormPago = true"
            >
              + Registrar pago
            </button>
          </div>

          <div v-if="pagos.length > 0" class="pagos-table">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Monto</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="pago in pagos" :key="pago.id">
                  <td>{{ new Date(pago.fecha).toLocaleDateString("es-AR") }}</td>
                  <td>
                    <span class="badge-tipo">
                      {{ pago.medio_pago === "Depósito" ? "💰 Depósito" : "💵 Efectivo" }}
                    </span>
                  </td>
                  <td><strong>{{ formatearMoneda(pago.monto) }}</strong></td>
                  <td>
                    <button class="btn-delete-small" @click="eliminarPago(pago.id)">
                      🗑️
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">Sin registros de pago</p>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading-overlay">
          Cargando datos...
        </div>
      </div>

      <!-- VISTA: TARIFAS -->
      <div v-if="vistaActual === 'tarifas'" class="tarifas-container">
        <!-- Encabezado -->
        <div class="tarifas-header">
          <button class="btn-volver" @click="volverALista">
            ← Volver a la lista
          </button>
          <h2>💰 Configurar Tarifas por Hora</h2>
        </div>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <!-- Tabla de empleados -->
        <div v-if="!loading && empleados.length > 0" class="tarifas-table">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Valor hora actual</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="emp in empleados" :key="emp.id">
                <td>
                  <strong>{{ emp.nombre }} {{ emp.apellido }}</strong>
                </td>
                <td v-if="empleadoEditando?.id !== emp.id">
                  <span class="valor-tarifa">{{ formatearMoneda(emp.valor_hora) }}</span>
                </td>
                <td v-else class="cell-edicion">
                  <input
                    v-model="tarifaEditando"
                    type="number"
                    min="0"
                    step="100"
                    class="input-tarifa"
                  />
                </td>
                <td>
                  <div v-if="empleadoEditando?.id !== emp.id" class="acciones">
                    <button class="btn-edit-tarifa" @click="iniciarEdicionTarifa(emp)">
                      <span class="edit-icon">✏️</span>
                      <span class="edit-text">Editar Tarifa</span>
                    </button>
                  </div>
                  <div v-else class="acciones-edicion">
                    <button class="btn-save" @click="guardarTarifa" :disabled="loading">
                      ✓ Guardar
                    </button>
                    <button class="btn-cancel" @click="cancelarEdicionTarifa" :disabled="loading">
                      ✕ Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Estado vacío -->
        <div v-if="!loading && empleados.length === 0" class="empty-state">
          <p>No hay empleados registrados</p>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading">
          Cargando...
        </div>
      </div>

      <!-- Modal - Editar Conceptos -->
      <div v-if="showFormConceptos" class="modal-overlay" @click.self="showFormConceptos = false">
        <div class="modal modal-conceptos">
          <div class="modal-header">
            <h3>Editar conceptos adicionales</h3>
            <button class="btn-close" @click="showFormConceptos = false">×</button>
          </div>

          <form @submit.prevent="actualizarConceptos" class="modal-form modal-form-conceptos">
            <label class="form-group">
              <span>Horas computadas / pagadas</span>
              <input v-model.number="formConceptos.total_horas" type="number" min="0" step="0.5" />
              <small class="form-help">Al cambiar este valor, se autocalcula el sueldo base con el valor hora del empleado. Después podés retocarlo manualmente.</small>
            </label>

            <label class="form-group">
              <span>Sueldo base ($)</span>
              <input v-model.number="formConceptos.monto_bruto" type="number" min="0" step="0.01" />
              <small class="form-help">Administración puede ajustarlo manualmente sin depender de las horas cargadas.</small>
              <small class="form-help">
                Cálculo automático: {{ formatearHoras(formConceptos.total_horas) }} hs × {{ formatearMoneda(getValorHoraEmpleado(liquidacionSeleccionada?.empleado_id) || liquidacionSeleccionada?.valor_hora) }} = {{ formatearMoneda(sueldoBaseCalculadoPreview) }}
              </small>
            </label>

            <label class="form-group">
              <span>Presentismo ($)</span>
              <input v-model.number="formConceptos.presentismo" type="number" min="0" step="0.01" />
            </label>

            <div class="form-group form-group-readonly">
              <span>Horas extra al 50%</span>
              <strong>{{ formatearHoras(formConceptos.horas_extra_cantidad) }} hs</strong>
              <small class="form-help">Se toma automáticamente desde la ventana de horas. Importe calculado: {{ formatearMoneda(importeHorasExtraPreview) }}</small>
            </div>

            <div class="form-group form-group-readonly">
              <span>Horas extra al 100%</span>
              <strong>{{ formatearHoras(formConceptos.horas_extra_100_cantidad) }} hs</strong>
              <small class="form-help">Se toma automáticamente desde la ventana de horas. Importe calculado: {{ formatearMoneda(importeHorasExtra100Preview) }}</small>
            </div>

            <label class="form-group">
              <span>No remunerativo ($)</span>
              <input v-model.number="formConceptos.no_remunerativo" type="number" min="0" step="0.01" />
            </label>

            <label class="form-group">
              <span>Aguinaldo ($)</span>
              <input v-model.number="formConceptos.aguinaldo" type="number" min="0" step="0.01" />
            </label>

            <label class="form-group">
              <span>Vacaciones ($)</span>
              <input v-model.number="formConceptos.vacaciones" type="number" min="0" step="0.01" />
            </label>

            <label class="form-group">
              <span>Feriados (cantidad de días)</span>
              <input v-model.number="formConceptos.feriados_cantidad" type="number" min="0" step="1" />
              <small class="form-help">Cada feriado suma 8 horas al valor común. Importe calculado: {{ formatearMoneda(importeFeriadosPreview) }}</small>
            </label>

            <label class="form-group">
              <span>Días no trabajados (cantidad)</span>
              <input v-model.number="formConceptos.dias_no_trabajados" type="number" min="0" step="1" />
              <small class="form-help">Se descuenta 8 horas por día faltado. Descuento calculado: -{{ formatearMoneda(descuentoDiasNoTrabajadosPreview) }}</small>
            </label>

            <label class="form-group">
              <span>Adelantos ($)</span>
              <input v-model.number="formConceptos.adelantos" type="number" min="0" step="0.01" />
            </label>

            <label class="form-group">
              <span>Anotaciones</span>
              <textarea v-model="formConceptos.observaciones" rows="3" placeholder="Notas del período, adelantos, aclaraciones..."></textarea>
            </label>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Guardando..." : "Guardar cambios" }}
              </button>
              <button type="button" class="btn-secondary" @click="showFormConceptos = false">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Modal - Nuevo Pago -->
      <div v-if="showFormPago" class="modal-overlay" @click.self="showFormPago = false">
        <div class="modal">
          <div class="modal-header">
            <h3>Registrar pago</h3>
            <button class="btn-close" @click="showFormPago = false">×</button>
          </div>

          <form @submit.prevent="crearPago" class="modal-form">
            <div class="form-info">
              <p>Falta pagar: <strong>{{ formatearMoneda(faltaPagar) }}</strong></p>
            </div>

            <label class="form-group">
              <span>Monto ($) *</span>
              <input
                v-model.number="formPago.monto"
                type="number"
                min="0"
                step="0.01"
                :max="faltaPagar"
                required
              />
            </label>

            <label class="form-group">
              <span>Medio de pago *</span>
              <select v-model="formPago.medio_pago" required>
                <option value="Depósito">💰 Depósito</option>
                <option value="Efectivo">💵 Efectivo</option>
              </select>
            </label>

            <label class="form-group">
              <span>Fecha</span>
              <input v-model="formPago.fecha" type="date" />
            </label>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Registrando..." : "Registrar pago" }}
              </button>
              <button type="button" class="btn-secondary" @click="showFormPago = false">
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
.sueldos-container {
  padding: 1.5rem;
}

.sueldos-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  gap: 1rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-btn {
  width: 270px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 270px;
}

.filtros {
  display: flex;
  gap: 1rem;
}

.filtro-grupo {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filtro-grupo label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #cbd5e1;
}

.filtro-grupo select {
  padding: 0.5rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.9375rem;
}

.error-alert {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.sueldos-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
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

.badge-pendiente {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.badge-pagada {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.acciones {
  display: flex;
  gap: 0.5rem;
}

.btn-detalle {
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

.btn-detalle:hover {
  background-color: rgba(34, 197, 94, 0.3);
}

.btn-edit-inline {
  padding: 0.4rem 1rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.24), rgba(37, 99, 235, 0.3));
  color: #bfdbfe;
  border: 1px solid rgba(96, 165, 250, 0.35);
  border-radius: 0.55rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 6px 16px -10px rgba(59, 130, 246, 0.9);
}

.btn-edit-inline:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.34), rgba(37, 99, 235, 0.42));
  border-color: rgba(147, 197, 253, 0.6);
  color: #eff6ff;
  transform: translateY(-1px);
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

/* Detalle */
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
.detalle-acciones .btn-pdf {
  padding: 0.75rem 1.25rem;
  font-size: 0.875rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.detalle-acciones .btn-pdf {
  background-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}

.detalle-acciones .btn-pdf:hover {
  background-color: rgba(99, 102, 241, 0.32);
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

.detalle-seccion h4 {
  margin-top: 1rem;
  margin-bottom: 1rem;
  color: #cbd5e1;
  font-size: 0.9375rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
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

.desglose-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.desglose-item {
  padding: 1rem;
  background-color: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.desglose-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
}

.desglose-help {
  font-size: 0.78rem;
  color: #7c93b6;
}

.desglose-valor {
  font-size: 1.125rem;
  font-weight: 700;
  color: #86efac;
}

.conceptos-lista {
  padding: 1rem;
  background-color: rgba(30, 41, 59, 0.4);
  border-radius: 0.5rem;
}

.concepto {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  color: #cbd5e1;
.form-group textarea {
  padding: 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.9375rem;
  resize: vertical;
  font-family: inherit;
}
}

.concepto:last-child {
  border-bottom: none;
}

.concepto-observacion {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background-color: rgba(30, 41, 59, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.15);
}
.concepto-observacion span {
  display: block;
  color: #cbd5e1;
  font-weight: 600;
  margin-bottom: 0.35rem;
}
.concepto-observacion p {
  margin: 0;
  color: #e2e8f0;
  white-space: pre-wrap;
}
.concepto-negativo {
  color: #fca5a5;
}

.resumen-pago {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(15, 23, 42, 0.6));
  border-color: rgba(34, 197, 94, 0.3);
}

.resumen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}

.resumen-item {
  padding: 1.25rem;
  background-color: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.resumen-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
  text-transform: uppercase;
}

.resumen-valor {
  font-size: 1.5rem;
  font-weight: 700;
  color: #fda29b;
}

.resumen-valor.pagado {
  color: #86efac;
}

.resumen-valor.pendiente {
  color: #fca5a5;
}

.seccion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.seccion-header h3 {
  margin: 0;
}

.btn-pago {
  padding: 0.5rem 1rem;
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-pago:hover {
  background-color: rgba(34, 197, 94, 0.3);
}

.pagos-table {
  overflow-x: auto;
}

.pagos-table table {
  background-color: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.1);
}

.badge-tipo {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  background-color: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.btn-delete-small {
  padding: 0.25rem 0.5rem;
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.875rem;
}

.btn-delete-small:hover {
  background-color: rgba(239, 68, 68, 0.3);
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
}

.modal {
  background-color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal-conceptos {
  max-width: 550px;
  max-height: 98vh;
  display: flex;
  flex-direction: column;
}

.modal-conceptos .modal-header {
  padding: 1rem 1.25rem;
}

.modal-conceptos .modal-header h3 {
  font-size: 1.05rem;
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

.modal-form-conceptos {
  padding: 1rem 1.2rem;
  gap: 0.8rem;
  max-height: calc(88vh - 74px);
  overflow-y: auto;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-help {
  color: #8ea2c7;
  font-size: 0.82rem;
  line-height: 1.35;
}

.form-group span {
  font-size: 0.875rem;
  font-weight: 500;
  color: #cbd5e1;
}

.form-group-readonly strong {
  padding: 0.75rem;
  background-color: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.95rem;
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

.form-info {
  padding: 1rem;
  background-color: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.5rem;
  color: #cbd5e1;
  font-size: 0.9375rem;
}

.form-info p {
  margin: 0;
}

.form-info strong {
  color: #60a5fa;
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

/* TARIFAS */
.tarifas-container {
  animation: fadeIn 0.3s ease-in;
}

.tarifas-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid rgba(148, 163, 184, 0.2);
}

.tarifas-header h2 {
  color: #e2e8f0;
  margin: 0;
  font-size: 1.75rem;
}

.tarifas-table {
  margin-top: 1.5rem;
}

.tarifas-table table {
  width: 100%;
  border-collapse: collapse;
  background-color: rgba(20, 29, 51, 0.5);
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.tarifas-table thead {
  background-color: rgba(15, 23, 42, 0.8);
  border-bottom: 2px solid rgba(149, 165, 166, 0.3);
}

.tarifas-table th {
  padding: 1rem;
  text-align: left;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tarifas-table tbody tr {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  transition: background-color 0.2s;
}

.tarifas-table tbody tr:hover {
  background-color: rgba(148, 163, 184, 0.05);
}

.tarifas-table td {
  padding: 1rem;
  color: #e2e8f0;
}

.valor-tarifa {
  font-size: 1rem;
  font-weight: 600;
  color: #10b981;
}

.cell-edicion {
  padding: 0.5rem 1rem !important;
}

.input-tarifa {
  width: 100%;
  padding: 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 2px solid rgba(16, 185, 129, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 1rem;
  font-weight: 600;
  transition: all 0.2s;
}

.input-tarifa:focus {
  outline: none;
  border-color: #10b981;
  background-color: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.acciones {
  display: flex;
  gap: 0.5rem;
}

.acciones-edicion {
  display: flex;
  gap: 0.5rem;
}

.btn-save,
.btn-cancel {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
}

.btn-save {
  background-color: #10b981;
  color: #ffffff;
}

.btn-save:hover:not(:disabled) {
  background-color: #059669;
  box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.3);
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-cancel {
  background-color: #ef4444;
  color: #ffffff;
}

.btn-cancel:hover:not(:disabled) {
  background-color: #dc2626;
  box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.3);
}

.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Botón Tarifas por Hora */
.btn-tarifas {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #ffffff;
  border: none;
  border-radius: 0.5rem;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px -3px rgba(245, 158, 11, 0.3);
}

.btn-tarifas:hover {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px -3px rgba(245, 158, 11, 0.4);
}

.btn-tarifas:active {
  transform: translateY(0);
  box-shadow: 0 2px 10px -3px rgba(245, 158, 11, 0.3);
}

/* Botón Editar Tarifa */
.btn-edit-tarifa {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.2rem;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #ffffff;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px -2px rgba(59, 130, 246, 0.3);
}

.btn-edit-tarifa:hover {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -2px rgba(59, 130, 246, 0.4);
}

.btn-edit-tarifa:active {
  transform: translateY(0);
}

.edit-icon {
  font-size: 1rem;
  display: flex;
  align-items: center;
}

.edit-text {
  font-weight: 600;
  letter-spacing: 0.3px;
}

@media (max-width: 1024px) {
  .sueldos-header {
    flex-wrap: wrap;
    align-items: flex-end;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .header-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .header-btn {
    width: 100%;
    flex: 1 1 auto;
  }
}
</style>
