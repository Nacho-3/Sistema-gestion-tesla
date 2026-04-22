<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

const CAJAS_DISPONIBLES = [
  { id: "tesla", label: "Caja Tesla" },
  { id: "teslita", label: "Caja Teslita" },
  { id: "juani", label: "Caja Juani" },
]

const movimientos = ref([])
const clientes = ref([])
const presupuestos = ref([])
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
const filtroCaja = ref("tesla")
const filtroBusqueda = ref("")
const semanasCaja = ref([])
const semanaActual = ref(null)
const semanaSeleccionadaId = ref("")
const cerrandoSemana = ref(false)

// Filtros
const filtroFechaInicio = ref("")
const filtroFechaFin = ref("")
const filtroTipo = ref("")

// Formulario
const form = ref({
  fecha: new Date().toISOString().split('T')[0],
  caja_codigo: "tesla",
  tipo: "ingreso",
  categoria: "mano_obra",
  con_iva: true,
  destinatario: "",
  cliente_id: "",
  presupuesto_id: "",
  detalle: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    retencion: 0
  },
  cheques: []
})

const mediosDePago = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "echeq", label: "Echeq" },
  { id: "retencion", label: "Retención" },
  { id: "cheque", label: "Cheque" }
]

const mediosDePagoSimples = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "retencion", label: "Retención" },
]

const tiposCheque = [
  { id: "cheque", label: "Cheque" },
  { id: "echeq", label: "Echeq" },
]

const handleCajaChanged = () => {
  refrescarCaja()
}

const crearChequeVacio = (tipo = "cheque") => ({
  medio_pago: tipo,
  monto: 0,
  identificador: "",
})

const parseFechaLocal = (valor) => {
  const texto = String(valor || "").split("T")[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null
  const [anio, mes, dia] = texto.split("-").map(Number)
  return new Date(anio, mes - 1, dia)
}

const formatFechaISO = (fecha) => {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, "0")
  const d = String(fecha.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const getRangoSemanaLocal = (fechaValor) => {
  const fecha = parseFechaLocal(fechaValor)
  if (!fecha) return null
  const diaSemana = fecha.getDay()
  const offsetLunes = diaSemana === 0 ? -6 : 1 - diaSemana
  const inicio = new Date(fecha)
  inicio.setDate(fecha.getDate() + offsetLunes)
  const fin = new Date(inicio)
  fin.setDate(inicio.getDate() + 4)
  return {
    fecha_inicio: formatFechaISO(inicio),
    fecha_fin: formatFechaISO(fin),
  }
}

const normalizarFechaSemana = (valor) => String(valor || "").split("T")[0]

const normalizarSemanaCaja = (semana, defaults = {}) => {
  if (!semana) return null
  return {
    ...defaults,
    ...semana,
    fecha_inicio: normalizarFechaSemana(semana.fecha_inicio || defaults.fecha_inicio),
    fecha_fin: normalizarFechaSemana(semana.fecha_fin || defaults.fecha_fin),
    saldo_inicial: Number(semana.saldo_inicial ?? defaults.saldo_inicial ?? 0),
    saldo_inicial_efectivo: Number(semana.saldo_inicial_efectivo ?? defaults.saldo_inicial_efectivo ?? 0),
    saldo_inicial_cheques: Number(semana.saldo_inicial_cheques ?? defaults.saldo_inicial_cheques ?? 0),
    total_ingresos: Number(semana.total_ingresos ?? defaults.total_ingresos ?? 0),
    total_egresos: Number(semana.total_egresos ?? defaults.total_egresos ?? 0),
    saldo_final: Number(semana.saldo_final ?? defaults.saldo_final ?? 0),
    saldo_final_efectivo: Number(semana.saldo_final_efectivo ?? defaults.saldo_final_efectivo ?? 0),
    saldo_final_cheques: Number(semana.saldo_final_cheques ?? defaults.saldo_final_cheques ?? 0),
    estado: String(semana.estado || defaults.estado || "cerrada").toLowerCase(),
  }
}

const claveSemanaCaja = (semana) => {
  if (!semana) return ""
  const inicio = normalizarFechaSemana(semana.fecha_inicio)
  const fin = normalizarFechaSemana(semana.fecha_fin)
  return inicio && fin ? `${inicio}-${fin}` : String(semana.id || "")
}

const extraerSemanaIdNumerica = (valor) => {
  const texto = String(valor || "").trim()
  if (!texto) return null
  if (/^\d+$/.test(texto)) return Number(texto)
  const match = texto.match(/^id-(\d+)$/i)
  return match ? Number(match[1]) : null
}

const movimientoPerteneceASemana = (movimiento, semana) => {
  if (!semana) return true

  const semanaId = extraerSemanaIdNumerica(semana.id)
  const movimientoSemanaId = extraerSemanaIdNumerica(movimiento?.caja_semanal_id)

  if (semanaId && movimientoSemanaId) {
    return semanaId === movimientoSemanaId
  }

  const fechaMovimiento = String(movimiento?.fecha || "").split("T")[0]
  if (!fechaMovimiento) return false

  const inicio = String(semana.fecha_inicio || "")
  const fin = String(semana.fecha_fin || "")

  return (!inicio || fechaMovimiento >= inicio) && (!fin || fechaMovimiento <= fin)
}

const actualizarSaldoPorMedioLocal = (acumulador, movimiento) => {
  const signo = String(movimiento?.tipo || "").toLowerCase() === "egreso" ? -1 : 1
  let montoAplicado = 0
  const detalles = Array.isArray(movimiento?.detalles_medio_pago) ? movimiento.detalles_medio_pago : []

  detalles.forEach((detalle) => {
    const medio = String(detalle?.medio_pago || "").toLowerCase()
    const monto = Number(detalle?.monto || 0)
    if (!(monto > 0)) return

    if (medio === "efectivo") {
      acumulador.efectivo += signo * monto
      montoAplicado += monto
    }

    if (medio === "cheque") {
      acumulador.cheques += signo * monto
      montoAplicado += monto
    }
  })

  if (detalles.length === 0 && !(montoAplicado > 0)) {
    acumulador.efectivo += signo * Number(movimiento?.monto_total || 0)
  }
}

const saldoSemanalCalculado = computed(() => {
  if (!semanaActiva.value?.fecha_inicio || !semanaActiva.value?.fecha_fin) {
    return {
      saldo_inicial_efectivo: 0,
      saldo_inicial_cheques: 0,
      saldo_final_efectivo: 0,
      saldo_final_cheques: 0,
    }
  }

  const inicioSemana = normalizarFechaSemana(semanaActiva.value.fecha_inicio)
  const finSemana = normalizarFechaSemana(semanaActiva.value.fecha_fin)
  const movimientosCaja = (movimientos.value || [])
    .filter((movimiento) => String(movimiento?.caja_codigo || "").toLowerCase() === filtroCaja.value)
    .slice()
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

  const acumulador = { efectivo: 0, cheques: 0 }

  movimientosCaja.forEach((movimiento) => {
    const fechaMovimiento = normalizarFechaSemana(movimiento?.fecha)
    if (!fechaMovimiento || fechaMovimiento >= inicioSemana) return
    actualizarSaldoPorMedioLocal(acumulador, movimiento)
  })

  const saldoInicial = {
    saldo_inicial_efectivo: acumulador.efectivo,
    saldo_inicial_cheques: acumulador.cheques,
  }

  movimientosCaja.forEach((movimiento) => {
    const fechaMovimiento = normalizarFechaSemana(movimiento?.fecha)
    if (!fechaMovimiento || fechaMovimiento < inicioSemana || fechaMovimiento > finSemana) return
    if (!movimientoPerteneceASemana(movimiento, semanaActiva.value)) return
    actualizarSaldoPorMedioLocal(acumulador, movimiento)
  })

  return {
    ...saldoInicial,
    saldo_final_efectivo: acumulador.efectivo,
    saldo_final_cheques: acumulador.cheques,
  }
})

const cajaActiva = computed(() => {
  return CAJAS_DISPONIBLES.find((caja) => caja.id === filtroCaja.value) || CAJAS_DISPONIBLES[0]
})

const construirSemanasDesdeMovimientos = () => {
  const movimientosCaja = movimientos.value
    .filter((movimiento) => String(movimiento.caja_codigo || "").toLowerCase() === filtroCaja.value)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

  if (movimientosCaja.length === 0) return []

  const grupos = new Map()
  let saldoInicial = 0

  movimientosCaja.forEach((movimiento) => {
    const key = movimiento.caja_semanal_id
      ? `id-${movimiento.caja_semanal_id}`
      : `fecha-${(getRangoSemanaLocal(movimiento.fecha) || {}).fecha_inicio || String(movimiento.fecha).split("T")[0]}`

    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key).push(movimiento)
  })

  const semanas = []

  for (const [key, items] of grupos.entries()) {
    const fechas = items
      .map((movimiento) => String(movimiento.fecha || "").split("T")[0])
      .filter(Boolean)
      .sort()

    const rango = key.startsWith("id-")
      ? { fecha_inicio: fechas[0], fecha_fin: fechas[fechas.length - 1] }
      : getRangoSemanaLocal(fechas[0]) || { fecha_inicio: fechas[0], fecha_fin: fechas[fechas.length - 1] }

    const totalIngresos = items
      .filter((movimiento) => movimiento.tipo === "ingreso")
      .reduce((sum, movimiento) => sum + Number(movimiento.monto_total || 0), 0)

    const totalEgresos = items
      .filter((movimiento) => movimiento.tipo === "egreso")
      .reduce((sum, movimiento) => sum + Number(movimiento.monto_total || 0), 0)

    const saldoFinal = saldoInicial + totalIngresos - totalEgresos
    const semanaId = extraerSemanaIdNumerica(key)

    semanas.push(normalizarSemanaCaja({
      id: semanaId || key,
      caja_codigo: filtroCaja.value,
      fecha_inicio: rango.fecha_inicio,
      fecha_fin: rango.fecha_fin,
      saldo_inicial: saldoInicial,
      total_ingresos: totalIngresos,
      total_egresos: totalEgresos,
      saldo_final: saldoFinal,
      estado: "cerrada",
    }))

    saldoInicial = saldoFinal
  }

  return semanas
}

const semanasCajaVisibles = computed(() => {
  const semanasBase = (semanasCaja.value || []).map((semana) => normalizarSemanaCaja(semana)).filter(Boolean)
  const actual = semanaActual.value ? normalizarSemanaCaja(semanaActual.value, { estado: "abierta" }) : null

  const mapa = new Map()
  const registrar = (semana) => {
    if (!semana?.fecha_inicio || !semana?.fecha_fin) return
    const clave = claveSemanaCaja(semana)
    const existente = mapa.get(clave)
    if (!existente || (existente.estado !== "abierta" && semana.estado === "abierta")) {
      mapa.set(clave, semana)
    }
  }

  semanasBase.forEach(registrar)
  if (actual) registrar(actual)

  if (mapa.size === 0) {
    construirSemanasDesdeMovimientos().forEach(registrar)
  }

  const semanasOrdenadas = Array.from(mapa.values()).sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio))
  const rangoHoy = getRangoSemanaLocal(formatFechaISO(new Date()))

  if (rangoHoy) {
    const yaExisteSemanaActual = semanasOrdenadas.some((semana) => {
      return semana.fecha_inicio === rangoHoy.fecha_inicio && semana.fecha_fin === rangoHoy.fecha_fin
    })

    if (!yaExisteSemanaActual) {
      const saldoBase = semanasOrdenadas.length > 0
        ? Number(semanasOrdenadas[0]?.saldo_final || 0)
        : 0

      semanasOrdenadas.unshift(normalizarSemanaCaja({
        id: actual?.id || `actual-${filtroCaja.value}-${rangoHoy.fecha_inicio}`,
        caja_codigo: filtroCaja.value,
        fecha_inicio: rangoHoy.fecha_inicio,
        fecha_fin: rangoHoy.fecha_fin,
        saldo_inicial: actual?.saldo_inicial ?? saldoBase,
        total_ingresos: actual?.total_ingresos ?? 0,
        total_egresos: actual?.total_egresos ?? 0,
        saldo_final: actual?.saldo_final ?? saldoBase,
        estado: actual?.estado || "abierta",
      }))
    }
  }

  return semanasOrdenadas
})

const semanaActiva = computed(() => {
  if (semanaSeleccionadaId.value) {
    return semanasCajaVisibles.value.find((semana) => String(semana.id) === String(semanaSeleccionadaId.value)) || null
  }
  return semanaActual.value || semanasCajaVisibles.value[0] || null
})

const subtitleCaja = computed(() => {
  return `${cajaActiva.value.label} - Movimientos de ingresos y egresos`
})

const esIngreso = computed(() => form.value.tipo === "ingreso")
const esEgreso = computed(() => form.value.tipo === "egreso")

const chequesCargados = computed(() => {
  return (form.value.cheques || []).filter((item) => {
    const monto = parseFloat(item?.monto || 0)
    const identificador = String(item?.identificador || "").trim()
    return monto > 0 || identificador.length > 0
  })
})

const esFormularioValido = computed(() => {
  if (!form.value.fecha || !form.value.caja_codigo || !form.value.detalle || !form.value.monto_total || form.value.monto_total <= 0) {
    return false
  }

  if (form.value.tipo === "ingreso" && !form.value.categoria) {
    return false
  }

  if (form.value.tipo === "egreso" && !String(form.value.destinatario || "").trim()) {
    return false
  }

  const sumaDesglose = sumaMediosPago.value
  const chequesValidos = chequesCargados.value.every((item) => {
    if (!(parseFloat(item?.monto || 0) > 0)) return false
    return String(item?.identificador || "").trim().length > 0
  })
  if (!chequesValidos) return false
  return Math.abs(sumaDesglose - form.value.monto_total) < 0.01
})

const tieneErrorDesglose = computed(() => {
  const sumaDesglose = sumaMediosPago.value
  return Math.abs(sumaDesglose - form.value.monto_total) > 0.01
})

const sumaMediosPago = computed(() => {
  const sumaSimples = Object.values(form.value.desglose).reduce((sum, val) => sum + parseFloat(val || 0), 0)
  const sumaCheques = (form.value.cheques || []).reduce((sum, item) => sum + (parseFloat(item?.monto || 0) || 0), 0)
  return sumaSimples + sumaCheques
})

const cajaSemanalIdConsulta = computed(() => extraerSemanaIdNumerica(semanaSeleccionadaId.value))

const movimientosFiltrados = computed(() => {
  let resultado = movimientos.value

  if (semanaActiva.value) {
    resultado = resultado.filter((movimiento) => movimientoPerteneceASemana(movimiento, semanaActiva.value))
  }

  if (filtroTipo.value) {
    resultado = resultado.filter(m => m.tipo === filtroTipo.value)
  }

  if (filtroBusqueda.value.trim()) {
    const termino = filtroBusqueda.value.trim().toLowerCase()
    resultado = resultado.filter((movimiento) => {
      const referencia = movimiento.tipo === "egreso"
        ? (movimiento.destinatario || "")
        : `${getNumeroPresupuesto(movimiento.presupuesto_id)} ${getNombreCliente(movimiento.cliente_id)}`

      return [
        movimiento.detalle,
        referencia,
        movimiento.tipo,
        movimiento.categoria,
        getLabelCaja(movimiento.caja_codigo),
      ].some((valor) => String(valor || "").toLowerCase().includes(termino))
    })
  }

  // Los filtros de fecha se aplican en la API
  return resultado.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
})

const totalIngresosVisibles = computed(() => movimientosFiltrados.value
  .filter((mov) => mov.tipo === "ingreso")
  .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0))

const totalEgresosVisibles = computed(() => movimientosFiltrados.value
  .filter((mov) => mov.tipo === "egreso")
  .reduce((sum, mov) => sum + Number(mov.monto_total || 0), 0))

const balanceActual = computed(() => totalIngresosVisibles.value - totalEgresosVisibles.value)
const cantidadIngresos = computed(() => movimientosFiltrados.value.filter((mov) => mov.tipo === "ingreso").length)
const cantidadEgresos = computed(() => movimientosFiltrados.value.filter((mov) => mov.tipo === "egreso").length)
const fechaInicioConsulta = computed(() => filtroFechaInicio.value)
const fechaFinConsulta = computed(() => filtroFechaFin.value)
const rangoActivoDescripcion = computed(() => {
  if (semanaActiva.value?.fecha_inicio && semanaActiva.value?.fecha_fin) {
    return `Semana ${textoRangoFechas(semanaActiva.value.fecha_inicio, semanaActiva.value.fecha_fin)}`
  }
  if (!filtroFechaInicio.value && !filtroFechaFin.value) return "Sin rango de fechas aplicado"
  return textoRangoFechas()
})

const saldoInicialEfectivoSemana = computed(() => Number(saldoSemanalCalculado.value?.saldo_inicial_efectivo || 0))
const saldoInicialChequesSemana = computed(() => Number(saldoSemanalCalculado.value?.saldo_inicial_cheques || 0))
const saldoInicialSemana = computed(() => saldoInicialEfectivoSemana.value + saldoInicialChequesSemana.value)
const ingresosSemana = computed(() => Number(semanaActiva.value?.total_ingresos || 0))
const egresosSemana = computed(() => Number(semanaActiva.value?.total_egresos || 0))
const saldoFinalEfectivoSemana = computed(() => Number(saldoSemanalCalculado.value?.saldo_final_efectivo || 0))
const saldoFinalChequesSemana = computed(() => Number(saldoSemanalCalculado.value?.saldo_final_cheques || 0))
const saldoFinalSemana = computed(() => saldoFinalEfectivoSemana.value + saldoFinalChequesSemana.value)
const semanaEstaCerrada = computed(() => String(semanaActiva.value?.estado || "").toLowerCase() === "cerrada")
const etiquetaSemanaActiva = computed(() => {
  if (!semanaActiva.value?.fecha_inicio || !semanaActiva.value?.fecha_fin) return "Semana actual"
  const inicio = new Date(`${semanaActiva.value.fecha_inicio}T00:00:00`).toLocaleDateString("es-AR")
  const fin = new Date(`${semanaActiva.value.fecha_fin}T00:00:00`).toLocaleDateString("es-AR")
  return `${inicio} al ${fin}`
})

const presupuestosDisponibles = computed(() => {
  if (!form.value.cliente_id) return presupuestos.value
  return presupuestos.value.filter((p) => String(p.cliente_id) === String(form.value.cliente_id))
})

const clientesOrdenados = computed(() => {
  return [...clientes.value].sort((a, b) => {
    const etiquetaA = getEtiquetaCliente(a)
    const etiquetaB = getEtiquetaCliente(b)
    return etiquetaA.localeCompare(etiquetaB, "es", { sensitivity: "base" })
  })
})

const cargarDatos = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getMovimientosCaja(
      fechaInicioConsulta.value,
      fechaFinConsulta.value,
      filtroTipo.value,
      filtroCaja.value
    )
    movimientos.value = res.data.movimientos || []
    totales.value = res.data.totales || {}
  } catch (err) {
    error.value = `Error al cargar: ${err.response?.data?.error || err.message}`
  } finally {
    loading.value = false
  }
}

const cargarReferencias = async () => {
  try {
    const [resClientes, resPresupuestos] = await Promise.all([
      api.getClientes(),
      api.getPresupuestos()
    ])

    clientes.value = resClientes.data || []
    presupuestos.value = resPresupuestos.data || []
  } catch (err) {
    console.error("Error cargando clientes/presupuestos:", err)
  }
}

const cargarSemanasCaja = async (mantenerSeleccion = true) => {
  try {
    const [resSemanas, resSemanaActual] = await Promise.allSettled([
      api.getSemanasCaja(filtroCaja.value),
      api.getSemanaCajaActual(filtroCaja.value),
    ])

    if (resSemanas.status === "fulfilled") {
      semanasCaja.value = (resSemanas.value.data || []).map((semana) => normalizarSemanaCaja(semana)).filter(Boolean)
    }

    if (resSemanaActual.status === "fulfilled") {
      semanaActual.value = resSemanaActual.value.data ? normalizarSemanaCaja(resSemanaActual.value.data) : null
    } else {
      console.error("Error al cargar semana actual:", resSemanaActual.reason)
      semanaActual.value = semanasCaja.value.find((semana) => String(semana.estado || "") === "abierta") || null
    }

    if (semanaActual.value && !semanasCaja.value.some((semana) => claveSemanaCaja(semana) === claveSemanaCaja(semanaActual.value))) {
      semanasCaja.value = [semanaActual.value, ...semanasCaja.value]
    }

    if (!mantenerSeleccion || !semanaSeleccionadaId.value) {
      semanaSeleccionadaId.value = semanaActual.value?.id ? String(semanaActual.value.id) : (semanasCaja.value[0]?.id ? String(semanasCaja.value[0].id) : "")
      return
    }

    const existeSeleccion = semanasCaja.value.some((semana) => String(semana.id) === String(semanaSeleccionadaId.value))
    if (existeSeleccion) return

    const semanaSeleccionadaNormalizada = extraerSemanaIdNumerica(semanaSeleccionadaId.value)
    if (semanaSeleccionadaNormalizada) {
      const semanaEquivalente = semanasCaja.value.find((semana) => Number(semana.id) === semanaSeleccionadaNormalizada)
      if (semanaEquivalente) {
        semanaSeleccionadaId.value = String(semanaEquivalente.id)
        return
      }
    }

    semanaSeleccionadaId.value = semanaActual.value?.id ? String(semanaActual.value.id) : (semanasCaja.value[0]?.id ? String(semanasCaja.value[0].id) : "")
  } catch (err) {
    console.error("Error al cargar semanas de caja:", err)
    if (!mantenerSeleccion && semanaActual.value?.id) {
      semanaSeleccionadaId.value = String(semanaActual.value.id)
    }
  }
}

const refrescarCaja = async ({ mantenerSeleccion = true } = {}) => {
  await cargarDatos()
  await cargarSemanasCaja(mantenerSeleccion)
}

const aplicarFiltros = () => {
  cargarDatos()
}

const cerrarSemanaActual = async () => {
  if (!semanaActiva.value?.id) return
  const ok = window.confirm(`Se va a cerrar la semana ${etiquetaSemanaActiva.value} de ${cajaActiva.value.label}. La próxima semana arrancará con este saldo final.\n\n¿Deseás continuar?`)
  if (!ok) return

  try {
    cerrandoSemana.value = true
    await api.cerrarSemanaCaja(semanaActiva.value.id)
    await refrescarCaja({ mantenerSeleccion: false })
  } catch (err) {
    error.value = `Error al cerrar semana: ${err.response?.data?.error || err.message}`
  } finally {
    cerrandoSemana.value = false
  }
}

const textoTipoFiltro = () => {
  if (filtroTipo.value === "ingreso") return "solo ingresos"
  if (filtroTipo.value === "egreso") return "solo egresos"
  return "ingresos y egresos"
}

const textoCajaFiltro = () => cajaActiva.value.label

const textoRangoFechas = (fechaInicio = fechaInicioConsulta.value, fechaFin = fechaFinConsulta.value) => {
  const desde = fechaInicio
    ? new Date(`${fechaInicio}T00:00:00`).toLocaleDateString("es-AR")
    : "sin fecha de inicio"
  const hasta = fechaFin
    ? new Date(`${fechaFin}T00:00:00`).toLocaleDateString("es-AR")
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
      filtroTipo.value,
      filtroCaja.value
    )

    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url

    const hoy = new Date()
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`
    link.download = `Resumen ${textoCajaFiltro()} ${fecha}.pdf`

    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = `Error al generar PDF: ${err.response?.data?.error || err.message}`
  } finally {
    generandoPdf.value = false
  }
}

const descargarSemanaPdf = async () => {
  if (!semanaActiva.value?.fecha_inicio || !semanaActiva.value?.fecha_fin) {
    error.value = "Seleccioná una semana antes de descargar el PDF"
    return
  }

  const ok = window.confirm(
    `Se va a generar el resumen de la semana ${etiquetaSemanaActiva.value} para ${textoCajaFiltro()}.

¿Deseás continuar?`
  )
  if (!ok) return

  try {
    generandoPdf.value = true
    const res = await api.getResumenCajaPdf(
      semanaActiva.value.fecha_inicio,
      semanaActiva.value.fecha_fin,
      filtroTipo.value,
      filtroCaja.value
    )

    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `Resumen semanal ${textoCajaFiltro()} ${semanaActiva.value.fecha_inicio} al ${semanaActiva.value.fecha_fin}.pdf`
    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = `Error al generar PDF semanal: ${err.response?.data?.error || err.message}`
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
  caja_codigo: filtroCaja.value || "tesla",
  tipo: "ingreso",
  categoria: "mano_obra",
  con_iva: true,
  destinatario: "",
  cliente_id: "",
  presupuesto_id: "",
  detalle: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    retencion: 0
  },
  cheques: []
})

const normalizarDesglose = (detalles = []) => {
  const base = {
    efectivo: 0,
    transferencia: 0,
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

const normalizarCheques = (detalles = []) => {
  return (detalles || [])
    .filter((item) => ["cheque", "echeq"].includes(String(item?.medio_pago || "").toLowerCase()))
    .map((item) => ({
      medio_pago: String(item?.medio_pago || "").toLowerCase(),
      monto: parseFloat(item?.monto || 0) || 0,
      identificador: String(item?.identificador || "").trim(),
    }))
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

const agregarCheque = (tipo = "cheque") => {
  form.value.cheques.push(crearChequeVacio(tipo))
}

const eliminarCheque = (index) => {
  form.value.cheques.splice(index, 1)
}

const abrirEdicion = (movimiento) => {
  form.value = {
    fecha: String(movimiento.fecha || "").split("T")[0],
    caja_codigo: movimiento.caja_codigo || filtroCaja.value || "tesla",
    tipo: movimiento.tipo || "ingreso",
    categoria: movimiento.categoria || "mano_obra",
    con_iva: movimiento.con_iva !== false,
    destinatario: movimiento.destinatario || "",
    cliente_id: movimiento.cliente_id || "",
    presupuesto_id: movimiento.presupuesto_id || "",
    detalle: movimiento.detalle || "",
    monto_total: parseFloat(movimiento.monto_total) || 0,
    desglose: normalizarDesglose(movimiento.detalles_medio_pago || []),
    cheques: normalizarCheques(movimiento.detalles_medio_pago || [])
  }
  editandoMovimientoId.value = movimiento.id
  error.value = ""
  showForm.value = true
}

const payloadMovimiento = () => ({
  fecha: form.value.fecha,
  caja_codigo: form.value.caja_codigo,
  tipo: form.value.tipo,
  categoria: form.value.tipo === "ingreso" ? form.value.categoria : null,
  con_iva: form.value.con_iva,
  destinatario: form.value.tipo === "egreso" ? String(form.value.destinatario || "").trim() : null,
  cliente_id: form.value.tipo === "ingreso" ? (form.value.cliente_id || null) : null,
  presupuesto_id: form.value.tipo === "ingreso" ? (form.value.presupuesto_id || null) : null,
  detalle: form.value.detalle,
  monto_total: parseFloat(form.value.monto_total),
  desglose: {
    efectivo: parseFloat(form.value.desglose.efectivo) || 0,
    transferencia: parseFloat(form.value.desglose.transferencia) || 0,
    retencion: parseFloat(form.value.desglose.retencion) || 0
  },
  detalles_medio_pago: chequesCargados.value
    .filter((item) => parseFloat(item?.monto || 0) > 0 && String(item?.identificador || "").trim())
    .map((item) => ({
      medio_pago: item.medio_pago,
      monto: parseFloat(item.monto) || 0,
      identificador: String(item.identificador || "").trim(),
    }))
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

const getEtiquetaCliente = (cliente) => {
  if (!cliente) return "-"
  const empresa = String(cliente.empresa || "").trim()
  const razonSocial = String(cliente.razon_social || "").trim()
  return empresa || razonSocial || "-"
}

const getNombreCliente = (clienteId) => {
  if (!clienteId) return "-"
  const cliente = clientes.value.find((c) => String(c.id) === String(clienteId))
  return getEtiquetaCliente(cliente) !== "-" ? getEtiquetaCliente(cliente) : `Cliente ${clienteId}`
}

const getNumeroPresupuesto = (presupuestoId) => {
  if (!presupuestoId) return "-"
  const presupuesto = presupuestos.value.find((p) => String(p.id) === String(presupuestoId))
  return presupuesto?.numero ? `#${presupuesto.numero}` : `Presupuesto ${presupuestoId}`
}

const getLabelCategoria = (categoria) => {
  if (categoria === "mano_obra") return "Mano de obra"
  if (categoria === "materiales") return "Materiales"
  if (categoria === "varios") return "Varios"
  return "-"
}

const getChequesMovimiento = (movimiento) => {
  return (movimiento?.detalles_medio_pago || []).filter((detalle) => {
    return ["cheque", "echeq"].includes(String(detalle?.medio_pago || "").toLowerCase())
  })
}

const getCantidadCheques = (movimiento) => getChequesMovimiento(movimiento).length

const getIdentificadoresCheque = (movimiento) => {
  const ids = getChequesMovimiento(movimiento)
    .map((detalle) => String(detalle?.identificador || "").trim())
    .filter(Boolean)

  return ids.join(" · ")
}

const getResumenCheques = (movimiento) => {
  const cantidad = getCantidadCheques(movimiento)
  if (!cantidad) return ""

  const ids = getIdentificadoresCheque(movimiento)
  const textoCantidad = `${cantidad} ${cantidad === 1 ? "cheque" : "cheques"}`
  return ids ? `${textoCantidad} · ${ids}` : textoCantidad
}

const getLabelCaja = (codigo) => {
  const caja = CAJAS_DISPONIBLES.find((item) => item.id === codigo)
  return caja?.label || "Caja Tesla"
}

const formatoMoneda = (valor) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS'
  }).format(valor)
}

watch(filtroCaja, () => {
  semanaSeleccionadaId.value = ""
  semanasCaja.value = []
  semanaActual.value = null
  refrescarCaja({ mantenerSeleccion: false })
})

watch(semanaSeleccionadaId, () => {
  error.value = ""
})

watch(() => form.value.tipo, (tipo) => {
  if (tipo === "egreso") {
    form.value.categoria = ""
    form.value.cliente_id = ""
    form.value.presupuesto_id = ""
    return
  }

  form.value.destinatario = ""
  if (!form.value.categoria) {
    form.value.categoria = "mano_obra"
  }
})

watch(() => form.value.cliente_id, (clienteId) => {
  if (!clienteId) {
    form.value.presupuesto_id = ""
    return
  }

  const presupuestoActual = presupuestos.value.find((p) => String(p.id) === String(form.value.presupuesto_id))
  if (presupuestoActual && String(presupuestoActual.cliente_id) !== String(clienteId)) {
    form.value.presupuesto_id = ""
  }
})

onMounted(() => {
  refrescarCaja({ mantenerSeleccion: false })
  cargarReferencias()
  socket.on('caja:changed', handleCajaChanged)
})
onUnmounted(() => {
  socket.off('caja:changed', handleCajaChanged)
})
</script>

<template>
  <LayoutShell title="Caja" :subtitle="subtitleCaja">
    <!-- LISTA VIEW -->
    <div v-if="vistaActual === 'lista'" class="container">
      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <section class="caja-topbar">
        <div class="caja-topbar-copy">
          <span class="section-kicker">Control financiero</span>
          <h2>{{ cajaActiva.label }}</h2>
          <p>Seguí ingresos, egresos y composición por medio de pago desde una sola vista, con filtros rápidos y acceso directo a cada movimiento.</p>
        </div>
        <div class="caja-topbar-actions">
          <div class="caja-pdf-actions">
            <button class="btn btn-pdf" :disabled="generandoPdf" @click="descargarResumenPdf">
              {{ generandoPdf ? "Generando PDF..." : "Descargar Resumen PDF" }}
            </button>
            <button class="btn btn-pdf btn-pdf-week" :disabled="generandoPdf || !semanaActiva" @click="descargarSemanaPdf">
              {{ generandoPdf ? "Generando PDF..." : "Descargar semana seleccionada" }}
            </button>
          </div>
          <button class="btn btn-primary" :disabled="semanaEstaCerrada" @click="abrirFormulario">
            + Nuevo Movimiento
          </button>
        </div>
      </section>

      <div class="caja-tabs">
        <button
          v-for="caja in CAJAS_DISPONIBLES"
          :key="caja.id"
          type="button"
          class="caja-tab"
          :class="{ active: filtroCaja === caja.id }"
          @click="filtroCaja = caja.id"
        >
          {{ caja.label }}
        </button>
      </div>

      <section class="caja-semana-shell" v-if="semanaActiva">
        <div class="caja-semana-header">
          <div class="caja-semana-copy">
            <span class="section-kicker">Caja semanal</span>
            <h3>{{ etiquetaSemanaActiva }}</h3>
            <p>La semana nueva arranca con el saldo final de la anterior y los movimientos quedan encapsulados en su propio período.</p>
          </div>
          <div class="caja-semana-actions">
            <label class="caja-semana-select">
              <span>Semana</span>
              <select v-model="semanaSeleccionadaId" class="select-sm">
                <option v-for="semana in semanasCajaVisibles" :key="semana.id" :value="String(semana.id)">
                  {{ new Date(`${semana.fecha_inicio}T00:00:00`).toLocaleDateString("es-AR") }} - {{ new Date(`${semana.fecha_fin}T00:00:00`).toLocaleDateString("es-AR") }} {{ String(semana.estado) === 'abierta' ? '(actual)' : '' }}
                </option>
              </select>
            </label>
            <button
              v-if="!semanaEstaCerrada"
              class="btn btn-week-close"
              :disabled="cerrandoSemana"
              @click="cerrarSemanaActual"
            >
              {{ cerrandoSemana ? "Cerrando..." : "Cerrar semana" }}
            </button>
            <span :class="['week-badge', semanaEstaCerrada ? 'week-badge-closed' : 'week-badge-open']">
              {{ semanaEstaCerrada ? "Cerrada" : "Abierta" }}
            </span>
          </div>
        </div>

        <div class="caja-semana-grid">
          <article class="caja-semana-card">
            <span>Saldo inicial</span>
            <strong>{{ formatoMoneda(saldoInicialSemana) }}</strong>
            <small class="caja-semana-meta">Efectivo: {{ formatoMoneda(saldoInicialEfectivoSemana) }}</small>
            <small class="caja-semana-meta">Cheques: {{ formatoMoneda(saldoInicialChequesSemana) }}</small>
          </article>
          <article class="caja-semana-card caja-semana-card-in">
            <span>Ingresos semana</span>
            <strong>{{ formatoMoneda(ingresosSemana) }}</strong>
          </article>
          <article class="caja-semana-card caja-semana-card-out">
            <span>Egresos semana</span>
            <strong>{{ formatoMoneda(egresosSemana) }}</strong>
          </article>
          <article class="caja-semana-card caja-semana-card-balance">
            <span>Saldo final</span>
            <strong>{{ formatoMoneda(saldoFinalSemana) }}</strong>
            <small class="caja-semana-meta">Efectivo: {{ formatoMoneda(saldoFinalEfectivoSemana) }}</small>
            <small class="caja-semana-meta">Cheques: {{ formatoMoneda(saldoFinalChequesSemana) }}</small>
          </article>
        </div>
      </section>

      <section class="caja-stats-grid">
        <article class="caja-stat-card caja-stat-balance">
          <span class="stat-label">Balance actual</span>
          <strong class="stat-value">{{ formatoMoneda(balanceActual) }}</strong>
          <small>{{ rangoActivoDescripcion }}</small>
        </article>
        <article class="caja-stat-card caja-stat-ingresos">
          <span class="stat-label">Ingresos filtrados</span>
          <strong class="stat-value">{{ cantidadIngresos }}</strong>
          <small>{{ formatoMoneda(totalIngresosVisibles) }}</small>
        </article>
        <article class="caja-stat-card caja-stat-egresos">
          <span class="stat-label">Egresos filtrados</span>
          <strong class="stat-value">{{ cantidadEgresos }}</strong>
          <small>{{ formatoMoneda(totalEgresosVisibles) }}</small>
        </article>
        <article class="caja-stat-card caja-stat-movimientos">
          <span class="stat-label">Movimientos visibles</span>
          <strong class="stat-value">{{ movimientosFiltrados.length }}</strong>
          <small>{{ textoTipoFiltro() }}</small>
        </article>
      </section>

      <section class="caja-toolbar-shell">
        <div class="toolbar toolbar-caja">
          <div class="toolbar-search">
            <label class="toolbar-search-label">
              <span>Buscar movimiento</span>
              <input v-model="filtroBusqueda" type="text" class="input-sm input-search" placeholder="Detalle, cliente, destinatario, presupuesto..." />
            </label>
          </div>
          <div class="filtros filtros-caja">
            <label>
              <span>Desde</span>
              <input v-model="filtroFechaInicio" type="date" class="input-sm" />
            </label>
            <label>
              <span>Hasta</span>
              <input v-model="filtroFechaFin" type="date" class="input-sm" />
            </label>
            <label>
              <span>Tipo</span>
              <select v-model="filtroTipo" class="select-sm">
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </label>
            <button class="btn btn-sm btn-secondary" @click="aplicarFiltros">Aplicar filtros</button>
            <button class="btn btn-sm btn-secondary btn-ghost" @click="filtroBusqueda = ''; filtroFechaInicio = ''; filtroFechaFin = ''; filtroTipo = ''; aplicarFiltros()">Limpiar</button>
          </div>
        </div>
      </section>

      <div class="resumen-totales">
        <div class="total-card total-ingresos">
          <span class="label">Total Ingresos</span>
          <span class="value">{{ formatoMoneda(totalIngresosVisibles) }}</span>
        </div>
        <div class="total-card total-egresos">
          <span class="label">Total Egresos</span>
          <span class="value">{{ formatoMoneda(totalEgresosVisibles) }}</span>
        </div>
        <div class="total-card total-balance">
          <span class="label">Balance</span>
          <span class="value">{{ formatoMoneda(balanceActual) }}</span>
        </div>
      </div>

      <!-- Desglose por medio de pago -->
      <div class="desglose-medios">
        <div class="section-heading">
          <div>
            <span class="section-kicker">Distribucion</span>
            <h3>Desglose por medio de pago</h3>
          </div>
        </div>
        <div class="medios-grid">
          <div class="medio-card" v-for="medio in mediosDePago" :key="medio.id">
            <span class="label">{{ medio.label }}</span>
            <span class="value">{{ formatoMoneda(totales.desglose?.[medio.id] || 0) }}</span>
          </div>
        </div>
      </div>

      <section class="caja-list-shell">
        <div class="section-heading section-heading-inline">
          <div>
            <span class="section-kicker">Listado</span>
            <h3>Movimientos de caja</h3>
          </div>
          <p>{{ movimientosFiltrados.length }} registros visibles para {{ cajaActiva.label.toLowerCase() }}.</p>
        </div>

      <div v-if="loading" class="spinner">Cargando...</div>
      <div v-else-if="movimientosFiltrados.length === 0" class="empty">
        <strong>No hay movimientos registrados</strong>
        <span>Probá ajustando el rango, el tipo o la búsqueda para encontrar movimientos cargados.</span>
      </div>
      <div v-else class="tabla-shell">
      <table class="tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Categoría</th>
            <th>Destino / Referencia</th>
            <th>Detalle</th>
            <th>Cheques / IDs</th>
            <th>Monto Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mov in movimientosFiltrados" :key="mov.id" :class="`row-${mov.tipo}`">
            <td>{{ new Date(mov.fecha).toLocaleDateString('es-AR') }}</td>
            <td>
              <span :class="`badge badge-${mov.tipo}`">
                {{ mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}
              </span>
            </td>
            <td>
              <span>{{ mov.tipo === 'ingreso' ? getLabelCategoria(mov.categoria) : '-' }}</span>
            </td>
            <td>
              <div class="tabla-referencia">
                <strong>{{ mov.tipo === 'egreso' ? (mov.destinatario || '-') : (getNumeroPresupuesto(mov.presupuesto_id) !== '-' ? getNumeroPresupuesto(mov.presupuesto_id) : getNombreCliente(mov.cliente_id)) }}</strong>
                <small v-if="getIdentificadoresCheque(mov)">Cheque(s): {{ getIdentificadoresCheque(mov) }}</small>
              </div>
            </td>
            <td>{{ mov.detalle }}</td>
            <td class="td-cheques">
              <span v-if="getCantidadCheques(mov)">{{ getResumenCheques(mov) }}</span>
              <span v-else>-</span>
            </td>
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
      </section>
    </div>

    <!-- DETALLE VIEW -->
    <div v-else-if="vistaActual === 'detalle'" class="container">
      <section class="detalle-hero">
        <div class="detalle-hero-copy">
          <span class="section-kicker">Detalle del movimiento</span>
          <h2>{{ movimientoSeleccionado?.tipo === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado' }}</h2>
          <p>Revisá los datos principales, referencias y desglose por medio de pago antes de descargar el comprobante o volver al listado.</p>
        </div>
        <div class="detalle-top-actions">
          <button class="btn btn-secondary" @click="volverALista">← Volver a lista</button>
          <button class="btn btn-pdf" :disabled="generandoPdfDetalle" @click="descargarMovimientoPdf">
            {{ generandoPdfDetalle ? "Generando PDF..." : "Descargar PDF" }}
          </button>
        </div>
      </section>

      <div v-if="movimientoSeleccionado" class="detalle-card">
        <!-- Header -->
        <div class="detalle-header">
          <div>
            <h2>{{ movimientoSeleccionado.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}</h2>
            <p class="subtitle">{{ new Date(movimientoSeleccionado.fecha).toLocaleDateString('es-AR') }}</p>
          </div>
          <span :class="`badge badge-${movimientoSeleccionado.tipo}`">
            {{ movimientoSeleccionado.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}
          </span>
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
            <div class="info-item">
              <label>Caja</label>
              <p>{{ getLabelCaja(movimientoSeleccionado.caja_codigo) }}</p>
            </div>
            <div class="info-item">
              <label>Categoría</label>
              <p>{{ movimientoSeleccionado.categoria === 'materiales' ? 'Materiales' : (movimientoSeleccionado.categoria === 'mano_obra' ? 'Mano de obra' : (movimientoSeleccionado.categoria === 'varios' ? 'Varios' : '-')) }}</p>
            </div>
            <div class="info-item">
              <label>Concepto IVA</label>
              <p>{{ movimientoSeleccionado.con_iva ? 'Con IVA' : 'Sin IVA' }}</p>
            </div>
            <div class="info-item" v-if="movimientoSeleccionado.tipo === 'egreso'">
              <label>Destinatario</label>
              <p>{{ movimientoSeleccionado.destinatario || '-' }}</p>
            </div>
            <div class="info-item">
              <label>Cliente asociado</label>
              <p>{{ getNombreCliente(movimientoSeleccionado.cliente_id) }}</p>
            </div>
            <div class="info-item">
              <label>Presupuesto asociado</label>
              <p>{{ getNumeroPresupuesto(movimientoSeleccionado.presupuesto_id) }}</p>
            </div>
            <div class="info-item" v-if="getCantidadCheques(movimientoSeleccionado)">
              <label>Cheques asociados</label>
              <p>{{ getResumenCheques(movimientoSeleccionado) }}</p>
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
              <span v-if="detalle.identificador" class="medio-identificador">ID: {{ detalle.identificador }}</span>
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
    <div class="modal modal-movimiento">
      <div class="modal-header modal-header-movimiento">
        <div class="modal-header-copy">
          <span class="section-kicker">Gestion de caja</span>
          <h3>{{ editandoMovimientoId ? "Modificar movimiento" : "Nuevo movimiento" }}</h3>
          <p>Completá los datos principales, referencias y desglose por medio de pago para registrar el movimiento correctamente.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="cerrarFormulario">×</button>
      </div>

      <form @submit.prevent="guardarMovimiento" class="modal-form modal-form-movimiento">
        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <div class="movimiento-summary-pills">
          <div class="summary-pill">
            <span>Caja</span>
            <strong>{{ getLabelCaja(form.caja_codigo) }}</strong>
          </div>
          <div class="summary-pill">
            <span>Tipo</span>
            <strong>{{ form.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}</strong>
          </div>
          <div class="summary-pill">
            <span>Total declarado</span>
            <strong>{{ formatoMoneda(form.monto_total || 0) }}</strong>
          </div>
        </div>
        
        <section class="modal-section">
          <div class="modal-section-header">
            <div>
              <span class="section-kicker">Datos principales</span>
              <h4>Información base del movimiento</h4>
            </div>
            <small>Definí fecha, caja, tipo y descripción general antes de cargar el desglose.</small>
          </div>

          <div class="form-row form-row-primary">
            <label class="form-group form-card-field">
              <span>Fecha *</span>
              <input v-model="form.fecha" type="date" required />
            </label>
            <label class="form-group form-card-field">
              <span>Caja *</span>
              <select v-model="form.caja_codigo" required>
                <option v-for="caja in CAJAS_DISPONIBLES" :key="caja.id" :value="caja.id">
                  {{ caja.label }}
                </option>
              </select>
            </label>
            <label class="form-group form-card-field">
              <span>Tipo *</span>
              <select v-model="form.tipo" required>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </label>
          </div>

          <div class="form-row" v-if="esIngreso">
            <label class="form-group form-card-field">
              <span>Categoría *</span>
              <select v-model="form.categoria" required>
                <option value="mano_obra">Mano de obra</option>
                <option value="materiales">Materiales</option>
                <option value="varios">Varios</option>
              </select>
            </label>
            <label class="form-group form-card-field">
              <span>Concepto IVA *</span>
              <select v-model="form.con_iva">
                <option :value="true">Con IVA</option>
                <option :value="false">Sin IVA</option>
              </select>
            </label>
          </div>

          <label v-if="esEgreso" class="form-group form-card-field">
            <span>Destinatario *</span>
            <input v-model="form.destinatario" type="text" placeholder="Persona o empresa que recibe el pago" required />
          </label>

          <div v-if="esIngreso" class="form-row">
            <label class="form-group form-card-field">
              <span>Cliente (opcional)</span>
              <select v-model="form.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ getEtiquetaCliente(cliente) }}
                </option>
              </select>
            </label>
            <label class="form-group form-card-field">
              <span>Presupuesto (opcional)</span>
              <select v-model="form.presupuesto_id">
                <option value="">Sin presupuesto</option>
                <option v-for="pres in presupuestosDisponibles" :key="pres.id" :value="pres.id">
                  #{{ pres.numero }}
                </option>
              </select>
            </label>
          </div>

          <label class="form-group form-card-field">
            <span>Detalle *</span>
            <input v-model="form.detalle" type="text" placeholder="Descripción del movimiento" required />
          </label>

          <label class="form-group form-card-field form-card-field-accent">
            <span>Monto total *</span>
            <input v-model.number="form.monto_total" type="number" @wheel.prevent placeholder="0.00" step="0.01" required />
          </label>
        </section>

        <section class="modal-section modal-section-highlighted">
          <div class="modal-section-header">
            <div>
              <span class="section-kicker">Desglose</span>
              <h4>Distribución por medio de pago</h4>
            </div>
            <small>La suma de todos los medios debe coincidir con el monto total declarado.</small>
          </div>

          <div class="desglose-compacto">
            <div class="desglose-compacto-header">
              <div>
                <span class="section-kicker">Control interno</span>
                <h4>Desglose por medio de pago</h4>
              </div>
              <p>Usá este bloque para distribuir el movimiento entre efectivo, transferencias, cheques, eCheq y retenciones.</p>
            </div>
            <div class="desglose-grid-compact">
              <div v-for="medio in mediosDePagoSimples" :key="medio.id" class="desglose-compact-item">
                <label>{{ medio.label }}</label>
                <input 
                  v-model.number="form.desglose[medio.id]" 
                  type="number"
                  @wheel.prevent
                  placeholder="0.00" 
                  step="0.01"
                />
              </div>
            </div>
            <div class="cheques-section">
              <div class="cheques-section-header">
                <div>
                  <span class="section-kicker">Cheques</span>
                  <h4>Cheques y eCheq</h4>
                  <div class="cheques-header-side">
                    <small>Agregá solo si el movimiento incluye uno o varios cheques.</small>
                    <span class="cheques-count">{{ form.cheques.length }} cargado<span v-if="form.cheques.length !== 1">s</span></span>
                  </div>
                </div>
                <small>Agregá solo si el movimiento incluye cheques.</small>
              </div>

              <div class="cheques-intro">
                <div class="cheques-intro-copy">
                  <strong>Identifica cada cheque por separado.</strong>
                  <p>Podes cargar uno o varios, y a cada uno asignarle su identificador alfanumerico.</p>
                </div>
                <div class="cheques-actions cheques-actions-prominent">
                  <button type="button" class="btn btn-cheque-add" @click="agregarCheque('cheque')">Agregar cheque</button>
                  <button type="button" class="btn btn-cheque-add btn-cheque-add-alt" @click="agregarCheque('echeq')">Agregar eCheq</button>
                 
                </div>
              </div>

              <div v-if="form.cheques.length > 0" class="cheques-list">
                <div v-for="(cheque, index) in form.cheques" :key="index" class="cheque-card">
                  <div class="cheque-card-top">
                    <span class="cheque-card-index">Cheque {{ index + 1 }}</span>
                    <span class="cheque-card-caption">Monto e identificador del documento</span>
                  </div>
                  <div class="cheque-card-row cheque-card-row-main">
                    <label class="form-group form-card-field">
                      <span>Tipo</span>
                      <select v-model="cheque.medio_pago">
                        <option v-for="tipoCheque in tiposCheque" :key="tipoCheque.id" :value="tipoCheque.id">
                          {{ tipoCheque.label }}
                        </option>
                      </select>
                    </label>
                    <label class="form-group form-card-field">
                      <span>Monto</span>
                      <input v-model.number="cheque.monto" type="number" @wheel.prevent min="0" step="0.01" placeholder="0.00" />
                    </label>
                    <label class="form-group form-card-field">
                      <span>Identificador *</span>
                      <input v-model="cheque.identificador" type="text" placeholder="Ej: CHQ-A12345" />
                    </label>
                    <div class="cheque-card-remove">
                      <button type="button" class="btn btn-cheque-remove" @click="eliminarCheque(index)">Quitar cheque</button>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="cheques-empty-card">
                <span class="cheques-empty-label">Sin cheques cargados</span>
                <p>Si este movimiento fue pagado con cheque o eCheq, agregalo desde los botones de arriba y completa su identificador.</p>
              </div>
            </div>
            <div class="desglose-validacion-compact" :class="{ error: tieneErrorDesglose, ok: !tieneErrorDesglose }">
              <div class="desglose-validacion-copy">
                <span>Total distribuido</span>
                <strong>{{ formatoMoneda(sumaMediosPago) }}</strong>
              </div>
              <span v-if="tieneErrorDesglose" class="error-badge">No coincide con el total</span>
              <span v-else class="success-badge">Desglose correcto</span>
            </div>
          </div>
        </section>

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
    <div class="modal modal-confirmacion">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Acción crítica</span>
          <h3>Confirmar eliminación</h3>
          <p>Este movimiento va a quitarse del historial de caja y dejará de impactar en los totales y reportes.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="showConfirm = false">×</button>
      </div>

      <div class="modal-form modal-form-confirmacion">
        <div class="confirmacion-icono">!</div>

        <div v-if="movimientoAEliminar" class="confirmacion-copy">
          <p>¿Querés eliminar definitivamente este movimiento de caja?</p>
          <div class="confirmacion-resumen">
            <span>{{ movimientoAEliminar.detalle }}</span>
            <strong>{{ formatoMoneda(movimientoAEliminar.monto_total) }}</strong>
          </div>
        </div>

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

.section-kicker {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.caja-topbar,
.detalle-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  padding: 1.45rem 1.55rem;
  border-radius: 1.1rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 30%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.84));
}

.caja-topbar-copy,
.detalle-hero-copy {
  display: grid;
  gap: 0.35rem;
}

.caja-topbar-copy h2,
.detalle-hero-copy h2 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.7rem;
}

.caja-topbar-copy p,
.detalle-hero-copy p {
  margin: 0;
  max-width: 64ch;
  color: #94a3b8;
  line-height: 1.5;
}

.caja-topbar-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.caja-pdf-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.btn-pdf-week {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(29, 78, 216, 0.95));
  color: #eff6ff;
}

.caja-tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.caja-semana-shell {
  padding: 1.25rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.94));
}

.caja-semana-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.caja-semana-copy {
  display: grid;
  gap: 0.35rem;
}

.caja-semana-copy h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.35rem;
}

.caja-semana-copy p {
  margin: 0;
  max-width: 68ch;
  color: #94a3b8;
  line-height: 1.5;
}

.caja-semana-actions {
  display: flex;
  align-items: end;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.caja-semana-select {
  display: grid;
  gap: 0.4rem;
  min-width: 260px;
  color: #d1d5db;
  font-size: 0.82rem;
  font-weight: 600;
}

.caja-semana-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.9rem;
}

.caja-semana-card {
  display: grid;
  gap: 0.35rem;
  padding: 1rem 1.05rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.caja-semana-card span {
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.caja-semana-card strong {
  color: #f8fafc;
  font-size: 1.35rem;
}

.caja-semana-meta {
  color: #cbd5e1;
  font-size: 0.78rem;
  line-height: 1.35;
}

.caja-semana-card-in strong {
  color: #86efac;
}

.caja-semana-card-out strong {
  color: #fca5a5;
}

.caja-semana-card-balance strong {
  color: #7dd3fc;
}

.btn-week-close {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff7ed;
  border-color: rgba(251, 191, 36, 0.42);
}

.btn-week-close:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 18px rgba(245, 158, 11, 0.28);
}

.week-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.9rem;
  padding: 0.72rem 0.95rem;
  border-radius: 0.8rem;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.week-badge-open {
  color: #bbf7d0;
  background: rgba(22, 163, 74, 0.18);
  border: 1px solid rgba(74, 222, 128, 0.24);
}

.week-badge-closed {
  color: #fde68a;
  background: rgba(202, 138, 4, 0.18);
  border: 1px solid rgba(250, 204, 21, 0.24);
}

.caja-tab {
  padding: 0.9rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.45);
  color: #cbd5e1;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.caja-tab:hover {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(30, 41, 59, 0.72);
}

.caja-tab.active {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(14, 165, 233, 0.92));
  color: #eff6ff;
  border-color: rgba(147, 197, 253, 0.55);
  box-shadow: 0 12px 24px rgba(14, 165, 233, 0.18);
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

.toolbar-caja {
  align-items: flex-end;
}

.caja-toolbar-shell,
.caja-list-shell,
.desglose-medios {
  padding: 1.2rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(15, 23, 42, 0.92));
}

.toolbar-search {
  flex: 1 1 260px;
}

.toolbar-search-label {
  display: grid;
  gap: 0.45rem;
  color: #cbd5e1;
  font-size: 0.82rem;
  font-weight: 600;
}

.input-search {
  min-width: 280px;
}

.tabla-referencia {
  display: grid;
  gap: 0.18rem;
}

.td-cheques {
  min-width: 190px;
  color: #bfdbfe;
  font-size: 0.82rem;
  font-weight: 700;
}

.tabla-referencia small,
.medio-identificador {
  color: #93c5fd;
  font-size: 0.78rem;
  font-weight: 600;
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

.filtros-caja {
  flex: 2 1 580px;
}

.filtros label {
  display: grid;
  gap: 0.4rem;
  color: #d1d5db;
  font-size: 0.82rem;
  font-weight: 600;
}

.input-sm,
.select-sm {
  padding: 0.72rem 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.75rem;
  background: rgba(30, 41, 59, 0.6);
  color: #e5e7eb;
  font-size: 0.9rem;
}

.input-sm:focus,
.select-sm:focus {
  outline: none;
  border-color: #3b82f6;
  background: rgba(30, 41, 59, 0.8);
}

.btn {
  padding: 0.72rem 1rem;
  border: 1px solid transparent;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
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
  background: rgba(51, 65, 85, 0.75);
  color: #d1d5db;
  border-color: rgba(148, 163, 184, 0.18);
  margin-top: 1rem;
}

.btn-secondary:hover {
  background: rgba(71, 85, 105, 0.9);
}

.btn-ghost {
  background: transparent;
  color: #94a3b8;
  border-color: rgba(148, 163, 184, 0.14);
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

.caja-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.caja-stat-card {
  display: grid;
  gap: 0.35rem;
  padding: 1.15rem 1.2rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.caja-stat-card small {
  color: #8ea2c7;
  line-height: 1.45;
}

.stat-label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.stat-value {
  font-size: 1.6rem;
  color: #f8fafc;
}

.caja-stat-balance .stat-value {
  color: #7dd3fc;
}

.caja-stat-ingresos .stat-value {
  color: #86efac;
}

.caja-stat-egresos .stat-value {
  color: #fca5a5;
}

.caja-stat-movimientos .stat-value {
  color: #bfdbfe;
}

.total-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 1.35rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.92));
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
  display: grid;
  gap: 1rem;
}

.desglose-medios h3,
.section-heading h3 {
  color: #d1d5db;
  font-size: 1.05rem;
  margin: 0;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.section-heading > div {
  display: grid;
  gap: 0.28rem;
}

.section-heading p {
  margin: 0;
  max-width: 34rem;
  color: #94a3b8;
  line-height: 1.5;
}

.medios-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.medio-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 0.4rem;
  padding: 1rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.9rem;
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
  background: transparent;
}

.tabla-shell {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 1rem;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.55);
}

.tabla thead {
  background: rgba(30, 41, 59, 0.9);
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
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
  display: grid;
  gap: 0.35rem;
  text-align: center;
  color: #9ca3af;
  padding: 2.4rem 1rem;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 1rem;
  background: rgba(15, 23, 42, 0.45);
  margin-top: 1rem;
}

.empty strong {
  color: #e2e8f0;
}

/* Detalle card */
.detalle-card {
  background: rgba(15, 23, 42, 0.4);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 1rem;
  padding: 2rem;
}

.detalle-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
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
  padding: 1.2rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(30, 41, 59, 0.34);
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
  gap: 0.35rem;
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
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.9rem;
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
  display: grid;
  gap: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.9));
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
}

.desglose-compacto-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.desglose-compacto-header > div {
  display: grid;
  gap: 0.28rem;
}

.desglose-compacto-header p {
  margin: 0;
  max-width: 30rem;
  color: #94a3b8;
  line-height: 1.45;
}

.desglose-compacto h4 {
  color: #cbd5e1;
  font-size: 1rem;
  margin: 0;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 600;
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
  padding: 0.85rem;
  border-radius: 0.85rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.46);
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
  gap: 1rem;
  padding: 0.85rem 1rem;
  background: rgba(15, 23, 42, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.85rem;
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

.desglose-validacion-compact.ok {
  border-color: rgba(74, 222, 128, 0.18);
}

.desglose-validacion-compact.error {
  border-color: rgba(248, 113, 113, 0.22);
}

.desglose-validacion-copy {
  display: grid;
  gap: 0.2rem;
}

.desglose-validacion-copy span {
  color: #94a3b8;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.desglose-validacion-copy strong {
  color: #e2e8f0;
  font-size: 1rem;
}

.cheques-section {
  margin-top: 1rem;
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 28%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.94));
}

.cheques-section-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  flex-wrap: wrap;
}

.cheques-section-header > div {
  display: grid;
  gap: 0.35rem;
}

.cheques-section-header > small {
  display: none;
}

.cheques-header-side {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.cheques-header-side small {
  color: #94a3b8;
  line-height: 1.45;
}

.cheques-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  background: rgba(30, 64, 175, 0.24);
  color: #bfdbfe;
  font-size: 0.76rem;
  font-weight: 700;
}

.cheques-intro {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.95rem 1rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.cheques-intro-copy {
  display: grid;
  gap: 0.25rem;
}

.cheques-intro-copy strong {
  color: #f8fafc;
  font-size: 0.96rem;
}

.cheques-intro-copy p {
  margin: 0;
  color: #94a3b8;
  font-size: 0.88rem;
  line-height: 1.45;
}

.cheques-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.cheques-actions-prominent {
  justify-content: flex-end;
}

.btn-cheque-add {
  margin-top: 0;
  padding: 0.72rem 1rem;
  border-radius: 0.85rem;
  border: 1px solid rgba(96, 165, 250, 0.24);
  background: linear-gradient(180deg, rgba(29, 78, 216, 0.34), rgba(30, 64, 175, 0.24));
  color: #dbeafe;
  font-size: 0.84rem;
  font-weight: 700;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.btn-cheque-add:hover {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.34);
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.44), rgba(30, 64, 175, 0.3));
}

.btn-cheque-add-alt {
  background: linear-gradient(180deg, rgba(8, 145, 178, 0.28), rgba(14, 116, 144, 0.22));
  border-color: rgba(103, 232, 249, 0.22);
}

.btn-cheque-save {
  margin-top: 0;
  padding: 0.72rem 1rem;
  border-radius: 0.85rem;
  border: 1px solid rgba(74, 222, 128, 0.24);
  background: linear-gradient(180deg, rgba(22, 163, 74, 0.34), rgba(21, 128, 61, 0.24));
  color: #dcfce7;
  font-size: 0.84rem;
  font-weight: 700;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.btn-cheque-save:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(134, 239, 172, 0.34);
  background: linear-gradient(180deg, rgba(22, 163, 74, 0.44), rgba(21, 128, 61, 0.3));
}

.btn-cheque-save:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cheques-list {
  display: grid;
  gap: 0.85rem;
}

.cheque-card {
  padding: 0.95rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.42);
  display: grid;
  gap: 0.75rem;
}

.cheque-card-top {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.cheque-card-index {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.6rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
  font-size: 0.76rem;
  font-weight: 700;
}

.cheque-card-caption {
  color: #94a3b8;
  font-size: 0.8rem;
}

.cheque-card-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.cheque-card-row-main {
  grid-template-columns: 140px 1fr 1.2fr auto;
  align-items: end;
}

.cheque-card-remove {
  display: flex;
  align-items: end;
}

.btn-cheque-remove {
  margin-top: 0;
  min-height: 44px;
  padding: 0.72rem 0.95rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(248, 113, 113, 0.26);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.28), rgba(69, 10, 10, 0.22));
  color: #fecaca;
  font-size: 0.8rem;
  font-weight: 700;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.btn-cheque-remove:hover {
  transform: translateY(-1px);
  border-color: rgba(252, 165, 165, 0.36);
  background: linear-gradient(180deg, rgba(153, 27, 27, 0.38), rgba(127, 29, 29, 0.28));
}

.cheques-empty-card {
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  border-radius: 0.95rem;
  border: 1px dashed rgba(148, 163, 184, 0.26);
  background: rgba(15, 23, 42, 0.36);
}

.cheques-empty-label {
  color: #f8fafc;
  font-size: 0.92rem;
  font-weight: 700;
}

.cheques-empty-card p {
  margin: 0;
  color: #94a3b8;
  font-size: 0.88rem;
  line-height: 1.45;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
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
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  animation: fadeIn 0.18s ease-out;
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

.modal-movimiento {
  width: min(94vw, 860px);
  max-width: 860px;
  border-radius: 1.15rem;
  border-color: rgba(96, 165, 250, 0.22);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
}

.modal-confirmacion {
  width: min(92vw, 520px);
  max-width: 520px;
  border-radius: 1.05rem;
  border-color: rgba(248, 113, 113, 0.2);
  background:
    radial-gradient(circle at top left, rgba(239, 68, 68, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
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

.modal-header-movimiento {
  align-items: flex-start;
  padding: 1.4rem 1.55rem 1.15rem;
}

.modal-header-confirmacion {
  align-items: flex-start;
  padding: 1.35rem 1.45rem 1.05rem;
}

.modal-header-copy {
  display: grid;
  gap: 0.35rem;
}

.modal-header-copy p {
  margin: 0;
  max-width: 58ch;
  color: #94a3b8;
  line-height: 1.45;
}

.modal-header h3 {
  margin: 0;
  color: #e2e8f0;
  font-size: 1.25rem;
}

.btn-close {
  width: 2.55rem;
  height: 2.55rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.8rem;
  color: #e2e8f0;
  font-size: 1.3rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.btn-close:hover {
  color: #ffffff;
  border-color: rgba(125, 211, 252, 0.4);
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.42), rgba(30, 64, 175, 0.34));
  transform: translateY(-1px);
}

.modal-form {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.modal-form-movimiento {
  padding: 1.15rem 1.45rem 1.45rem;
  gap: 1rem;
}

.modal-form-confirmacion {
  align-items: center;
  padding: 1.25rem 1.45rem 1.45rem;
  gap: 1rem;
}

.confirmacion-icono {
  width: 3.4rem;
  height: 3.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.88), rgba(69, 10, 10, 0.92));
  border: 1px solid rgba(248, 113, 113, 0.26);
  color: #fecaca;
  font-size: 1.45rem;
  font-weight: 800;
}

.confirmacion-copy {
  display: grid;
  gap: 0.9rem;
  width: 100%;
  text-align: center;
}

.confirmacion-copy p {
  margin: 0;
  color: #e2e8f0;
  font-size: 1rem;
  line-height: 1.5;
}

.confirmacion-resumen {
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(248, 113, 113, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.confirmacion-resumen span {
  color: #cbd5e1;
}

.confirmacion-resumen strong {
  color: #fca5a5;
  font-size: 1.05rem;
}

.movimiento-summary-pills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.85rem;
}

.summary-pill {
  display: grid;
  gap: 0.28rem;
  padding: 0.95rem 1rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.summary-pill span {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.summary-pill strong {
  color: #f8fafc;
  font-size: 0.98rem;
}

.modal-section {
  display: grid;
  gap: 0.95rem;
  padding: 1.05rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.78), rgba(15, 23, 42, 0.94));
}

.modal-section-highlighted {
  border-color: rgba(96, 165, 250, 0.2);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 26%),
    linear-gradient(180deg, rgba(23, 37, 84, 0.34), rgba(15, 23, 42, 0.95));
}

.modal-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.modal-section-header > div {
  display: grid;
  gap: 0.28rem;
}

.modal-section-header h4 {
  margin: 0;
  color: #f8fafc;
  font-size: 1rem;
}

.modal-section-header small {
  max-width: 32rem;
  color: #94a3b8;
  line-height: 1.45;
}

.form-card-field {
  padding: 0.95rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.86));
}

.form-card-field-accent {
  border-color: rgba(125, 211, 252, 0.2);
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.18), rgba(15, 23, 42, 0.9));
}

.form-row-primary {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
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

.modal-actions .btn-primary {
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

.modal-actions .btn-primary:hover:not(:disabled) {
  background-color: #2563eb;
}

.modal-actions .btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-actions .btn-primary.btn-danger {
  background-color: #ef4444;
}

.modal-actions .btn-primary.btn-danger:hover:not(:disabled) {
  background-color: #dc2626;
}

.modal-actions .btn-secondary {
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

.modal-actions .btn-secondary:hover {
  background-color: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.5);
}

@media (max-width: 720px) {
  .caja-topbar,
  .detalle-hero,
  .section-heading,
  .caja-semana-header,
  .modal-section-header,
  .cheques-intro,
  .desglose-compacto-header,
  .modal-header-movimiento {
    flex-direction: column;
  }

  .input-search {
    min-width: 100%;
  }

  .tabla {
    display: block;
    overflow-x: auto;
  }

  .acciones {
    flex-wrap: wrap;
  }

  .modal {
    width: 96%;
  }

  .desglose-grid-compact {
    grid-template-columns: 1fr;
  }

  .caja-semana-select {
    min-width: 100%;
  }

  .cheque-card-row-main {
    grid-template-columns: 1fr;
  }

  .cheque-card-remove {
    align-items: stretch;
  }

  .desglose-compact-item:last-child {
    grid-column: auto;
    max-width: none;
    margin: 0;
  }

  .modal-actions {
    flex-direction: column;
  }
}
</style>

