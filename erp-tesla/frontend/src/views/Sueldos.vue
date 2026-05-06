<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import { formatHoursAsClock, parseHoursInput } from "../utils/hourFormat"

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
const filtroBusqueda = ref("")

// Modal - Nuevo Pago
const showFormPago = ref(false)
const createInitialFormPago = () => ({
  monto: "",
  medio_pago: "Depósito",
  fecha: new Date().toISOString().split("T")[0],
  aplicar_redondeo: false,
  monto_redondeado: "",
  detalle: "",
})
const formPago = ref({
  ...createInitialFormPago()
})

// Modal - Editar Conceptos
const showFormConceptos = ref(false)
const crearConceptoExtraVacio = () => ({ descripcion: "", monto: 0, tipo: "suma" })
const normalizarConceptosExtra = (items = []) => {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => ({
      descripcion: String(item?.descripcion || item?.concepto || "").trim(),
      monto: toNumber(item?.monto),
      tipo: String(item?.tipo || item?.operacion || "suma").toLowerCase() === "resta" ? "resta" : "suma",
    }))
    .filter((item) => item.descripcion || item.monto > 0)
}

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
  dias_enfermedad: 0,
  dias_no_trabajados: 0,
  adelantos: 0,
  observaciones: "",
  adicional: 0,
  conceptos_extra: []
})
const formConceptosHorasInput = ref("0")
const formConceptosHorasExtra50Input = ref("0")
const formConceptosHorasExtra100Input = ref("0")

const toNumber = (valor) => {
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const roundMoney = (valor) => Math.round(toNumber(valor) * 100) / 100

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
  dias_enfermedad: toNumber(liq.dias_enfermedad),
  importe_feriados: toNumber(liq.importe_feriados),
  importe_enfermedad: toNumber(liq.importe_enfermedad),
  descuento_dias_no_trabajados: toNumber(liq.descuento_dias_no_trabajados),
  adelantos: toNumber(liq.adelantos),
  total: toNumber(liq.total),
  total_pagado: toNumber(liq.total_pagado),
  adicional: toNumber(liq.adicional),
  ajuste_conceptos_extra: toNumber(liq.ajuste_conceptos_extra),
  conceptos_extra: normalizarConceptosExtra(liq.conceptos_extra),
  reajuste_porcentaje: toNumber(liq.reajuste_porcentaje),
})

const normalizarPago = (pago = {}) => ({
  ...pago,
  monto: toNumber(pago.monto),
})

const crearFormularioConceptos = (liquidacion = {}, opciones = {}) => {
  const reiniciarHorasExtra = opciones.reiniciarHorasExtra === true

  return {
    total_horas: liquidacion.total_horas || 0,
    monto_bruto: liquidacion.monto_bruto || liquidacion.importe_horas || 0,
    presentismo: liquidacion.presentismo || 0,
    horas_extra_cantidad:  liquidacion.horas_extra_cantidad || 0,
    horas_extra_100_cantidad: liquidacion.horas_extra_100_cantidad || 0,
    no_remunerativo: liquidacion.no_remunerativo || 0,
    aguinaldo: liquidacion.aguinaldo || 0,
    vacaciones: liquidacion.vacaciones || 0,
    feriados_cantidad: liquidacion.feriados_cantidad || 0,
    dias_no_trabajados: liquidacion.dias_no_trabajados || 0,
    dias_enfermedad: toNumber(liquidacion.dias_enfermedad),
    adelantos: liquidacion.adelantos || 0,
    observaciones: liquidacion.observaciones || "",
    adicional: liquidacion.adicional || 0,
    conceptos_extra: normalizarConceptosExtra(liquidacion.conceptos_extra),
    reajuste_porcentaje: toNumber(liquidacion.reajuste_porcentaje),
  }
}

const formatearHoras = (valor) => formatHoursAsClock(valor)
const formatearCantidad = (valor) => formatHoursAsClock(valor)

const syncHorasInputConceptos = (valor) => {
  formConceptosHorasInput.value = formatHoursAsClock(valor)
}

const syncHorasExtra50Input = (valor) => {
  formConceptosHorasExtra50Input.value = formatHoursAsClock(valor)
}

const syncHorasExtra100Input = (valor) => {
  formConceptosHorasExtra100Input.value = formatHoursAsClock(valor)
}

const actualizarHorasConceptosDesdeInput = (valorRaw) => {
  formConceptosHorasInput.value = valorRaw
  const parsed = parseHoursInput(valorRaw)
  if (Number.isFinite(parsed)) {
    formConceptos.value.total_horas = parsed
  }
}

const actualizarHorasExtra50DesdeInput = (valorRaw) => {
  formConceptosHorasExtra50Input.value = valorRaw
  const parsed = parseHoursInput(valorRaw)
  if (Number.isFinite(parsed)) {
    formConceptos.value.horas_extra_cantidad = parsed
  }
}

const actualizarHorasExtra100DesdeInput = (valorRaw) => {
  formConceptosHorasExtra100Input.value = valorRaw
  const parsed = parseHoursInput(valorRaw)
  if (Number.isFinite(parsed)) {
    formConceptos.value.horas_extra_100_cantidad = parsed
  }
}

const normalizarHorasConceptosInput = () => {
  const parsed = parseHoursInput(formConceptosHorasInput.value)
  // Si el formato no es valido al perder foco, conservamos el ultimo valor numerico correcto.
  // Esto evita que el sueldo base se recalcule a cero por un typo temporal en el input.
  formConceptos.value.total_horas = Number.isFinite(parsed)
    ? parsed
    : toNumber(formConceptos.value.total_horas)
  syncHorasInputConceptos(formConceptos.value.total_horas)
}

// Cargar liquidaciones
const cargarLiquidaciones = async () => {
  loading.value = true
  error.value = ""

  try {
    const res = await api.getLiquidaciones(
      mesSeleccionado.value,
      anioSeleccionado.value,
      filtroEmpleado.value || undefined
    )

    liquidaciones.value = (res?.data || []).map(normalizarLiquidacion)
    await consultarEstadoCaja()
  } catch (err) {
    console.error("❌ Error al cargar liquidaciones:", err)
    error.value = "Error al cargar liquidaciones: " + (err.response?.data?.error || err.message)
    liquidaciones.value = []
  } finally {
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
  liquidacionSeleccionada.value = normalizarLiquidacion(liquidacion)
  vistaActual.value = "detalle"
  pagos.value = []
  
  loading.value = true
  try {
    const [resLiquidacion, resPagos] = await Promise.all([
      api.getLiquidacion(liquidacion.id),
      api.getPagos(liquidacion.id),
    ])

    const liquidacionActualizada = normalizarLiquidacion(resLiquidacion.data || liquidacion)
    liquidacionSeleccionada.value = liquidacionActualizada
    pagos.value = (resPagos.data || []).map(normalizarPago)

    // Cargar conceptos en el formulario usando el dato más fresco posible
    formConceptos.value = crearFormularioConceptos(liquidacionActualizada)
    syncHorasInputConceptos(formConceptos.value.total_horas)
  } catch (err) {
    console.error("Error al cargar detalle/pagos:", err)
    pagos.value = []
    error.value = err.response?.data?.error || "Error al cargar el detalle de la liquidación"
  } finally {
    loading.value = false
  }
}

const abrirEdicionLiquidacion = async (liquidacion) => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getLiquidacion(liquidacion.id)
    const liquidacionActualizada = normalizarLiquidacion(res.data || liquidacion)

    liquidacionSeleccionada.value = liquidacionActualizada
    formConceptos.value = crearFormularioConceptos(liquidacionActualizada)
    syncHorasInputConceptos(formConceptos.value.total_horas)
    syncHorasExtra50Input(formConceptos.value.horas_extra_cantidad)
    syncHorasExtra100Input(formConceptos.value.horas_extra_100_cantidad)
    showFormConceptos.value = true
  } catch (err) {
    console.error("Error al cargar liquidación para edición:", err)
    error.value = err.response?.data?.error || "Error al cargar la liquidación para edición"
  } finally {
    loading.value = false
  }
}

const agregarConceptoExtra = () => {
  formConceptos.value.conceptos_extra.push(crearConceptoExtraVacio())
}

const eliminarConceptoExtra = (index) => {
  formConceptos.value.conceptos_extra.splice(index, 1)
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

  if (!redondeoPagoHabilitado.value && toNumber(formPago.value.monto) > faltaPagar.value) {
    error.value = `Debe ingresar un monto igual o inferior a ${formatearMoneda(faltaPagar.value)}`
    return
  }

  if (redondeoPagoHabilitado.value && montoPagoFinal.value < toNumber(formPago.value.monto)) {
    error.value = "El monto redondeado no puede ser menor al importe a cancelar"
    return
  }

  loading.value = true
  try {
    await api.createPago(liquidacionSeleccionada.value.id, {
      monto: parseFloat(formPago.value.monto),
      medio_pago: formPago.value.medio_pago,
      fecha: formPago.value.fecha,
      permitir_redondeo: redondeoPagoHabilitado.value,
      monto_redondeado: redondeoPagoHabilitado.value ? montoPagoFinal.value : undefined,
      detalle: formPago.value.detalle || undefined,
    })
    await verDetalle(liquidacionSeleccionada.value)
    cerrarFormPago()
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

const totalLiquidacionDetalle = computed(() => {
  return toNumber(liquidacionSeleccionada.value?.total ?? liquidacionSeleccionada.value?.monto_neto)
})

const faltaPagar = computed(() => {
  const restante = totalLiquidacionDetalle.value - totalPagado.value
  return Math.max(0, Math.round(restante * 100) / 100)
})

const redondeoPagoHabilitado = computed(() => {
  return formPago.value.medio_pago === "Efectivo" && formPago.value.aplicar_redondeo
})

const montoPagoFinal = computed(() => {
  return redondeoPagoHabilitado.value
    ? roundMoney(formPago.value.monto_redondeado)
    : roundMoney(formPago.value.monto)
})

const diferenciaRedondeoPago = computed(() => {
  if (!redondeoPagoHabilitado.value) return 0
  return Math.max(0, roundMoney(montoPagoFinal.value - toNumber(formPago.value.monto)))
})

const estaPagadaDetalle = computed(() => {
  return faltaPagar.value <= 0.01
})



const resetFormPago = () => {
  formPago.value = createInitialFormPago()
}

const abrirFormPago = () => {
  resetFormPago()
  formPago.value.monto = faltaPagar.value > 0 ? faltaPagar.value : ""
  formPago.value.monto_redondeado = formPago.value.monto
  showFormPago.value = true
}

const cerrarFormPago = () => {
  showFormPago.value = false
  resetFormPago()
}

const valorHoraDetalle = computed(() => {
  const valorHoraEmpleado = getValorHoraEmpleado(liquidacionSeleccionada.value?.empleado_id)
  return valorHoraEmpleado || toNumber(liquidacionSeleccionada.value?.valor_hora)
})

const sueldoBaseCalculadoPreview = computed(() => {
  const horas = toNumber(formConceptos.value.total_horas)
  const valorHora = getValorHoraEmpleado(liquidacionSeleccionada.value?.empleado_id) || toNumber(liquidacionSeleccionada.value?.valor_hora)
  return Math.round(horas * valorHora * 100) / 100
})

const estaAGenerar = (liq) => {
  return Number(liq?.total || 0) === 0 &&
         Number(liq?.monto_neto || 0) === 0
}

const importeHorasExtra50Preview = computed(() => {
  return toNumber(formConceptos.value.horas_extra_cantidad) * valorHoraDetalle.value * 1.5
})

const importeHorasExtra100Preview = computed(() => {
  return toNumber(formConceptos.value.horas_extra_100_cantidad) * valorHoraDetalle.value * 2
})

const horasExtraRegistradas50 = computed(() => {
  return toNumber(liquidacionSeleccionada.value?.horas_extra_registradas_50)
})

const horasExtraRegistradas100 = computed(() => {
  return toNumber(liquidacionSeleccionada.value?.horas_extra_registradas_100)
})

const importeFeriadosPreview = computed(() => {
  return toNumber(formConceptos.value.feriados_cantidad) * 8 * valorHoraDetalle.value
})

const importeEnfermedadPreview = computed(() => {
  return toNumber(formConceptos.value.dias_enfermedad) * 8 * valorHoraDetalle.value
})

const descuentoDiasNoTrabajadosPreview = computed(() => {
  return toNumber(formConceptos.value.dias_no_trabajados) * 8 * valorHoraDetalle.value
})

const totalConceptosExtrasPreview = computed(() => {
  return normalizarConceptosExtra(formConceptos.value.conceptos_extra).reduce((sum, item) => {
    return sum + (item.tipo === "resta" ? -toNumber(item.monto) : toNumber(item.monto))
  }, 0)
})

const totalRedondeoPagosDetalle = computed(() => {
  return normalizarConceptosExtra(liquidacionSeleccionada.value?.conceptos_extra || []).reduce((sum, item) => {
    const descripcion = String(item?.descripcion || "").toLowerCase()
    if (!descripcion.startsWith("redondeo pago efectivo")) return sum
    return sum + toNumber(item.monto)
  }, 0)
})

const liquidacionesFiltradas = computed(() => {
  const termino = filtroBusqueda.value.trim().toLowerCase()
  if (!termino) return liquidaciones.value

  return liquidaciones.value.filter((liquidacion) => {
    const empleado = getNombreEmpleado(liquidacion.empleado_id)
    const periodo = `${liquidacion.mes}/${liquidacion.anio}`
    const searchable = [
      empleado,
      periodo,
      liquidacion.estado,
      formatearHoras(liquidacion.horas_computadas),
      formatearMoneda(liquidacion.total),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    return searchable.includes(termino)
  })
})

const liquidacionesPagadasCount = computed(() => liquidaciones.value.filter((liq) => String(liq.estado) === "pagada").length)
const liquidacionesPendientesCount = computed(() => liquidaciones.value.filter((liq) => String(liq.estado) !== "pagada").length)

const totalPagadoMes = computed(() => {
  return liquidaciones.value.reduce((sum, liq) => {
    return sum + toNumber(liq.total_pagado)
  }, 0)
})


// Importar sueldos a Caja Tesla
const mostrarImportarModal = ref(false)
const importandoCaja = ref(false)
const importCajaResult = ref(null)
const importCajaEstado = ref(null) // null | { estado: "no_importado"|"importado"|"desactualizado"|"sin_pagos", buckets: [] }
const cargandoEstadoCaja = ref(false)
const cargandoResumenCaja = ref(false)
const resumenImportCaja = ref(null)

const consultarEstadoCaja = async () => {
  if (totalPagadoMes.value <= 0) { importCajaEstado.value = null; return }
  cargandoEstadoCaja.value = true
  try {
    const { data } = await api.getEstadoImportacionSueldos(mesSeleccionado.value, anioSeleccionado.value)
    importCajaEstado.value = data
  } catch (_) {
    importCajaEstado.value = null
  } finally {
    cargandoEstadoCaja.value = false
  }
}

const labelBotonImportar = computed(() => {
  if (!importCajaEstado.value || importCajaEstado.value.estado === "no_importado") return "Importar a Caja Tesla"
  if (importCajaEstado.value.estado === "desactualizado") return "Reimportar a Caja Tesla"
  return "Importar a Caja Tesla"
})

const abrirImportarModal = () => {
  if (totalPagadoMes.value <= 0) return
  importCajaResult.value = null
  resumenImportCaja.value = null
  mostrarImportarModal.value = true
  void cargarResumenImportacionCaja()
}

const cerrarImportarModal = () => {
  mostrarImportarModal.value = false
  importCajaResult.value = null
}

const cargarResumenImportacionCaja = async () => {
  cargandoResumenCaja.value = true
  try {
    const { data } = await api.getResumenImportacionSueldos(mesSeleccionado.value, anioSeleccionado.value)
    resumenImportCaja.value = data
  } catch (err) {
    resumenImportCaja.value = { error: err.response?.data?.error || err.message }
  } finally {
    cargandoResumenCaja.value = false
  }
}

const imprimirResumenImportacionCajaLocal = () => {
  const resumen = resumenImportCaja.value
  if (!resumen || resumen.error) return

  const empleados = Array.isArray(resumen.empleados) ? resumen.empleados : []
  const filas = empleados.map((e) => {
    const nombre = `${e.apellido || ""} ${e.nombre || ""}`.trim() || `Empleado ${e.empleado_id}`
    return `
      <tr>
        <td style="padding:8px;border:1px solid #999;">${nombre}</td>
        <td style="padding:8px;border:1px solid #999;text-align:right;">${formatearMoneda(e.efectivo)}</td>
        <td style="padding:8px;border:1px solid #999;text-align:right;">${formatearMoneda(e.total)}</td>
      </tr>
    `
  }).join("")

  const html = `
    <html>
      <head><title>Resumen importación sueldos</title></head>
      <body style="font-family:Arial,sans-serif;padding:18px;">
        <h2 style="margin:0 0 8px 0;">Resumen previo de importación a Caja Tesla</h2>
        <p style="margin:0 0 14px 0;">Período: ${resumen.periodo || "-"}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr>
              <th style="padding:8px;border:1px solid #999;text-align:left;">Empleado</th>
              <th style="padding:8px;border:1px solid #999;text-align:right;">Efectivo</th>
              <th style="padding:8px;border:1px solid #999;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr>
              <td style="padding:8px;border:1px solid #999;"><strong>Totales</strong></td>
              <td style="padding:8px;border:1px solid #999;text-align:right;"><strong>${formatearMoneda(resumen?.totales?.efectivo)}</strong></td>
              <td style="padding:8px;border:1px solid #999;text-align:right;"><strong>${formatearMoneda(resumen?.totales?.total)}</strong></td>
            </tr>
          </tfoot>
        </table>
        <p style="margin-top:12px;font-size:12px;">A Caja Tesla se importa solo efectivo: <strong>${formatearMoneda(resumen?.importara_a_caja)}</strong></p>
      </body>
    </html>
  `

  const w = window.open("", "_blank", "width=980,height=760")
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

const extraerMensajeErrorPdf = async (err) => {
  const data = err?.response?.data
  if (!data) return "Error al generar PDF del resumen"

  if (data instanceof Blob) {
    try {
      const text = await data.text()
      try {
        const parsed = JSON.parse(text)
        return parsed?.error || parsed?.mensaje || text || "Error al generar PDF del resumen"
      } catch {
        return text || "Error al generar PDF del resumen"
      }
    } catch {
      return "Error al generar PDF del resumen"
    }
  }

  return data?.error || data?.mensaje || err?.message || "Error al generar PDF del resumen"
}

const imprimirResumenImportacionCaja = async () => {
  if (!resumenImportCaja.value || resumenImportCaja.value.error) return

  try {
    const res = await api.getResumenImportacionSueldosPdf(mesSeleccionado.value, anioSeleccionado.value)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `resumen_importacion_sueldos_${anioSeleccionado.value}-${String(mesSeleccionado.value).padStart(2, "0")}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = await extraerMensajeErrorPdf(err)
    imprimirResumenImportacionCajaLocal()
  }
}

const confirmarImportarACaja = async () => {
  if (importandoCaja.value) return
  importandoCaja.value = true
  importCajaResult.value = null
  try {
    const { data } = await api.importarSueldosACaja(mesSeleccionado.value, anioSeleccionado.value)
    importCajaResult.value = data
    await consultarEstadoCaja()
  } catch (err) {
    importCajaResult.value = { status: "error", mensaje: err.response?.data?.error || err.message }
  } finally {
    importandoCaja.value = false
  }
}

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

const refrescarSueldosEnTiempoReal = async () => {
  await cargarLiquidaciones()

  if (vistaActual.value === "detalle" && liquidacionSeleccionada.value?.id) {
    await verDetalle(liquidacionSeleccionada.value)
  }
}

onMounted(async () => {
  await Promise.all([cargarLiquidaciones(), cargarEmpleados()])
  socket.on('liquidaciones:changed', refrescarSueldosEnTiempoReal)
  socket.on('horas:changed', refrescarSueldosEnTiempoReal)
})
onUnmounted(() => {
  socket.off('liquidaciones:changed', refrescarSueldosEnTiempoReal)
  socket.off('horas:changed', refrescarSueldosEnTiempoReal)
})

const puedeDescargarPdfLiquidacion = computed(() => !!liquidacionSeleccionada.value)


</script>

<template>
  <LayoutShell
    title="Sueldos y Liquidaciones"
    subtitle="Generación de liquidaciones y registro de pagos"
  >
    <div class="sueldos-container">
      <!-- VISTA: LISTA DE LIQUIDACIONES -->
      <div v-if="vistaActual === 'lista'" class="sueldos-list-view">
        <section class="sueldos-topbar">
          <div class="sueldos-topbar-copy">
            <span class="section-kicker">Gestión salarial</span>
            <h2>Liquidaciones mensuales</h2>
          </div>
          <div class="header-actions">
            <button class="btn-primary header-btn" @click="cargarLiquidaciones">
              ↻ Actualizar automáticamente
            </button>
            <button class="btn-tarifas header-btn" @click="vistaActual = 'tarifas'">
              💰 Configurar Tarifas
            </button>
          </div>
        </section>

        <section class="sueldos-stats">
          <article class="sueldo-stat-card sueldo-stat-card-primary">
            <span>Total liquidaciones</span>
            <strong>{{ liquidaciones.length }}</strong>
            <small>Registros del período actualmente consultado.</small>
          </article>
          <article class="sueldo-stat-card sueldo-stat-card-paid">
            <span>Pagadas</span>
            <strong>{{ liquidacionesPagadasCount }}</strong>
            <small>Liquidaciones completamente cubiertas.</small>
          </article>
          <article class="sueldo-stat-card sueldo-stat-card-pending">
            <span>Pendientes</span>
            <strong>{{ liquidacionesPendientesCount }}</strong>
            <small>Liquidaciones con saldo aún pendiente.</small>
          </article>
          <article class="sueldo-stat-card sueldo-stat-card-total-paid">
            <span>Total pagado</span>
            <strong>{{ formatearMoneda(totalPagadoMes) }}</strong>
            <small>Suma de todos los pagos registrados en las liquidaciones del período.</small>
            <button
              class="btn-importar-caja"
              :disabled="totalPagadoMes <= 0"
              @click="abrirImportarModal"
            >
              {{ labelBotonImportar }}
            </button>
          </article>
        </section>

        <section class="sueldos-toolbar">
          <div class="filtros filtros-sueldo">
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
            <label class="sueldos-search-field">
              <span>Buscar en tiempo real</span>
              <input
                v-model="filtroBusqueda"
                type="text"
                placeholder="Empleado, período, estado o total"
              />
            </label>
          </div>
          <div class="sueldos-toolbar-count">
            Mostrando {{ liquidacionesFiltradas.length }} de {{ liquidaciones.length }} liquidaciones
          </div>
        </section>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <!-- Tabla de liquidaciones -->
        <div v-if="!loading && liquidacionesFiltradas.length > 0" class="sueldos-table-shell">
          <div class="sueldos-table-header-row">
            <div>
              <span class="section-kicker">Listado</span>
              <h3>Liquidaciones generadas</h3>
            </div>
          </div>

          <div class="sueldos-table">
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
              <tr v-for="liq in liquidacionesFiltradas" :key="liq.id">
                <td><strong>{{ getNombreEmpleado(liq.empleado_id) }}</strong></td>
                <td>{{ liq.mes }}/{{ liq.anio }}</td>
                <td>{{ formatearHoras(liq.horas_computadas) }}</td>
                <td>{{ formatearMoneda(liq.monto_bruto || 0) }}</td>
                <td><strong>{{ formatearMoneda(liq.total) }}</strong></td>
                <td>
                  <span :class="['badge', estaAGenerar(liq) ? 'badge-generar' : (liq.estado === 'pagada' ? 'badge-pagada' : 'badge-pendiente')]">
                    {{ estaAGenerar(liq) ? "A GENERAR" : (liq.estado === "pagada" ? "PAGADA" : "PENDIENTE") }}
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
        </div>

        <!-- Estado vacío -->
        <div v-if="!loading && liquidaciones.length === 0" class="empty-state">
          <p>No hay liquidaciones para este período</p>
          <button class="btn-primary" @click="cargarLiquidaciones">
            Generar automáticamente
          </button>
        </div>

        <div v-if="!loading && liquidaciones.length > 0 && liquidacionesFiltradas.length === 0" class="empty-state empty-state-search">
          <p>No hay coincidencias para la búsqueda actual</p>
          <button class="btn-secondary" @click="filtroBusqueda = ''">Limpiar búsqueda</button>
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
            <button
              class="btn-pdf"
              @click="descargarPdfLiquidacion"
              :disabled="loading"
              :title="'Descargar PDF de liquidación'"
            >
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
              <span :class="['badge', estaAGenerar(liquidacionSeleccionada) ? 'badge-generar' : (estaPagadaDetalle ? 'badge-pagada' : 'badge-pendiente')]">
                {{ estaAGenerar(liquidacionSeleccionada) ? "A GENERAR" : (estaPagadaDetalle ? "PAGADA" : "PENDIENTE") }}
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
              <span class="desglose-valor">{{ formatearMoneda(liquidacionSeleccionada.monto_bruto || 0) }}</span>
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
              <span>Días por enfermedad ({{ formatearCantidad(liquidacionSeleccionada.dias_enfermedad) }} días):</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.importe_enfermedad) }}</span>
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
            <div class="concepto">
              <span>Adicional:</span>
              <span>{{ formatearMoneda(liquidacionSeleccionada.adicional) }}</span>
            </div>
            <div
              v-for="(conceptoExtra, index) in liquidacionSeleccionada.conceptos_extra || []"
              :key="`${conceptoExtra.descripcion}-${index}`"
              class="concepto"
            >
              <span>{{ conceptoExtra.descripcion }}<template v-if="conceptoExtra.tipo === 'resta'"> (resta)</template>:</span>
              <span :class="conceptoExtra.tipo === 'resta' ? 'concepto-negativo' : ''">
                {{ conceptoExtra.tipo === "resta" ? "-" : "" }}{{ formatearMoneda(conceptoExtra.monto) }}
              </span>
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
              <span class="resumen-valor">{{ formatearMoneda(totalLiquidacionDetalle) }}</span>
            </div>
            <div class="resumen-item">
              <span class="resumen-label">Total pagado:</span>
              <span class="resumen-valor pagado">{{ formatearMoneda(totalPagado) }}</span>
              <small v-if="totalRedondeoPagosDetalle > 0" class="resumen-detalle-extra">
                Incluye {{ formatearMoneda(totalRedondeoPagosDetalle) }} de diferencia por redondeo en efectivo.
              </small>
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
              @click="abrirFormPago"
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
        <div class="tarifas-header tarifas-topbar">
          <button class="btn-volver" @click="volverALista">
            ← Volver a la lista
          </button>
          <div class="tarifas-topbar-copy">
            <span class="section-kicker">Configuración salarial</span>
            <h2>Configurar tarifas por hora</h2>
            <p>Actualizá el valor hora de cada empleado con una vista más clara y operativa.</p>
          </div>
        </div>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <!-- Tabla de empleados -->
        <div v-if="!loading && empleados.length > 0" class="tarifas-table-shell">
          <div class="sueldos-table-header-row">
            <div>
              <span class="section-kicker">Tarifario</span>
              <h3>Valores por empleado</h3>
            </div>
          </div>

          <div class="tarifas-table">
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
                    @wheel.prevent
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
            <div class="modal-header-copy modal-header-copy-conceptos">
              <span class="modal-kicker">Liquidacion manual</span>
              <h3>Editar conceptos adicionales</h3>
              <p>Revisá horas, ajustes y conceptos manuales antes de guardar la liquidación del período.</p>
            </div>
            <button type="button" class="btn-close" aria-label="Cerrar modal" @click="showFormConceptos = false">×</button>
          </div>

          <form @submit.prevent="actualizarConceptos" class="modal-form modal-form-conceptos">
            <div class="conceptos-modal-summary">
              <div class="conceptos-summary-pill">
                <span>Empleado</span>
                <strong>{{ getNombreEmpleado(liquidacionSeleccionada?.empleado_id) }}</strong>
              </div>
              <div class="conceptos-summary-pill">
                <span>Periodo</span>
                <strong>{{ liquidacionSeleccionada?.mes }}/{{ liquidacionSeleccionada?.anio }}</strong>
              </div>
              <div class="conceptos-summary-pill">
                <span>Valor hora</span>
                <strong>{{ formatearMoneda(getValorHoraEmpleado(liquidacionSeleccionada?.empleado_id) || liquidacionSeleccionada?.valor_hora) }}</strong>
              </div>
            </div>

            <section class="conceptos-form-section">
              <div class="conceptos-form-section-header">
                <div>
                  <span class="section-kicker">Base de liquidacion</span>
                  <h4>Horas y sueldo base</h4>
                </div>
                <small>Podés recalcular desde horas y luego ajustar el valor final manualmente.</small>
              </div>

              <div class="conceptos-form-grid conceptos-form-grid-primary">
                <label class="form-group form-card-field">
                  <span>Horas computadas / pagadas</span>
                  <input
                    :value="formConceptosHorasInput"
                    type="text"
                    @wheel.prevent
                    inputmode="decimal"
                    placeholder="Ej: 8.30"
                    @input="actualizarHorasConceptosDesdeInput($event.target.value)"
                    @blur="normalizarHorasConceptosInput"
                  />
                  <small class="form-help">Al cambiar este valor, se autocalcula el sueldo base con el valor hora del empleado. Después podés retocarlo manualmente.</small>
                  <small class="form-help">Formato hora real. Ejemplo: 0.30 = media hora, 8.30 = ocho horas y media.</small>
                </label>

                <label class="form-group form-card-field">
                  <span>Sueldo base ($)</span>
                  <input v-model.number="formConceptos.monto_bruto" type="number" min="0" step="0.01" @wheel.prevent />
                  <small class="form-help">Administración puede ajustarlo manualmente sin depender de las horas cargadas.</small>
                  <small class="form-help">
                    Cálculo automático: {{ formatearHoras(formConceptos.total_horas) }} hs × {{ formatearMoneda(getValorHoraEmpleado(liquidacionSeleccionada?.empleado_id) || liquidacionSeleccionada?.valor_hora) }} = {{ formatearMoneda(sueldoBaseCalculadoPreview) }}
                  </small>
                </label>

                <label class="form-group form-card-field">
                  <span>Reajuste sobre valor hora (%)</span>
                  <input v-model.number="formConceptos.reajuste_porcentaje" type="number" min="0" step="0.01" @wheel.prevent placeholder="0" />
                  <small class="form-help">Porcentaje de ajuste aplicado al valor hora en este período. Se muestra en el recibo.</small>
                </label>

                <label class="form-group form-card-field">
                  <span>Presentismo ($)</span>
                  <input v-model.number="formConceptos.presentismo" type="number" min="0" step="0.01" @wheel.prevent />
                  <small class="form-help">Usalo para reflejar asistencia perfecta o premios fijos del período.</small>
                </label>
              </div>
            </section>

            <section class="conceptos-form-section conceptos-form-section-highlighted">
              <div class="conceptos-form-section-header">
                <div>
                  <span class="section-kicker">Variables del periodo</span>
                  <h4>Horas extra y adicionales legales</h4>
                </div>
                <small>Compará lo liquidado contra lo que vino cargado en horas.</small>
              </div>

              <div class="overtime-edit-grid">
                <label class="form-group overtime-edit-card">
                  <span>Horas extra a liquidar al 50%</span>
                  <input :value="formConceptosHorasExtra50Input" @input="actualizarHorasExtra50DesdeInput($event.target.value)" type="text" placeholder="ej: 16.15" />
                  <small class="form-help">Importe calculado: {{ formatearMoneda(importeHorasExtra50Preview) }}</small>
                  <div class="overtime-source-note">
                    <span>Registradas en horas:</span>
                    <strong>{{ formatearHoras(liquidacionSeleccionada.horas_extra_registradas_50) }} hs</strong>
                  </div>
                </label>

                <label class="form-group overtime-edit-card">
                  <span>Horas extra a liquidar al 100%</span>
                  <input :value="formConceptosHorasExtra100Input" @input="actualizarHorasExtra100DesdeInput($event.target.value)" type="text" placeholder="ej: 4.30" />
                  <small class="form-help">Importe calculado: {{ formatearMoneda(importeHorasExtra100Preview) }}</small>
                  <div class="overtime-source-note">
                    <span>Registradas en horas:</span>
                    <strong>{{ formatearHoras(liquidacionSeleccionada.horas_extra_registradas_100) }} hs</strong>
                  </div>
                </label>
              </div>

              <div class="conceptos-form-grid conceptos-form-grid-secondary">
                <label class="form-group form-card-field">
                  <span>No remunerativo ($)</span>
                  <input v-model.number="formConceptos.no_remunerativo" type="number" min="0" step="0.01" @wheel.prevent />
                </label>

                <label class="form-group form-card-field">
                  <span>Aguinaldo ($)</span>
                  <input v-model.number="formConceptos.aguinaldo" type="number" min="0" step="0.01" @wheel.prevent />
                </label>

                <label class="form-group form-card-field">
                  <span>Vacaciones ($)</span>
                  <input v-model.number="formConceptos.vacaciones" type="number" min="0" step="0.01" @wheel.prevent />
                </label>

                <label class="form-group form-card-field">
                  <span>Feriados (cantidad de días)</span>
                  <input v-model.number="formConceptos.feriados_cantidad" type="number" min="0" step="1" @wheel.prevent />
                  <small class="form-help">Cada feriado suma 8 horas al valor común. Importe calculado: {{ formatearMoneda(importeFeriadosPreview) }}</small>
                </label>

                <label class="form-group form-card-field">
                  <span>Días por enfermedad (cantidad)</span>
                  <input v-model.number="formConceptos.dias_enfermedad" type="number" min="0" step="1" @wheel.prevent />
                  <small class="form-help">Cada día suma 8 horas al valor común. Importe calculado: {{ formatearMoneda(importeEnfermedadPreview) }}</small>
                </label>

                <label class="form-group form-card-field">
                  <span>Días no trabajados (cantidad)</span>
                  <input v-model.number="formConceptos.dias_no_trabajados" type="number" min="0" step="1" @wheel.prevent />
                  <small class="form-help">Se descuenta 8 horas por día faltado. Descuento calculado: -{{ formatearMoneda(descuentoDiasNoTrabajadosPreview) }}</small>
                </label>

                <label class="form-group form-card-field">
                  <span>Adelantos ($)</span>
                  <input v-model.number="formConceptos.adelantos" type="number" min="0" step="0.01" @wheel.prevent />
                </label>

                <label class="form-group form-card-field form-card-field-accent">
                  <span>Adicional ($)</span>
                  <input v-model.number="formConceptos.adicional" type="number" min="0" step="0.01" @wheel.prevent />
                  <small class="form-help">Monto adicional a sumar a la liquidación (bonos, premios, etc).</small>
                </label>
              </div>
            </section>

            <section class="conceptos-form-section">
              <div class="conceptos-form-section-header">
                <div>
                  <span class="section-kicker">Ajustes puntuales</span>
                  <h4>Conceptos manuales y anotaciones</h4>
                </div>
                <small>Estos conceptos impactan también en el PDF de la liquidación.</small>
              </div>

            <div class="form-group form-group-conceptos-extra">
              <div class="conceptos-extra-header">
                <div>
                  <span>Conceptos manuales</span>
                  <small class="form-help conceptos-extra-subtitle">Sumá bonos, descuentos o ajustes puntuales que no vienen de horas.</small>
                </div>
                <button type="button" class="btn-secondary btn-small btn-concepto-add" @click="agregarConceptoExtra">
                  + Agregar concepto
                </button>
              </div>

              <div class="conceptos-extra-summary">
                <span>Impacto total</span>
                <strong :class="{ negativo: totalConceptosExtrasPreview < 0 }">
                  {{ totalConceptosExtrasPreview >= 0 ? "+" : "" }}{{ formatearMoneda(totalConceptosExtrasPreview) }}
                </strong>
              </div>

              <div v-if="formConceptos.conceptos_extra.length === 0" class="conceptos-extra-empty">
                <strong>Sin conceptos manuales cargados</strong>
                <span>Cuando agregues uno, va a aparecer en conceptos adicionales y también en el PDF.</span>
              </div>

              <div
                v-for="(conceptoExtra, index) in formConceptos.conceptos_extra"
                :key="`extra-${index}`"
                class="concepto-extra-row"
              >
                <div class="concepto-extra-row-top">
                  <span class="concepto-extra-index">Concepto {{ index + 1 }}</span>
                  <button type="button" class="btn-delete-small" @click="eliminarConceptoExtra(index)">
                    Quitar
                  </button>
                </div>
                <div class="concepto-extra-fields">
                  <label>
                    <span>Descripción</span>
                    <input v-model="conceptoExtra.descripcion" type="text" placeholder="Ej: Bono productividad" />
                  </label>
                  <label>
                    <span>Monto</span>
                    <input v-model.number="conceptoExtra.monto" type="number" min="0" step="0.01" placeholder="0.00" @wheel.prevent />
                  </label>
                  <label>
                    <span>Impacto</span>
                    <select v-model="conceptoExtra.tipo">
                      <option value="suma">Suma</option>
                      <option value="resta">Resta</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

              <label class="form-group form-card-field conceptos-notes-field">
                <span>Observaciones</span>
                <textarea v-model="formConceptos.observaciones" rows="3" placeholder="Notas del período, adelantos, aclaraciones..."></textarea>
                <small class="form-help">Este texto sirve para dejar contexto interno y también observaciones que después pueden verse en el detalle.</small>
              </label>
            </section>

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
      <div v-if="showFormPago" class="modal-overlay" @click.self="cerrarFormPago">
        <div class="modal">
          <div class="modal-header">
            <h3>Registrar pago</h3>
            <button class="btn-close" @click="cerrarFormPago">×</button>
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
                @wheel.prevent
                min="0"
                step="0.01"
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

            <label v-if="formPago.medio_pago === 'Efectivo'" class="form-group checkbox">
              <input v-model="formPago.aplicar_redondeo" type="checkbox" />
              <span>Permitir redondeo de pago en efectivo</span>
            </label>

            <label v-if="redondeoPagoHabilitado" class="form-group">
              <span>Monto final pagado ($)</span>
              <input
                v-model.number="formPago.monto_redondeado"
                type="number"
                @wheel.prevent
                min="0"
                step="0.01"
                required
              />
              <small class="form-help">
                Diferencia por redondeo: {{ formatearMoneda(diferenciaRedondeoPago) }}.
                Se registrará como ajuste dentro de la liquidación.
              </small>
            </label>

            <label class="form-group">
              <span>Fecha</span>
              <input v-model="formPago.fecha" type="date" />
            </label>

            <label class="form-group">
              <span>Detalle (opcional)</span>
              <input v-model="formPago.detalle" type="text" placeholder="Ej: Adelanto quincena, pago parcial..." />
            </label>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Registrando..." : "Registrar pago" }}
              </button>
              <button type="button" class="btn-secondary" @click="cerrarFormPago">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Modal - Importar sueldos a Caja Tesla -->
      <div v-if="mostrarImportarModal" class="modal-overlay" @click.self="cerrarImportarModal">
        <div class="modal modal-importar-caja">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="modal-kicker">Caja Tesla</span>
              <h2>Importar sueldos del período</h2>
            </div>
            <button type="button" class="btn-close" @click="cerrarImportarModal">×</button>
          </div>

          <div class="modal-body importar-caja-body">
            <div v-if="cargandoResumenCaja" class="importar-caja-empty">Cargando resumen...</div>
            <div v-else-if="resumenImportCaja?.error" class="importar-caja-resultado resultado-error">
              Error al cargar resumen: {{ resumenImportCaja.error }}
            </div>

            <!-- Resumen previo separado por medio -->
            <div class="importar-caja-resumen-box">
              <table class="importar-caja-tabla">
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th class="col-monto">Efectivo</th>
                    <th class="col-monto">Total pagado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="emp in (resumenImportCaja?.empleados || [])" :key="emp.empleado_id">
                    <td>{{ `${emp.apellido || ''} ${emp.nombre || ''}`.trim() || getNombreEmpleado(emp.empleado_id) }}</td>
                    <td class="col-monto">{{ formatearMoneda(emp.efectivo) }}</td>
                    <td class="col-monto">{{ formatearMoneda(emp.total) }}</td>
                  </tr>
                  <tr v-if="(resumenImportCaja?.empleados || []).length === 0">
                    <td colspan="3" class="importar-caja-empty">Sin pagos registrados en este período</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr class="importar-caja-total">
                    <td>Total</td>
                    <td class="col-monto">{{ formatearMoneda(resumenImportCaja?.totales?.efectivo || 0) }}</td>
                    <td class="col-monto">{{ formatearMoneda(resumenImportCaja?.totales?.total || 0) }}</td>
                  </tr>
                </tfoot>
              </table>

              <p class="importar-caja-nota">
                Se importa a Caja Tesla solo efectivo: <strong>{{ formatearMoneda(resumenImportCaja?.importara_a_caja || 0) }}</strong>
              </p>
            </div>

            <!-- Estado previo (antes de confirmar) -->
            <template v-if="!importCajaResult && importCajaEstado">
              <template v-if="importCajaEstado.estado === 'desactualizado'">
                <div
                  v-for="b in importCajaEstado.buckets.filter(b => b.cambio || !b.importado)"
                  :key="b.medio"
                  class="importar-caja-resultado resultado-actualizado"
                >
                  <strong>{{ b.medio === 'efectivo' ? 'Efectivo' : 'Depósito' }}:</strong>
                  <template v-if="!b.importado">
                    Sin importar — se creará por {{ formatearMoneda(b.montoActual) }}
                  </template>
                  <template v-else>
                    Monto cambió: {{ formatearMoneda(b.montoEnCaja) }} → {{ formatearMoneda(b.montoActual) }}
                  </template>
                </div>
              </template>
              <template v-else-if="importCajaEstado.estado === 'importado'">
                <div class="importar-caja-resultado resultado-sin_cambios">
                  Ya importado. Podés reimportar si hubo cambios en los pagos.
                </div>
              </template>
            </template>

            <!-- Resultado después de importar -->
            <template v-if="importCajaResult">
              <div v-if="importCajaResult.status === 'error'" class="importar-caja-resultado resultado-error">
                Error: {{ importCajaResult.mensaje }}
              </div>
              <div v-else-if="importCajaResult.status === 'sin_pagos'" class="importar-caja-resultado resultado-sin_pagos">
                {{ importCajaResult.mensaje }}
              </div>
              <template v-else>
                <div
                  v-for="r in importCajaResult.resultados"
                  :key="r.medio"
                  class="importar-caja-resultado"
                  :class="`resultado-${r.status}`"
                >
                  <strong>{{ r.medio === 'efectivo' ? 'Efectivo' : 'Depósito' }}:</strong>
                  <template v-if="r.status === 'creado'">
                    ✓ Movimiento creado por {{ formatearMoneda(r.monto) }}
                  </template>
                  <template v-else-if="r.status === 'actualizado'">
                    ↑ Actualizado: {{ formatearMoneda(r.montoAnterior) }} → {{ formatearMoneda(r.montoNuevo) }}
                  </template>
                  <template v-else-if="r.status === 'sin_cambios'">
                    Sin cambios ({{ formatearMoneda(r.monto) }})
                  </template>
                </div>
              </template>
            </template>
          </div>

          <div class="modal-actions importar-caja-actions">
            <template v-if="!importCajaResult || importCajaResult.status === 'error'">
              <button
                class="btn-secondary"
                :disabled="cargandoResumenCaja || !resumenImportCaja || !!resumenImportCaja.error"
                @click="imprimirResumenImportacionCaja"
              >
                Imprimir resumen
              </button>
              <button
                class="btn-primary"
                :disabled="importandoCaja || totalPagadoMes <= 0"
                @click="confirmarImportarACaja"
              >
                <template v-if="importandoCaja">Importando...</template>
                <template v-else-if="importCajaEstado?.estado === 'desactualizado'">Reimportar a Caja Tesla</template>
                <template v-else-if="importCajaEstado?.estado === 'importado'">Reimportar a Caja Tesla</template>
                <template v-else>Importar a Caja Tesla</template>
              </button>
              <button class="btn-secondary" @click="cerrarImportarModal">Cancelar</button>
            </template>
            <template v-else>
              <button
                class="btn-secondary"
                :disabled="cargandoResumenCaja || !resumenImportCaja || !!resumenImportCaja.error"
                @click="imprimirResumenImportacionCaja"
              >
                Imprimir resumen
              </button>
              <button class="btn-primary" :disabled="importandoCaja" @click="confirmarImportarACaja">
                {{ importandoCaja ? 'Importando...' : 'Reimportar a Caja Tesla' }}
              </button>
              <button class="btn-secondary" @click="cerrarImportarModal">Cerrar</button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.sueldos-container {
  padding: 1.5rem;
  display: grid;
  gap: 1.75rem;
}

.sueldos-list-view {
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

.sueldos-topbar,
.sueldos-toolbar,
.sueldos-table-shell,
.sueldo-stat-card,
.empty-state {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.45);
}

.sueldos-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.sueldos-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.sueldos-topbar-copy h2,
.sueldos-table-header-row h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.sueldos-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 62ch;
  line-height: 1.45;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.header-btn {
  width: 270px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 270px;
}

.sueldos-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.35rem;
}

.sueldo-stat-card {
  padding: 1.15rem 1.2rem;
  border-radius: 0.95rem;
  display: grid;
  gap: 0.4rem;
}

.sueldo-stat-card span {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.sueldo-stat-card strong {
  font-size: 1.55rem;
  color: #f8fafc;
}

.sueldo-stat-card small {
  color: #94a3b8;
  line-height: 1.35;
}

.sueldo-stat-card-primary {
  border-color: rgba(96, 165, 250, 0.28);
}

.sueldo-stat-card-paid {
  border-color: rgba(74, 222, 128, 0.24);
}

.sueldo-stat-card-pending {
  border-color: rgba(248, 113, 113, 0.22);
}

.btn-importar-caja {
  margin-top: 0.3rem;
  padding: 0.35rem 0.85rem;
  font-size: 0.75rem;
  font-weight: 700;
  border-radius: 0.5rem;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.12);
  color: #93c5fd;
  cursor: pointer;
  transition: background 0.15s;
  width: fit-content;
}

.btn-importar-caja:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.22);
}

.btn-importar-caja:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.importar-caja-msg {
  font-size: 0.7rem;
  color: #86efac;
}

/* Modal importar sueldos */
.modal-importar-caja {
  max-width: 1320px;
  width: min(96vw, 1320px);
}

.importar-caja-body {
  padding: 1.25rem 1.5rem;
  display: grid;
  gap: 1rem;
  max-height: min(62vh, 640px);
  overflow-y: auto;
  overflow-x: hidden;
}

.importar-caja-resumen-box {
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.8rem;
  padding: 0.95rem 1rem;
}

.importar-caja-tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
  table-layout: fixed;
}

.importar-caja-tabla th {
  text-align: left;
  color: #94a3b8;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.15rem 0.35rem 0.65rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}

.importar-caja-tabla td {
  padding: 0.58rem 0.35rem;
  color: #cbd5e1;
  border-bottom: 1px solid rgba(148, 163, 184, 0.07);
}

.importar-caja-tabla td:first-child,
.importar-caja-tabla th:first-child {
  width: 44%;
}

.importar-caja-tabla td:nth-child(2),
.importar-caja-tabla th:nth-child(2),
.importar-caja-tabla td:nth-child(3),
.importar-caja-tabla th:nth-child(3),
.importar-caja-tabla td:nth-child(4),
.importar-caja-tabla th:nth-child(4) {
  width: 18.66%;
}

.importar-caja-tabla .col-monto {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.importar-caja-tabla tfoot td {
  padding-top: 0.78rem;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
  border-bottom: none;
  font-weight: 700;
  color: #f1f5f9;
}

.importar-caja-nota {
  margin: 0.9rem 0 0;
  padding-top: 0.85rem;
  border-top: 1px dashed rgba(148, 163, 184, 0.22);
}

.importar-caja-empty {
  color: #64748b;
  font-style: italic;
}

.importar-caja-resultado {
  padding: 0.65rem 0.9rem;
  border-radius: 0.5rem;
  font-size: 0.82rem;
  font-weight: 600;
}

.resultado-creado {
  background: rgba(74, 222, 128, 0.1);
  color: #86efac;
  border: 1px solid rgba(74, 222, 128, 0.2);
}

.resultado-actualizado {
  background: rgba(251, 191, 36, 0.1);
  color: #fcd34d;
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.resultado-sin_cambios {
  background: rgba(148, 163, 184, 0.08);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.resultado-sin_pagos {
  background: rgba(148, 163, 184, 0.08);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.15);
}

.resultado-error {
  background: rgba(248, 113, 113, 0.1);
  color: #fca5a5;
  border: 1px solid rgba(248, 113, 113, 0.2);
}

.importar-caja-actions {
  padding: 1rem 1.5rem 1.25rem;
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.sueldos-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.15rem;
  flex-wrap: wrap;
  padding: 1.1rem 1.2rem;
  border-radius: 1rem;
}

.filtros {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.filtros-sueldo {
  flex: 1;
}

.filtro-grupo {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filtro-grupo label {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.filtro-grupo select,
.sueldos-search-field input {
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  background-color: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.filtro-grupo select:focus,
.sueldos-search-field input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.sueldos-search-field {
  display: grid;
  gap: 0.45rem;
  min-width: min(100%, 280px);
}

.sueldos-search-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.sueldos-toolbar-count {
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

.sueldos-table {
  overflow-x: auto;
  padding: 0 1rem 1rem;
}

.sueldos-table-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.sueldos-table-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.15rem 0.75rem;
}

.btn-generar {
  padding: 0.4rem 1rem;
  background-color: rgba(255, 72, 0, 0.822);
  color: #ffffff;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-generar:hover {
  background-color: rgba(255, 72, 0, 0.575);
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

.badge-pendiente {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.badge-pagada {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.badge-generar{
  background-color: rgba(255, 94, 0, 0.548);
  color: #ffffff;
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

.detalle-acciones .btn-pdf:hover:not(:disabled) {
  background-color: rgba(99, 102, 241, 0.32);
}

.detalle-acciones .btn-pdf:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
  padding: 0.45rem 0.75rem;
  background-color: rgba(239, 68, 68, 0.14);
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.8rem;
  font-weight: 600;
}

.btn-delete-small:hover {
  background-color: rgba(239, 68, 68, 0.22);
  border-color: rgba(248, 113, 113, 0.35);
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
  background:
    radial-gradient(circle at top, rgba(15, 23, 42, 0.45), rgba(2, 6, 23, 0.82)),
    rgba(0, 0, 0, 0.68);
  backdrop-filter: blur(7px);
  -webkit-backdrop-filter: blur(7px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  animation: fadeIn 0.18s ease-out;
}

.modal {
  background-color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal.modal-importar-caja {
  max-width: 1320px;
  width: min(96vw, 1320px);
}

.modal-conceptos {
  width: min(96vw, 980px);
  max-width: 980px;
  min-height: min(82vh, 920px);
  max-height: 94vh;
  display: flex;
  flex-direction: column;
  border-radius: 1.2rem;
  border: 1px solid rgba(96, 165, 250, 0.2);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.95));
}

.modal-conceptos .modal-header {
  padding: 1.35rem 1.6rem 1.15rem;
  align-items: flex-start;
}

.modal-conceptos .modal-header h3 {
  margin: 0;
  font-size: 1.35rem;
}

.modal-header-copy {
  display: grid;
  gap: 0.35rem;
}

.modal-header-copy p {
  margin: 0;
  color: #9fb1d1;
  max-width: 60ch;
  line-height: 1.45;
}

.modal-header-copy-conceptos {
  gap: 0.4rem;
}

.modal-kicker,
.section-kicker {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}
.tarifas-topbar {
  gap: 1.5rem;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.tarifas-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.tarifas-topbar-copy h2 {
  color: #f9fafb;
  margin: 0;
  font-size: 1.5rem;
}

.tarifas-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 58ch;
  line-height: 1.45;
  font-size: 1.25rem;
}

.btn-close {
  width: 2.6rem;
  height: 2.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  border-radius: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.92));
  color: #e2e8f0;
  font-size: 1.3rem;
  line-height: 1;
  box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.95);
  cursor: pointer;
  padding: 0;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.tarifas-table-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.btn-close:hover {
  color: #ffffff;
  border-color: rgba(125, 211, 252, 0.42);
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.42), rgba(30, 64, 175, 0.34));
  transform: translateY(-1px);
}

.btn-close:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.2);
}

.modal-form {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.modal-form-conceptos {
  padding: 1.15rem 1.5rem 1.5rem;
  gap: 1.15rem;
  max-height: calc(94vh - 110px);
  overflow-y: auto;
}

.conceptos-modal-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.85rem;
}

.conceptos-summary-pill {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.95rem 1rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.82), rgba(15, 23, 42, 0.94));
}

.conceptos-summary-pill span {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8ea2c7;
}

.conceptos-summary-pill strong {
  color: #f8fafc;
  font-size: 0.98rem;
}

.conceptos-form-section {
  display: grid;
  gap: 0.95rem;
  padding: 1.05rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.76), rgba(15, 23, 42, 0.92));
}

.conceptos-form-section-highlighted {
  border-color: rgba(96, 165, 250, 0.22);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(23, 37, 84, 0.32), rgba(15, 23, 42, 0.95));
}

.conceptos-form-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.conceptos-form-section-header > div {
  display: grid;
  gap: 0.3rem;
}

.conceptos-form-section-header h4 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.02rem;
}

.conceptos-form-section-header small {
  max-width: 32rem;
  color: #8ea2c7;
  line-height: 1.45;
}

.conceptos-form-grid {
  display: grid;
  gap: 0.9rem;
}

.conceptos-form-grid-primary {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.conceptos-form-grid-secondary {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.form-card-field {
  padding: 1rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.86));
}

.form-card-field-accent {
  border-color: rgba(74, 222, 128, 0.18);
  background: linear-gradient(180deg, rgba(20, 83, 45, 0.2), rgba(15, 23, 42, 0.9));
}

.overtime-edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.9rem;
}

.overtime-edit-card {
  padding: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.88), rgba(15, 23, 42, 0.92));
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 0.85rem;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.overtime-source-note {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.8rem;
  background-color: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.65rem;
}

.overtime-source-note span {
  font-size: 0.78rem;
  color: #8ea2c7;
}

.overtime-source-note strong {
  color: #f8fafc;
  font-size: 0.95rem;
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

.form-group-conceptos-extra {
  padding: 1rem;
  background: linear-gradient(180deg, rgba(23, 37, 84, 0.32), rgba(15, 23, 42, 0.94));
  border: 1px solid rgba(96, 165, 250, 0.16);
  border-radius: 1rem;
  gap: 0.9rem;
}

.conceptos-notes-field textarea {
  min-height: 92px;
}

.conceptos-extra-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.conceptos-extra-header > div {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.conceptos-extra-subtitle {
  max-width: 30rem;
}

.btn-small {
  padding: 0.6rem 0.9rem;
  font-size: 0.85rem;
}

.btn-concepto-add {
  border-radius: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}

.conceptos-extra-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.85rem 1rem;
  background-color: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.85rem;
}

.conceptos-extra-summary span {
  color: #9fb1d1;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.conceptos-extra-summary strong {
  color: #86efac;
  font-size: 1rem;
}

.conceptos-extra-summary strong.negativo {
  color: #fca5a5;
}

.conceptos-extra-empty {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem;
  background-color: rgba(15, 23, 42, 0.68);
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 0.85rem;
  color: #94a3b8;
}

.conceptos-extra-empty strong {
  color: #e2e8f0;
  font-size: 0.92rem;
}

.concepto-extra-row {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.84), rgba(15, 23, 42, 0.96));
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.95rem;
}

.concepto-extra-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.concepto-extra-index {
  color: #bfdbfe;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.concepto-extra-fields {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(130px, 0.9fr) minmax(120px, 0.8fr);
  gap: 0.8rem;
}

.concepto-extra-fields label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.concepto-extra-fields label span {
  font-size: 0.78rem;
  color: #9fb1d1;
  font-weight: 600;
}

.concepto-extra-fields input,
.concepto-extra-fields select {
  width: 100%;
}

@media (max-width: 720px) {
  .modal-conceptos .modal-header,
  .conceptos-form-section-header {
    flex-direction: column;
  }

  .conceptos-extra-header,
  .concepto-extra-row-top {
    flex-direction: column;
    align-items: stretch;
  }

  .concepto-extra-fields {
    grid-template-columns: 1fr;
  }

  .conceptos-extra-summary,
  .overtime-source-note {
    flex-direction: column;
    align-items: flex-start;
  }
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

@media (max-width: 900px) {
  .sueldos-topbar,
  .sueldos-toolbar,
  .tarifas-header,
  .detalle-header {
    flex-direction: column;
    align-items: stretch;
  }

  .sueldos-toolbar-count {
    white-space: normal;
  }
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
