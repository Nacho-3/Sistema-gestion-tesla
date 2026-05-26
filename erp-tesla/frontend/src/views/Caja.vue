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
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const showConfirm = ref(false)
const movimientoAEliminar = ref(null)
const editandoMovimientoId = ref(null)
const generandoPdf = ref(false)
const generandoPdfDetalle = ref(false)
const generandoPdfCheques = ref(false)
const mostrarModalPdfCheques = ref(false)
const opcionPdfCheques = ref("disponibles")
const filtroCaja = ref("tesla")
const filtroBusqueda = ref("")
const semanasCaja = ref([])
const semanaActual = ref(null)
const semanaSeleccionadaId = ref("")
const mostrarModalCerrarSemana = ref(false)
const saldoBancoCierre = ref("")
const saldoPendienteEcheqCierre = ref("")
const saldoEcheqDepositadosCierre = ref("")
const saldoEfectivoCierre = ref("")
const saldoChequesCierre = ref("")
const saldoBancoEditable = ref("")
const saldoEcheqADepositarEditable = ref("")
const saldoEcheqDepositadosEditable = ref("")
const saldoEfectivoEditable = ref("")
const saldoChequesEditable = ref("")
const guardandoSaldosSemana = ref(false)
const proximaSemanaInfo = ref(null)
const confirmandoCierre = ref(false)
const libroCheques = ref([])
const chequesDisponibles = ref([])
const loadingLibroCheques = ref(false)
const filtroBusquedaLibroCheques = ref("")
const libroChequesExpandido = ref(true)
const movimientosExpandido = ref(true)

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
  observaciones: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    retencion: 0
  },
  cheques: [],
  usar_cheques_libro: false,
  cheques_salida: [],
  fecha_salida_cheques: new Date().toISOString().split('T')[0],
  endosado_a_cheques: ""
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


const crearChequeVacio = (medio = "cheque") => ({
  medio_pago: medio,
  monto: 0,
  identificador: "",
  numero_cheque: "",
  librador_endosante: "",
  banco: "",
  fecha_cheque: "",
  fecha_entrada: new Date().toISOString().split('T')[0],
  fecha_cobro: "",
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
    saldo_banco: semana.saldo_banco === null || semana.saldo_banco === undefined ? null : Number(semana.saldo_banco),
    saldo_pendiente_echeq: semana.saldo_pendiente_echeq === null || semana.saldo_pendiente_echeq === undefined ? null : Number(semana.saldo_pendiente_echeq),
    saldo_echeq_depositados: semana.saldo_echeq_depositados === null || semana.saldo_echeq_depositados === undefined ? null : Number(semana.saldo_echeq_depositados),
    saldo_efectivo: semana.saldo_efectivo === null || semana.saldo_efectivo === undefined ? null : Number(semana.saldo_efectivo),
    saldo_cheques: semana.saldo_cheques === null || semana.saldo_cheques === undefined ? null : Number(semana.saldo_cheques),
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
const chequesBloqueadosPorLibro = computed(() => esEgreso.value && Boolean(form.value.usar_cheques_libro))

const chequesCargados = computed(() => {
  return (form.value.cheques || []).filter((item) => {
    const monto = parseFloat(item?.monto || 0)
    const identificador = String(item?.identificador || item?.numero_cheque || "").trim()
    return monto > 0 || identificador.length > 0
  })
})

const libroChequesFiltrado = computed(() => {
  const termino = String(filtroBusquedaLibroCheques.value || "").trim().toLowerCase()

  return (libroCheques.value || []).filter((item) => {
    if (!termino) return true
    return [item.numero_cheque, item.banco, item.librador_endosante, item.endosado_a]
      .some((v) => String(v || "").toLowerCase().includes(termino))
  })
})

const libroChequesDisponibles = computed(() => {
  return libroChequesFiltrado.value
    .filter((item) => String(item.estado || "").toLowerCase() === "disponible")
    .sort((a, b) => {
      const fechaA = String(a?.fecha_cheque || "")
      const fechaB = String(b?.fecha_cheque || "")
      if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
      return String(a?.numero_cheque || "").localeCompare(String(b?.numero_cheque || ""))
    })
})

const libroChequesNoDisponibles = computed(() => {
  return libroChequesFiltrado.value
    .filter((item) => String(item.estado || "").toLowerCase() !== "disponible")
    .sort((a, b) => {
      const fechaA = String(a?.fecha_salida || a?.fecha_cheque || "")
      const fechaB = String(b?.fecha_salida || b?.fecha_cheque || "")
      if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
      return String(a?.numero_cheque || "").localeCompare(String(b?.numero_cheque || ""))
    })
})

const capitalizarInicial = (value) => {
  const texto = String(value || "").trim()
  if (!texto) return ""
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const chequesDisponiblesOrdenados = computed(() => {
  return [...(chequesDisponibles.value || [])].sort((a, b) => {
    const fechaA = String(a?.fecha_cheque || "")
    const fechaB = String(b?.fecha_cheque || "")
    if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)

    const bancoA = String(a?.banco || "")
    const bancoB = String(b?.banco || "")
    if (bancoA !== bancoB) return bancoA.localeCompare(bancoB)

    return String(a?.numero_cheque || "").localeCompare(String(b?.numero_cheque || ""))
  })
})

const esFormularioValido = computed(() => {
  if (!form.value.fecha || !form.value.caja_codigo || !form.value.detalle || !form.value.monto_total || form.value.monto_total <= 0) {
    return false
  }

  if (form.value.tipo === "ingreso" && !form.value.categoria) {
    return false
  }

  if (
    form.value.tipo === "egreso"
    && !String(form.value.destinatario || form.value.endosado_a_cheques || "").trim()
  ) {
    return false
  }

  const sumaDesglose = sumaMediosPago.value
  const chequesValidos = chequesCargados.value.every((item) => {
    if (!(parseFloat(item?.monto || 0) > 0)) return false
    const identificadorValido = String(item?.identificador || item?.numero_cheque || "").trim().length > 0
    if (!identificadorValido) return false

    if (form.value.tipo === "ingreso" && ["cheque", "echeq"].includes(String(item?.medio_pago || ""))) {
      return Boolean(
        String(item?.librador_endosante || "").trim() &&
        String(item?.banco || "").trim() &&
        String(item?.numero_cheque || item?.identificador || "").trim() &&
        String(item?.fecha_cheque || "").trim() &&
        String(item?.fecha_entrada || item?.fecha_cobro || "").trim()
      )
    }

    return true
  })
  if (!chequesValidos) return false

  if (form.value.tipo === "egreso" && form.value.usar_cheques_libro) {
    if (!Array.isArray(form.value.cheques_salida) || form.value.cheques_salida.length === 0) return false
    if (!String(form.value.endosado_a_cheques || "").trim()) return false
  }

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
const hayFiltroFecha = computed(() => Boolean(filtroFechaInicio.value || filtroFechaFin.value))
const semanaAplicadaAFiltros = computed(() => (hayFiltroFecha.value ? null : semanaActiva.value))

const movimientosFiltrados = computed(() => {
  let resultado = movimientos.value

  if (semanaAplicadaAFiltros.value) {
    resultado = resultado.filter((movimiento) => movimientoPerteneceASemana(movimiento, semanaAplicadaAFiltros.value))
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
        movimiento.observaciones,
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
const puedeDescargarResumenGeneral = computed(() => Boolean(filtroFechaInicio.value && filtroFechaFin.value))
const rangoActivoDescripcion = computed(() => {
  if (hayFiltroFecha.value) {
    return `Filtro por fechas ${textoRangoFechas()}`
  }
  if (semanaAplicadaAFiltros.value?.fecha_inicio && semanaAplicadaAFiltros.value?.fecha_fin) {
    return `Semana ${textoRangoFechas(semanaAplicadaAFiltros.value.fecha_inicio, semanaAplicadaAFiltros.value.fecha_fin)}`
  }
  if (!filtroFechaInicio.value && !filtroFechaFin.value) return "Sin rango de fechas aplicado"
  return textoRangoFechas()
})

const saldoInicialEfectivoSemana = computed(() => Number(semanaActiva.value?.saldo_inicial_efectivo || 0))
const saldoInicialChequesSemana = computed(() => Number(semanaActiva.value?.saldo_inicial_cheques || 0))
const saldoInicialSemana = computed(() => saldoInicialEfectivoSemana.value + saldoInicialChequesSemana.value)
const ingresosSemana = computed(() => Number(semanaActiva.value?.total_ingresos || 0))
const egresosSemana = computed(() => Number(semanaActiva.value?.total_egresos || 0))
const saldoFinalEfectivoSemana = computed(() => Number(semanaActiva.value?.saldo_final_efectivo || 0))
const saldoFinalChequesSemana = computed(() => Number(semanaActiva.value?.saldo_final_cheques || 0))
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

const desgloseMedios = computed(() => {
  const mapa = mediosDePago.reduce((acc, medio) => {
    acc[medio.id] = { ingresos: 0, egresos: 0, balance: 0 }
    return acc
  }, {})

  movimientosFiltrados.value.forEach((movimiento) => {
    const signoIngreso = String(movimiento?.tipo || "") === "ingreso"
    ;(movimiento.detalles_medio_pago || []).forEach((detalle) => {
      const medio = String(detalle?.medio_pago || "").toLowerCase()
      const monto = Number(detalle?.monto || 0)
      if (!mapa[medio] || !(monto > 0)) return

      if (signoIngreso) {
        mapa[medio].ingresos += monto
        mapa[medio].balance += monto
      } else {
        mapa[medio].egresos += monto
        mapa[medio].balance -= monto
      }
    })
  })

  return mediosDePago.map((medio) => ({
    ...medio,
    ingresos: mapa[medio.id].ingresos,
    egresos: mapa[medio.id].egresos,
    balance: mapa[medio.id].balance,
  }))
})

const cargarDatos = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getMovimientosCaja(
      fechaInicioConsulta.value,
      fechaFinConsulta.value,
      filtroTipo.value,
      filtroCaja.value,
      undefined,
      filtroBusqueda.value
    )
    movimientos.value = res.data.movimientos || []
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
  await cargarLibroCheques()
  await cargarChequesDisponibles()
}

const aplicarFiltros = () => {
  if (hayFiltroFecha.value) {
    semanaSeleccionadaId.value = ""
  }
  cargarDatos()
}

const manejarCambioFiltroFecha = () => {
  if (filtroFechaInicio.value || filtroFechaFin.value) {
    semanaSeleccionadaId.value = ""
  }
}

const abrirModalCerrarSemana = () => {
  if (!semanaActiva.value?.id) return
  
  // Calculamos las fechas de la próxima semana para mostrar seguridad al usuario
  const fechaFin = semanaActiva.value.fecha_fin
  if (fechaFin) {
    const d = new Date(`${fechaFin}T00:00:00`)
    const proxInicio = new Date(d)
    proxInicio.setDate(d.getDate() + 3) // Lunes
    const proxFin = new Date(proxInicio)
    proxFin.setDate(proxInicio.getDate() + 4) // Viernes
    
    proximaSemanaInfo.value = {
      inicio: proxInicio.toLocaleDateString("es-AR"),
      fin: proxFin.toLocaleDateString("es-AR")
    }
  }

  saldoBancoCierre.value = saldoBancoEditable.value
  saldoPendienteEcheqCierre.value = saldoEcheqADepositarEditable.value
  saldoEcheqDepositadosCierre.value = saldoEcheqDepositadosEditable.value
  saldoEfectivoCierre.value = saldoEfectivoEditable.value
  saldoChequesCierre.value = saldoChequesEditable.value
  mostrarModalCerrarSemana.value = true
}

const cargarSaldosEditablesDesdeSemana = () => {
  saldoBancoEditable.value = semanaActiva.value?.saldo_banco ?? ""
  saldoEcheqADepositarEditable.value = semanaActiva.value?.saldo_pendiente_echeq ?? ""
  saldoEcheqDepositadosEditable.value = semanaActiva.value?.saldo_echeq_depositados ?? ""
  saldoEfectivoEditable.value = semanaActiva.value?.saldo_efectivo ?? ""
  saldoChequesEditable.value = semanaActiva.value?.saldo_cheques ?? ""
}

const descartarSaldosSemana = async () => {
  if (!semanaActiva.value?.id) return
  try {
    guardandoSaldosSemana.value = true
    await api.updateSemanaCajaSaldos(semanaActiva.value.id, {
      saldo_banco: null,
      saldo_pendiente_echeq: null,
      saldo_echeq_depositados: null,
      saldo_efectivo: null,
      saldo_cheques: null,
    })
    await refrescarCaja({ mantenerSeleccion: true })
    saldoBancoEditable.value = ""
    saldoEcheqADepositarEditable.value = ""
    saldoEcheqDepositadosEditable.value = ""
    saldoEfectivoEditable.value = ""
    saldoChequesEditable.value = ""
  } catch (err) {
    error.value = `Error al descartar saldos: ${err.response?.data?.error || err.message}`
  } finally {
    guardandoSaldosSemana.value = false
  }
}

const guardarSaldosSemana = async () => {
  if (!semanaActiva.value?.id) return

  try {
    guardandoSaldosSemana.value = true
    await api.updateSemanaCajaSaldos(semanaActiva.value.id, {
      saldo_banco: saldoBancoEditable.value !== "" ? Number(saldoBancoEditable.value) : null,
      saldo_pendiente_echeq: saldoEcheqADepositarEditable.value !== "" ? Number(saldoEcheqADepositarEditable.value) : null,
      saldo_echeq_depositados: saldoEcheqDepositadosEditable.value !== "" ? Number(saldoEcheqDepositadosEditable.value) : null,
      saldo_efectivo: saldoEfectivoEditable.value !== "" ? Number(saldoEfectivoEditable.value) : null,
      saldo_cheques: saldoChequesEditable.value !== "" ? Number(saldoChequesEditable.value) : null,
    })
    await refrescarCaja({ mantenerSeleccion: true })
    cargarSaldosEditablesDesdeSemana()
  } catch (err) {
    error.value = `Error al guardar saldos semanales: ${err.response?.data?.error || err.message}`
  } finally {
    guardandoSaldosSemana.value = false
  }
}

const confirmarCerrarSemana = async () => {
  if (!semanaActiva.value?.id) return
  
  try {
    confirmandoCierre.value = true
    const body = {
      saldo_banco: saldoBancoCierre.value !== "" ? Number(saldoBancoCierre.value) : null,
      saldo_pendiente_echeq: saldoPendienteEcheqCierre.value !== "" ? Number(saldoPendienteEcheqCierre.value) : null,
      saldo_echeq_depositados: saldoEcheqDepositadosCierre.value !== "" ? Number(saldoEcheqDepositadosCierre.value) : null,
      saldo_efectivo: saldoEfectivoCierre.value !== "" ? Number(saldoEfectivoCierre.value) : null,
      saldo_cheques: saldoChequesCierre.value !== "" ? Number(saldoChequesCierre.value) : null,
    }
    const res = await api.cerrarSemanaCaja(semanaActiva.value.id, body)
    const proximaSemanaId = res?.data?.proximaSemana?.id
    if (proximaSemanaId) {
      semanaSeleccionadaId.value = String(proximaSemanaId)
    }
    await refrescarCaja({ mantenerSeleccion: true })
    mostrarModalCerrarSemana.value = false
    proximaSemanaInfo.value = null
  } catch (err) {
    error.value = `Error al cerrar semana: ${err.response?.data?.error || err.message}`
  } finally {
    confirmandoCierre.value = false
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
  if (!filtroFechaInicio.value || !filtroFechaFin.value) {
    error.value = "Para descargar el resumen general debés seleccionar fecha de inicio y fecha de fin"
    return
  }

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
      filtroCaja.value,
      "general",
      filtroBusqueda.value
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
      filtroCaja.value,
      "semanal"
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

const abrirModalPdfCheques = () => {
  opcionPdfCheques.value = "disponibles"
  mostrarModalPdfCheques.value = true
}

const descargarLibroChequesPdf = async () => {
  const listado = String(opcionPdfCheques.value || "disponibles")

  try {
    generandoPdfCheques.value = true
    const res = await api.getLibroChequesPdf(filtroCaja.value, listado, filtroBusquedaLibroCheques.value)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url

    const hoy = new Date()
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`
    link.download = `Libro cheques ${textoCajaFiltro()} ${listado} ${fecha}.pdf`

    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = `Error al generar PDF de cheques: ${err.response?.data?.error || err.message}`
  } finally {
    generandoPdfCheques.value = false
    mostrarModalPdfCheques.value = false
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
  observaciones: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    retencion: 0
  },
  cheques: [],
  usar_cheques_libro: false,
  cheques_salida: [],
  fecha_salida_cheques: new Date().toISOString().split('T')[0],
  endosado_a_cheques: ""
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
      numero_cheque: String(item?.numero_cheque || item?.identificador || "").trim(),
      librador_endosante: String(item?.librador_endosante || "").trim(),
      banco: String(item?.banco || "").trim(),
      fecha_cheque: String(item?.fecha_cheque || "").split("T")[0],
      fecha_entrada: String(item?.fecha_entrada || item?.fecha_cobro || "").split("T")[0],
      libro_cheque_id: Number(item?.libro_cheque_id || 0) || null,
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


const agregarCheque = () => {
  form.value.cheques.push(crearChequeVacio())
}

const agregarEcheq = () => {
  form.value.cheques.push(crearChequeVacio("echeq"))
}

const eliminarCheque = (index) => {
  form.value.cheques.splice(index, 1)
}

const abrirEdicion = (movimiento) => {
  const chequesMovimiento = normalizarCheques(movimiento.detalles_medio_pago || [])
  const chequesSalidaIds = chequesMovimiento
    .map((item) => Number(item.libro_cheque_id || 0))
    .filter((id) => Number.isInteger(id) && id > 0)

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
    observaciones: movimiento.observaciones || "",
    monto_total: parseFloat(movimiento.monto_total) || 0,
    desglose: normalizarDesglose(movimiento.detalles_medio_pago || []),
    cheques: chequesMovimiento,
    usar_cheques_libro: movimiento.tipo === "egreso" && chequesSalidaIds.length > 0,
    cheques_salida: chequesSalidaIds,
    fecha_salida_cheques: String(movimiento.fecha || "").split("T")[0] || new Date().toISOString().split('T')[0],
    endosado_a_cheques: String(movimiento.destinatario || "").trim(),
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
  destinatario: form.value.tipo === "egreso"
    ? String(form.value.destinatario || form.value.endosado_a_cheques || "").trim()
    : null,
  cliente_id: form.value.tipo === "ingreso" ? (form.value.cliente_id || null) : null,
  presupuesto_id: form.value.tipo === "ingreso" ? (form.value.presupuesto_id || null) : null,
  detalle: form.value.detalle,
  observaciones: String(form.value.observaciones || "").trim() || null,
  monto_total: parseFloat(form.value.monto_total),
  desglose: {
    efectivo: parseFloat(form.value.desglose.efectivo) || 0,
    transferencia: parseFloat(form.value.desglose.transferencia) || 0,
    retencion: parseFloat(form.value.desglose.retencion) || 0
  },
  detalles_medio_pago: chequesCargados.value
    .filter((item) => parseFloat(item?.monto || 0) > 0 && String(item?.identificador || item?.numero_cheque || "").trim())
    .map((item) => ({
      medio_pago: item.medio_pago,
      monto: parseFloat(item.monto) || 0,
      identificador: String(item.identificador || item.numero_cheque || "").trim(),
      numero_cheque: String(item.numero_cheque || item.identificador || "").trim(),
      librador_endosante: String(item.librador_endosante || "").trim(),
      banco: String(item.banco || "").trim(),
      fecha_cheque: item.fecha_cheque || null,
      fecha_entrada: item.fecha_entrada || null,
      libro_cheque_id: Number(item.libro_cheque_id || 0) || null,
      endosado_a: form.value.tipo === "egreso" ? String(form.value.endosado_a_cheques || form.value.destinatario || "").trim() : null,
    })),
  cheques_salida: form.value.tipo === "egreso" && form.value.usar_cheques_libro
    ? (form.value.cheques_salida || []).map((id) => ({ libro_cheque_id: Number(id) }))
    : [],
  fecha_salida_cheques: form.value.tipo === "egreso" && form.value.usar_cheques_libro
    ? (form.value.fecha_salida_cheques || form.value.fecha)
    : null,
  endosado_a_cheques: form.value.tipo === "egreso" && form.value.usar_cheques_libro
    ? String(form.value.endosado_a_cheques || form.value.destinatario || "").trim()
    : null,
})

const cargarLibroCheques = async () => {
  try {
    loadingLibroCheques.value = true
    const res = await api.getLibroChequesCaja(filtroCaja.value, "", filtroBusquedaLibroCheques.value)
    libroCheques.value = res.data || []
  } catch (err) {
    console.error("Error al cargar libro de cheques:", err)
  } finally {
    loadingLibroCheques.value = false
  }
}

const cargarChequesDisponibles = async () => {
  try {
    const res = await api.getChequesDisponiblesCaja(filtroCaja.value)
    chequesDisponibles.value = (res.data || []).map((item) => ({
      ...item,
      librador_endosante: capitalizarInicial(item.librador_endosante),
      banco: capitalizarInicial(item.banco),
    }))
  } catch (err) {
    console.error("Error al cargar cheques disponibles:", err)
    chequesDisponibles.value = []
  }
}

const sincronizarChequesSalidaSeleccionados = () => {
  if (!(form.value.tipo === "egreso" && form.value.usar_cheques_libro)) return

  const seleccionados = (form.value.cheques_salida || [])
    .map((id) => chequesDisponibles.value.find((item) => Number(item.id) === Number(id)))
    .filter(Boolean)

  form.value.cheques = seleccionados.map((item) => ({
    medio_pago: String(item.medio_pago || "cheque").toLowerCase(),
    monto: Number(item.importe || 0),
    identificador: String(item.numero_cheque || ""),
    numero_cheque: String(item.numero_cheque || ""),
    librador_endosante: String(item.librador_endosante || ""),
    banco: String(item.banco || ""),
    fecha_cheque: String(item.fecha_cheque || "").split("T")[0],
    fecha_entrada: String(item.fecha_entrada || "").split("T")[0],
    libro_cheque_id: Number(item.id),
  }))
}

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

    await refrescarCaja()
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
    await refrescarCaja()
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

const formatearFechaLibro = (valor) => {
  const texto = String(valor || "").trim()
  if (!texto) return "-"

  const base = texto.includes("T") ? texto.split("T")[0] : texto
  const matchIso = base.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (matchIso) {
    const [, anio, mes, dia] = matchIso
    return `${dia}/${mes}/${anio}`
  }

  const fecha = new Date(texto)
  if (Number.isNaN(fecha.getTime())) return texto
  return fecha.toLocaleDateString("es-AR", { timeZone: "UTC" })
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

watch(semanaActiva, () => {
  cargarSaldosEditablesDesdeSemana()
}, { immediate: true })

watch(() => form.value.tipo, (tipo) => {
  if (tipo === "egreso") {
    form.value.categoria = ""
    form.value.cliente_id = ""
    form.value.presupuesto_id = ""
    return
  }

  form.value.destinatario = ""
  form.value.usar_cheques_libro = false
  form.value.cheques_salida = []
  form.value.endosado_a_cheques = ""
  if (!form.value.categoria) {
    form.value.categoria = "mano_obra"
  }
})

watch(() => form.value.usar_cheques_libro, (usar) => {
  if (form.value.tipo !== "egreso") return
  if (usar) {
    form.value.cheques = []
    sincronizarChequesSalidaSeleccionados()
  } else {
    form.value.cheques_salida = []
    form.value.endosado_a_cheques = ""
    form.value.fecha_salida_cheques = form.value.fecha
  }
})

watch(() => form.value.cheques_salida, () => {
  sincronizarChequesSalidaSeleccionados()
}, { deep: true })

watch(() => filtroBusquedaLibroCheques.value, () => {
  cargarLibroCheques()
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
              @click="abrirModalCerrarSemana"
            >
              Cerrar semana
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
            <div class="caja-semana-desglose-final">
              <small class="caja-semana-meta">Efectivo: {{ formatoMoneda(saldoFinalEfectivoSemana) }}</small>
              <small class="caja-semana-meta">Cheques: {{ formatoMoneda(saldoFinalChequesSemana) }}</small>
            </div>
          </article>
        </div>

        <div
          v-if="semanaActiva.saldo_banco !== null && semanaActiva.saldo_banco !== undefined
            || semanaActiva.saldo_pendiente_echeq !== null && semanaActiva.saldo_pendiente_echeq !== undefined
            || semanaActiva.saldo_echeq_depositados !== null && semanaActiva.saldo_echeq_depositados !== undefined
            || semanaActiva.saldo_efectivo !== null && semanaActiva.saldo_efectivo !== undefined
            || semanaActiva.saldo_cheques !== null && semanaActiva.saldo_cheques !== undefined"
          class="caja-resumen-bancario-card"
        >
          <span class="caja-resumen-bancario-title">Resumen bancario</span>
          <div class="caja-resumen-bancario-grid">
            <div v-if="semanaActiva.saldo_banco !== null && semanaActiva.saldo_banco !== undefined" class="caja-semana-bank-box">
              <span class="bank-label">Saldo Banco</span>
              <strong class="bank-value">{{ formatoMoneda(semanaActiva.saldo_banco) }}</strong>
            </div>
            <div v-if="semanaActiva.saldo_pendiente_echeq !== null && semanaActiva.saldo_pendiente_echeq !== undefined" class="caja-semana-bank-box caja-semana-echeq-box">
              <span class="bank-label">eCheqs a depositar</span>
              <strong class="bank-value">{{ formatoMoneda(semanaActiva.saldo_pendiente_echeq) }}</strong>
            </div>
            <div v-if="semanaActiva.saldo_echeq_depositados !== null && semanaActiva.saldo_echeq_depositados !== undefined" class="caja-semana-bank-box caja-semana-echeq-box">
              <span class="bank-label">eCheqs depositados</span>
              <strong class="bank-value">{{ formatoMoneda(semanaActiva.saldo_echeq_depositados) }}</strong>
            </div>
            <div v-if="semanaActiva.saldo_efectivo !== null && semanaActiva.saldo_efectivo !== undefined" class="caja-semana-bank-box caja-semana-cash-box">
              <span class="bank-label">Efectivo ingresado</span>
              <strong class="bank-value">{{ formatoMoneda(semanaActiva.saldo_efectivo) }}</strong>
            </div>
            <div v-if="semanaActiva.saldo_cheques !== null && semanaActiva.saldo_cheques !== undefined" class="caja-semana-bank-box caja-semana-cash-box">
              <span class="bank-label">Cheques ingresados</span>
              <strong class="bank-value">{{ formatoMoneda(semanaActiva.saldo_cheques) }}</strong>
            </div>
          </div>
        </div>

        <section class="caja-bank-inline-shell">
          <div class="caja-bank-inline-head">
            <span class="section-kicker">Resumen bancario semanal</span>
            <p>{{ semanaEstaCerrada ? 'Semana cerrada: no se pueden modificar estos valores.' : 'Podés editar estos montos en cualquier momento. Al cerrar semana se vuelven a confirmar.' }}</p>
          </div>
          <div class="caja-bank-inline-grid">
            <label class="form-group form-card-field form-card-field-accent">
              <span>Saldo banco ($)</span>
              <input v-model.number="saldoBancoEditable" type="number" @wheel.prevent placeholder="0.00" step="0.01" :disabled="semanaEstaCerrada" />
            </label>
            <label class="form-group form-card-field form-card-field-accent">
              <span>eCheqs a depositar ($)</span>
              <input v-model.number="saldoEcheqADepositarEditable" type="number" @wheel.prevent placeholder="0.00" step="0.01" :disabled="semanaEstaCerrada" />
            </label>
            <label class="form-group form-card-field form-card-field-accent">
              <span>eCheqs depositados ($)</span>
              <input v-model.number="saldoEcheqDepositadosEditable" type="number" @wheel.prevent placeholder="0.00" step="0.01" :disabled="semanaEstaCerrada" />
            </label>
            <label class="form-group form-card-field form-card-field-accent">
              <span>Efectivo en caja ($)</span>
              <input v-model.number="saldoEfectivoEditable" type="number" @wheel.prevent placeholder="0.00" step="0.01" :disabled="semanaEstaCerrada" />
            </label>
            <label class="form-group form-card-field form-card-field-accent">
              <span>Cheques en caja ($)</span>
              <input v-model.number="saldoChequesEditable" type="number" @wheel.prevent placeholder="0.00" step="0.01" :disabled="semanaEstaCerrada" />
            </label>
          </div>
          <div class="caja-bank-inline-actions">
            <button type="button" class="btn btn-secondary" :disabled="guardandoSaldosSemana || semanaEstaCerrada" @click="descartarSaldosSemana()">
              Descartar cambios
            </button>
            <button type="button" class="btn btn-primary" :disabled="guardandoSaldosSemana || semanaEstaCerrada" @click="guardarSaldosSemana()">
              {{ guardandoSaldosSemana ? "Guardando..." : "Guardar saldos" }}
            </button>
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
      </section>

      <section class="caja-toolbar-shell">
        <div class="toolbar toolbar-caja">
          <label class="toolbar-search-label toolbar-search">
            <span>Buscar movimiento</span>
            <input v-model="filtroBusqueda" type="text" class="input-sm input-search" placeholder="Detalle, cliente, destinatario, presupuesto..." />
          </label>
          <label class="toolbar-filter-label">
            <span>Desde</span>
            <input v-model="filtroFechaInicio" type="date" class="input-sm" @change="manejarCambioFiltroFecha" />
          </label>
          <label class="toolbar-filter-label">
            <span>Hasta</span>
            <input v-model="filtroFechaFin" type="date" class="input-sm" @change="manejarCambioFiltroFecha" />
          </label>
          <label class="toolbar-filter-label">
            <span>Tipo</span>
            <select v-model="filtroTipo" class="select-sm">
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </label>
          <button class="btn btn-filter-apply toolbar-action-btn" @click="aplicarFiltros">Aplicar filtros</button>
          <button class="btn btn-filter-clear toolbar-action-btn" @click="filtroBusqueda = ''; filtroFechaInicio = ''; filtroFechaFin = ''; filtroTipo = ''; aplicarFiltros()">Limpiar filtros</button>
          <button class="btn btn-pdf btn-pdf-toolbar toolbar-action-btn" :disabled="generandoPdf || !puedeDescargarResumenGeneral" @click="descargarResumenPdf">
            {{ generandoPdf ? "Generando PDF..." : "Descargar Resumen PDF" }}
          </button>
        </div>
      </section>

      <!-- Desglose por medio de pago -->
      <div class="desglose-medios">
        <div class="section-heading">
          <div>
            <span class="section-kicker">Distribucion</span>
            <h3>Desglose por medio de pago</h3>
          </div>
        </div>
        <div class="medios-grid">
          <div class="medio-card" v-for="medio in desgloseMedios" :key="medio.id">
            <span class="label">{{ medio.label }}</span>
            <div class="medio-detalle-linea">
              <small>Ingresos</small>
              <strong class="medio-ingreso">{{ formatoMoneda(medio.ingresos || 0) }}</strong>
            </div>
            <div class="medio-detalle-linea">
              <small>Egresos</small>
              <strong class="medio-egreso">{{ formatoMoneda(medio.egresos || 0) }}</strong>
            </div>
            <div class="medio-detalle-linea">
              <small>Balance</small>
              <strong class="medio-balance">{{ formatoMoneda(medio.balance || 0) }}</strong>
            </div>
          </div>
        </div>
      </div>

      <section class="caja-list-shell caja-list-shell-compact">
        <div class="section-heading section-heading-inline section-heading-libro">
          <div class="section-heading-libro-main">
            <span class="section-kicker">Libro</span>
            <h3>Libro de cheques</h3>
          </div>
          <div class="libro-cheques-header-actions">
            <p class="libro-cheques-counter">{{ libroChequesFiltrado.length }} cheque(s) para {{ cajaActiva.label.toLowerCase() }}.</p>
            <div class="section-actions-group">
              <button type="button" class="btn btn-ghost btn-collapse-toggle" @click="libroChequesExpandido = !libroChequesExpandido">
                {{ libroChequesExpandido ? "Contraer" : "Expandir" }}
              </button>
              <button class="btn btn-pdf libro-cheques-pdf-btn" :disabled="generandoPdfCheques" @click="abrirModalPdfCheques">
                {{ generandoPdfCheques ? "Generando PDF..." : "PDF cheques" }}
              </button>
            </div>
          </div>
        </div>

        <div v-show="libroChequesExpandido" class="section-content-collapsible">
          <div class="toolbar toolbar-caja toolbar-libro-cheques">
            <label class="toolbar-search-label toolbar-search">
              <span>Buscar cheque</span>
              <input v-model="filtroBusquedaLibroCheques" type="text" class="input-sm input-search" placeholder="Numero, banco, librador, endosado..." />
            </label>
          </div>

          <div v-if="loadingLibroCheques" class="spinner">Cargando libro de cheques...</div>
          <div v-else-if="!libroChequesFiltrado.length" class="empty">
            <strong>Sin cheques en el libro</strong>
            <span>Los cheques ingresados desde movimientos se verán acá.</span>
          </div>
          <div v-else class="libro-cheques-split">
          <div>
            <div class="section-heading section-heading-inline section-heading-libro-sublist">
              <div>
                <span class="section-kicker">Disponibles</span>
                <h3>Cheques disponibles</h3>
              </div>
              <p class="section-heading-count">{{ libroChequesDisponibles.length }} cheque(s).</p>
            </div>
            <div v-if="!libroChequesDisponibles.length" class="empty">
              <strong>Sin cheques disponibles</strong>
              <span>No hay cheques en estado disponible para este filtro.</span>
            </div>
            <div v-else class="tabla-shell">
              <table class="tabla tabla-libro-cheques">
                <thead>
                  <tr>
                    <th>Fecha entrada</th>
                    <th>Numero</th>
                    <th>Librador / Endosante</th>
                    <th>Banco</th>
                    <th>Importe</th>
                    <th>Fecha cheque</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in libroChequesDisponibles" :key="`disp-${item.id}`">
                    <td>{{ formatearFechaLibro(item.fecha_entrada) }}</td>
                    <td>{{ item.numero_cheque || '-' }}</td>
                    <td>{{ item.librador_endosante || '-' }}</td>
                    <td>{{ item.banco || '-' }}</td>
                    <td>{{ formatoMoneda(item.importe || 0) }}</td>
                    <td>{{ formatearFechaLibro(item.fecha_cheque) }}</td>
                    <td><span class="badge badge-ingreso">Disponible</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div class="section-heading section-heading-inline section-heading-libro-sublist">
              <div>
                <span class="section-kicker">No disponibles</span>
                <h3>Cheques no disponibles</h3>
              </div>
              <p class="section-heading-count">{{ libroChequesNoDisponibles.length }} cheque(s).</p>
            </div>
            <div v-if="!libroChequesNoDisponibles.length" class="empty">
              <strong>Sin cheques no disponibles</strong>
              <span>No hay cheques egresados o anulados para este filtro.</span>
            </div>
            <div v-else class="tabla-shell">
              <table class="tabla tabla-libro-cheques tabla-libro-cheques-no-disponibles">
                <thead>
                  <tr>
                    <th>Fecha entrada</th>
                    <th>Numero</th>
                    <th>Librador / Endosante</th>
                    <th>Banco</th>
                    <th>Importe</th>
                    <th>Fecha cheque</th>
                    <th>Estado</th>
                    <th>Fecha salida</th>
                    <th>Endosado a</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in libroChequesNoDisponibles" :key="`nodisp-${item.id}`">
                    <td>{{ formatearFechaLibro(item.fecha_entrada) }}</td>
                    <td>{{ item.numero_cheque || '-' }}</td>
                    <td>{{ item.librador_endosante || '-' }}</td>
                    <td>{{ item.banco || '-' }}</td>
                    <td>{{ formatoMoneda(item.importe || 0) }}</td>
                    <td>{{ formatearFechaLibro(item.fecha_cheque) }}</td>
                    <td><span class="badge badge-egreso">No disponible</span></td>
                    <td>{{ formatearFechaLibro(item.fecha_salida) }}</td>
                    <td>{{ item.endosado_a || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        </div>
      </section>

      <section class="caja-list-shell caja-list-shell-compact">
        <div class="section-heading section-heading-inline section-heading-movimientos">
          <div>
            <span class="section-kicker">Listado</span>
            <h3>Movimientos de caja</h3>
          </div>
          <div class="section-header-actions">
            <p class="section-heading-count section-heading-count-movimientos">{{ movimientosFiltrados.length }} registros visibles para {{ cajaActiva.label.toLowerCase() }}.</p>
            <button type="button" class="btn btn-ghost btn-collapse-toggle" @click="movimientosExpandido = !movimientosExpandido">
              {{ movimientosExpandido ? "Contraer" : "Expandir" }}
            </button>
          </div>
        </div>

      <div v-show="movimientosExpandido" class="section-content-collapsible">
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
            <th>Observaciones</th>
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
                <small v-if="getIdentificadoresCheque(mov)" class="referencia-cheques" :title="`Cheque(s): ${getIdentificadoresCheque(mov)}`">Cheque(s): {{ getIdentificadoresCheque(mov) }}</small>
              </div>
            </td>
            <td>{{ mov.detalle }}</td>
            <td class="td-observaciones">
              <span class="observacion-completa">{{ mov.observaciones || '-' }}</span>
            </td>
            <td class="td-cheques">
              <span v-if="getCantidadCheques(mov)" class="cell-clamp" :title="getResumenCheques(mov)">{{ getResumenCheques(mov) }}</span>
              <span v-else>-</span>
            </td>
            <td class="monto-total">{{ formatoMoneda(mov.monto_total) }}</td>
            <td class="acciones">
              <div class="acciones-grid">
                <button class="btn btn-sm btn-info" @click="abrirEdicion(mov)">
                  Editar
                </button>
                <button class="btn btn-sm btn-info" @click="verDetalle(mov)">
                  Ver detalle
                </button>
                <button class="btn btn-sm btn-danger" @click="confirmarEliminar(mov)">
                  Eliminar
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
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
        <div class="section-heading">
          <div>
            <span class="section-kicker">Datos del movimiento</span>
            <h3>Informacion principal</h3>
            <p>Aca se muestran solo los detalles del movimiento seleccionado.</p>
          </div>
        </div>

        <div class="detalle-info-grid">
          <div class="info-item">
            <label>Fecha</label>
            <p>{{ new Date(`${movimientoSeleccionado.fecha}T00:00:00`).toLocaleDateString("es-AR") }}</p>
          </div>
          <div class="info-item">
            <label>Caja</label>
            <p>{{ getLabelCaja(movimientoSeleccionado.caja_codigo) }}</p>
          </div>
          <div class="info-item">
            <label>Tipo</label>
            <p>{{ movimientoSeleccionado.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}</p>
          </div>
          <div class="info-item">
            <label>Monto total</label>
            <p>{{ formatoMoneda(movimientoSeleccionado.monto_total || 0) }}</p>
          </div>
          <div class="info-item">
            <label>Detalle</label>
            <p>{{ movimientoSeleccionado.detalle || '-' }}</p>
          </div>
          <div class="info-item">
            <label>Observaciones</label>
            <p>{{ movimientoSeleccionado.observaciones || '-' }}</p>
          </div>
          <div class="info-item">
            <label>Categoria</label>
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
          <div class="info-item">
            <label>ID de movimiento</label>
            <p>#{{ movimientoSeleccionado.id }}</p>
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

  </LayoutShell>

  <div v-if="mostrarModalPdfCheques" class="modal-overlay" @click.self="mostrarModalPdfCheques = false">
    <div class="modal modal-confirmacion modal-pdf-cheques">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Libro de cheques</span>
          <h3>Generar PDF de cheques</h3>
          <p>Elegí qué listado querés incluir en el PDF.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="mostrarModalPdfCheques = false">×</button>
      </div>

      <div class="modal-form modal-form-pdf-cheques">
        <label class="pdf-cheques-option">
          <input v-model="opcionPdfCheques" type="radio" value="disponibles" />
          <div>
            <strong>Cheques disponibles</strong>
            <small>Incluye solo cheques en estado disponible.</small>
          </div>
        </label>

        <label class="pdf-cheques-option">
          <input v-model="opcionPdfCheques" type="radio" value="no_disponibles" />
          <div>
            <strong>Cheques no disponibles</strong>
            <small>Incluye cheques salidos o anulados.</small>
          </div>
        </label>

        <label class="pdf-cheques-option">
          <input v-model="opcionPdfCheques" type="radio" value="ambos" />
          <div>
            <strong>Ambos listados</strong>
            <small>Incluye disponibles y no disponibles.</small>
          </div>
        </label>

        <div class="modal-actions">
          <button type="button" class="btn-primary" :disabled="generandoPdfCheques" @click="descargarLibroChequesPdf">
            {{ generandoPdfCheques ? "Generando..." : "Generar PDF" }}
          </button>
          <button type="button" class="btn-secondary" :disabled="generandoPdfCheques" @click="mostrarModalPdfCheques = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

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
        
        <section class="modal-section modal-section-main">
          <div class="modal-section-header">
            <div>
              <span class="section-kicker">Datos principales</span>
              <h4>Información base del movimiento</h4>
            </div>
            <small>Definí fecha, caja, tipo y descripción general antes de cargar el desglose.</small>
          </div>

          <div class="modal-main-grid">
            <div class="modal-main-fields">
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

              <div class="form-row form-row-emphasis">
                <label class="form-group form-card-field form-card-field-accent monto-panel-field">
                  <span>Monto total *</span>
                  <input v-model.number="form.monto_total" type="number" @wheel.prevent placeholder="0.00" step="0.01" required />
                </label>
                <label class="form-group form-card-field form-card-field-detail">
                  <span>Detalle *</span>
                  <input v-model="form.detalle" type="text" placeholder="Descripción clara del movimiento" required />
                </label>
              </div>

              <div class="form-row form-row-secondary" v-if="esIngreso">
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

          <label v-if="esEgreso" class="form-group form-card-field form-card-field-wide">
            <span>Destinatario *</span>
            <input v-model="form.destinatario" type="text" placeholder="Persona o empresa que recibe el pago" required />
          </label>

          <div v-if="esIngreso" class="form-row form-row-secondary">
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

          </div>

            <aside class="monto-panel">
          <label class="form-group form-card-field form-card-field-accent monto-panel-field">
            <span>Monto total *</span>
            <input v-model.number="form.monto_total" type="number" @wheel.prevent placeholder="0.00" step="0.01" required />
          </label>
              <div class="monto-panel-helper">
                <span class="section-kicker">Referencia</span>
                <strong>{{ form.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }} a registrar</strong>
                <p>Completá primero el importe total y después distribuí el movimiento entre los medios de pago.</p>
              </div>
              <div class="monto-panel-summary">
                <span class="monto-panel-label">Total actual</span>
                <strong>{{ formatoMoneda(form.monto_total || 0) }}</strong>
              </div>
            </aside>
          </div>
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

              <div class="cheques-intro" :class="{ 'cheques-intro-egreso': esEgreso }">
                <div v-if="esEgreso" class="cheques-libro-egreso">
                  <label class="check-inline">
                    <input v-model="form.usar_cheques_libro" type="checkbox" />
                    <span>Usar cheques disponibles del libro</span>
                  </label>

                  <div v-if="form.usar_cheques_libro" class="cheques-libro-egreso-grid">
                    <label class="form-group form-card-field">
                      <span>Fecha salida *</span>
                      <input v-model="form.fecha_salida_cheques" type="date" required />
                    </label>
                    <label class="form-group form-card-field">
                      <span>A quién se le endosa *</span>
                      <input v-model="form.endosado_a_cheques" type="text" placeholder="Persona o empresa" required />
                    </label>
                  </div>

                  <div v-if="form.usar_cheques_libro" class="cheques-libro-lista">
                    <label
                      v-for="item in chequesDisponiblesOrdenados"
                      :key="item.id"
                      class="cheque-disponible-item"
                    >
                      <input v-model="form.cheques_salida" :value="item.id" type="checkbox" class="cheque-disponible-check" />
                      <span class="cheque-disponible-main">
                        <strong>#{{ item.numero_cheque || '-' }}</strong>
                        <em>{{ formatoMoneda(item.importe || 0) }}</em>
                      </span>
                      <span class="cheque-disponible-meta">
                        {{ capitalizarInicial(item.banco) || '-' }} · {{ capitalizarInicial(item.librador_endosante) || '-' }} · F. cheque {{ formatearFechaLibro(item.fecha_cheque) }}
                      </span>
                    </label>
                    <p v-if="!chequesDisponibles.length" class="cheques-libro-empty">
                      No hay cheques disponibles para esta caja.
                    </p>
                  </div>
                </div>

                <div v-if="esIngreso" class="cheques-intro-copy">
                  <strong>Identifica cada cheque por separado.</strong>
                  <p>Podes cargar uno o varios, y a cada uno asignarle su identificador alfanumerico.</p>
                </div>
                <div v-if="esIngreso" class="cheques-actions cheques-actions-prominent">

                  <button type="button" class="btn btn-cheque-add" @click="agregarCheque">Agregar cheque</button>
                  <button type="button" class="btn btn-cheque-add btn-cheque-add-alt" @click="agregarEcheq">Agregar eCheq</button>
                 
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
                      <select v-model="cheque.medio_pago" :disabled="chequesBloqueadosPorLibro">
                        <option v-for="tipoCheque in tiposCheque" :key="tipoCheque.id" :value="tipoCheque.id">
                          {{ tipoCheque.label }}
                        </option>
                      </select>
                    </label>
                    <label class="form-group form-card-field">
                      <span>Monto</span>
                      <input v-model.number="cheque.monto" :readonly="chequesBloqueadosPorLibro" :disabled="chequesBloqueadosPorLibro" type="number" @wheel.prevent min="0" step="0.01" placeholder="0.00" />
                    </label>
                    <label class="form-group form-card-field">
                      <span>Identificador *</span>
                      <input v-model="cheque.identificador" :readonly="chequesBloqueadosPorLibro" :disabled="chequesBloqueadosPorLibro" type="text" placeholder="Ej: CHQ-A12345" />
                    </label>
                    <label v-if="esIngreso" class="form-group form-card-field">
                      <span>Numero cheque *</span>
                      <input v-model="cheque.numero_cheque" type="text" placeholder="Numero de cheque" />
                    </label>
                    <label v-if="esIngreso" class="form-group form-card-field">
                      <span>Librador o endosante *</span>
                      <input v-model="cheque.librador_endosante" type="text" placeholder="Nombre" />
                    </label>
                    <label v-if="esIngreso" class="form-group form-card-field">
                      <span>Banco *</span>
                      <input v-model="cheque.banco" type="text" placeholder="Banco emisor" />
                    </label>
                    <label v-if="esIngreso" class="form-group form-card-field">
                      <span>Fecha cheque *</span>
                      <input v-model="cheque.fecha_cheque" type="date" />
                    </label>
                    <label v-if="esIngreso" class="form-group form-card-field">
                      <span>Fecha entrada *</span>
                      <input v-model="cheque.fecha_entrada" type="date" />
                    </label>
                    <div class="cheque-card-remove">
                      <button type="button" class="btn btn-cheque-remove" :disabled="chequesBloqueadosPorLibro" @click="eliminarCheque(index)">Quitar cheque</button>
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

        <section class="modal-section">
          <div class="modal-section-header">
            <div>
              <span class="section-kicker">Observaciones</span>
              <h4>Notas internas del movimiento</h4>
            </div>
            <small>Este campo es opcional y no afecta los cálculos de caja.</small>
          </div>

          <label class="form-group form-card-field">
            <span>Observaciones (opcional)</span>
            <textarea
              v-model="form.observaciones"
              rows="3"
              placeholder="Ej: aclaraciones del comprobante, contexto del pago, seguimiento interno..."
            ></textarea>
          </label>
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

  <!-- Modal para cerrar semana y registrar banco -->
  <div v-if="mostrarModalCerrarSemana" class="modal-overlay" @click.self="mostrarModalCerrarSemana = false">
    <div class="modal modal-confirmacion">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Cierre de periodo</span>
          <h3>Cerrar semana actual</h3>
          <p>Se bloquearán los movimientos de esta semana. La próxima semana arrancará con el saldo final de hoy.</p>
        </div>
        <button type="button" class="btn-close" @click="mostrarModalCerrarSemana = false">×</button>
      </div>

      <div class="modal-form">
        <div class="info-rango" v-if="proximaSemanaInfo" style="margin-bottom: 1rem;">
          Próxima semana a iniciar: <strong>{{ proximaSemanaInfo.inicio }} al {{ proximaSemanaInfo.fin }}</strong>
        </div>

        <label class="form-group form-card-field form-card-field-accent">
          <span>Saldo actual en Banco ($)</span>
          <input v-model.number="saldoBancoCierre" type="number" @wheel.prevent placeholder="0.00" step="0.01" />
          <small class="form-help">Ingresá el saldo de la cuenta bancaria al día de hoy.</small>
        </label>

        <label class="form-group form-card-field form-card-field-accent">
          <span>eCheqs a depositar ($)</span>
          <input v-model.number="saldoPendienteEcheqCierre" type="number" @wheel.prevent placeholder="0.00" step="0.01" />
          <small class="form-help">Ingresá el total de eCheqs pendientes de depósito al momento del cierre.</small>
        </label>

        <label class="form-group form-card-field form-card-field-accent">
          <span>eCheqs depositados ($)</span>
          <input v-model.number="saldoEcheqDepositadosCierre" type="number" @wheel.prevent placeholder="0.00" step="0.01" />
          <small class="form-help">Ingresá el total de eCheqs ya depositados para esta semana.</small>
        </label>

        <label class="form-group form-card-field form-card-field-accent">
          <span>Efectivo en caja ($)</span>
          <input v-model.number="saldoEfectivoCierre" type="number" @wheel.prevent placeholder="0.00" step="0.01" />
          <small class="form-help">Ingresá el efectivo disponible en la caja al momento del cierre.</small>
        </label>

        <label class="form-group form-card-field form-card-field-accent">
          <span>Cheques en caja ($)</span>
          <input v-model.number="saldoChequesCierre" type="number" @wheel.prevent placeholder="0.00" step="0.01" />
          <small class="form-help">Ingresá el total de cheques en poder de la caja al cierre.</small>
        </label>

        <div class="modal-actions">
          <button type="button" class="btn btn-primary" :disabled="confirmandoCierre" @click="confirmarCerrarSemana">
            {{ confirmandoCierre ? "Cerrando..." : "Confirmar y Cerrar Semana" }}
          </button>
          <button type="button" class="btn btn-secondary" @click="mostrarModalCerrarSemana = false">
            Cancelar
          </button>
        </div>
      </div>
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
.caja-toolbar-shell {
  margin-bottom: 2.5rem;
  padding: 1.15rem 1.2rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.72), rgba(15, 23, 42, 0.92));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.toolbar-caja {
  display: grid;
  grid-template-columns: minmax(320px, 1.55fr) repeat(3, minmax(120px, 0.48fr)) repeat(3, auto);
  align-items: flex-end;
  gap: 1rem;
  width: 100%;
}

.toolbar-search {
  min-width: 0;
}

.toolbar-filter-label {
  display: grid;
  gap: 0.42rem;
  min-width: 0;
  color: #d1d5db;
  font-size: 0.82rem;
  font-weight: 600;
}

.input-sm,
.select-sm,
.input-search {
  font-size: 0.92rem;
  padding: 0.74rem 0.88rem;
  min-height: 44px;
  min-width: 0;
  border-radius: 0.9rem;
}

.input-search {
  width: 100%;
}

.toolbar-filter-label .input-sm,
.toolbar-filter-label .select-sm {
  width: 100%;
  min-width: 0;
}

.btn-pdf-toolbar {
  white-space: nowrap;
}

.toolbar-action-btn {
  white-space: nowrap;
}

.btn.btn-filter-apply,
.btn.btn-filter-clear,
.btn.btn-pdf {
  font-size: 0.92rem;
  padding: 0.74rem 1.1rem;
  min-height: 44px;
}
</style>

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

.caja-bank-inline-shell {
  margin-top: 1rem;
  margin-bottom: 2rem;
  padding: 1rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(59, 130, 246, 0.25);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.55), rgba(15, 23, 42, 0.65));
}

.caja-bank-inline-head {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.8rem;
}

.caja-bank-inline-head p {
  margin: 0;
  color: #94a3b8;
  font-size: 0.84rem;
}

.caja-bank-inline-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.8rem;
}

.caja-bank-inline-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.7rem;
  margin-top: 0.85rem;
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
  min-width: 340px;
  color: #d1d5db;
  font-size: 0.82rem;
  font-weight: 600;
}

.caja-semana-select .select-sm {
  min-width: 340px;
  min-height: 52px;
  font-size: 0.95rem;
  padding-right: 2.5rem;
}

.caja-semana-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.9rem;
  margin-bottom: 1rem;
  align-items: start;
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

.caja-semana-desglose-final {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
}

.caja-resumen-bancario-card {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 0.75rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
}

.caja-resumen-bancario-title {
  display: block;
  color: #94a3b8;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.6rem;
}

.caja-resumen-bancario-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.55rem;
}

.caja-semana-bank-box {
  padding: 0.45rem 0.55rem;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}

.caja-semana-echeq-box {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(96, 165, 250, 0.3);
}

.caja-semana-echeq-box .bank-label {
  color: #93c5fd !important;
}

.caja-semana-cash-box {
  background: rgba(168, 85, 247, 0.15);
  border: 1px solid rgba(196, 181, 253, 0.3);
}

.caja-semana-cash-box .bank-label {
  color: #d8b4fe !important;
}

.bank-label {
  font-size: 0.65rem !important;
  color: #86efac !important;
}

.bank-value {
  color: #f8fafc !important;
  font-size: 0.95rem !important;
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

.caja-list-shell-compact {
  padding: 0.95rem 1rem;
}

.section-content-collapsible {
  display: grid;
  gap: 0.7rem;
  margin-top: 0.45rem;
}

.section-header-actions,
.section-actions-group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.section-header-actions {
  margin-left: auto;
  justify-content: flex-end;
}

.btn-collapse-toggle {
  min-height: 2.45rem;
  padding: 0.58rem 0.95rem;
  border-radius: 0.68rem;
  border-color: rgba(148, 163, 184, 0.25);
  color: #dbeafe;
  background: rgba(30, 41, 59, 0.5);
}

.btn-collapse-toggle:hover {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(30, 41, 59, 0.82);
}

.toolbar-search {
  flex: 1 1 260px;
}

.toolbar-right {
  display: flex;
  justify-content: flex-end;
  align-items: flex-end;
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

.td-observaciones {
  vertical-align: top;
}

.observacion-completa {
  white-space: normal;
  word-break: break-word;
}

.cell-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  word-break: break-word;
}

.referencia-cheques {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  word-break: break-word;
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

.filtros-caja > .btn-sm {
  display: none;
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

.btn-filter-apply {
  min-height: 2.85rem;
  padding: 0.78rem 1.15rem;
  border-radius: 0.82rem;
  background: linear-gradient(135deg, #2563eb, #1e40af);
  color: white;
  border: 1px solid rgba(96, 165, 250, 0.32);
  box-shadow: 0 10px 22px rgba(37, 99, 235, 0.16);
  margin-top: 1.1rem;
  min-width: 170px;
  font-size: 0.87rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.btn-filter-apply:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(59, 130, 246, 0.22);
}

.btn-filter-clear {
  min-height: 2.85rem;
  padding: 0.78rem 1.15rem;
  border-radius: 0.82rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.86), rgba(15, 23, 42, 0.96));
  color: #e2e8f0;
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  margin-top: 1.1rem;
  min-width: 170px;
  font-size: 0.87rem;
  font-weight: 700;
}

.btn-filter-clear:hover {
  background: linear-gradient(180deg, rgba(51, 65, 85, 0.9), rgba(15, 23, 42, 1));
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.34);
  transform: translateY(-1px);
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.18);
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

/* Desglose por medio de pago */
.desglose-medios {
  display: grid;
  gap: 1rem;
}

.libro-cheques-split {
  display: grid;
  gap: 1.25rem;
}

.libro-cheques-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.55rem;
  margin-left: auto;
  flex-wrap: nowrap;
}

.libro-cheques-header-actions p {
  margin: 0;
}

.section-heading-inline {
  align-items: center;
}

.section-heading-libro {
  gap: 0.9rem;
  margin-bottom: 0;
  align-items: center;
}

.section-heading-libro-main {
  display: grid;
  gap: 0.16rem;
  min-width: 0;
}

.libro-cheques-counter {
  color: #cbd5e1;
  font-size: 0.88rem;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.libro-cheques-header-actions {
  margin-left: auto;
  justify-content: flex-end;
}

.libro-cheques-header-actions .section-actions-group {
  flex-wrap: nowrap;
}

.libro-cheques-pdf-btn {
  min-width: 170px;
  justify-content: center;
  min-height: 2.45rem;
  padding: 0.58rem 0.9rem;
}

.tabla-libro-cheques {
  table-layout: auto;
}

.tabla-libro-cheques th,
.tabla-libro-cheques td {
  padding: 0.48rem 0.62rem;
  font-size: 0.86rem;
  white-space: nowrap;
}

.tabla-libro-cheques th:nth-child(1),
.tabla-libro-cheques td:nth-child(1) {
  width: 88px;
}

.tabla-libro-cheques th:nth-child(2),
.tabla-libro-cheques td:nth-child(2) {
  width: 84px;
}

.tabla-libro-cheques th:nth-child(3),
.tabla-libro-cheques td:nth-child(3) {
  width: 120px;
}

.tabla-libro-cheques th:nth-child(4),
.tabla-libro-cheques td:nth-child(4) {
  width: 96px;
}

.tabla-libro-cheques th:nth-child(5),
.tabla-libro-cheques td:nth-child(5) {
  width: 96px;
  text-align: right;
}

.tabla-libro-cheques th:nth-child(6),
.tabla-libro-cheques td:nth-child(6) {
  width: 92px;
}

.tabla-libro-cheques th:nth-child(7),
.tabla-libro-cheques td:nth-child(7) {
  width: 98px;
}

.tabla-libro-cheques-no-disponibles th:nth-child(8),
.tabla-libro-cheques-no-disponibles td:nth-child(8) {
  width: 92px;
}

.tabla-libro-cheques-no-disponibles th:nth-child(9),
.tabla-libro-cheques-no-disponibles td:nth-child(9) {
  width: 125px;
  max-width: 125px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-libro-cheques {
  grid-template-columns: minmax(280px, 1fr);
  align-items: stretch;
  margin-top: 0.3rem;
}

.tabla.tabla-libro-cheques {
  width: 100%;
  min-width: 100%;
  table-layout: fixed;
}

.tabla.tabla-libro-cheques th,
.tabla.tabla-libro-cheques td {
  padding: 0.56rem 0.65rem;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(1),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(1) {
  width: 12% !important;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(2),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(2) {
  width: 10% !important;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(3),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(3) {
  width: 19% !important;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(4),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(4) {
  width: 16% !important;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(5),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(5) {
  width: 16% !important;
  text-align: right;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(6),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(6) {
  width: 13% !important;
}

.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) th:nth-child(7),
.tabla.tabla-libro-cheques:not(.tabla-libro-cheques-no-disponibles) td:nth-child(7) {
  width: 14% !important;
}

.tabla.tabla-libro-cheques-no-disponibles {
  min-width: 100%;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(8),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(8) {
  width: 9% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(9),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(9) {
  width: 10% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(1),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(1) {
  width: 10% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(2),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(2) {
  width: 9% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(3),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(3) {
  width: 16% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(4),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(4) {
  width: 13% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(5),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(5) {
  width: 13% !important;
  text-align: right;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(6),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(6) {
  width: 10% !important;
}

.tabla.tabla-libro-cheques-no-disponibles th:nth-child(7),
.tabla.tabla-libro-cheques-no-disponibles td:nth-child(7) {
  width: 10% !important;
}

.caja-list-shell-compact .btn-sm {
  padding: 0.3rem 0.58rem;
  font-size: 0.7rem;
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
  display: grid;
  gap: 0.45rem;
  padding: 1rem;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.9rem;
}

.medio-card .label {
  color: #9ca3af;
  font-size: 0.875rem;
}

.medio-detalle-linea {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.medio-detalle-linea small {
  color: #93a4c3;
  font-size: 0.78rem;
}

.medio-detalle-linea strong {
  font-size: 0.94rem;
}

.medio-ingreso {
  color: #86efac;
}

.medio-egreso {
  color: #fca5a5;
}

.medio-balance {
  color: #7dd3fc;
}

/* Tabla */
.tabla {
  width: 100%;
  min-width: 100%;
  border-collapse: collapse;
  background: transparent;
  table-layout: fixed;
}

.tabla-shell{
  border: 1px solid rgba(148,162,184, 0.16);
  border-radius: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
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

.tabla th:nth-child(1),
.tabla td:nth-child(1) {
  width: 95px;
}

.tabla th:nth-child(2),
.tabla td:nth-child(2) {
  width: 92px;
}

.tabla th:nth-child(3),
.tabla td:nth-child(3) {
  width: 110px;
}

.tabla th:nth-child(4),
.tabla td:nth-child(4) {
  width: 24%;
}

.tabla th:nth-child(5),
.tabla td:nth-child(5) {
  width: 18%;
}

.tabla th:nth-child(6),
.tabla td:nth-child(6) {
  width: 15%;
}

.tabla th:nth-child(7),
.tabla td:nth-child(7) {
  width: 13%;
}

.tabla th:nth-child(8),
.tabla td:nth-child(8) {
  min-width: 170px;
  width: 170px;
  white-space: nowrap;
}

.tabla th:nth-child(9),
.tabla td:nth-child(9) {
  min-width: 250px;
  width: 250px;
  white-space: normal;
}

.tabla td:nth-child(4),
.tabla td:nth-child(5),
.tabla td:nth-child(6),
.tabla td:nth-child(7) {
  word-break: break-word;
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
  vertical-align: top;
}

.acciones-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(96px, 1fr));
  gap: 0.5rem;
  white-space: normal;
  align-items: stretch;
}

.acciones-grid .btn{
  width: 100%;
  white-space: nowrap;
  text-align: center;
}

.acciones-grid .btn-danger {
  grid-column: 1 / -1;
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

.info-grid,
.detalle-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
  align-items: stretch;
}

.info-item {
  display: grid;
  gap: 0.45rem;
  min-height: 108px;
  padding: 1rem 1.05rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.info-item label {
  color: #94a3b8;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin: 0;
}

.info-item p {
  color: #f8fafc;
  font-size: 1.02rem;
  line-height: 1.45;
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

.cheques-intro-egreso {
  display: block;
}

.cheques-intro-egreso .cheques-libro-egreso {
  width: 100%;
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

.cheques-libro-lista {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 0.6rem;
  margin-top: 0.15rem;
}

.cheque-disponible-item {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.65rem;
  row-gap: 0.25rem;
  align-items: start;
  padding: 0.72rem 0.8rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.54);
}

.cheque-disponible-item:hover {
  border-color: rgba(125, 211, 252, 0.34);
  background: rgba(15, 23, 42, 0.72);
}

.cheque-disponible-check {
  margin-top: 0.2rem;
}

.cheque-disponible-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: #e5e7eb;
}

.cheque-disponible-main strong {
  color: #f8fafc;
  font-size: 0.9rem;
}

.cheque-disponible-main em {
  font-style: normal;
  color: #93c5fd;
  font-weight: 700;
  font-size: 0.88rem;
}

.cheque-disponible-meta {
  grid-column: 2;
  color: #94a3b8;
  font-size: 0.8rem;
  line-height: 1.4;
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
  width: min(96vw, 1120px);
  max-width: 1120px;
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
  color: #e2e8f0;
}

.modal-form-movimiento {
  padding: 1.2rem 1.6rem 1.6rem;
  gap: 1.1rem;
}

.modal-form-confirmacion {
  align-items: center;
  padding: 1.25rem 1.45rem 1.45rem;
  gap: 1rem;
}

.modal-pdf-cheques {
  border-color: rgba(96, 165, 250, 0.26);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
}

.modal-form-pdf-cheques {
  padding: 1.2rem 1.35rem 1.35rem;
  gap: 0.7rem;
}

.pdf-cheques-option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.7rem;
  align-items: start;
  padding: 0.78rem 0.85rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.52);
  cursor: pointer;
}

.pdf-cheques-option:hover {
  border-color: rgba(125, 211, 252, 0.4);
}

.pdf-cheques-option input {
  margin-top: 0.2rem;
}

.pdf-cheques-option strong {
  color: #e2e8f0;
  font-size: 0.92rem;
}

.pdf-cheques-option small {
  display: block;
  margin-top: 0.2rem;
  color: #94a3b8;
  line-height: 1.35;
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

.modal-section-main {
  padding: 1.15rem;
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

.modal-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.9fr);
  gap: 1rem;
  align-items: start;
}

.modal-main-fields {
  display: grid;
  gap: 0.95rem;
}

.form-row-emphasis {
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  align-items: stretch;
}

.form-row-secondary {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.form-card-field-wide {
  grid-column: 1 / -1;
}

.form-card-field-detail {
  min-height: 100%;
}

.form-card-field-detail input {
  min-height: 3.45rem;
}

.monto-panel {
  display: grid;
  gap: 0.9rem;
  position: sticky;
  top: 0;
}

.monto-panel-field {
  padding: 1.1rem;
}

.monto-panel-field input {
  min-height: 3.45rem;
  font-size: 1.2rem;
  font-weight: 700;
}

.monto-panel-helper {
  display: grid;
  gap: 0.35rem;
  padding: 1rem 1.05rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.66), rgba(15, 23, 42, 0.9));
}

.monto-panel-helper strong {
  color: #f8fafc;
  font-size: 1rem;
}

.monto-panel-helper p {
  margin: 0;
  color: #94a3b8;
  line-height: 1.5;
}

.monto-panel > .monto-panel-field {
  display: none;
}

.monto-panel-summary {
  display: grid;
  gap: 0.35rem;
  padding: 1rem 1.05rem;
  border-radius: 1rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.18), rgba(15, 23, 42, 0.9));
}

.monto-panel-label {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #93c5fd;
}

.monto-panel-summary strong {
  color: #f8fafc;
  font-size: 1.45rem;
  line-height: 1.1;
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

@media (max-width: 1200px) {
  .cheques-libro-lista {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
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

  .toolbar-right {
    width: 100%;
    justify-content: stretch;
  }

  .toolbar-right .btn {
    width: 100%;
  }

  .tabla {
    min-width: 980px;
  }

  .acciones-grid {
    grid-template-columns: 1fr;
  }

  .modal {
    width: 96%;
  }

  .desglose-grid-compact {
    grid-template-columns: 1fr;
  }

  .section-heading-libro,
  .section-heading-libro-sublist,
  .libro-cheques-header-actions {
    align-items: stretch;
  }

  .libro-cheques-header-actions,
  .libro-cheques-header-actions .section-actions-group {
    flex-wrap: wrap;
  }

  .section-header-actions,
  .section-actions-group {
    width: 100%;
    justify-content: stretch;
  }

  .btn-collapse-toggle {
    width: 100%;
  }

  .libro-cheques-counter,
  .section-heading-count {
    white-space: normal;
    text-align: left;
  }

  .libro-cheques-pdf-btn {
    width: 100%;
    min-width: 0;
  }

  .toolbar-libro-cheques {
    grid-template-columns: 1fr;
  }

  .modal-main-grid {
    grid-template-columns: 1fr;
  }

  .form-row-emphasis {
    grid-template-columns: 1fr;
  }

  .monto-panel {
    position: static;
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

  .cheques-libro-lista {
    grid-template-columns: 1fr;
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
