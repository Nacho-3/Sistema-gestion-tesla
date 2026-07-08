<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import * as API from "../api.js"

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
const mostrarModalAbrirSemana = ref(false)
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
const confirmandoCierre = ref(false)
const abriendoSemana = ref(false)
const formAbrirSemana = ref({
  fecha_inicio: "",
})
const libroCheques = ref([])
const chequesDisponibles = ref([])
const loadingLibroCheques = ref(false)
const filtroBusquedaLibroCheques = ref("")
const filtroSemanaLibroCheques = ref("global")
const libroChequesExpandido = ref(true)
const noDisponiblesExpandido = ref(false)
const movimientosExpandido = ref(true)
const mostrarModalAsignaciones = ref(false)
const mostrarModalTransferenciaCheques = ref(false)
const transferiendoCheques = ref(false)
const asignacionesDraft = ref([])
const mostrarModalControlSemanal = ref(false)
const guardandoControlSemanal = ref(false)
const chequesControlSemanalCandidatos = ref([])
const chequesControlSemanalSeleccionados = ref([])
const controlSemanalEfectivo = ref(0)
const controlSemanalDetalle = ref("Control semanal inicial de caja")
const controlSemanalObservaciones = ref("")
const transferenciaChequesForm = ref({
  caja_destino: "",
  fecha: new Date().toISOString().split('T')[0],
  cheques_ids: [],
  detalle: "",
  observaciones: "",
})

const reciboMovimiento = ref(null)
const recibosMovimiento = ref([])
const loadingRecibo = ref(false)
const emitiendoRecibo = ref(false)
const descargandoRecibo = ref(false)
const anulandoRecibo = ref(false)
const mostrarModalRecibo = ref(false)
const presupuestosMovimiento = ref([])
const formRecibo = ref({
  pagador_nombre: "",
  concepto_publico: "",
  conceptoTipo: "manual", // "manual" o "presupuestos"
  presupuestosSeleccionados: [],
  incluir_saldos_presupuestos: true,
  observaciones_publicas: "",
})

const recibosAnuladosMovimiento = computed(() => {
  return (Array.isArray(recibosMovimiento.value) ? recibosMovimiento.value : [])
    .filter((item) => String(item?.estado || "") === "anulado")
    .sort((a, b) => Number(b?.numero || 0) - Number(a?.numero || 0))
})
// categorias

const mostrarModalCategorias = ref(false)
const categorias = ref([])
const formCategoria = ref({ nombre: "", descripcion: "", tipo: "ingreso" })
const editandoCategoria = ref(null)
const guardandoCategoria = ref(false)
const eliminandoCategoria = ref(false)
const NUEVA_CATEGORIA_OPTION = "__nueva_categoria__"

const normalizarTipoCategoria = (tipo) => {
  const tipoNormalizado = String(tipo || "").trim().toLowerCase()
  return tipoNormalizado === "egreso" ? "egreso" : "ingreso"
}

const categoriasFormulario = computed(() => {
  const tipo = normalizarTipoCategoria(form.value.tipo)
  return (categorias.value || []).filter((cat) => normalizarTipoCategoria(cat?.tipo) === tipo)
})

const categoriasFiltro = computed(() => {
  const tipo = String(filtroTipo.value || "").trim().toLowerCase()
  if (!tipo) return categorias.value || []
  return (categorias.value || []).filter((cat) => normalizarTipoCategoria(cat?.tipo) === tipo)
})

const categoriasModal = computed(() => {
  return [...(categorias.value || [])].sort((a, b) => {
    const tipoA = normalizarTipoCategoria(a?.tipo)
    const tipoB = normalizarTipoCategoria(b?.tipo)
    if (tipoA !== tipoB) return tipoA.localeCompare(tipoB)
    return String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es")
  })
})

const categoriasModalIngreso = computed(() => {
  return categoriasModal.value.filter((cat) => normalizarTipoCategoria(cat?.tipo) === "ingreso")
})

const categoriasModalEgreso = computed(() => {
  return categoriasModal.value.filter((cat) => normalizarTipoCategoria(cat?.tipo) === "egreso")
})


// Filtros
const filtroFechaInicio = ref("")
const filtroFechaFin = ref("")
const filtroTipo = ref("")
const filtroMedioPago = ref("")
const filtroCategoria = ref("")
const FILTRO_SIN_CATEGORIA = "__sin_categoria__"

// Formulario
const form = ref({
  fecha: new Date().toISOString().split('T')[0],
  caja_codigo: "tesla",
  tipo: "ingreso",
  categoria: "",
  categoria_id: "",
  con_iva: true,
  destinatario: "",
  cliente_id: "",
  presupuesto_id: "",
  presupuesto_ids: [],
  presupuestos_asignaciones: [],
  detalle: "",
  observaciones: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    banco: 0,
    retencion: 0
  },
  cheques: [],
  usar_cheques_libro: false,
  usar_echeqs_libro: false,
  cheques_salida: [],
  fecha_salida_cheques: new Date().toISOString().split('T')[0],
  endosado_a_cheques: ""
})

const mediosDePago = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "banco", label: "Banco" },
  { id: "echeq", label: "Echeq" },
  { id: "retencion", label: "Retención" },
  { id: "cheque", label: "Cheque" }
]

const mediosDePagoSimples = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "banco", label: "Banco" },
  { id: "retencion", label: "Retención" },
]

const tiposCheque = [
  { id: "cheque", label: "Cheque" },
  { id: "echeq", label: "Echeq" },
]

const handleCajaChanged = () => {
  refrescarCaja({ mantenerSeleccion: true, recargarReferencias: true })
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

const normalizarEstadoSemana = (estado) => {
  const valor = String(estado || "").trim().toLowerCase()
  if (["abierta", "abierto"].includes(valor)) return "abierta"
  if (["cerrada", "cerrado"].includes(valor)) return "cerrada"
  return valor || "cerrada"
}

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
    estado: normalizarEstadoSemana(semana.estado || defaults.estado || "cerrada"),
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
  const fechaMovimiento = String(movimiento?.fecha || "").split("T")[0]
  const inicio = String(semana.fecha_inicio || "")
  const fin = String(semana.fecha_fin || "")
  const fechaEnRango = Boolean(fechaMovimiento)
    && (!inicio || fechaMovimiento >= inicio)
    && (!fin || fechaMovimiento <= fin)

  // Si el movimiento ya tiene semana asignada, esa asignacion manda.
  // Evita duplicados cuando dos semanas comparten el mismo dia de borde
  // (por ejemplo cerrar y volver a abrir el 03/07).
  if (movimientoSemanaId && semanaId) {
    return semanaId === movimientoSemanaId
  }

  if (!movimientoSemanaId && fechaEnRango) {
    const candidatas = (semanasCajaVisibles.value || []).filter((item) => {
      const inicioSemana = String(item?.fecha_inicio || "")
      const finSemana = String(item?.fecha_fin || "")
      return (!inicioSemana || fechaMovimiento >= inicioSemana) && (!finSemana || fechaMovimiento <= finSemana)
    })

    if (candidatas.length > 1) {
      candidatas.sort((a, b) => {
        const inicioA = String(a?.fecha_inicio || "")
        const inicioB = String(b?.fecha_inicio || "")
        if (inicioA !== inicioB) return inicioB.localeCompare(inicioA)
        return Number(b?.id || 0) - Number(a?.id || 0)
      })

      const semanaCanonicaId = extraerSemanaIdNumerica(candidatas[0]?.id)
      return Boolean(semanaCanonicaId && semanaId && semanaCanonicaId === semanaId)
    }
  }

  return fechaEnRango
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
    if (!semana?.fecha_inicio) return
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

  return Array.from(mapa.values()).sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio)
  )
})

const semanaActiva = computed(() => {
  if (semanaSeleccionadaId.value) {
    return semanasCajaVisibles.value.find((semana) => String(semana.id) === String(semanaSeleccionadaId.value)) || null
  }
  if (semanaActual.value) {
    return semanaActual.value
  }
  return semanasCajaVisibles.value[0] || null
})

const haySemanaAbierta = computed(() => {
  return (semanasCajaVisibles.value || []).some((semana) => normalizarEstadoSemana(semana?.estado) === "abierta")
})

const claveSemanaLibro = (semana) => {
  const inicio = String(semana?.fecha_inicio || "")
  const fin = String(semana?.fecha_fin || "")
  if (!inicio || !fin) return ""
  return `${inicio}|${fin}`
}

const etiquetaSemanaLibro = (semana) => {
  if (!semana?.fecha_inicio) return "Semana"
  const inicio = new Date(`${semana.fecha_inicio}T00:00:00`).toLocaleDateString("es-AR")
  if (!semana?.fecha_fin) return `${inicio} al día de hoy`
  const fin = new Date(`${semana.fecha_fin}T00:00:00`).toLocaleDateString("es-AR")
  return `${inicio} al ${fin}`
}

const semanaLibroChequesActiva = computed(() => {
  if (String(filtroSemanaLibroCheques.value || "").toLowerCase() === "global") return null
  return semanasCajaVisibles.value.find((semana) => claveSemanaLibro(semana) === String(filtroSemanaLibroCheques.value)) || null
})

const opcionesSemanaLibroCheques = computed(() => {
  return semanasCajaVisibles.value.map((semana) => ({
    id: claveSemanaLibro(semana),
    label: etiquetaSemanaLibro(semana),
  })).filter((semana) => Boolean(semana.id))
})

const obtenerSemanaLibroChequesPorDefecto = () => {
  const claveSemanaActiva = claveSemanaLibro(semanaActiva.value)
  if (!claveSemanaActiva) return "global"
  const existeSemana = opcionesSemanaLibroCheques.value.some((semana) => String(semana.id) === String(claveSemanaActiva))
  return existeSemana ? claveSemanaActiva : "global"
}

const sincronizarFiltroSemanaLibroCheques = ({ forzar = false } = {}) => {
  const filtroActual = String(filtroSemanaLibroCheques.value || "").toLowerCase()
  const existeFiltroActual = opcionesSemanaLibroCheques.value.some((semana) => String(semana.id) === String(filtroSemanaLibroCheques.value))

  if (!forzar && filtroActual !== "global" && existeFiltroActual) {
    return
  }

  filtroSemanaLibroCheques.value = obtenerSemanaLibroChequesPorDefecto()
}

const subtitleCaja = computed(() => {
  return `${cajaActiva.value.label} - Movimientos de ingresos y egresos`
})

const esIngreso = computed(() => form.value.tipo === "ingreso")
const esEgreso = computed(() => form.value.tipo === "egreso")
const usaLibroCualquiera = computed(() => esEgreso.value && (Boolean(form.value.usar_cheques_libro) || Boolean(form.value.usar_echeqs_libro)))
const chequesBloqueadosPorLibro = computed(() => usaLibroCualquiera.value)

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
    if (!["cheque", "echeq"].includes(String(item?.medio_pago || "").toLowerCase())) return false
    if (!termino) return true
    return [item.numero_cheque, item.banco, item.librador_endosante, item.endosado_a]
      .some((v) => String(v || "").toLowerCase().includes(termino))
  })
})

const libroChequesDisponibles = computed(() => {
  return libroChequesFiltrado.value
    .filter((item) => {
      const estadoVista = String(item.estado_vista || item.estado || "").toLowerCase()
      return estadoVista === "disponible"
    })
    .sort((a, b) => {
      const fechaA = String(a?.fecha_cheque || "")
      const fechaB = String(b?.fecha_cheque || "")
      if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
      return String(a?.numero_cheque || "").localeCompare(String(b?.numero_cheque || ""))
    })
})

const libroChequesNoDisponibles = computed(() => {
  return libroChequesFiltrado.value
    .filter((item) => {
      const estadoVista = String(item.estado_vista || item.estado || "").toLowerCase()
      return estadoVista !== "disponible"
    })
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

const sortCheques = (arr) => [...(arr || [])].sort((a, b) => {
  const fechaA = String(a?.fecha_cheque || "")
  const fechaB = String(b?.fecha_cheque || "")
  if (fechaA && fechaB && fechaA !== fechaB) return fechaB.localeCompare(fechaA)
  const bancoA = String(a?.banco || "")
  const bancoB = String(b?.banco || "")
  if (bancoA !== bancoB) return bancoA.localeCompare(bancoB)
  return String(a?.numero_cheque || "").localeCompare(String(b?.numero_cheque || ""))
})

const chequesDisponiblesOrdenados = computed(() => sortCheques(chequesDisponibles.value))

const chequesDisponiblesLibroFisicos = computed(() =>
  sortCheques((chequesDisponibles.value || []).filter((item) => String(item?.medio_pago || "").toLowerCase() === "cheque"))
)

const chequesDisponiblesLibroEcheqs = computed(() =>
  sortCheques((chequesDisponibles.value || []).filter((item) => String(item?.medio_pago || "").toLowerCase() === "echeq"))
)

const esFormularioValido = computed(() => {
  if (!form.value.fecha || !form.value.caja_codigo || !form.value.detalle || !form.value.monto_total || form.value.monto_total <= 0) {
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
      const esEcheq = String(item?.medio_pago || "") === "echeq"
      const identificadorOk = Boolean(String(item?.numero_cheque || item?.identificador || "").trim())
      const fechaEntradaOk = Boolean(String(item?.fecha_entrada || item?.fecha_cobro || "").trim())
      if (!identificadorOk || !fechaEntradaOk) return false
      if (!esEcheq) {
        return Boolean(
          String(item?.librador_endosante || "").trim() &&
          String(item?.banco || "").trim() &&
          String(item?.fecha_cheque || "").trim()
        )
      }
      return true
    }

    return true
  })
  if (!chequesValidos) return false

  if (form.value.tipo === "egreso" && usaLibroCualquiera.value) {
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

  if (filtroMedioPago.value){
    resultado = resultado.filter((movimiento) =>{
      if (!movimiento.detalles_medio_pago || movimiento.detalles_medio_pago.length === 0) return false
      return movimiento.detalles_medio_pago.some((detalle) =>
        String(detalle.medio_pago || "").toLowerCase() === String(filtroMedioPago.value || "").toLowerCase()
      )
    })
  }

  if (filtroCategoria.value) {
    if (filtroCategoria.value === FILTRO_SIN_CATEGORIA) {
      resultado = resultado.filter((movimiento) => {
        const categoriaId = Number(movimiento?.categoria_id || 0)
        const tieneCategoriaId = Number.isInteger(categoriaId) && categoriaId > 0
        const categoriaTexto = String(movimiento?.categoria || "").trim()
        return !tieneCategoriaId && !categoriaTexto
      })
    } else {
      resultado = resultado.filter((movimiento) => String(movimiento?.categoria_id || "") === String(filtroCategoria.value))
    }
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

  // Los filtros de fecha se aplican en la API.
  // Orden estable: fecha desc; dentro del mismo dia, el control semanal queda al final (mas antiguo),
  // y luego por id desc para que lo ultimo cargado quede arriba.
  return [...resultado].sort((a, b) => {
    const fechaA = String(a?.fecha || "").split("T")[0]
    const fechaB = String(b?.fecha || "").split("T")[0]

    if (fechaA !== fechaB) {
      return fechaB.localeCompare(fechaA)
    }

    const controlA = Boolean(a?.es_control_semanal)
    const controlB = Boolean(b?.es_control_semanal)
    if (controlA !== controlB) {
      return controlA ? 1 : -1
    }

    const idA = Number(a?.id || 0)
    const idB = Number(b?.id || 0)
    return idB - idA
  })
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
const semanaEstaCerrada = computed(() => normalizarEstadoSemana(semanaActiva.value?.estado) === "cerrada")
const movimientosSemanaActiva = computed(() => {
  if (!semanaActiva.value) return []
  return (movimientos.value || []).filter((mov) => movimientoPerteneceASemana(mov, semanaActiva.value))
})
const semanaRequiereControl = computed(() => {
  if (!semanaActiva.value) return false
  if (semanaEstaCerrada.value) return false
  return movimientosSemanaActiva.value.length === 0
})
const totalChequesControlSemanal = computed(() => {
  const ids = new Set((chequesControlSemanalSeleccionados.value || []).map((valor) => Number(valor)))
  return (chequesControlSemanalCandidatos.value || [])
    .filter((item) => ids.has(Number(item.id)))
    .reduce((acc, item) => acc + Number(item.importe || 0), 0)
})
const totalControlSemanal = computed(() => {
  return Number(controlSemanalEfectivo.value || 0) + Number(totalChequesControlSemanal.value || 0)
})
const todosChequesControlSeleccionados = computed(() => {
  const candidatos = chequesControlSemanalCandidatos.value || []
  if (!candidatos.length) return false
  return candidatos.every((item) => (chequesControlSemanalSeleccionados.value || []).includes(Number(item.id)))
})

const etiquetaSemanaRango = (semana) => {
  if (!semana?.fecha_inicio) return "Semana"
  const inicio = new Date(`${semana.fecha_inicio}T00:00:00`).toLocaleDateString("es-AR")
  const estado = normalizarEstadoSemana(semana?.estado)
  if (estado === "abierta") {
    return `${inicio} - actualidad (abierta)`
  }
  if (!semana?.fecha_fin) {
    return `${inicio} - ${inicio} (cerrada)`
  }
  const fin = new Date(`${semana.fecha_fin}T00:00:00`).toLocaleDateString("es-AR")
  return `${inicio} - ${fin} (cerrada)`
}

const etiquetaSemanaActiva = computed(() => {
  if (!semanaActiva.value?.fecha_inicio) return "Semana actual"
  const inicio = new Date(`${semanaActiva.value.fecha_inicio}T00:00:00`).toLocaleDateString("es-AR")
  const estado = normalizarEstadoSemana(semanaActiva.value?.estado)
  if (estado === "abierta") {
    return `${inicio} al día de hoy`
  }
  if (!semanaActiva.value?.fecha_fin) return `${inicio} al ${inicio}`
  const fin = new Date(`${semanaActiva.value.fecha_fin}T00:00:00`).toLocaleDateString("es-AR")
  return `${inicio} al ${fin}`
})

const presupuestosDisponibles = computed(() => {
  if (!form.value.cliente_id) return []
  return presupuestos.value.filter((p) => {
    const mismoCliente = String(p.cliente_id) === String(form.value.cliente_id)
    const saldoPendiente = Number(p?.saldo_pendiente_cobro || 0)
    return mismoCliente && saldoPendiente > 0.009
  })
})

const totalAsignadoPresupuestosDraft = computed(() => {
  return (asignacionesDraft.value || []).reduce((acc, item) => acc + Number(item?.monto_asignado || 0), 0)
})

const diferenciaAsignacionesDraft = computed(() => {
  return Number(form.value.monto_total || 0) - Number(totalAsignadoPresupuestosDraft.value || 0)
})

const asignacionesDraftValidas = computed(() => {
  const idsSeleccionados = (form.value.presupuesto_ids || []).map((id) => String(id))
  if (!idsSeleccionados.length) return true

  const idsDraft = (asignacionesDraft.value || []).map((item) => String(item.presupuesto_id || ""))
  const sinRepetidos = new Set(idsDraft).size === idsDraft.length
  const mismosIds = idsSeleccionados.every((id) => idsDraft.includes(String(id))) && idsDraft.every((id) => idsSeleccionados.includes(String(id)))
  return sinRepetidos && mismosIds && Number(diferenciaAsignacionesDraft.value || 0) >= -0.01
})

const chequesTransferibles = computed(() => {
  return (libroChequesDisponibles.value || []).filter((item) => ["cheque", "echeq"].includes(String(item?.medio_pago || "").toLowerCase()))
})

const totalTransferenciaCheques = computed(() => {
  const ids = new Set((transferenciaChequesForm.value.cheques_ids || []).map((id) => Number(id)))
  return chequesTransferibles.value
    .filter((item) => ids.has(Number(item.id)))
    .reduce((acc, item) => acc + Number(item.importe || 0), 0)
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
      semanaActual.value = semanasCaja.value.find((semana) => normalizarEstadoSemana(semana?.estado) === "abierta") || null
    }

    if (semanaActual.value && !semanasCaja.value.some((semana) => claveSemanaCaja(semana) === claveSemanaCaja(semanaActual.value))) {
      semanasCaja.value = [semanaActual.value, ...semanasCaja.value]
    }

    if (!mantenerSeleccion || !semanaSeleccionadaId.value) {
      semanaSeleccionadaId.value = semanaActual.value?.id ? String(semanaActual.value.id) : ""
      sincronizarFiltroSemanaLibroCheques({ forzar: true })
      return
    }

    const existeSeleccion = semanasCaja.value.some((semana) => String(semana.id) === String(semanaSeleccionadaId.value))
    if (existeSeleccion) {
      sincronizarFiltroSemanaLibroCheques()
      return
    }

    const semanaSeleccionadaNormalizada = extraerSemanaIdNumerica(semanaSeleccionadaId.value)
    if (semanaSeleccionadaNormalizada) {
      const semanaEquivalente = semanasCaja.value.find((semana) => Number(semana.id) === semanaSeleccionadaNormalizada)
      if (semanaEquivalente) {
        semanaSeleccionadaId.value = String(semanaEquivalente.id)
        sincronizarFiltroSemanaLibroCheques({ forzar: true })
        return
      }
    }

    semanaSeleccionadaId.value = semanaActual.value?.id ? String(semanaActual.value.id) : ""
    sincronizarFiltroSemanaLibroCheques({ forzar: true })
  } catch (err) {
    console.error("Error al cargar semanas de caja:", err)
    if (!mantenerSeleccion && semanaActual.value?.id) {
      semanaSeleccionadaId.value = String(semanaActual.value.id)
    }
  }
}

const refrescarCaja = async ({ mantenerSeleccion = true, recargarReferencias = true } = {}) => {
  if (recargarReferencias) {
    await cargarReferencias()
  }
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

const resetFormAbrirSemana = () => {
  const hoy = formatFechaISO(new Date())
  formAbrirSemana.value = {
    fecha_inicio: hoy,
  }
}

const abrirModalNuevaSemana = () => {
  resetFormAbrirSemana()
  mostrarModalAbrirSemana.value = true
}

const confirmarAbrirSemana = async () => {
  const fechaInicio = String(formAbrirSemana.value.fecha_inicio || "").trim()

  if (!fechaInicio) {
    error.value = "Debés completar la fecha de inicio para abrir la semana"
    return
  }

  try {
    abriendoSemana.value = true
    const res = await api.abrirSemanaCaja({
      caja_codigo: filtroCaja.value,
      fecha_inicio: fechaInicio,
    })

    const nuevaSemanaId = res?.data?.id
    await refrescarCaja({ mantenerSeleccion: false })
    if (nuevaSemanaId) {
      semanaSeleccionadaId.value = String(nuevaSemanaId)
    }
    mostrarModalAbrirSemana.value = false
  } catch (err) {
    error.value = `Error al abrir semana: ${err.response?.data?.error || err.message}`
  } finally {
    abriendoSemana.value = false
  }
}

const abrirModalCerrarSemana = () => {
  if (!semanaActiva.value?.id) return

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
    await api.cerrarSemanaCaja(semanaActiva.value.id, body)
    await refrescarCaja({ mantenerSeleccion: true })
    mostrarModalCerrarSemana.value = false
    semanaSeleccionadaId.value = ""
  } catch (err) {
    error.value = `Error al cerrar semana: ${err.response?.data?.error || err.message}`
  } finally {
    confirmandoCierre.value = false
  }
}

const textoTipoFiltro = () => {
  let texto = ""
  if (filtroTipo.value === "ingreso") texto = "solo ingresos"
  else if (filtroTipo.value === "egreso") texto = "solo egresos"
  else texto = "ingresos y egresos"
  
  // Agregar medio de pago si está filtrado
  const etiquetaMedioPago = {
    "efectivo": "efectivo",
    "transferencia": "transferencias",
    "banco": "banco",
    "cheque": "cheques",
    "echeq": "e-cheques",
    "retencion": "retenciones"
  }
  
  if (filtroMedioPago.value) {
    texto += ` - ${etiquetaMedioPago[filtroMedioPago.value] || filtroMedioPago.value}`
  }

  if (filtroCategoria.value === FILTRO_SIN_CATEGORIA) {
    texto += " - sin categoria"
  } else if (filtroCategoria.value) {
    const categoriaFiltro = categorias.value.find((item) => String(item?.id || "") === String(filtroCategoria.value))
    texto += ` - categoria: ${categoriaFiltro?.nombre || filtroCategoria.value}`
  }
  
  return texto
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
      filtroBusqueda.value,
      filtroMedioPago.value,
      filtroCategoria.value
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

const resetReciboMovimiento = () => {
  reciboMovimiento.value = null
  recibosMovimiento.value = []
}

const descargarBlobPdf = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  window.URL.revokeObjectURL(url)
}

const cargarReciboPorMovimiento = async (movimientoId) => {
  const id = Number(movimientoId)
  if (!Number.isInteger(id) || id <= 0) {
    reciboMovimiento.value = null
    recibosMovimiento.value = []
    return
  }

  try {
    loadingRecibo.value = true
    const res = await api.getReciboCajaPorMovimiento(id)
    reciboMovimiento.value = res.data?.recibo || null
    recibosMovimiento.value = Array.isArray(res.data?.recibos) ? res.data.recibos : (res.data?.recibo ? [res.data.recibo] : [])
  } catch (err) {
    reciboMovimiento.value = null
    recibosMovimiento.value = []
    error.value = `Error al consultar recibo: ${err.response?.data?.error || err.message}`
  } finally {
    loadingRecibo.value = false
  }
}

const pedirTextoRecibo = (label, valorInicial = "", obligatorio = false) => {
  const valor = window.prompt(label, valorInicial)
  if (valor === null) return null
  const limpio = String(valor || "").trim()
  if (obligatorio && !limpio) {
    error.value = "Completa el dato requerido para emitir el recibo"
    return null
  }
  return limpio
}

const abrirModalRecibo = async () => {
  if (!movimientoSeleccionado.value?.id) return
  if (movimientoSeleccionado.value?.tipo !== "ingreso") {
    error.value = "Solo se pueden emitir recibos para ingresos"
    return
  }

  // Cargar presupuestos asociados al movimiento
  let presupuestosAsociados = []
  const idsPresupuestos = new Set()

  // Prioridad 1: lista completa de presupuestos asociados
  if (Array.isArray(movimientoSeleccionado.value?.presupuestos_ids) && movimientoSeleccionado.value.presupuestos_ids.length > 0) {
    movimientoSeleccionado.value.presupuestos_ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => idsPresupuestos.add(id))
  }

  // Prioridad 2: ids presentes en asignaciones
  if (idsPresupuestos.size === 0 && movimientoSeleccionado.value?.presupuestos_asignaciones?.length > 0) {
    movimientoSeleccionado.value.presupuestos_asignaciones
      .map((a) => Number(a?.presupuesto_id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => idsPresupuestos.add(id))
  }

  // Prioridad 3: presupuesto_id legacy (uno solo)
  if (idsPresupuestos.size === 0 && movimientoSeleccionado.value?.presupuesto_id) {
    const presupuestoId = Number(movimientoSeleccionado.value.presupuesto_id)
    if (Number.isInteger(presupuestoId) && presupuestoId > 0) {
      idsPresupuestos.add(presupuestoId)
    }
  }

  if (idsPresupuestos.size > 0) {
    presupuestosAsociados = presupuestos.value.filter((p) => idsPresupuestos.has(Number(p.id)))
  } else {
    // Si no hay asociaciones, traer todos del cliente
    presupuestosAsociados = presupuestos.value.filter((p) => {
      return Number(p.cliente_id) === Number(movimientoSeleccionado.value?.cliente_id)
    })
  }
  
  presupuestosMovimiento.value = presupuestosAsociados

  // Resetear formulario - dejar que el usuario elija si quiere manual o presupuestos
  formRecibo.value = {
    pagador_nombre: movimientoSeleccionado.value?.cliente || "",
    concepto_publico: movimientoSeleccionado.value?.detalle || "",
    conceptoTipo: "manual", // Siempre comenzar en manual para que el usuario elija
    presupuestosSeleccionados: [],
    incluir_saldos_presupuestos: true,
    observaciones_publicas: "",
  }

  mostrarModalRecibo.value = true
}

const guardarRecibo = async () => {
  if (!formRecibo.value.pagador_nombre?.trim()) {
    error.value = "El nombre del pagador es obligatorio"
    return
  }

  let conceptoFinal = ""
  if (formRecibo.value.conceptoTipo === "manual") {
    if (!formRecibo.value.concepto_publico?.trim()) {
      error.value = "El concepto es obligatorio"
      return
    }
    conceptoFinal = formRecibo.value.concepto_publico
  } else if (formRecibo.value.conceptoTipo === "presupuestos") {
    if (!formRecibo.value.presupuestosSeleccionados.length) {
      error.value = "Debe seleccionar al menos un presupuesto"
      return
    }
    // Obtener números de presupuestos seleccionados
    const presupuestosTexto = formRecibo.value.presupuestosSeleccionados
      .map((id) => {
        const presupuesto = presupuestosMovimiento.value.find((p) => Number(p.id) === Number(id))
        return presupuesto ? `- Presupuesto #${presupuesto.numero}` : null
      })
      .filter(Boolean)
      .join("\n")
    conceptoFinal = presupuestosTexto
  }

  const presupuestosIdsRecibo = obtenerPresupuestosIdsRecibo()

  try {
    emitiendoRecibo.value = true
    const res = await api.createReciboCaja({
      movimiento_id: Number(movimientoSeleccionado.value.id),
      pagador_nombre: formRecibo.value.pagador_nombre,
      concepto_publico: conceptoFinal,
      observaciones_publicas: formRecibo.value.observaciones_publicas,
      mostrar_saldos_presupuestos: Boolean(formRecibo.value.incluir_saldos_presupuestos),
      presupuestos_ids: presupuestosIdsRecibo,
    })
    reciboMovimiento.value = res.data
    await cargarReciboPorMovimiento(Number(movimientoSeleccionado.value.id))
    mostrarModalRecibo.value = false
    await descargarReciboPdf()
  } catch (err) {
    error.value = `Error al emitir recibo: ${err.response?.data?.error || err.message}`
  } finally {
    emitiendoRecibo.value = false
  }
}

const generarConceptoPresupuestos = () => {
  if (formRecibo.value.presupuestosSeleccionados.length === 0) return ""
  
  const presupuestosTexto = formRecibo.value.presupuestosSeleccionados
    .map((id) => {
      const presupuesto = presupuestosMovimiento.value.find((p) => Number(p.id) === Number(id))
      return presupuesto ? `- Presupuesto #${presupuesto.numero}` : null
    })
    .filter(Boolean)
    .join("\n")
  
  return presupuestosTexto
}

const obtenerPresupuestosIdsRecibo = () => {
  const ids = new Set()

  if (formRecibo.value.conceptoTipo === "presupuestos") {
    ;(formRecibo.value.presupuestosSeleccionados || [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => ids.add(id))
  }

  if (ids.size === 0) {
    ;(presupuestosMovimiento.value || [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .forEach((id) => ids.add(id))
  }

  return Array.from(ids)
}

const emitirRecibo = abrirModalRecibo

const descargarReciboPdf = async () => {
  if (!reciboMovimiento.value?.id) return

  await descargarReciboPdfPorId(reciboMovimiento.value.id, reciboMovimiento.value.numero)
}

const descargarReciboPdfPorId = async (reciboId, numeroRecibo = null) => {
  const id = Number(reciboId)
  if (!Number.isInteger(id) || id <= 0) return

  try {
    descargandoRecibo.value = true
    const res = await api.getReciboCajaPdf(id)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const numero = String(numeroRecibo || reciboMovimiento.value?.numero || 0).padStart(6, "0")
    descargarBlobPdf(blob, `Recibo-${numero}.pdf`)
  } catch (err) {
    error.value = `Error al descargar recibo: ${err.response?.data?.error || err.message}`
  } finally {
    descargandoRecibo.value = false
  }
}

const anularRecibo = async () => {
  if (!reciboMovimiento.value?.id) return

  if (reciboMovimiento.value?.estado === "anulado") {
    error.value = "El recibo ya está anulado. Podés descargarlo para conservar constancia."
  } else {
    // Si esta emitido, permitir anular
    const motivo = window.prompt("Ingresa el motivo de anulacion del recibo:")
    if (!motivo || !String(motivo).trim()) return

    try {
      anulandoRecibo.value = true
      const res = await api.anularReciboCaja(Number(reciboMovimiento.value.id), String(motivo).trim())
      reciboMovimiento.value = res.data
      await cargarReciboPorMovimiento(Number(movimientoSeleccionado.value.id))
      error.value = ""
    } catch (err) {
      error.value = `Error al anular recibo: ${err.response?.data?.error || err.message}`
    } finally {
      anulandoRecibo.value = false
    }
  }
}

const abrirModalPdfCheques = () => {
  opcionPdfCheques.value = "disponibles"
  mostrarModalPdfCheques.value = true
}

const descargarLibroChequesPdf = async () => {
  const listado = String(opcionPdfCheques.value || "disponibles")
  const fechaInicio = semanaLibroChequesActiva.value?.fecha_inicio || ""
  const fechaFin = semanaLibroChequesActiva.value?.fecha_fin || ""

  try {
    generandoPdfCheques.value = true
    const res = await api.getLibroChequesPdf(filtroCaja.value, listado, filtroBusquedaLibroCheques.value, fechaInicio, fechaFin)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url

    const hoy = new Date()
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`
    const sufijo = fechaInicio ? ` semana ${fechaInicio}` : ""
    link.download = `Libro cheques ${textoCajaFiltro()} ${listado}${sufijo} ${fecha}.pdf`

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
  fecha: formatFechaISO(new Date()),
  caja_codigo: filtroCaja.value || "tesla",
  tipo: "ingreso",
  categoria: "",
  categoria_id: "",
  con_iva: true,
  destinatario: "",
  cliente_id: "",
  presupuesto_id: "",
  presupuesto_ids: [],
  presupuestos_asignaciones: [],
  detalle: "",
  observaciones: "",
  monto_total: 0,
  desglose: {
    efectivo: 0,
    transferencia: 0,
    banco: 0,
    retencion: 0
  },
  cheques: [],
  usar_cheques_libro: false,
  usar_echeqs_libro: false,
  cheques_salida: [],
  fecha_salida_cheques: formatFechaISO(new Date()),
  endosado_a_cheques: ""
})

const normalizarAsignacionesPresupuestos = (asignaciones = [], { excluirCeros = false } = {}) => {
  return (Array.isArray(asignaciones) ? asignaciones : [])
    .map((item) => ({
      presupuesto_id: String(item?.presupuesto_id || item?.id || ""),
      monto_asignado: Math.max(0, Number(item?.monto_asignado ?? item?.monto ?? 0)),
    }))
    .filter((item) => {
      if (!item.presupuesto_id) return false
      return excluirCeros ? Number(item.monto_asignado) > 0 : Number(item.monto_asignado) >= 0
    })
}

const sincronizarAsignacionesConSeleccion = () => {
  const idsSeleccionados = (form.value.presupuesto_ids || []).map((id) => String(id))
  if (!idsSeleccionados.length) {
    form.value.presupuestos_asignaciones = []
    return
  }

  const actuales = normalizarAsignacionesPresupuestos(form.value.presupuestos_asignaciones || [])
  const mapaActual = new Map(actuales.map((item) => [String(item.presupuesto_id), Number(item.monto_asignado || 0)]))
  const nuevas = idsSeleccionados.map((id) => ({
    presupuesto_id: String(id),
    monto_asignado: Number(mapaActual.get(String(id)) || 0),
  }))

  if (nuevas.length === 1 && !(nuevas[0].monto_asignado > 0)) {
    nuevas[0].monto_asignado = Number(form.value.monto_total || 0)
  }

  form.value.presupuestos_asignaciones = nuevas
}

const abrirModalAsignacionesPresupuestos = () => {
  if (!form.value.cliente_id || !Array.isArray(form.value.presupuesto_ids) || form.value.presupuesto_ids.length === 0) {
    error.value = "Seleccioná al menos un presupuesto para repartir el monto"
    return
  }

  sincronizarAsignacionesConSeleccion()
  asignacionesDraft.value = normalizarAsignacionesPresupuestos(form.value.presupuestos_asignaciones || [])

  if (!asignacionesDraft.value.length) {
    asignacionesDraft.value = (form.value.presupuesto_ids || []).map((id) => ({
      presupuesto_id: String(id),
      monto_asignado: 0,
    }))
  }
  mostrarModalAsignaciones.value = true
}

const aplicarAsignacionesPresupuestos = () => {
  if (!asignacionesDraftValidas.value) {
    error.value = "La suma asignada no puede superar el monto total del movimiento"
    return
  }

  form.value.presupuestos_asignaciones = normalizarAsignacionesPresupuestos(asignacionesDraft.value)
  mostrarModalAsignaciones.value = false
}

const abrirModalTransferenciaCheques = () => {
  transferenciaChequesForm.value = {
    caja_destino: CAJAS_DISPONIBLES.find((item) => item.id !== filtroCaja.value)?.id || "",
    fecha: new Date().toISOString().split('T')[0],
    cheques_ids: [],
    detalle: `Pasan cheques a ${getLabelCaja(CAJAS_DISPONIBLES.find((item) => item.id !== filtroCaja.value)?.id || "")}`,
    observaciones: "",
  }
  mostrarModalTransferenciaCheques.value = true
}

const confirmarTransferenciaCheques = async () => {
  error.value = ""
  const destino = String(transferenciaChequesForm.value.caja_destino || "")
  const ids = (transferenciaChequesForm.value.cheques_ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)

  if (!destino) {
    error.value = "Seleccioná la caja destino para transferir los cheques"
    return
  }
  if (destino === filtroCaja.value) {
    error.value = "La caja destino debe ser distinta a la caja actual"
    return
  }
  if (!ids.length) {
    error.value = "Seleccioná al menos un cheque disponible"
    return
  }

  try {
    transferiendoCheques.value = true
    await api.transferirChequesCaja({
      caja_origen: filtroCaja.value,
      caja_destino: destino,
      fecha: transferenciaChequesForm.value.fecha,
      cheques: ids.map((id) => ({ libro_cheque_id: id })),
      detalle: transferenciaChequesForm.value.detalle,
      observaciones: transferenciaChequesForm.value.observaciones,
    })
    mostrarModalTransferenciaCheques.value = false
    await refrescarCaja()
  } catch (err) {
    error.value = `Error al transferir cheques: ${err.response?.data?.error || err.message}`
  } finally {
    transferiendoCheques.value = false
  }
}

const normalizarDesglose = (detalles = []) => {
  const base = {
    efectivo: 0,
    transferencia: 0,
    banco: 0,
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
      numero_cheque: String(item?.numero_cheque || "").trim(),
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

const abrirModalControlSemanal = async () => {
  const semanaId = extraerSemanaIdNumerica(semanaActiva.value?.id)
  if (!semanaId) {
    error.value = "No se pudo determinar la semana activa para registrar el control"
    return
  }

  try {
    const res = await api.getControlSemanalCandidatos(semanaId)
    chequesControlSemanalCandidatos.value = Array.isArray(res.data) ? res.data : []
    chequesControlSemanalSeleccionados.value = (chequesControlSemanalCandidatos.value || []).map((item) => Number(item.id))
    controlSemanalEfectivo.value = 0
    controlSemanalDetalle.value = "Control semanal inicial de caja"
    controlSemanalObservaciones.value = ""
    mostrarModalControlSemanal.value = true
  } catch (err) {
    error.value = `Error al cargar cheques para control semanal: ${err.response?.data?.error || err.message}`
  }
}

const toggleSeleccionTodosChequesControl = () => {
  if (todosChequesControlSeleccionados.value) {
    chequesControlSemanalSeleccionados.value = []
    return
  }
  chequesControlSemanalSeleccionados.value = (chequesControlSemanalCandidatos.value || []).map((item) => Number(item.id))
}

const guardarControlSemanal = async () => {
  const semanaId = extraerSemanaIdNumerica(semanaActiva.value?.id)
  if (!semanaId) {
    error.value = "No se pudo determinar la semana activa para guardar el control"
    return
  }

  const efectivo = Number(controlSemanalEfectivo.value || 0)
  if (efectivo < 0) {
    error.value = "El efectivo inicial no puede ser negativo"
    return
  }

  const ids = (chequesControlSemanalSeleccionados.value || [])
    .map((valor) => Number(valor))
    .filter((valor) => Number.isInteger(valor) && valor > 0)

  try {
    guardandoControlSemanal.value = true
    await api.registrarControlSemanal(semanaId, {
      efectivo_inicial: efectivo,
      cheques_controlados_ids: ids,
      detalle: String(controlSemanalDetalle.value || "").trim() || "Control semanal inicial de caja",
      observaciones: String(controlSemanalObservaciones.value || "").trim() || null,
    })

    mostrarModalControlSemanal.value = false
    await refrescarCaja()
  } catch (err) {
    error.value = `Error al guardar control semanal: ${err.response?.data?.error || err.message}`
  } finally {
    guardandoControlSemanal.value = false
  }
}

const abrirFormulario = async () => {
  if (semanaRequiereControl.value) {
    await abrirModalControlSemanal()
    return
  }
  await cargarReferencias()
  await cargarCategorias()
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

const abrirEdicion = async (movimiento) => {
  try {
    loading.value = true
    await cargarCategorias()
    const res = await api.getMovimientoCaja(movimiento.id)
    const movimientoCompleto = res?.data || movimiento

    const chequesMovimiento = normalizarCheques(movimientoCompleto.detalles_medio_pago || [])
    const detalleChequesSalida = Array.isArray(movimientoCompleto.cheques_salida_detalle)
      ? movimientoCompleto.cheques_salida_detalle
      : []
    const detalleChequesIngreso = Array.isArray(movimientoCompleto.cheques_ingreso_detalle)
      ? movimientoCompleto.cheques_ingreso_detalle
      : []
    const chequesSalidaIdsBackend = Array.isArray(movimientoCompleto.cheques_salida_ids)
      ? movimientoCompleto.cheques_salida_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : []
    const chequesSalidaIdsDetalles = chequesMovimiento
      .map((item) => Number(item.libro_cheque_id || 0))
      .filter((id) => Number.isInteger(id) && id > 0)
    const chequesSalidaIds = chequesSalidaIdsBackend.length > 0 ? chequesSalidaIdsBackend : chequesSalidaIdsDetalles

    detalleChequesSalida.forEach((item) => {
      const libroId = Number(item?.id || 0)
      if (!Number.isInteger(libroId) || libroId <= 0) return

      const existentePorLibro = chequesMovimiento.find((cheque) => Number(cheque?.libro_cheque_id || 0) === libroId)
      if (existentePorLibro) return

      const numero = String(item?.numero_cheque || "").trim()
      const existentePorNumeroSinLibro = chequesMovimiento.find((cheque) => {
        if (Number(cheque?.libro_cheque_id || 0) > 0) return false
        const nroCheque = String(cheque?.numero_cheque || cheque?.identificador || "").trim()
        return numero && nroCheque && nroCheque === numero
      })

      if (existentePorNumeroSinLibro) {
        existentePorNumeroSinLibro.libro_cheque_id = libroId
        if (!(Number(existentePorNumeroSinLibro.monto || 0) > 0)) {
          existentePorNumeroSinLibro.monto = Number(item?.importe || 0)
        }
        return
      }

      chequesMovimiento.push({
        medio_pago: String(item?.medio_pago || "cheque").toLowerCase(),
        monto: Number(item?.importe || 0),
        identificador: numero,
        numero_cheque: numero,
        librador_endosante: String(item?.librador_endosante || "").trim(),
        banco: String(item?.banco || "").trim(),
        fecha_cheque: String(item?.fecha_cheque || "").split("T")[0],
        fecha_entrada: String(item?.fecha_salida || movimientoCompleto.fecha || "").split("T")[0],
        libro_cheque_id: libroId,
      })
    })

    const usedChequeRows = new Set()
    const completarChequeDesdeLibro = (cheque, item) => {
      const libroId = Number(item?.id || 0)
      const numero = String(item?.numero_cheque || "").trim()
      const importe = Number(item?.importe || 0)

      if (Number.isInteger(libroId) && libroId > 0) cheque.libro_cheque_id = libroId
      if (!String(cheque.numero_cheque || "").trim()) cheque.numero_cheque = numero
      if (!String(cheque.librador_endosante || "").trim()) cheque.librador_endosante = String(item?.librador_endosante || "").trim()
      if (!String(cheque.banco || "").trim()) cheque.banco = String(item?.banco || "").trim()
      if (!String(cheque.fecha_cheque || "").trim()) cheque.fecha_cheque = String(item?.fecha_cheque || "").split("T")[0]
      if (!String(cheque.fecha_entrada || "").trim()) cheque.fecha_entrada = String(item?.fecha_entrada || movimientoCompleto.fecha || "").split("T")[0]
      if (!(Number(cheque.monto || 0) > 0) && importe > 0) cheque.monto = importe
    }

    detalleChequesIngreso.forEach((item) => {
      const libroId = Number(item?.id || 0)
      const numero = String(item?.numero_cheque || "").trim()
      const importe = Number(item?.importe || 0)

      let existente = chequesMovimiento.find((cheque, idx) => {
        if (usedChequeRows.has(idx)) return false
        return Number(cheque?.libro_cheque_id || 0) === libroId && Number.isInteger(libroId) && libroId > 0
      })

      if (!existente) {
        existente = chequesMovimiento.find((cheque, idx) => {
          if (usedChequeRows.has(idx)) return false
          const numeroCheque = String(cheque?.numero_cheque || "").trim()
          return Boolean(numero && numeroCheque && numeroCheque === numero)
        })
      }

      if (!existente) {
        existente = chequesMovimiento.find((cheque, idx) => {
          if (usedChequeRows.has(idx)) return false
          const montoCheque = Number(cheque?.monto || 0)
          return importe > 0 && montoCheque > 0 && Math.abs(montoCheque - importe) < 0.01
        })
      }

      if (existente) {
        const idx = chequesMovimiento.indexOf(existente)
        if (idx >= 0) usedChequeRows.add(idx)
        completarChequeDesdeLibro(existente, item)
        return
      }

      const nuevo = {
        medio_pago: String(item?.medio_pago || "cheque").toLowerCase(),
        monto: importe,
        identificador: "",
        numero_cheque: numero,
        librador_endosante: String(item?.librador_endosante || "").trim(),
        banco: String(item?.banco || "").trim(),
        fecha_cheque: String(item?.fecha_cheque || "").split("T")[0],
        fecha_entrada: String(item?.fecha_entrada || movimientoCompleto.fecha || "").split("T")[0],
        libro_cheque_id: Number.isInteger(libroId) && libroId > 0 ? libroId : null,
      }
      chequesMovimiento.push(nuevo)
      usedChequeRows.add(chequesMovimiento.length - 1)
    })

    form.value = {
      fecha: String(movimientoCompleto.fecha || "").split("T")[0],
      caja_codigo: movimientoCompleto.caja_codigo || filtroCaja.value || "tesla",
      tipo: movimientoCompleto.tipo || "ingreso",
      categoria: movimientoCompleto.categoria || "",
      categoria_id: movimientoCompleto.categoria_id ? String(movimientoCompleto.categoria_id) : "",
      con_iva: movimientoCompleto.con_iva !== false,
      destinatario: movimientoCompleto.destinatario || "",
      cliente_id: movimientoCompleto.cliente_id || "",
      presupuesto_id: movimientoCompleto.presupuesto_id || "",
      presupuesto_ids: Array.isArray(movimientoCompleto.presupuestos_ids) && movimientoCompleto.presupuestos_ids.length > 0
        ? movimientoCompleto.presupuestos_ids.map((id) => String(id))
        : (movimientoCompleto.presupuesto_id ? [String(movimientoCompleto.presupuesto_id)] : []),
      presupuestos_asignaciones: normalizarAsignacionesPresupuestos(
        movimientoCompleto.presupuestos_asignaciones
        || (Array.isArray(movimientoCompleto.presupuestos_ids)
          ? movimientoCompleto.presupuestos_ids.map((id) => ({ presupuesto_id: id, monto_asignado: 0 }))
          : [])
      ),
      detalle: movimientoCompleto.detalle || "",
      observaciones: movimientoCompleto.observaciones || "",
      monto_total: parseFloat(movimientoCompleto.monto_total) || 0,
      desglose: normalizarDesglose(movimientoCompleto.detalles_medio_pago || []),
      cheques: chequesMovimiento,
      usar_cheques_libro: movimientoCompleto.tipo === "egreso" && chequesSalidaIds.length > 0
        && (movimientoCompleto.cheques_salida_detalle || []).some((c) => String(c?.medio_pago || "").toLowerCase() === "cheque"),
      usar_echeqs_libro: movimientoCompleto.tipo === "egreso" && chequesSalidaIds.length > 0
        && (movimientoCompleto.cheques_salida_detalle || []).some((c) => String(c?.medio_pago || "").toLowerCase() === "echeq"),
      cheques_salida: chequesSalidaIds,
      fecha_salida_cheques: String(movimientoCompleto.fecha_salida_cheques || movimientoCompleto.fecha || "").split("T")[0] || new Date().toISOString().split('T')[0],
      endosado_a_cheques: String(movimientoCompleto.endosado_a_cheques || movimientoCompleto.destinatario || "").trim(),
    }
    editandoMovimientoId.value = movimientoCompleto.id
    error.value = ""
    showForm.value = true
  } catch (err) {
    error.value = `Error al cargar edición: ${err.response?.data?.error || err.message}`
  } finally {
    loading.value = false
  }
}

const payloadMovimiento = () => ({
  fecha: form.value.fecha,
  caja_codigo: form.value.caja_codigo,
  tipo: form.value.tipo,
  categoria: form.value.tipo === "ingreso" ? (form.value.categoria || null) : null,
  categoria_id: Number.isInteger(Number(form.value.categoria_id)) && Number(form.value.categoria_id) > 0
    ? Number(form.value.categoria_id)
    : null,
  con_iva: form.value.con_iva,
  destinatario: form.value.tipo === "egreso"
    ? String(form.value.destinatario || form.value.endosado_a_cheques || "").trim()
    : null,
  cliente_id: form.value.cliente_id || null,
  presupuesto_id: form.value.tipo === "ingreso"
    ? ((form.value.presupuesto_ids || []).length > 0 ? Number(form.value.presupuesto_ids[0]) : (form.value.presupuesto_id || null))
    : null,
  presupuesto_ids: form.value.tipo === "ingreso"
    ? ((form.value.presupuesto_ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    : [],
  caja_semanal_id: extraerSemanaIdNumerica(semanaActiva.value?.id),
  presupuestos_asignaciones: form.value.tipo === "ingreso"
    ? normalizarAsignacionesPresupuestos(form.value.presupuestos_asignaciones || [], { excluirCeros: true }).map((item) => ({
      presupuesto_id: Number(item.presupuesto_id),
      monto_asignado: Number(item.monto_asignado || 0),
    }))
    : [],
  detalle: form.value.detalle,
  observaciones: String(form.value.observaciones || "").trim() || null,
  monto_total: parseFloat(form.value.monto_total),
  desglose: {
    efectivo: parseFloat(form.value.desglose.efectivo) || 0,
    transferencia: parseFloat(form.value.desglose.transferencia) || 0,
    banco: parseFloat(form.value.desglose.banco) || 0,
    retencion: parseFloat(form.value.desglose.retencion) || 0
  },
  detalles_medio_pago: chequesCargados.value
    .filter((item) => parseFloat(item?.monto || 0) > 0 && String(item?.identificador || item?.numero_cheque || "").trim())
    .map((item) => ({
      medio_pago: item.medio_pago,
      monto: parseFloat(item.monto) || 0,
      identificador: String(item.identificador || "").trim(),
      numero_cheque: String(item.numero_cheque || "").trim(),
      librador_endosante: String(item.librador_endosante || "").trim(),
      banco: String(item.banco || "").trim(),
      fecha_cheque: item.fecha_cheque || null,
      fecha_entrada: item.fecha_entrada || null,
      libro_cheque_id: Number(item.libro_cheque_id || 0) || null,
      endosado_a: form.value.tipo === "egreso" ? String(form.value.endosado_a_cheques || form.value.destinatario || "").trim() : null,
    })),
  cheques_salida: form.value.tipo === "egreso" && usaLibroCualquiera.value
    ? (form.value.cheques_salida || []).map((id) => ({ libro_cheque_id: Number(id) }))
    : [],
  fecha_salida_cheques: form.value.tipo === "egreso" && usaLibroCualquiera.value
    ? (form.value.fecha_salida_cheques || form.value.fecha)
    : null,
  endosado_a_cheques: form.value.tipo === "egreso" && usaLibroCualquiera.value
    ? String(form.value.endosado_a_cheques || form.value.destinatario || "").trim()
    : null,
})

const cargarLibroCheques = async () => {
  try {
    loadingLibroCheques.value = true
    const fechaInicio = semanaLibroChequesActiva.value?.fecha_inicio || ""
    const fechaFin = semanaLibroChequesActiva.value?.fecha_fin || ""
    const res = await api.getLibroChequesCaja(
      filtroCaja.value,
      "",
      filtroBusquedaLibroCheques.value,
      fechaInicio,
      fechaFin,
    )
    libroCheques.value = res.data || []
  } catch (err) {
    console.error("Error al cargar libro de cheques:", err)
  } finally {
    loadingLibroCheques.value = false
  }
}

const cargarChequesDisponibles = async () => {
  try {
    const cajaConsulta = String((showForm.value ? form.value?.caja_codigo : filtroCaja.value) || filtroCaja.value || "tesla").toLowerCase()

    const fechaFormulario = String(form.value?.fecha || "").split("T")[0]
    const semanaDesdeFecha = fechaFormulario
      ? (semanasCajaVisibles.value || []).find((semana) => {
        const inicio = String(semana?.fecha_inicio || "")
        const fin = String(semana?.fecha_fin || "")
        if (!inicio || !fin) return false
        return fechaFormulario >= inicio && fechaFormulario <= fin
      })
      : null

    const semanaObjetivo = showForm.value ? (semanaDesdeFecha || semanaActiva.value) : semanaActiva.value
    const semanaId = extraerSemanaIdNumerica(semanaObjetivo?.id)
    if (!semanaId) {
      chequesDisponibles.value = []
      return
    }

    const res = await api.getChequesDisponiblesCaja(cajaConsulta, semanaId, fechaFormulario)
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
  if (!(form.value.tipo === "egreso" && usaLibroCualquiera.value)) return

  const idsSeleccionados = new Set((form.value.cheques_salida || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
  const seleccionadosDisponibles = [...idsSeleccionados]
    .map((id) => chequesDisponibles.value.find((item) => Number(item.id) === id))
    .filter(Boolean)

  const seleccionadosPersistidos = (form.value.cheques || []).filter((item) => {
    const id = Number(item?.libro_cheque_id || 0)
    if (!Number.isInteger(id) || id <= 0) return false
    if (!idsSeleccionados.has(id)) return false
    return !seleccionadosDisponibles.some((disponible) => Number(disponible.id) === id)
  })

  const seleccionados = [
    ...seleccionadosDisponibles.map((item) => ({
      medio_pago: String(item.medio_pago || "cheque").toLowerCase(),
      monto: Number(item.importe || 0),
      identificador: String(item.numero_cheque || ""),
      numero_cheque: String(item.numero_cheque || ""),
      librador_endosante: String(item.librador_endosante || ""),
      banco: String(item.banco || ""),
      fecha_cheque: String(item.fecha_cheque || "").split("T")[0],
      fecha_entrada: String(item.fecha_entrada || "").split("T")[0],
      libro_cheque_id: Number(item.id),
    })),
    ...seleccionadosPersistidos,
  ]

  form.value.cheques = seleccionados.map((item) => ({
    medio_pago: String(item.medio_pago || "cheque").toLowerCase(),
    monto: Number(item.importe || item.monto || 0),
    identificador: String(item.identificador || "").trim(),
    numero_cheque: String(item.numero_cheque || "").trim(),
    librador_endosante: String(item.librador_endosante || "").trim(),
    banco: String(item.banco || "").trim(),
    fecha_cheque: String(item.fecha_cheque || "").split("T")[0],
    fecha_entrada: String(item.fecha_entrada || item.fecha_salida || "").split("T")[0],
    libro_cheque_id: Number(item.libro_cheque_id || item.id || 0) || null,
  }))
}

const guardarMovimiento = async () => {
  error.value = ""

  if (!semanaActiva.value || semanaEstaCerrada.value) {
    error.value = "No hay una semana abierta para cargar movimientos"
    return
  }

  if (!esFormularioValido.value) {
    error.value = "Por favor completa todos los campos correctamente"
    return
  }

  if (form.value.tipo === "ingreso" && Array.isArray(form.value.presupuesto_ids) && form.value.presupuesto_ids.length > 1) {
    sincronizarAsignacionesConSeleccion()
    const totalAsignado = (form.value.presupuestos_asignaciones || []).reduce((acc, item) => acc + Number(item?.monto_asignado || 0), 0)
    if (totalAsignado - Number(form.value.monto_total || 0) > 0.01) {
      error.value = "La imputacion por presupuesto no puede superar el monto total del movimiento"
      return
    }
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

const verDetalle = async (mov) => {
  movimientoSeleccionado.value = mov
  vistaActual.value = "detalle"
  await cargarReciboPorMovimiento(mov.id)
}

const volverALista = () => {
  vistaActual.value = "lista"
  movimientoSeleccionado.value = null
  resetReciboMovimiento()
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
  const ids = Array.isArray(presupuestoId)
    ? presupuestoId
    : (presupuestoId ? [presupuestoId] : [])
  if (ids.length === 0) return "-"

  const etiquetas = ids
    .map((id) => {
      const presupuesto = presupuestos.value.find((p) => String(p.id) === String(id))
      return presupuesto?.numero ? `#${presupuesto.numero}` : `Presupuesto ${id}`
    })
    .filter(Boolean)

  return etiquetas.join(", ") || "-"
}

const getPresupuestoById = (presupuestoId) => {
  return presupuestos.value.find((p) => String(p.id) === String(presupuestoId)) || null
}

const getMontoPendientePresupuesto = (presupuestoId) => {
  const presupuesto = getPresupuestoById(presupuestoId)
  return Number(presupuesto?.saldo_pendiente_cobro || 0)
}

const getMontoTotalPresupuesto = (presupuestoId) => {
  const presupuesto = getPresupuestoById(presupuestoId)
  return Number(presupuesto?.total || 0)
}

const aplicarMontoPresupuestoEnDraft = (presupuestoId, modo = "pendiente") => {
  const id = String(presupuestoId || "")
  if (!id) return

  const pendiente = getMontoPendientePresupuesto(id)
  const total = getMontoTotalPresupuesto(id)
  const monto = modo === "total" ? total : (pendiente > 0 ? pendiente : total)
  const fila = (asignacionesDraft.value || []).find((item) => String(item.presupuesto_id) === id)
  if (!fila) return

  fila.monto_asignado = Math.max(0, Number(monto || 0))
}

const getLabelCategoria = (categoria, categoriaId = null) => {
  const categoriaIdNumero = Number(categoriaId || 0)
  if (Number.isInteger(categoriaIdNumero) && categoriaIdNumero > 0) {
    const categoriaDinamica = categorias.value.find((item) => Number(item?.id) === categoriaIdNumero)
    if (categoriaDinamica?.nombre) return categoriaDinamica.nombre
  }
  if (categoria === "mano_obra") return "Mano de obra"
  if (categoria === "materiales") return "Materiales"
  if (categoria === "varios") return "Varios"
  return "-"
}

const esControlSemanalMovimiento = (movimiento) => Boolean(movimiento?.es_control_semanal)

const getLabelTipoCategoria = (tipo) => {
  return normalizarTipoCategoria(tipo) === "egreso" ? "Egreso" : "Ingreso"
}

const getEtiquetaCategoriaFiltro = (categoria) => {
  const nombre = String(categoria?.nombre || "-")
  if (String(filtroTipo.value || "").trim()) return nombre
  return `${nombre} (${getLabelTipoCategoria(categoria?.tipo)})`
}

const getChequesMovimiento = (movimiento) => {
  return (movimiento?.detalles_medio_pago || []).filter((detalle) => {
    return String(detalle?.medio_pago || "").toLowerCase() === "cheque"
  })
}

const getCantidadCheques = (movimiento) => getChequesMovimiento(movimiento).length

const getEcheqsMovimiento = (movimiento) => {
  return (movimiento?.detalles_medio_pago || []).filter((detalle) => {
    return String(detalle?.medio_pago || "").toLowerCase() === "echeq"
  })
}

const getCantidadEcheqs = (movimiento) => getEcheqsMovimiento(movimiento).length

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

const getIdentificadoresEcheq = (movimiento) => {
  const ids = getEcheqsMovimiento(movimiento)
    .map((detalle) => String(detalle?.identificador || detalle?.numero_cheque || "").trim())
    .filter(Boolean)

  return ids.join(" · ")
}

const getResumenEcheq = (movimiento) => {
  const cantidad = getCantidadEcheqs(movimiento)
  if (!cantidad) return ""

  const ids = getIdentificadoresEcheq(movimiento)
  const textoCantidad = `${cantidad} ${cantidad === 1 ? "eCheq" : "eCheq"}`
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

const cargarCategorias = async () => {
  try {
    const {data} = await API.getCategoriasCaja()
    categorias.value = Array.isArray(data) ? data : []
  } catch (err) {
    console.error("Error al cargar categorias:", err)
    categorias.value = []
  }
}

const abrirModalCategorias = () => {
  formCategoria.value.tipo = normalizarTipoCategoria(form.value.tipo)
  cargarCategorias()
  mostrarModalCategorias.value = true
}

const onCategoriaSelectChange = () => {
  if (String(form.value.categoria_id) !== NUEVA_CATEGORIA_OPTION) return
  form.value.categoria_id = ""
  abrirModalCategorias()
}

const guardarCategoria = async (categoria) =>{
  if (!formCategoria.value.nombre.trim()){
    alert("El nombre de la categoría no puede estar vacío")
    return
  }

  formCategoria.value.tipo = normalizarTipoCategoria(formCategoria.value.tipo)

  guardandoCategoria.value = true
  try {
    let categoriaGuardada = null
    if(editandoCategoria.value){
      const { data } = await API.updateCategoria(editandoCategoria.value, formCategoria.value)
      categoriaGuardada = data || null
    } else {
      const { data } = await API.createCategoria(formCategoria.value)
      categoriaGuardada = data || null
    }
    formCategoria.value = { nombre: "" , descripcion: "", tipo: normalizarTipoCategoria(form.value.tipo) }
    editandoCategoria.value = null
    await cargarCategorias()
    if (showForm.value && categoriaGuardada?.id && normalizarTipoCategoria(form.value.tipo) === normalizarTipoCategoria(categoriaGuardada?.tipo)) {
      form.value.categoria_id = String(categoriaGuardada.id)
    }
  } catch (err) {
    const mensaje = err.response?.data?.error || "Error al guardar categoría"
    alert(mensaje)
  } finally {
    guardandoCategoria.value = false
  }
}

const editarCategoria = (cat) => {
  formCategoria.value = {nombre: cat.nombre || "", descripcion: cat.descripcion || "", tipo: normalizarTipoCategoria(cat?.tipo)}
  editandoCategoria.value = cat.id
}

const cancelarEdicionCategoria = () => {
  formCategoria.value = { nombre: "" , descripcion: "", tipo: normalizarTipoCategoria(form.value.tipo) }
  editandoCategoria.value = null
}

const eliminarCategoria = async (cat) => {
  const categoriaId = Number(cat?.id)
  const categoriaNombre = cat?.nombre || "esta categoría"

  if (!Number.isFinite(categoriaId)) {
    alert("No se pudo identificar la categoría a eliminar")
    return
  }

  if (!confirm(`¿Estás seguro de eliminar la categoría "${categoriaNombre}"?`)) return

  eliminandoCategoria.value = true
  try {
    await API.deleteCategoria(categoriaId)
    await cargarCategorias()
  } catch (err) {
    const mensaje = err.response?.data?.error || "Error al eliminar categoría"
    alert(mensaje)
  } finally {
    eliminandoCategoria.value = false
  }
}


watch(filtroCaja, () => {
  semanaSeleccionadaId.value = ""
  filtroSemanaLibroCheques.value = "global"
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

watch(() => semanaActiva.value?.id, () => {
  sincronizarFiltroSemanaLibroCheques({ forzar: true })
  cargarChequesDisponibles()
})

watch(() => form.value.fecha, () => {
  if (!(showForm.value && form.value.tipo === "egreso" && usaLibroCualquiera.value)) return
  cargarChequesDisponibles()
})

watch(() => form.value.caja_codigo, () => {
  if (!(showForm.value && form.value.tipo === "egreso" && usaLibroCualquiera.value)) return
  cargarChequesDisponibles()
})

watch(() => form.value.tipo, (tipo) => {
  const categoriaSeleccionada = (categorias.value || []).find((cat) => String(cat?.id) === String(form.value.categoria_id || ""))
  if (categoriaSeleccionada && normalizarTipoCategoria(categoriaSeleccionada?.tipo) !== normalizarTipoCategoria(tipo)) {
    form.value.categoria_id = ""
  }

  if (tipo === "egreso") {
    form.value.categoria = ""
    form.value.presupuesto_id = ""
    form.value.presupuesto_ids = []
    form.value.presupuestos_asignaciones = []
    return
  }

  form.value.destinatario = ""
  form.value.usar_cheques_libro = false
  form.value.usar_echeqs_libro = false
  form.value.cheques_salida = []
  form.value.endosado_a_cheques = ""
})

watch(() => filtroTipo.value, (tipo) => {
  if (!filtroCategoria.value || filtroCategoria.value === FILTRO_SIN_CATEGORIA) return
  const categoriaSeleccionada = (categorias.value || []).find((cat) => String(cat?.id) === String(filtroCategoria.value))
  if (!categoriaSeleccionada) {
    filtroCategoria.value = ""
    return
  }

  const tipoFiltro = String(tipo || "").trim().toLowerCase()
  if (tipoFiltro && normalizarTipoCategoria(categoriaSeleccionada?.tipo) !== tipoFiltro) {
    filtroCategoria.value = ""
  }
})

watch(() => form.value.usar_cheques_libro, (usar) => {
  if (form.value.tipo !== "egreso") return
  if (usar) {
    cargarChequesDisponibles()
    form.value.cheques = (form.value.cheques || []).filter((item) => {
      const id = Number(item?.libro_cheque_id || 0)
      return Number.isInteger(id) && id > 0
    })
    sincronizarChequesSalidaSeleccionados()
  } else if (!form.value.usar_echeqs_libro) {
    form.value.cheques_salida = []
    form.value.endosado_a_cheques = ""
    form.value.fecha_salida_cheques = form.value.fecha
  }
})

watch(() => form.value.usar_echeqs_libro, (usar) => {
  if (form.value.tipo !== "egreso") return
  if (usar) {
    cargarChequesDisponibles()
    form.value.cheques = (form.value.cheques || []).filter((item) => {
      const id = Number(item?.libro_cheque_id || 0)
      return Number.isInteger(id) && id > 0
    })
    sincronizarChequesSalidaSeleccionados()
  } else if (!form.value.usar_cheques_libro) {
    form.value.cheques_salida = []
    form.value.endosado_a_cheques = ""
    form.value.fecha_salida_cheques = form.value.fecha
  }
})

watch(() => form.value.cheques_salida, () => {
  sincronizarChequesSalidaSeleccionados()
}, { deep: true })

watch(() => form.value.presupuesto_ids, (ids) => {
  form.value.presupuesto_id = Array.isArray(ids) && ids.length > 0 ? ids[0] : ""
  sincronizarAsignacionesConSeleccion()
}, { deep: true })

watch(() => form.value.monto_total, () => {
  if (Array.isArray(form.value.presupuesto_ids) && form.value.presupuesto_ids.length === 1) {
    sincronizarAsignacionesConSeleccion()
  }
})

watch(() => filtroBusquedaLibroCheques.value, () => {
  cargarLibroCheques()
})

watch(() => filtroSemanaLibroCheques.value, () => {
  cargarLibroCheques()
})

watch(() => form.value.cliente_id, (clienteId) => {
  if (!clienteId) {
    form.value.presupuesto_id = ""
    form.value.presupuesto_ids = []
    form.value.presupuestos_asignaciones = []
    return
  }

  const idsFiltrados = (form.value.presupuesto_ids || []).filter((id) => {
    const presupuesto = presupuestos.value.find((p) => String(p.id) === String(id))
    return presupuesto && String(presupuesto.cliente_id) === String(clienteId)
  })
  form.value.presupuesto_ids = idsFiltrados
  form.value.presupuesto_id = idsFiltrados[0] || ""
  sincronizarAsignacionesConSeleccion()
})

watch(() => transferenciaChequesForm.value.caja_destino, (destino) => {
  if (!destino) return
  transferenciaChequesForm.value.detalle = `Pasan cheques a ${getLabelCaja(destino)}`
})

onMounted(() => {
  refrescarCaja({ mantenerSeleccion: false })
  cargarReferencias()
  cargarCategorias()
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
          <button @click="abrirModalCategorias" class="btn btn-primary btn-categorias">
            Gestionar Categorías
          </button>
          <div class="caja-pdf-actions">
            <button class="btn btn-pdf btn-pdf-week" :disabled="generandoPdf || !semanaActiva" @click="descargarSemanaPdf">
              {{ generandoPdf ? "Generando PDF..." : "Descargar semana seleccionada" }}
            </button>
          </div>
          <button class="btn btn-primary" :disabled="!semanaActiva || semanaEstaCerrada" @click="abrirFormulario">
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
            <!--<p>La semana nueva arranca con el saldo final de la anterior y los movimientos quedan encapsulados en su propio período.</p>-->
          </div>
          <div class="caja-semana-actions">
            <label class="caja-semana-select">
              <span>Semana</span>
              <select v-model="semanaSeleccionadaId" class="select-sm">
                <option v-for="semana in semanasCajaVisibles" :key="semana.id" :value="String(semana.id)">
                  {{ etiquetaSemanaRango(semana) }}
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
            <button
              v-if="!haySemanaAbierta"
              class="btn btn-week-open"
              @click="abrirModalNuevaSemana"
            >
              Abrir semana
            </button>
            <span :class="['week-badge', semanaEstaCerrada ? 'week-badge-closed' : 'week-badge-open']">
              {{ semanaEstaCerrada ? "Cerrada" : "Abierta" }}
            </span>
          </div>
        </div>

        <!--<div class="caja-semana-grid">
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
        </div>-->

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

      <section v-if="!semanaActiva" class="caja-semana-shell caja-semana-empty">
        <div class="caja-semana-header">
          <div class="caja-semana-copy">
            <span class="section-kicker">Caja semanal</span>
            <h3>No hay semana abierta</h3>
            <p>Abrí una semana manualmente para empezar a cargar movimientos.</p>
          </div>
          <div class="caja-semana-actions">
            <button class="btn btn-week-open" @click="abrirModalNuevaSemana">
              Abrir semana
            </button>
          </div>
        </div>
      </section>
            
      <div
        v-if="semanaActiva && (
          semanaActiva.saldo_banco !== null && semanaActiva.saldo_banco !== undefined
          || semanaActiva.saldo_pendiente_echeq !== null && semanaActiva.saldo_pendiente_echeq !== undefined
          || semanaActiva.saldo_echeq_depositados !== null && semanaActiva.saldo_echeq_depositados !== undefined
          || semanaActiva.saldo_efectivo !== null && semanaActiva.saldo_efectivo !== undefined
          || semanaActiva.saldo_cheques !== null && semanaActiva.saldo_cheques !== undefined)"
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

      <section class="caja-toolbar-shell">
        <div class="toolbar toolbar-caja toolbar-caja-main">
          <div class="toolbar-filters-grid">
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
            <label class="toolbar-filter-label">
              <span>Medio</span>
              <select v-model="filtroMedioPago" class="select-sm">
                <option value="">Todos</option>
                <option v-for="medio in mediosDePago" :key="medio.id" :value="medio.id">
                  {{ medio.label }}
                </option>
              </select>
            </label>
            <label class="toolbar-filter-label">
              <span>Categoría</span>
              <select v-model="filtroCategoria" class="select-sm">
                <option value="">Todas</option>
                <option :value="FILTRO_SIN_CATEGORIA">Sin categoría</option>
                <option v-for="cat in categoriasFiltro" :key="cat.id" :value="String(cat.id)">
                  {{ cat.nombre }}
                </option>
              </select>
            </label>
          </div>
          <div class="toolbar-actions-row">
            <button class="btn btn-filter-apply toolbar-action-btn" @click="aplicarFiltros">Aplicar filtros</button>
            <button class="btn btn-filter-clear toolbar-action-btn" @click="filtroBusqueda = ''; filtroFechaInicio = ''; filtroFechaFin = ''; filtroTipo = ''; filtroMedioPago = ''; filtroCategoria = ''; aplicarFiltros()">Limpiar filtros</button>
            <button class="btn btn-pdf btn-pdf-toolbar toolbar-action-btn" :disabled="generandoPdf || !puedeDescargarResumenGeneral" @click="descargarResumenPdf">
              {{ generandoPdf ? "Generando PDF..." : "PDF resumen" }}
            </button>
          </div>
        </div>
      </section>

      <section class="section caja-medios-shell">
          <div class="section-heading section-heading-inline">
            <div>
              <span class="section-kicker">Medios de pago</span>
              <h3>Composición de ingresos y egresos</h3>
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
      </section>

      <section class="caja-list-shell caja-list-shell-compact">
        <div class="section-heading section-heading-inline section-heading-libro">
          <div class="section-heading-libro-main">
            <span class="section-kicker">Libro</span>
            <h3>Libro de cheques</h3>
          </div>
          <div class="libro-cheques-header-actions">
            <p class="libro-cheques-counter">{{ libroChequesFiltrado.length }} cheque(s) para {{ cajaActiva.label.toLowerCase() }}.</p>
            <div class="section-actions-group">
              <button type="button" class="btn btn-ghost" @click="abrirModalTransferenciaCheques">
                Transferir cheques
              </button>
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
            <label class="toolbar-filter-label">
              <span>Semana</span>
              <select v-model="filtroSemanaLibroCheques" class="select-sm">
                <option value="global">Global</option>
                <option v-for="semana in opcionesSemanaLibroCheques" :key="`libro-semana-${semana.id}`" :value="semana.id">
                  {{ semana.label }}
                </option>
              </select>
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
              <div class="section-actions-group">
                <p class="section-heading-count">{{ libroChequesNoDisponibles.length }} cheque(s).</p>
                <button type="button" class="btn btn-ghost btn-collapse-toggle" @click="noDisponiblesExpandido = !noDisponiblesExpandido">
                  {{ noDisponiblesExpandido ? "Contraer" : "Expandir" }}
                </button>
              </div>
            </div>
            <div v-if="!noDisponiblesExpandido" class="empty empty-collapsed">
              <strong>Listado contraído</strong>
              <span>Expandí para ver los cheques no disponibles.</span>
            </div>
            <div v-else-if="!libroChequesNoDisponibles.length" class="empty">
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
          <button
            v-if="semanaRequiereControl"
            type="button"
            class="btn btn-primary"
            @click="abrirModalControlSemanal"
          >
            Hacer control semanal
          </button>
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
              <template v-if="esControlSemanalMovimiento(mov)">
                <span class="badge badge-info">Control semanal</span>
              </template>
              <template v-else>
                <span :class="`badge badge-${mov.tipo}`">
                  {{ mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso' }}
                </span>
              </template>
            </td>
            <td>
              <span>{{ getLabelCategoria(mov.categoria, mov.categoria_id) }}</span>
            </td>
            <td>
              <div class="tabla-referencia">
                <strong>{{ mov.tipo === 'egreso' ? (mov.destinatario || '-') : (getNumeroPresupuesto((mov.presupuestos_ids && mov.presupuestos_ids.length) ? mov.presupuestos_ids : mov.presupuesto_id) !== '-' ? getNumeroPresupuesto((mov.presupuestos_ids && mov.presupuestos_ids.length) ? mov.presupuestos_ids : mov.presupuesto_id) : getNombreCliente(mov.cliente_id)) }}</strong>
                <small v-if="getIdentificadoresCheque(mov)" class="referencia-cheques" :title="`Cheque(s): ${getIdentificadoresCheque(mov)}`">Cheque(s): {{ getIdentificadoresCheque(mov) }}</small>
              </div>
            </td>
            <td>{{ mov.detalle }}</td>
            <td class="td-observaciones">
              <span class="observacion-completa">{{ mov.observaciones || '-' }}</span>
            </td>
            <td class="td-cheques">
              <template v-if="getCantidadCheques(mov) || getCantidadEcheqs(mov)">
                <span v-if="getCantidadCheques(mov)" class="cell-clamp" :title="getResumenCheques(mov)">{{ getResumenCheques(mov) }}</span>
                <span v-if="getCantidadEcheqs(mov)" class="cell-clamp" :title="getResumenEcheq(mov)">{{ getResumenEcheq(mov) }}</span>
              </template>
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
            {{ generandoPdfDetalle ? "Generando PDF..." : "Descargar comprobante" }}
          </button>

          <button
            v-if="movimientoSeleccionado?.tipo === 'ingreso' && !reciboMovimiento"
            class="btn btn-success"
            :disabled="emitiendoRecibo || loadingRecibo"
            @click="emitirRecibo"
          >
            {{ emitiendoRecibo ? "Emitiendo recibo..." : "Emitir recibo" }}
          </button>

          <button
            v-if="movimientoSeleccionado?.tipo === 'ingreso' && reciboMovimiento"
            class="btn btn-pdf"
            :disabled="descargandoRecibo"
            @click="descargarReciboPdf"
          >
            {{
              descargandoRecibo
                ? "Descargando recibo..."
                : (reciboMovimiento.estado === 'anulado'
                  ? `Recibo N ${String(reciboMovimiento.numero).padStart(6, '0')} Anulado`
                  : `Descargar recibo N ${String(reciboMovimiento.numero).padStart(6, '0')}`)
            }}
          </button>

          <button
            v-if="movimientoSeleccionado?.tipo === 'ingreso' && reciboMovimiento && reciboMovimiento.estado !== 'anulado'"
            class="btn btn-danger"
            :disabled="anulandoRecibo"
            @click="anularRecibo"
          >
            {{ anulandoRecibo ? "Anulando..." : "Anular recibo" }}
          </button>

          <button
            v-if="movimientoSeleccionado?.tipo === 'ingreso' && reciboMovimiento && reciboMovimiento.estado === 'anulado'"
            class="btn btn-success"
            :disabled="emitiendoRecibo || loadingRecibo"
            @click="abrirModalRecibo"
          >
            {{ emitiendoRecibo ? "Emitiendo recibo..." : "Emitir nuevo recibo" }}
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
            <p>{{ formatearFechaLibro(movimientoSeleccionado.fecha) }}</p>
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
            <label>Presupuestos asociados</label>
            <p>{{ getNumeroPresupuesto((movimientoSeleccionado.presupuestos_ids && movimientoSeleccionado.presupuestos_ids.length) ? movimientoSeleccionado.presupuestos_ids : movimientoSeleccionado.presupuesto_id) }}</p>
          </div>
          <div class="info-item" v-if="getCantidadCheques(movimientoSeleccionado)">
            <label>Cheques asociados</label>
            <p>{{ getResumenCheques(movimientoSeleccionado) }}</p>
          </div>
          <div class="info-item" v-if="getCantidadEcheqs(movimientoSeleccionado)">
            <label>eCheq asociados</label>
            <p>{{ getResumenEcheq(movimientoSeleccionado) }}</p>
          </div>
          <div class="info-item">
            <label>ID de movimiento</label>
            <p>#{{ movimientoSeleccionado.id }}</p>
          </div>
        </div>
      </div>

      <div v-if="movimientoSeleccionado?.tipo === 'ingreso'" class="detalle-card" style="margin-top: 16px;">
        <div class="section-heading">
          <div>
            <span class="section-kicker">Recibo</span>
            <h3>Estado del recibo</h3>
            <p>El recibo usa datos públicos y no muestra referencias internas del sistema.</p>
          </div>
        </div>

        <div v-if="loadingRecibo" class="empty-state">
          Consultando recibo...
        </div>

        <template v-else-if="reciboMovimiento">
          <div class="detalle-info-grid">
            <div class="info-item">
              <label>Numero</label>
              <p>{{ String(reciboMovimiento.numero).padStart(6, "0") }}</p>
            </div>
            <div class="info-item">
              <label>Estado</label>
              <p>{{ reciboMovimiento.estado }}</p>
            </div>
            <div v-if="reciboMovimiento.estado === 'anulado'" class="info-item">
              <label>Motivo de anulación</label>
              <p>{{ reciboMovimiento.motivo_anulacion || '-' }}</p>
            </div>
            <div v-if="reciboMovimiento.estado === 'anulado'" class="info-item">
              <label>Fecha anulación</label>
              <p>{{ reciboMovimiento.fecha_anulacion ? formatearFechaLibro(reciboMovimiento.fecha_anulacion) : '-' }}</p>
            </div>
            <div class="info-item">
              <label>Fecha emision</label>
              <p>{{ formatearFechaLibro(reciboMovimiento.fecha_emision) }}</p>
            </div>
            <div class="info-item">
              <label>Pagador</label>
              <p>{{ reciboMovimiento.pagador_nombre || '-' }}</p>
            </div>
            <div class="info-item">
              <label>Concepto público</label>
              <p>{{ reciboMovimiento.concepto_publico || '-' }}</p>
            </div>
          </div>

          <div v-if="recibosAnuladosMovimiento.length > 0" class="recibos-historial-shell">
            <div class="section-heading section-heading-inline recibos-historial-header">
              <div>
                <span class="section-kicker">Historial</span>
                <h3>Recibos anulados</h3>
              </div>
            </div>

            <div class="recibos-historial-list">
              <article v-for="reciboHist in recibosAnuladosMovimiento" :key="`historial-recibo-${reciboHist.id}`" class="recibo-historial-item">
                <div class="recibo-historial-copy">
                  <strong>{{ `Recibo N ${String(reciboHist.numero || 0).padStart(6, '0')} Anulado` }}</strong>
                  <p>{{ `Emitido: ${formatearFechaLibro(reciboHist.fecha_emision)} · Anulado: ${reciboHist.fecha_anulacion ? formatearFechaLibro(reciboHist.fecha_anulacion) : '-'}` }}</p>
                </div>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="descargandoRecibo"
                  @click="descargarReciboPdfPorId(reciboHist.id, reciboHist.numero)"
                >
                  Descargar recibo anulado
                </button>
              </article>
            </div>
          </div>
        </template>

        <div v-else class="empty-state">
          Este ingreso todavia no tiene recibo emitido.
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

  <div v-if="mostrarModalTransferenciaCheques" class="modal-overlay modal-overlay-front" @click.self="mostrarModalTransferenciaCheques = false">
    <div class="modal modal-confirmacion modal-transfer-cheques">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Libro de cheques</span>
          <h3>Transferir cheques de caja</h3>
          <p>Los cheques seleccionados saldran de {{ getLabelCaja(filtroCaja) }} y se agregaran como disponibles en la caja destino.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="mostrarModalTransferenciaCheques = false">×</button>
      </div>

      <div class="modal-form modal-form-transfer-cheques">
        <label class="form-group">
          <span>Caja destino *</span>
          <select v-model="transferenciaChequesForm.caja_destino">
            <option value="" disabled>Seleccionar</option>
            <option v-for="caja in CAJAS_DISPONIBLES.filter((item) => item.id !== filtroCaja)" :key="caja.id" :value="caja.id">
              {{ caja.label }}
            </option>
          </select>
        </label>

        <label class="form-group">
          <span>Fecha *</span>
          <input v-model="transferenciaChequesForm.fecha" type="date" />
        </label>

        <label class="form-group">
          <span>Detalle</span>
          <input v-model="transferenciaChequesForm.detalle" type="text" />
        </label>

        <label class="form-group">
          <span>Observaciones</span>
          <textarea v-model="transferenciaChequesForm.observaciones" rows="2" />
        </label>

        <div class="form-group">
          <span>Cheques disponibles *</span>
          <div class="cheques-transfer-list">
            <label v-for="item in chequesTransferibles" :key="`tr-${item.id}`" class="cheque-transfer-item">
              <input v-model="transferenciaChequesForm.cheques_ids" type="checkbox" :value="item.id" />
              <span>#{{ item.numero_cheque }} · {{ item.banco || '-' }} · {{ formatoMoneda(item.importe || 0) }}</span>
            </label>
            <small v-if="!chequesTransferibles.length" class="form-help">No hay cheques disponibles para transferir.</small>
          </div>
        </div>

        <div class="transfer-cheques-total">
          <span>Total seleccionado</span>
          <strong>{{ formatoMoneda(totalTransferenciaCheques || 0) }}</strong>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-primary" :disabled="transferiendoCheques" @click="confirmarTransferenciaCheques">
            {{ transferiendoCheques ? "Transfiriendo..." : "Confirmar transferencia" }}
          </button>
          <button type="button" class="btn-secondary" :disabled="transferiendoCheques" @click="mostrarModalTransferenciaCheques = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="mostrarModalControlSemanal" class="modal-overlay modal-overlay-front" @click.self="mostrarModalControlSemanal = false">
    <div class="modal modal-confirmacion modal-transfer-cheques">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Caja semanal</span>
          <h3>Control semanal inicial</h3>
          <p>Definí efectivo y cheques controlados para iniciar la semana.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="mostrarModalControlSemanal = false">×</button>
      </div>

      <div class="modal-form modal-form-transfer-cheques">
        <label class="form-group">
          <span>Efectivo inicial</span>
          <input v-model.number="controlSemanalEfectivo" type="number" step="0.01" min="0" />
        </label>

        <label class="form-group">
          <span>Detalle</span>
          <input v-model="controlSemanalDetalle" type="text" />
        </label>

        <label class="form-group">
          <span>Observaciones</span>
          <textarea v-model="controlSemanalObservaciones" rows="2" />
        </label>

        <div class="form-group">
          <div class="cheques-transfer-toolbar cheques-transfer-toolbar-control">
            <div class="cheques-transfer-toolbar-copy">
              <span class="cheques-transfer-toolbar-title">Cheques disponibles de la semana anterior</span>
              <small class="cheques-transfer-toolbar-meta">
                {{ chequesControlSemanalSeleccionados.length }} de {{ chequesControlSemanalCandidatos.length }} seleccionados
              </small>
            </div>
            <button type="button" class="btn btn-secondary btn-sm cheques-transfer-toolbar-btn" @click="toggleSeleccionTodosChequesControl">
              {{ todosChequesControlSeleccionados ? "Deseleccionar todos" : "Seleccionar todos" }}
            </button>
          </div>
          <div class="cheques-transfer-list">
            <label v-for="item in chequesControlSemanalCandidatos" :key="`control-${item.id}`" class="cheque-transfer-item">
              <input v-model="chequesControlSemanalSeleccionados" type="checkbox" :value="Number(item.id)" />
              <span>#{{ item.numero_cheque || '-' }} · {{ item.banco || '-' }} · {{ formatoMoneda(item.importe || 0) }}</span>
            </label>
            <small v-if="!chequesControlSemanalCandidatos.length" class="form-help">No hay cheques disponibles de la semana anterior.</small>
          </div>
        </div>

        <div class="transfer-cheques-total">
          <span>Total cheques seleccionados</span>
          <strong>{{ formatoMoneda(totalChequesControlSemanal || 0) }}</strong>
        </div>

        <div class="transfer-cheques-total">
          <span>Total control semanal</span>
          <strong>{{ formatoMoneda(totalControlSemanal || 0) }}</strong>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-primary" :disabled="guardandoControlSemanal" @click="guardarControlSemanal">
            {{ guardandoControlSemanal ? "Guardando..." : "Guardar control semanal" }}
          </button>
          <button type="button" class="btn-secondary" :disabled="guardandoControlSemanal" @click="mostrarModalControlSemanal = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

  <div v-if="mostrarModalAsignaciones" class="modal-overlay modal-overlay-front" @click.self="mostrarModalAsignaciones = false">
    <div class="modal modal-confirmacion modal-asignaciones-presupuestos">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Imputacion</span>
          <h3>Asignar monto por presupuesto</h3>
          <p>Podes asignar menos que el monto total. La diferencia queda como saldo a favor del cliente.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="mostrarModalAsignaciones = false">×</button>
      </div>

      <div class="modal-form modal-form-asignaciones">
        <div class="asignaciones-grid">
          <div v-for="item in asignacionesDraft" :key="item.presupuesto_id" class="asignacion-presupuesto-card">
            <div class="asignacion-presupuesto-head">
              <strong>{{ getNumeroPresupuesto(item.presupuesto_id) }}</strong>
              <span>Pendiente: {{ formatoMoneda(getMontoPendientePresupuesto(item.presupuesto_id)) }}</span>
              <span>Total: {{ formatoMoneda(getMontoTotalPresupuesto(item.presupuesto_id)) }}</span>
            </div>
            <div class="asignacion-presupuesto-controls">
              <input v-model.number="item.monto_asignado" type="number" step="0.01" @wheel.prevent />
              <button type="button" class="btn btn-ghost btn-sm" @click="aplicarMontoPresupuestoEnDraft(item.presupuesto_id, 'pendiente')">
                Usar pendiente
              </button>
              <button type="button" class="btn btn-ghost btn-sm" @click="aplicarMontoPresupuestoEnDraft(item.presupuesto_id, 'total')">
                Usar total
              </button>
            </div>
          </div>
        </div>

        <div class="asignaciones-resumen">
          <span>Total asignado: <strong>{{ formatoMoneda(totalAsignadoPresupuestosDraft || 0) }}</strong></span>
          <span :class="Number(diferenciaAsignacionesDraft || 0) >= -0.01 ? 'ok' : 'warn'">
            Diferencia: {{ formatoMoneda(diferenciaAsignacionesDraft || 0) }}
          </span>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-primary" @click="aplicarAsignacionesPresupuestos">Aplicar</button>
          <button type="button" class="btn-secondary" @click="mostrarModalAsignaciones = false">Cancelar</button>
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

              <div class="form-row form-row-secondary">
            <label class="form-group form-card-field">
              <span>Categoría</span>
                  <select v-model="form.categoria_id" @change="onCategoriaSelectChange">
                    <option value="">Sin categoría</option>
                    <option v-for="cat in categoriasFormulario" :key="cat.id" :value="String(cat.id)">
                      {{ cat.nombre }}
                    </option>
                    <option :value="NUEVA_CATEGORIA_OPTION">+ Agregar otra categoría</option>
              </select>
            </label>
            <label class="form-group form-card-field" v-if="esIngreso">
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

          <div class="form-row form-row-secondary">
            <label class="form-group form-card-field">
              <span>Cliente (opcional)</span>
              <select v-model="form.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ getEtiquetaCliente(cliente) }}
                </option>
              </select>
            </label>
            <div v-if="esIngreso && form.cliente_id" class="form-group form-card-field">
              <span>Presupuestos (opcional)</span>
              <div v-if="presupuestosDisponibles.length" class="presupuestos-checklist">
                <label v-for="pres in presupuestosDisponibles" :key="pres.id" class="presupuesto-check-item">
                  <input v-model="form.presupuesto_ids" type="checkbox" :value="String(pres.id)" />
                  <span>#{{ pres.numero }} · {{ formatoMoneda(Number(pres.saldo_pendiente_cobro || 0)) }} pendiente</span>
                </label>
              </div>
              <small v-else class="form-help">No hay presupuestos para el cliente seleccionado.</small>
              <small class="form-help">Podes asociar uno o más presupuestos del cliente seleccionado.</small>
              <div v-if="(form.presupuesto_ids || []).length > 0" class="presupuesto-asignacion-actions">
                <button type="button" class="btn btn-ghost" @click="abrirModalAsignacionesPresupuestos">
                  Imputar montos por presupuesto
                </button>
                <small v-if="(form.presupuestos_asignaciones || []).length">
                  Asignado: {{ formatoMoneda((form.presupuestos_asignaciones || []).reduce((acc, item) => acc + Number(item?.monto_asignado || 0), 0)) }} / {{ formatoMoneda(form.monto_total || 0) }}
                </small>
              </div>
            </div>
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
                  <div class="cheques-libro-opciones">
                    <label class="check-inline">
                      <input v-model="form.usar_cheques_libro" type="checkbox" />
                      <span>Usar cheques del libro</span>
                    </label>
                    <label class="check-inline">
                      <input v-model="form.usar_echeqs_libro" type="checkbox" />
                      <span>Usar eCheqs del libro</span>
                    </label>
                  </div>

                  <div v-if="usaLibroCualquiera" class="cheques-libro-egreso-grid">
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
                    <div class="cheques-libro-subtitulo">
                      <span class="section-kicker">Cheques físicos</span>
                      <span class="cheques-libro-count">{{ chequesDisponiblesLibroFisicos.length }} disponible(s)</span>
                    </div>
                    <label
                      v-for="item in chequesDisponiblesLibroFisicos"
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
                    <p v-if="!chequesDisponiblesLibroFisicos.length" class="cheques-libro-empty">
                      No hay cheques físicos disponibles para esta caja.
                    </p>
                  </div>

                  <div v-if="form.usar_echeqs_libro" class="cheques-libro-lista">
                    <div class="cheques-libro-subtitulo">
                      <span class="section-kicker">eCheqs</span>
                      <span class="cheques-libro-count">{{ chequesDisponiblesLibroEcheqs.length }} disponible(s)</span>
                    </div>
                    <label
                      v-for="item in chequesDisponiblesLibroEcheqs"
                      :key="item.id"
                      class="cheque-disponible-item"
                    >
                      <input v-model="form.cheques_salida" :value="item.id" type="checkbox" class="cheque-disponible-check" />
                      <span class="cheque-disponible-main">
                        <strong>#{{ item.numero_cheque || '-' }}</strong>
                        <em>{{ formatoMoneda(item.importe || 0) }}</em>
                      </span>
                      <span class="cheque-disponible-meta">
                        {{ capitalizarInicial(item.banco) || '-' }} · {{ capitalizarInicial(item.librador_endosante) || '-' }} · F. eCheq {{ formatearFechaLibro(item.fecha_cheque) }}
                      </span>
                    </label>
                    <p v-if="!chequesDisponiblesLibroEcheqs.length" class="cheques-libro-empty">
                      No hay eCheqs disponibles para esta caja.
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
                    <label v-if="esIngreso && cheque.medio_pago !== 'echeq'" class="form-group form-card-field">
                      <span>Numero cheque *</span>
                      <input v-model="cheque.numero_cheque" type="text" placeholder="Numero de cheque" />
                    </label>
                    <label v-if="esIngreso && cheque.medio_pago !== 'echeq'" class="form-group form-card-field">
                      <span>Librador o endosante *</span>
                      <input v-model="cheque.librador_endosante" type="text" placeholder="Nombre" />
                    </label>
                    <label v-if="esIngreso && cheque.medio_pago !== 'echeq'" class="form-group form-card-field">
                      <span>Banco *</span>
                      <input v-model="cheque.banco" type="text" placeholder="Banco emisor" />
                    </label>
                    <label v-if="esIngreso && cheque.medio_pago !== 'echeq'" class="form-group form-card-field">
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
  <div v-if="mostrarModalAbrirSemana" class="modal-overlay" @click.self="mostrarModalAbrirSemana = false">
    <div class="modal modal-confirmacion">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Inicio de periodo</span>
          <h3>Abrir caja semanal</h3>
          <p>La caja queda abierta desde esta fecha y se cierra cuando presiones Cerrar semana.</p>
        </div>
        <button type="button" class="btn-close" @click="mostrarModalAbrirSemana = false">×</button>
      </div>

      <div class="modal-form">
        <label class="form-group form-card-field form-card-field-accent">
          <span>Fecha de apertura *</span>
          <input v-model="formAbrirSemana.fecha_inicio" type="date" />
        </label>

        <div class="modal-actions">
          <button type="button" class="btn btn-primary" :disabled="abriendoSemana" @click="confirmarAbrirSemana">
            {{ abriendoSemana ? "Abriendo..." : "Abrir semana" }}
          </button>
          <button type="button" class="btn btn-secondary" :disabled="abriendoSemana" @click="mostrarModalAbrirSemana = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal para cerrar semana y registrar banco -->
  <div v-if="mostrarModalCerrarSemana" class="modal-overlay" @click.self="mostrarModalCerrarSemana = false">
    <div class="modal modal-confirmacion">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Cierre de periodo</span>
          <h3>Cerrar semana actual</h3>
          <p>Se bloquearán los movimientos de esta semana. La próxima semana la abrís manualmente cuando quieras.</p>
        </div>
        <button type="button" class="btn-close" @click="mostrarModalCerrarSemana = false">×</button>
      </div>

      <div class="modal-form">
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

  <!-- Modal para emitir recibo -->
  <div v-if="mostrarModalRecibo" class="modal-overlay" @click.self="mostrarModalRecibo = false">
    <div class="modal modal-confirmacion modal-recibo">
      <div class="modal-header modal-header-confirmacion">
        <div class="modal-header-copy">
          <span class="section-kicker">Emision de recibos</span>
          <h3>Emitir recibo numerado</h3>
          <p>Completa los datos del recibo que se va a emitir.</p>
        </div>
        <button type="button" class="btn-close" aria-label="Cerrar modal" @click="mostrarModalRecibo = false">×</button>
      </div>

      <div class="modal-form modal-form-recibo">
        <div class="form-group">
          <label for="pagador">Pagador *</label>
          <input
            id="pagador"
            v-model="formRecibo.pagador_nombre"
            type="text"
            placeholder="Nombre del pagador"
            class="form-control"
          />
        </div>

        <div class="form-group">
          <label>Concepto del recibo *</label>
          <div class="radio-group">
            <label class="radio-option">
              <input v-model="formRecibo.conceptoTipo" type="radio" value="manual" />
              <span>Ingresar concepto manualmente</span>
            </label>
            <label class="radio-option" v-if="presupuestosMovimiento.length > 0">
              <input v-model="formRecibo.conceptoTipo" type="radio" value="presupuestos" />
              <span>Usar presupuestos asociados</span>
            </label>
          </div>
        </div>

        <div v-if="formRecibo.conceptoTipo === 'manual'" class="form-group">
          <input
            v-model="formRecibo.concepto_publico"
            type="text"
            placeholder="Concepto publico"
            class="form-control"
          />
        </div>

        <div v-if="formRecibo.conceptoTipo === 'presupuestos' && presupuestosMovimiento.length > 0" class="form-group">
          <div class="presupuestos-automaticos">
            <small style="color: #93c5fd; font-weight: 600; display: block; margin-bottom: 0.5rem;">Selecciona los presupuestos para el concepto:</small>
            <div class="presupuestos-lista">
              <label v-for="presupuesto in presupuestosMovimiento" :key="presupuesto.id" class="presupuesto-checkbox">
                <input
                  :value="presupuesto.id"
                  type="checkbox"
                  v-model="formRecibo.presupuestosSeleccionados"
                />
                <span>{{ `Presupuesto #${presupuesto.numero} - ${presupuesto.cliente}` }}</span>
              </label>
            </div>
          </div>
          
          <!-- Mostrar preview del concepto que se va a generar -->
          <div v-if="formRecibo.presupuestosSeleccionados.length > 0" style="margin-top: 0.75rem; padding: 0.75rem; background: #1e293b; border: 1.5px solid #475569; border-radius: 0.6rem;">
            <small style="color: #93c5fd; font-weight: 600;">Concepto que se generará:</small>
            <div style="color: #ffffff; margin-top: 0.25rem;">
              {{ generarConceptoPresupuestos() }}
            </div>
          </div>
        </div>

        <div v-if="presupuestosMovimiento.length > 0" class="form-group">
          <label class="presupuesto-checkbox" style="margin-bottom: 0;">
            <input
              v-model="formRecibo.incluir_saldos_presupuestos"
              type="checkbox"
            />
            <span>Incluir en el PDF el saldo restante por presupuesto (debajo del total)</span>
          </label>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones publicas</label>
          <textarea
            id="observaciones"
            v-model="formRecibo.observaciones_publicas"
            placeholder="Observaciones (opcional)"
            class="form-control"
            rows="2"
          ></textarea>
        </div>

        <div class="modal-actions">
          <button
            type="button"
            class="btn-primary"
            :disabled="emitiendoRecibo"
            @click="guardarRecibo"
          >
            {{ emitiendoRecibo ? "Emitiendo recibo..." : "Emitir recibo" }}
          </button>
          <button type="button" class="btn-secondary" :disabled="emitiendoRecibo" @click="mostrarModalRecibo = false">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  </div>

<!-- Modal Gestión de Categorías -->
<div v-if="mostrarModalCategorias" class="modal-overlay" @click="mostrarModalCategorias = false">
  <div class="modal-categorias" @click.stop>
    <button class="modal-close" @click="mostrarModalCategorias = false">✕</button>
    <h2>Gestionar Categorías</h2>

    <!-- Formulario para agregar/editar -->
    <div class="form-categoria">
      <select v-model="formCategoria.tipo" class="input-categoria">
        <option value="ingreso">Categoría de ingreso</option>
        <option value="egreso">Categoría de egreso</option>
      </select>
      <input
        v-model="formCategoria.nombre"
        placeholder="Nombre de la categoría"
        class="input-categoria"
      />
      <textarea
        v-model="formCategoria.descripcion"
        placeholder="Descripción (opcional)"
        class="textarea-categoria"
        rows="4"
      ></textarea>
      <div class="botones-form">
        <button @click="guardarCategoria" :disabled="guardandoCategoria" class="btn btn-primary btn-guardar">
          {{ editandoCategoria ? "Actualizar" : "Agregar Categoría" }}
        </button>
        <button
          v-if="editandoCategoria"
          @click="cancelarEdicionCategoria"
          class="btn btn-secondary btn-cancelar"
        >
          Cancelar
        </button>
      </div>
    </div>

    <!-- Listado de categorías -->
    <div class="categorias-lista">
      <div v-if="categoriasModal.length === 0" class="sin-categorias">
        No hay categorías aún
      </div>
      <div v-else class="categorias-grupos">
        <section class="categorias-grupo">
          <div class="categorias-grupo-head">
            <h4>Ingreso</h4>
            <span class="categoria-tipo-chip">{{ categoriasModalIngreso.length }}</span>
          </div>
          <div class="categorias-grupo-body">
            <div v-if="categoriasModalIngreso.length === 0" class="sin-categorias">No hay categorías de ingreso</div>
            <div v-else class="items-categorias">
              <div v-for="cat in categoriasModalIngreso" :key="`cat-ingreso-${cat.id}`" class="categoria-item">
                <div class="categoria-info">
                  <strong>{{ cat.nombre }}</strong>
                  <p v-if="cat.descripcion" class="categoria-desc">{{ cat.descripcion }}</p>
                </div>
                <div class="categoria-acciones">
                  <button @click="editarCategoria(cat)" class="btn-editar">Editar</button>
                  <button
                    @click="eliminarCategoria(cat)"
                    :disabled="eliminandoCategoria"
                    class="btn-eliminar"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="categorias-grupo">
          <div class="categorias-grupo-head">
            <h4>Egreso</h4>
            <span class="categoria-tipo-chip">{{ categoriasModalEgreso.length }}</span>
          </div>
          <div class="categorias-grupo-body">
            <div v-if="categoriasModalEgreso.length === 0" class="sin-categorias">No hay categorías de egreso</div>
            <div v-else class="items-categorias">
              <div v-for="cat in categoriasModalEgreso" :key="`cat-egreso-${cat.id}`" class="categoria-item">
                <div class="categoria-info">
                  <strong>{{ cat.nombre }}</strong>
                  <p v-if="cat.descripcion" class="categoria-desc">{{ cat.descripcion }}</p>
                </div>
                <div class="categoria-acciones">
                  <button @click="editarCategoria(cat)" class="btn-editar">Editar</button>
                  <button
                    @click="eliminarCategoria(cat)"
                    :disabled="eliminandoCategoria"
                    class="btn-eliminar"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>

</template>
<style scoped>
.caja-toolbar-shell {
  margin-top: 1rem;
  margin-bottom: 1rem;
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

.caja-toolbar-shell .toolbar.toolbar-caja {
  display: grid;
}

.caja-toolbar-shell .toolbar-caja.toolbar-caja-main {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.9rem;
}

.toolbar-filters-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1.5fr) repeat(5, minmax(140px, 1fr));
  gap: 0.8rem;
  align-items: end;
  width: 100%;
}

.toolbar-filters-grid .toolbar-search {
  grid-column: span 1;
  min-width: 0;
}

.toolbar-filters-grid .toolbar-filter-label {
  width: 100%;
}

.toolbar-actions-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.7rem;
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

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  padding: 0.75rem;
  border-radius: 0.5rem;
  transition: background-color 0.2s, border-color 0.2s;
  border: 1.5px solid transparent;
}

.radio-option:hover {
  background-color: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}

.radio-option input[type="radio"] {
  cursor: pointer;
  width: 18px;
  height: 18px;
  min-width: 18px;
  accent-color: #3b82f6;
}

.presupuestos-lista {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
  padding: 1rem;
  border: 1.5px solid #475569;
  border-radius: 0.6rem;
  background-color: #1e293b;
}

.presupuesto-checkbox {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  padding: 0.75rem;
  border-radius: 0.4rem;
  transition: background-color 0.2s, border-color 0.2s;
  user-select: none;
  background-color: #2d3748;
  border: 1px solid #475569;
}

.presupuesto-checkbox:hover {
  background-color: #374151;
  border-color: #64748b;
}

.presupuesto-checkbox input[type="checkbox"] {
  cursor: pointer;
  width: 18px;
  height: 18px;
  min-width: 18px;
  accent-color: #3b82f6;
}

.presupuesto-checkbox span {
  color: #ffffff;
  font-size: 0.95rem;
  font-weight: 500;
}

.presupuestos-automaticos {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background-color: #0f172a;
  border: 1.5px solid #475569;
  border-radius: 0.6rem;
}

.presupuesto-item {
  padding: 0.75rem;
  background-color: #ffffff;
  border-radius: 0.4rem;
  border: 1px solid #bfdbfe;
  color: #1e293b;
  font-size: 0.95rem;
}

.modal-form-recibo {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.95rem;
  font-weight: 600;
  color: #1e293b;
}

.form-control {
  padding: 0.75rem;
  border: 1.5px solid #cbd5e1;
  border-radius: 0.5rem;
  font-size: 0.95rem;
  font-family: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
  background-color: #ffffff;
  color: #1e293b;
}

.form-control::placeholder {
  color: #94a3b8;
}

.form-control:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
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
  margin-bottom: 1rem;
  padding: 1rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(59, 130, 246, 0.25);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.55), rgba(15, 23, 42, 0.65));
  overflow: hidden;
}

.caja-bank-inline-shell + .caja-toolbar-shell {
  margin-top: 0;
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
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.8rem;
}

.caja-bank-inline-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 0.85rem;
}

.caja-bank-inline-actions .btn {
  min-width: 170px;
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

.btn-week-open {
  background: linear-gradient(135deg, #16a34a, #15803d);
  color: #ecfdf5;
  border-color: rgba(74, 222, 128, 0.42);
}

.btn-week-open:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 10px 18px rgba(22, 163, 74, 0.28);
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
  margin-top: -3rem;
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

.badge-info {
  background: rgba(96, 165, 250, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(96, 165, 250, 0.35);
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

.empty .btn {
  margin-top: 0.8rem;
}

.empty strong {
  color: #e2e8f0;
}

.cheques-transfer-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.5rem;
}

.cheques-transfer-toolbar-copy {
  display: grid;
  gap: 0.22rem;
}

.cheques-transfer-toolbar-title {
  color: #e2e8f0;
  font-weight: 700;
  font-size: 0.93rem;
}

.cheques-transfer-toolbar-meta {
  color: #94a3b8;
  font-size: 0.78rem;
}

.cheques-transfer-toolbar-control {
  padding: 0.7rem 0.8rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.52));
}

.cheques-transfer-toolbar-btn {
  white-space: nowrap;
}

@media (max-width: 640px) {
  .cheques-transfer-toolbar-control {
    flex-direction: column;
    align-items: stretch;
  }

  .cheques-transfer-toolbar-btn {
    width: 100%;
  }
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

.caja-medios-shell {
  margin-top: 0;
  margin-bottom: 1rem;
}

.caja-medios-shell + .caja-list-shell-compact {
  margin-top: 0;
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

.recibos-historial-shell {
  margin-top: 1rem;
  display: grid;
  gap: 0.75rem;
}

.recibos-historial-header {
  margin-bottom: 0;
}

.recibos-historial-list {
  display: grid;
  gap: 0.7rem;
}

.recibo-historial-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.9rem;
  padding: 0.9rem 1rem;
  border-radius: 0.9rem;
  border: 1px solid rgba(248, 113, 113, 0.24);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.12), rgba(15, 23, 42, 0.72));
}

.recibo-historial-copy {
  display: grid;
  gap: 0.25rem;
}

.recibo-historial-copy strong {
  color: #fecaca;
}

.recibo-historial-copy p {
  margin: 0;
  color: #cbd5e1;
  font-size: 0.88rem;
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

.presupuestos-checklist {
  display: grid;
  gap: 0.4rem;
  max-height: 10rem;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.55rem;
  padding: 0.55rem;
  background: rgba(15, 23, 42, 0.42);
}

.presupuesto-check-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #cbd5e1;
  font-size: 0.9rem;
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

.cheques-libro-opciones {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.cheques-libro-subtitulo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.6rem;
  background: rgba(30, 41, 59, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.cheques-libro-count {
  color: #94a3b8;
  font-size: 0.8rem;
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

.modal-overlay-front {
  z-index: 1300;
}

.modal {
  background-color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 95%;
  max-width: 1200px;
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
  width: min(92vw, 1000px);
  max-width: 1000px;
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

.modal-transfer-cheques {
  width: min(96vw, 920px);
  max-width: 920px;
  border-color: rgba(148, 163, 184, 0.22);
  background: #0f172a;
}

.modal-form-transfer-cheques {
  padding: 1.1rem 1.35rem 1.35rem;
  gap: 0.85rem;
}

.modal-form-transfer-cheques .form-group textarea {
  padding: 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.9375rem;
  resize: vertical;
  min-height: 72px;
}

.modal-form-transfer-cheques .form-group textarea:focus {
  outline: none;
  border-color: #3b82f6;
  background-color: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.cheques-transfer-list {
  max-height: 300px;
  overflow: auto;
  padding: 0.4rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.52);
  display: grid;
  gap: 0.5rem;
}

.cheque-transfer-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: center;
  padding: 0.65rem 0.7rem;
  border-radius: 0.65rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.55);
}

.cheque-transfer-item:hover {
  border-color: rgba(125, 211, 252, 0.34);
  background: rgba(30, 41, 59, 0.75);
}

.cheque-transfer-item span {
  color: #e2e8f0;
  font-size: 0.92rem;
  line-height: 1.4;
}

.transfer-cheques-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(96, 165, 250, 0.2);
  background: rgba(30, 64, 175, 0.16);
  color: #bfdbfe;
}

.transfer-cheques-total strong {
  color: #f8fafc;
}

.modal-asignaciones-presupuestos {
  width: min(92vw, 700px);
  max-width: 700px;
  border-color: rgba(96, 165, 250, 0.22);
  background: #0f172a;
}

.modal-form-asignaciones {
  padding: 1.05rem 1.25rem 1.3rem;
  gap: 0.95rem;
}

.asignaciones-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.8rem;
}

.asignacion-presupuesto-card {
  display: grid;
  gap: 0.7rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.52);
}

.asignacion-presupuesto-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.85rem;
  align-items: baseline;
}

.asignacion-presupuesto-head strong {
  color: #f8fafc;
  font-size: 0.96rem;
}

.asignacion-presupuesto-head span {
  font-size: 0.82rem;
  color: #cbd5e1;
}

.asignacion-presupuesto-controls {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto auto;
  gap: 0.55rem;
  align-items: center;
}

.asignacion-presupuesto-controls input {
  min-height: 2.6rem;
  font-weight: 600;
  padding: 0.65rem 0.75rem;
  background-color: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.5rem;
  color: #e2e8f0;
}

.asignacion-presupuesto-controls input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn-sm {
  padding: 0.48rem 0.72rem;
  font-size: 0.82rem;
}

.asignaciones-resumen {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.72rem 0.85rem;
  border-radius: 0.72rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(15, 23, 42, 0.64);
  color: #cbd5e1;
}

.asignaciones-resumen .ok {
  color: #86efac;
  font-weight: 600;
}

.asignaciones-resumen .warn {
  color: #fda4af;
  font-weight: 600;
}

.presupuesto-asignacion-actions {
  margin-top: 0.6rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
  align-items: center;
}

.presupuesto-asignacion-actions small {
  color: #93c5fd;
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

@media (max-width: 1750px) {
  .cheques-libro-lista {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }

  .caja-bank-inline-grid {
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));;
  }

  .toolbar-filters-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .toolbar-filters-grid .toolbar-search{
    grid-column: 1 / -1;
  }

  .toolbar-actions-row{
    justify-content: flex-start;
  }
}

@media (max-width: 1200px){
  .toolbar-filters-grid{
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .toolbar-filters-grid .toolbar-search{
    grid-column: 1 / -1;
  }
}

@media (max-width: 980px){
  .toolbar-filters-grid{
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .toolbar-filters-grid .toolbar-search{
    grid-column: 1 / -1;
  }

  .toolbar-actions-row .btn {
    justify-content: flex-start;
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

  .toolbar-filters-grid {
    grid-template-columns: 1fr;
  }

  .toolbar-filters-grid .toolbar-search {
    grid-column: span 1;
  }

  .toolbar-actions-row {
    justify-content: stretch;
  }

  .toolbar-actions-row .btn {
    width: 100%;
  }

  .caja-bank-inline-grid {
    grid-template-columns: 1fr;
  }

  .caja-bank-inline-actions {
    width: 100%;
    justify-content: stretch;
  }

  .caja-bank-inline-actions .btn {
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

  .modal-actions {
    flex-direction: column;
  }

  .asignaciones-grid {
    grid-template-columns: 1fr;
  }

  .asignacion-presupuesto-controls {
    grid-template-columns: 1fr;
  }
}


.btn-categorias {
  min-width: 170px;
}

.modal-categorias {
  position: relative;
  width: min(96vw, 980px);
  max-width: 980px;
  border-radius: 1.15rem;
  border: 1px solid rgba(96, 165, 250, 0.2);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  padding: 0;
  max-height: 92vh;
  overflow: hidden;
  box-shadow: 0 32px 55px rgba(2, 6, 23, 0.48);
}

.modal-close {
  position: absolute;
  top: 0.95rem;
  right: 1rem;
  background: rgba(30, 41, 59, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #e2e8f0;
  font-size: 1.1rem;
  cursor: pointer;
  width: 2rem;
  height: 2rem;
  border-radius: 0.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: all 0.2s ease;
}

.modal-close:hover {
  color: #ffffff;
  border-color: rgba(147, 197, 253, 0.45);
  background: rgba(30, 64, 175, 0.35);
}

.modal-categorias h2 {
  color: #dbeafe;
  margin-bottom: 1.25rem;
  margin-top: 0;
  font-size: 18px;
  padding: 1.4rem 1.55rem 0.75rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.modal-categorias h3 {
  color: #cbd5e1;
  font-size: 13px;
  margin-top: 1.25rem;
  margin-bottom: 0.75rem;
  padding: 0 1.4rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.form-categoria {
  padding: 1.4rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.input-categoria,
.textarea-categoria {
  width: 100%;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #ffffff;
  padding: 0.7rem 0.9rem;
  border-radius: 0.5rem;
  font-family: inherit;
  font-size: 13px;
  margin-bottom: 0.75rem;
  box-sizing: border-box;
  transition: all 0.2s ease;
}

.input-categoria:focus,
.textarea-categoria:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  background: #0f172a;
}

.textarea-categoria {
  resize: none;
  min-height: 92px;
  height: 92px;
  max-height: 92px;
  overflow-y: auto;
}

.botones-form {
  display: flex;
  gap: 0.75rem;
}

.btn-guardar {
  flex: 1;
  min-height: 2.65rem;
}

.btn-guardar:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


.btn-cancelar {
  margin-top: 0;
  min-height: 2.65rem;
}

.btn-cancelar:hover {
  background: rgba(71, 85, 105, 0.9);
}

.categorias-lista {
  padding: 0.95rem 1.2rem 1.1rem;
  height: 46vh;
  min-height: 320px;
  overflow: hidden;
}

.sin-categorias {
  text-align: center;
  color: #94a3b8;
  padding: 1.5rem;
  font-size: 13px;
}

.items-categorias {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.categorias-grupos {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  height: 100%;
  align-items: stretch;
}

.categorias-grupo {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.6rem;
  min-height: 0;
  overflow: hidden;
  padding: 0.9rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.48);
}

.categorias-grupo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.categorias-grupo-head h4 {
  margin: 0;
  color: #cbd5e1;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.categorias-grupo-body {
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.35rem;
  padding-bottom: 0.7rem;
  scrollbar-gutter: stable;
}

@media (max-width: 980px) {
  .categorias-lista {
    height: auto;
    max-height: 52vh;
    overflow-y: auto;
  }

  .categorias-grupos {
    grid-template-columns: 1fr;
    height: auto;
  }

  .categorias-grupo {
    max-height: 28vh;
  }
}

.categoria-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.5);
  gap: 1rem;
  transition: all 0.2s ease;
}

.categoria-item:hover {
  background: rgba(15, 23, 42, 0.8);
  border-color: rgba(59, 130, 246, 0.3);
}

.categoria-info {
  flex: 1;
  min-width: 0;
}

.categoria-info strong {
  color: #dbeafe;
  display: block;
  margin-bottom: 0.25rem;
  font-size: 13px;
  font-weight: 600;
}

.categoria-tipo-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(30, 64, 175, 0.22);
  color: #bfdbfe;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.categoria-desc {
  color: #94a3b8;
  font-size: 11px;
  margin: 0;
}

.categoria-acciones {
  display: flex;
  gap: 0.5rem;
  flex-wrap: nowrap;
}

.btn-editar,
.btn-eliminar {
  border: none;
  padding: 0.5rem 0.8rem;
  border-radius: 0.4rem;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-editar {
  background: rgba(59, 130, 246, 0.7);
  color: white;
}

.btn-editar:hover {
  background: #3b82f6;
  transform: translateY(-1px);
}

.btn-eliminar {
  background: rgba(239, 68, 68, 0.7);
  color: white;
}

.btn-eliminar:hover:not(:disabled) {
  background: #dc2626;
  transform: translateY(-1px);
}

.btn-eliminar:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


</style>
