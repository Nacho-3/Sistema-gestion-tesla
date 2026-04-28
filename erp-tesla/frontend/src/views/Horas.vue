<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'
import { formatHoursAsClock, parseHoursInput } from "../utils/hourFormat"

// Estado
const horas = ref([])
const empleados = ref([])
const clientes = ref([])
const obras = ref([])
const grupos = ref([])
const loadingHoras = ref(false)
const loadingResumen = ref(false)
const saving = ref(false)
const error = ref("")
const activeTab = ref("carga") // "carga" o "resumen"
const modalidadCarga = ref("diaria") // "diaria" o "rango"
const modoDiaria = ref("cantidad") // "cantidad" o "horario"
const modoRango = ref("cantidad")  // "cantidad" o "horario"
const showFormDiaria = ref(false)
const showFormRango = ref(false)
const editingId = ref(null)
const expandedEmpleadosHoras = ref(new Set())
const expandedPrestadas = ref(new Set())
const selectEmpleadoDiariaRef = ref(null)
const selectEmpleadoRangoRef = ref(null)
const inputCantidadDiariaRef = ref(null)
const inputHoraInicioDiariaRef = ref(null)
const cargaDiariaMultiple = ref(false)
const empleadosMultiplesDiaria = ref([])
const cargaRangoMultiple = ref(false)
const empleadosMultiplesRango = ref([])
const conflictoCargaRangoVisible = ref(false)
const conflictoCargaRangoResumen = ref([])
const conflictoCargaRangoTotal = ref(0)

const ULTIMA_CARGA_STORAGE_KEY = "tesla-horas-ultima-carga"
let ctrlShortcutArmed = false
let ctrlShortcutComboUsed = false
let focoModalDiaria = "empleado"

// Filtros
const filtroMes = ref(new Date().getMonth() + 1)
const filtroAnio = ref(new Date().getFullYear())
const filtroEmpleado = ref("")
const filtroObra = ref("")
const nombresMes = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const ADMIN_GROUP_REGEX = /admin/i

const normalizeToNonSunday = (date) => {
  const nextDate = new Date(date)
  if (nextDate.getDay() === 0) {
    nextDate.setDate(nextDate.getDate() + 1)
  }
  return nextDate
}

const getTodayInputDate = () => {
  const now = normalizeToNonSunday(new Date())
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const createEmptyFormDiaria = (overrides = {}) => ({
  empleado_id: "",
  cliente_id: "",
  obra_id: "",
  fecha: getTodayInputDate(),
  hora_inicio: "",
  hora_fin: "",
  cantidad_horas: "",
  cantidad_horas_extra: "",
  cantidad_horas_extra_50: "",
  cantidad_horas_extra_100: "",
  es_hora_extra: false,
  tipo_hora_extra: "",
  observaciones: "",
  es_prestada: false,
  grupo_origen_id: "",
  grupo_destino_id: "",
  ...overrides,
})

const createEmptyFormRango = (overrides = {}) => ({
  empleado_id: "",
  cliente_id: "",
  obra_id: "",
  fecha_desde: getTodayInputDate(),
  fecha_hasta: getTodayInputDate(),
  cantidad_horas: "",
  horas_por_dia: "",
  cantidad_horas_extra: "",
  cantidad_horas_extra_50: "",
  cantidad_horas_extra_100: "",
  hora_inicio: "",
  hora_fin: "",
  es_hora_extra: false,
  tipo_hora_extra: "",
  observaciones: "",
  es_prestada: false,
  grupo_origen_id: "",
  grupo_destino_id: "",
  ...overrides,
})

// Formulario carga diaria
const formDiaria = ref(createEmptyFormDiaria())

// Formulario carga por rango
const formRango = ref(createEmptyFormRango())
const rangoDias = ref([])
const loadingRangoDias = ref(false)
let rangoDiasRequestToken = 0
let plantillaRangoEmpleadoId = ""

// Resumen
const resumenEmpleado = ref([])
const resumenObra = ref([])
const resumenGrupo = ref([])
const resumenPrestadas = ref([])

const resumenEmpleadoOrdenado = computed(() => {
  return [...(resumenEmpleado.value || [])].sort((a, b) => {
    const totalA = Number(a?.total_horas || 0)
    const totalB = Number(b?.total_horas || 0)
    return totalB - totalA
  })
})

const resumenObraOrdenado = computed(() => {
  return [...(resumenObra.value || [])].sort((a, b) => {
    const totalA = Number(a?.total_horas || 0)
    const totalB = Number(b?.total_horas || 0)
    return totalB - totalA
  })
})

const resumenGrupoOrdenado = computed(() => {
  return [...(resumenGrupo.value || [])].sort((a, b) => {
    const totalA = Number(a?.total_horas || 0)
    const totalB = Number(b?.total_horas || 0)
    return totalB - totalA
  })
})

// Cargar horas
const loadHoras = async () => {
  loadingHoras.value = true
  error.value = ""
  try {
    const res = await api.getHoras(
      filtroMes.value,
      filtroAnio.value,
      filtroEmpleado.value || undefined,
      filtroObra.value || undefined
    )
    horas.value = res.data || []
  } catch (err) {
    error.value = "Error al cargar horas"
    console.error(err)
  } finally {
    loadingHoras.value = false
  }
}

// Cargar datos auxiliares
const loadDatos = async () => {
  try {
    const [resEmpleados, resClientes, resObras, resGrupos] = await Promise.all([
      api.getEmpleados(),
      api.getClientes(),
      api.getObras(),
      api.getGrupos()
    ])
    empleados.value = resEmpleados.data || []
    clientes.value = resClientes.data || []
    obras.value = resObras.data || []
    grupos.value = resGrupos.data || []
  } catch (err) {
    console.error("Error al cargar datos:", err)
  }
}

const getEmpleadoById = (empleadoId) => empleados.value.find((e) => String(e.id) === String(empleadoId))
const getEtiquetaTipoHora = (hora) => {
  if (hora?.es_hora_extra) {
    return String(hora?.tipo_hora_extra || "") === "100" || String(hora?.tipo || "") === "extra_100"
      ? "Extra 100%"
      : "Extra 50%"
  }
  if (hora?.es_prestada) return "Prestada"
  return "Normal"
}

const isGrupoAdministrativo = (grupoId) => {
  const grupo = grupos.value.find((g) => String(g.id) === String(grupoId))
  return ADMIN_GROUP_REGEX.test(String(grupo?.nombre || ""))
}

const isEmpleadoAdministrativo = (empleadoId) => {
  const emp = getEmpleadoById(empleadoId)
  if (!emp) return false
  return isGrupoAdministrativo(emp.grupo_id)
}

const getObraAdministrativa = (grupoId) => {
  const obrasDelGrupo = obras.value.filter((o) => String(o.grupo_id) === String(grupoId))
  if (!obrasDelGrupo.length) return null

  const obraConNombreAdmin = obrasDelGrupo.find((o) => ADMIN_GROUP_REGEX.test(String(o.nombre || "")))
  return obraConNombreAdmin || obrasDelGrupo[0]
}

const getObraAdministrativaParaEmpleado = (empleadoId) => {
  const emp = getEmpleadoById(empleadoId)
  if (!emp) return null
  if (!isGrupoAdministrativo(emp.grupo_id)) return null
  return getObraAdministrativa(emp.grupo_id)
}

const isObraAdministrativa = (obra) => {
  if (!obra) return false
  if (isGrupoAdministrativo(obra.grupo_id)) return true
  return ADMIN_GROUP_REGEX.test(String(obra.nombre || ""))
}

const compareAlphabetically = (a, b) => {
  return String(a || "").localeCompare(String(b || ""), "es", { sensitivity: "base" })
}

const clientesOrdenados = computed(() => {
  return [...(clientes.value || [])].sort((a, b) => {
    const labelA = a?.empresa || a?.razon_social || ""
    const labelB = b?.empresa || b?.razon_social || ""
    return compareAlphabetically(labelA, labelB)
  })
})

const obrasNoAdministrativas = computed(() => {
  return [...(obras.value || [])]
    .filter((obra) => !isObraAdministrativa(obra))
    .sort((a, b) => compareAlphabetically(a?.nombre, b?.nombre))
})

const getObrasDisponibles = (clienteId) => {
  const clienteIdNormalizado = String(clienteId || "")
  return obrasNoAdministrativas.value.filter((obra) => {
    if (!clienteIdNormalizado) return true
    return String(obra.cliente_id) === clienteIdNormalizado
  })
}

const obrasDisponiblesDiaria = computed(() => getObrasDisponibles(formDiaria.value.cliente_id))
const obrasDisponiblesRango = computed(() => getObrasDisponibles(formRango.value.cliente_id))
const getObrasDisponiblesFilaRango = (clienteId) => getObrasDisponibles(clienteId)
const esCargaDiariaAdminUnica = computed(() => {
  if (cargaDiariaMultiple.value && !editingId.value) return false
  return isEmpleadoAdministrativo(formDiaria.value.empleado_id)
})
const esCargaRangoAdminUnica = computed(() => {
  if (cargaRangoMultiple.value) return false
  return isEmpleadoAdministrativo(formRango.value.empleado_id)
})

const syncObraDiariaPorEmpleado = () => {
  if (!isEmpleadoAdministrativo(formDiaria.value.empleado_id)) return
  formDiaria.value.cliente_id = ""
  const obraAdmin = getObraAdministrativaParaEmpleado(formDiaria.value.empleado_id)
  formDiaria.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

const syncObraRangoPorEmpleado = () => {
  if (cargaRangoMultiple.value) return
  if (!isEmpleadoAdministrativo(formRango.value.empleado_id)) return
  formRango.value.cliente_id = ""
  const obraAdmin = getObraAdministrativaParaEmpleado(formRango.value.empleado_id)
  formRango.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

watch(() => formDiaria.value.empleado_id, syncObraDiariaPorEmpleado)
watch(() => formRango.value.empleado_id, syncObraRangoPorEmpleado)
watch(cargaDiariaMultiple, (enabled) => {
  if (!enabled) {
    empleadosMultiplesDiaria.value = []
  }
})
watch(cargaRangoMultiple, (enabled) => {
  if (!enabled) {
    empleadosMultiplesRango.value = []
  }
  if (enabled) {
    rangoDias.value = []
    loadingRangoDias.value = false
  }
})
watch(() => formDiaria.value.cliente_id, (clienteId) => {
  const obraActual = obras.value.find((obra) => String(obra.id) === String(formDiaria.value.obra_id))
  if (obraActual && clienteId && String(obraActual.cliente_id) !== String(clienteId)) {
    formDiaria.value.obra_id = ""
  }
})
watch(() => formRango.value.cliente_id, (clienteId) => {
  const obraActual = obras.value.find((obra) => String(obra.id) === String(formRango.value.obra_id))
  if (obraActual && clienteId && String(obraActual.cliente_id) !== String(clienteId)) {
    formRango.value.obra_id = ""
  }
})
watch(() => formDiaria.value.obra_id, (obraId) => {
  const obra = obras.value.find((item) => String(item.id) === String(obraId))
  if (obra?.cliente_id) formDiaria.value.cliente_id = obra.cliente_id
})
watch(() => formRango.value.obra_id, (obraId) => {
  const obra = obras.value.find((item) => String(item.id) === String(obraId))
  if (obra?.cliente_id) formRango.value.cliente_id = obra.cliente_id
})
watch(
  () => [showFormRango.value, cargaRangoMultiple.value, formRango.value.empleado_id, formRango.value.fecha_desde, formRango.value.fecha_hasta],
  () => {
    prepararDiasRango()
  }
)
const syncExtraState = (formValue) => {
  const extra50 = parseNumeroHoras(formValue.cantidad_horas_extra_50) || 0
  const extra100 = parseNumeroHoras(formValue.cantidad_horas_extra_100) || 0
  const totalExtra = Math.round((extra50 + extra100) * 100) / 100

  formValue.es_hora_extra = totalExtra > 0
  formValue.cantidad_horas_extra = totalExtra > 0 ? formatearHoras(totalExtra) : ""
  formValue.tipo_hora_extra = extra100 > 0 && extra50 === 0 ? "100" : (extra50 > 0 ? "50" : "")
}

watch(() => formDiaria.value.fecha, (fecha) => {
  if (esDomingo(fecha)) {
    const fechaAjustada = parseLocalDate(fecha)
    fechaAjustada.setDate(fechaAjustada.getDate() + 1)
    formDiaria.value.fecha = formatLocalDate(fechaAjustada)
    error.value = "Los domingos no se cargan. La fecha se ajustó automáticamente al lunes."
    return
  }

  if (!esSabado(fecha)) {
    formDiaria.value.cantidad_horas_extra_100 = ""
    syncExtraState(formDiaria.value)
  }
})

watch(() => [formDiaria.value.cantidad_horas_extra_50, formDiaria.value.cantidad_horas_extra_100], () => {
  syncExtraState(formDiaria.value)
})
watch(() => [formRango.value.cantidad_horas_extra_50, formRango.value.cantidad_horas_extra_100], () => {
  syncExtraState(formRango.value)
})

// Cargar resúmenes
const loadResumenes = async () => {
  loadingResumen.value = true
  error.value = ""
  try {
    const resEmpl = await api.getResumenEmpleado(filtroMes.value, filtroAnio.value)
    const resObra = await api.getResumenObra(filtroMes.value, filtroAnio.value)
    const resGrupo = await api.getResumenGrupo(filtroMes.value, filtroAnio.value)
    const resPrestadas = await api.getResumenPrestadas(filtroMes.value, filtroAnio.value)

    // Forzar asignación limpia para reactividad
    resumenEmpleado.value = [...(resEmpl?.data || [])]
    resumenObra.value = [...(resObra?.data || [])]
    resumenGrupo.value = [...(resGrupo?.data || [])]
    resumenPrestadas.value = [...(resPrestadas?.data || [])]
  } catch (err) {
    console.error("Error al cargar resúmenes:", err)
    error.value = "Error al cargar resúmenes"
  } finally {
    loadingResumen.value = false
  }
}

// Abrir modal de carga diaria
const openModalDiaria = (hora = null) => {
  if (hora) {
    cargaDiariaMultiple.value = false
    empleadosMultiplesDiaria.value = []
    editingId.value = hora.id
    focoModalDiaria = "cantidad"
    const tipoExtraActual = hora.es_hora_extra ? (hora.tipo_hora_extra || (hora.tipo === "extra_100" ? "100" : "50")) : ""
    const fechaEdicion = getDateObject(hora.fecha)
    const cantidadHoraActual = Number(hora.cantidad_horas ?? hora.horas_trabajadas) || 0
    formDiaria.value = {
      ...hora,
      cliente_id: hora.cliente_id || "",
      fecha: fechaEdicion ? formatLocalDate(fechaEdicion) : "",
      cantidad_horas: formatearHoras(cantidadHoraActual),
      cantidad_horas_extra: hora.es_hora_extra ? formatearHoras(cantidadHoraActual) : "",
      cantidad_horas_extra_50: tipoExtraActual === "50" ? formatearHoras(cantidadHoraActual) : "",
      cantidad_horas_extra_100: tipoExtraActual === "100" ? formatearHoras(cantidadHoraActual) : "",
      tipo_hora_extra: tipoExtraActual,
    }
    modoDiaria.value = (hora.hora_inicio && hora.hora_fin) ? "horario" : "cantidad"
  } else {
    cargaDiariaMultiple.value = false
    empleadosMultiplesDiaria.value = []
    editingId.value = null
    focoModalDiaria = "empleado"
    modoDiaria.value = "cantidad"
    formDiaria.value = createEmptyFormDiaria()
  }
  showFormDiaria.value = true
}

// Cerrar modal de carga diaria
const closeModalDiaria = () => {
  cargaDiariaMultiple.value = false
  empleadosMultiplesDiaria.value = []
  showFormDiaria.value = false
  editingId.value = null
  modoDiaria.value = "cantidad"
  formDiaria.value = createEmptyFormDiaria()
}

// Cerrar modal de carga por rango
const closeModalRango = () => {
  cargaRangoMultiple.value = false
  empleadosMultiplesRango.value = []
  conflictoCargaRangoVisible.value = false
  conflictoCargaRangoResumen.value = []
  conflictoCargaRangoTotal.value = 0
  showFormRango.value = false
  modoRango.value = "cantidad"
  formRango.value = createEmptyFormRango()
  rangoDias.value = []
  loadingRangoDias.value = false
  plantillaRangoEmpleadoId = ""
}

const buildRangoDiaBase = ({ fecha, empleadoId, base = null, existentes = [] }) => {
  const esEmpleadoAdmin = isEmpleadoAdministrativo(empleadoId)
  const obraAdmin = esEmpleadoAdmin ? getObraAdministrativaParaEmpleado(empleadoId) : null
  const modo = base?.hora_inicio && base?.hora_fin ? "horario" : "cantidad"
  const horasNormales = Number(base?.cantidad_horas ?? base?.horas_trabajadas)
  const extra50 = Number(base?.cantidad_horas_extra_50 || 0)
  const extra100 = Number(base?.cantidad_horas_extra_100 || 0)

  return {
    key: `${fecha}-${existentes.map((item) => item.id).join("-") || "new"}`,
    fecha,
    incluir: true,
    existenteIds: existentes.map((item) => item.id),
    tieneRegistrosExistentes: existentes.length > 0,
    tieneMultiplesRegistros: false,
    cliente_id: esEmpleadoAdmin ? "" : (base?.cliente_id || ""),
    obra_id: esEmpleadoAdmin ? (obraAdmin?.id || "") : (base?.obra_id || ""),
    modo,
    cantidad_horas: modo === "cantidad" && Number.isFinite(horasNormales) ? formatearHoras(horasNormales) : "",
    hora_inicio: base?.hora_inicio || "",
    hora_fin: base?.hora_fin || "",
    cantidad_horas_extra_50: extra50 > 0 ? formatearHoras(extra50) : "",
    cantidad_horas_extra_100: extra100 > 0 ? formatearHoras(extra100) : "",
    observaciones: base?.observaciones || "",
    es_prestada: Boolean(base?.es_prestada),
    grupo_origen_id: base?.grupo_origen_id || "",
    grupo_destino_id: base?.grupo_destino_id || "",
  }
}

const getMesesEnRango = (fechaDesde, fechaHasta) => {
  const inicio = parseLocalDate(fechaDesde)
  const fin = parseLocalDate(fechaHasta)
  if (!inicio || !fin || inicio > fin) return []

  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1)
  const limite = new Date(fin.getFullYear(), fin.getMonth(), 1)
  const meses = []

  while (cursor <= limite) {
    meses.push({ mes: cursor.getMonth() + 1, anio: cursor.getFullYear() })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return meses
}

const getDiasRango = (fechaDesde, fechaHasta) => {
  const inicio = parseLocalDate(fechaDesde)
  const fin = parseLocalDate(fechaHasta)
  if (!inicio || !fin || inicio > fin) return []

  const dias = []
  const cursor = new Date(inicio)
  while (cursor <= fin) {
    if (cursor.getDay() !== 0) {
      dias.push(formatLocalDate(cursor))
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return dias
}

const getResumenExistentePorFecha = (registros = [], fecha, empleadoId) => {
  const registrosDia = registros.filter((item) => String(item.empleado_id) === String(empleadoId) && String(item.fecha) === String(fecha))
  if (!registrosDia.length) return null

  const registrosBase = registrosDia.filter((item) => !item.es_hora_extra)
  const firmasBase = new Set(
    registrosBase.map((item) => [
      item.cliente_id || "",
      item.obra_id || "",
      item.hora_inicio || "",
      item.hora_fin || "",
      item.es_prestada ? "prestada" : "normal",
      item.grupo_origen_id || "",
      item.grupo_destino_id || "",
    ].join("|"))
  )

  if (registrosBase.length > 1 || firmasBase.size > 1) {
    return {
      fecha,
      existenteIds: registrosDia.map((item) => item.id),
      tieneRegistrosExistentes: true,
      tieneMultiplesRegistros: true,
    }
  }

  const base = registrosBase[0] || registrosDia[0]
  const extra50 = registrosDia
    .filter((item) => item.es_hora_extra && String(item.tipo_hora_extra || item.tipo || "") !== "100")
    .reduce((acc, item) => acc + getCantidadHoras(item), 0)
  const extra100 = registrosDia
    .filter((item) => item.es_hora_extra && (String(item.tipo_hora_extra || "") === "100" || String(item.tipo || "") === "extra_100"))
    .reduce((acc, item) => acc + getCantidadHoras(item), 0)

  return {
    ...base,
    fecha,
    existenteIds: registrosDia.map((item) => item.id),
    tieneRegistrosExistentes: true,
    tieneMultiplesRegistros: false,
    cantidad_horas_extra_50: extra50,
    cantidad_horas_extra_100: extra100,
  }
}

const getPlantillaEmpleadoRango = (empleadoId) => {
  if (String(ultimaCargaRapida.value?.empleado_id || "") === String(empleadoId)) {
    return {
      cliente_id: ultimaCargaRapida.value?.cliente_id || "",
      obra_id: ultimaCargaRapida.value?.obra_id || "",
      modo: "cantidad",
      cantidad_horas: "",
      hora_inicio: "",
      hora_fin: "",
      observaciones: "",
      es_prestada: false,
      grupo_origen_id: "",
      grupo_destino_id: "",
    }
  }

  const ultimoRegistro = [...(horas.value || [])]
    .filter((item) => String(item.empleado_id) === String(empleadoId) && !item.es_hora_extra)
    .sort((a, b) => (getDateObject(b.fecha)?.getTime() || 0) - (getDateObject(a.fecha)?.getTime() || 0))[0]

  if (!ultimoRegistro) return null

  return {
    ...ultimoRegistro,
    modo: ultimoRegistro.hora_inicio && ultimoRegistro.hora_fin ? "horario" : "cantidad",
    cantidad_horas: formatearHoras(ultimoRegistro.cantidad_horas ?? ultimoRegistro.horas_trabajadas),
    observaciones: ultimoRegistro.observaciones || "",
    es_prestada: Boolean(ultimoRegistro.es_prestada),
    grupo_origen_id: ultimoRegistro.grupo_origen_id || "",
    grupo_destino_id: ultimoRegistro.grupo_destino_id || "",
  }
}

const isPlantillaRangoVacia = () => {
  return !(
    formRango.value.cliente_id ||
    formRango.value.obra_id ||
    formRango.value.cantidad_horas ||
    formRango.value.hora_inicio ||
    formRango.value.hora_fin ||
    formRango.value.cantidad_horas_extra_50 ||
    formRango.value.cantidad_horas_extra_100 ||
    formRango.value.observaciones ||
    formRango.value.es_prestada ||
    formRango.value.grupo_origen_id ||
    formRango.value.grupo_destino_id
  )
}

const hidratarPlantillaRango = (template) => {
  if (!template) return

  modoRango.value = template.modo || "cantidad"
  formRango.value = {
    ...formRango.value,
    cliente_id: template.cliente_id || "",
    obra_id: template.obra_id || "",
    cantidad_horas: template.cantidad_horas || template.horas_por_dia || "",
    horas_por_dia: template.cantidad_horas || template.horas_por_dia || "",
    hora_inicio: template.hora_inicio || "",
    hora_fin: template.hora_fin || "",
    cantidad_horas_extra_50: template.cantidad_horas_extra_50 || "",
    cantidad_horas_extra_100: template.cantidad_horas_extra_100 || "",
    observaciones: template.observaciones || "",
    es_prestada: Boolean(template.es_prestada),
    grupo_origen_id: template.grupo_origen_id || "",
    grupo_destino_id: template.grupo_destino_id || "",
  }
}

const getPlantillaRangoActual = (fecha = "") => {
  const esEmpleadoAdmin = isEmpleadoAdministrativo(formRango.value.empleado_id)
  const obraAdmin = esEmpleadoAdmin ? getObraAdministrativaParaEmpleado(formRango.value.empleado_id) : null

  return {
    cliente_id: esEmpleadoAdmin ? "" : (formRango.value.cliente_id || ""),
    obra_id: esEmpleadoAdmin ? (obraAdmin?.id || "") : (formRango.value.obra_id || ""),
    modo: modoRango.value,
    cantidad_horas: modoRango.value === "cantidad" ? (formRango.value.cantidad_horas || formRango.value.horas_por_dia || "") : "",
    hora_inicio: modoRango.value === "horario" ? (formRango.value.hora_inicio || "") : "",
    hora_fin: modoRango.value === "horario" ? (formRango.value.hora_fin || "") : "",
    cantidad_horas_extra_50: formRango.value.cantidad_horas_extra_50 || "",
    cantidad_horas_extra_100: fecha && !esSabado(fecha) ? "" : (formRango.value.cantidad_horas_extra_100 || ""),
    observaciones: formRango.value.observaciones || "",
    es_prestada: Boolean(formRango.value.es_prestada),
    grupo_origen_id: formRango.value.es_prestada ? (formRango.value.grupo_origen_id || "") : "",
    grupo_destino_id: formRango.value.es_prestada ? (formRango.value.grupo_destino_id || "") : "",
  }
}

const normalizeRangoEditableData = (data, fecha = "") => {
  const esEmpleadoAdmin = isEmpleadoAdministrativo(formRango.value.empleado_id)
  const obraAdmin = esEmpleadoAdmin ? getObraAdministrativaParaEmpleado(formRango.value.empleado_id) : null
  const modo = data?.modo === "horario" ? "horario" : "cantidad"
  const esPrestada = Boolean(data?.es_prestada)

  return {
    ...data,
    cliente_id: esEmpleadoAdmin ? "" : (data?.cliente_id || ""),
    obra_id: esEmpleadoAdmin ? (obraAdmin?.id || "") : (data?.obra_id || ""),
    modo,
    cantidad_horas: modo === "cantidad" ? (data?.cantidad_horas || "") : "",
    hora_inicio: modo === "horario" ? (data?.hora_inicio || "") : "",
    hora_fin: modo === "horario" ? (data?.hora_fin || "") : "",
    cantidad_horas_extra_50: data?.cantidad_horas_extra_50 || "",
    cantidad_horas_extra_100: fecha && !esSabado(fecha) ? "" : (data?.cantidad_horas_extra_100 || ""),
    observaciones: data?.observaciones || "",
    es_prestada: esPrestada,
    grupo_origen_id: esPrestada ? (data?.grupo_origen_id || "") : "",
    grupo_destino_id: esPrestada ? (data?.grupo_destino_id || "") : "",
  }
}

const getRangoDiaEfectivo = (dia) => {
  if (!dia || dia.tieneMultiplesRegistros) return dia
  if (dia.personalizado) {
    return normalizeRangoEditableData(dia, dia.fecha)
  }

  return normalizeRangoEditableData({
    ...dia,
    ...getPlantillaRangoActual(dia.fecha),
  }, dia.fecha)
}

const setPersonalizacionDiaRango = (index, personalizado) => {
  const fila = rangoDias.value[index]
  if (!fila || fila.tieneMultiplesRegistros) return

  if (personalizado) {
    rangoDias.value[index] = {
      ...fila,
      ...getRangoDiaEfectivo(fila),
      personalizado: true,
    }
    return
  }

  rangoDias.value[index] = {
    ...fila,
    personalizado: false,
  }
}

const aplicarPlantillaATodosLosDias = () => {
  rangoDias.value = rangoDias.value.map((fila) => {
    if (fila.tieneMultiplesRegistros) return fila
    return {
      ...fila,
      personalizado: false,
    }
  })
}

const getResumenDiaRango = (dia) => {
  const fila = getRangoDiaEfectivo(dia)
  if (!fila) return ""

  const partes = []

  if (isEmpleadoAdministrativo(formRango.value.empleado_id)) {
    partes.push(getNombreObra(fila.obra_id))
  } else {
    const nombreObra = getNombreObra(fila.obra_id)
    const nombreCliente = getNombreCliente(fila.cliente_id)
    partes.push(nombreCliente === "Sin cliente" ? nombreObra : `${nombreCliente} / ${nombreObra}`)
  }

  if (fila.modo === "horario") {
    partes.push(fila.hora_inicio && fila.hora_fin ? `${fila.hora_inicio} a ${fila.hora_fin}` : "Horario incompleto")
  } else {
    partes.push(fila.cantidad_horas ? `${fila.cantidad_horas} hs` : "Horas sin completar")
  }

  if (fila.cantidad_horas_extra_50) {
    partes.push(`Extra 50: ${fila.cantidad_horas_extra_50}`)
  }

  if (fila.cantidad_horas_extra_100) {
    partes.push(`Extra 100: ${fila.cantidad_horas_extra_100}`)
  }

  if (fila.es_prestada) {
    partes.push(`Prestada: ${getNombreGrupo(fila.grupo_origen_id)} -> ${getNombreGrupo(fila.grupo_destino_id)}`)
  }

  if (fila.observaciones) {
    partes.push(fila.observaciones)
  }

  return partes.join(" · ")
}

const prepararDiasRango = async () => {
  if (cargaRangoMultiple.value) {
    rangoDias.value = []
    loadingRangoDias.value = false
    return
  }

  const empleadoId = formRango.value.empleado_id
  const fechaDesde = formRango.value.fecha_desde
  const fechaHasta = formRango.value.fecha_hasta

  if (!showFormRango.value || !empleadoId || !fechaDesde || !fechaHasta) {
    rangoDias.value = []
    return
  }

  const inicio = parseLocalDate(fechaDesde)
  const fin = parseLocalDate(fechaHasta)
  if (!inicio || !fin || inicio > fin) {
    rangoDias.value = []
    return
  }

  const requestToken = ++rangoDiasRequestToken
  loadingRangoDias.value = true

  try {
    const meses = getMesesEnRango(fechaDesde, fechaHasta)
    const respuestas = await Promise.all(
      meses.map(({ mes, anio }) => api.getHoras(mes, anio, empleadoId))
    )

    if (requestToken !== rangoDiasRequestToken) return

    const registros = respuestas.flatMap((respuesta) => respuesta?.data || [])
    const plantilla = getPlantillaEmpleadoRango(empleadoId)

    if (plantillaRangoEmpleadoId !== String(empleadoId)) {
      hidratarPlantillaRango(plantilla)
      plantillaRangoEmpleadoId = String(empleadoId)
    } else if (isPlantillaRangoVacia()) {
      hidratarPlantillaRango(plantilla)
    }

    rangoDias.value = getDiasRango(fechaDesde, fechaHasta).map((fecha) => {
      const resumenExistente = getResumenExistentePorFecha(registros, fecha, empleadoId)

      if (resumenExistente?.tieneMultiplesRegistros) {
        return {
          ...buildRangoDiaBase({ fecha, empleadoId, existentes: registros.filter((item) => String(item.empleado_id) === String(empleadoId) && String(item.fecha) === String(fecha)) }),
          incluir: false,
          tieneMultiplesRegistros: true,
          tieneRegistrosExistentes: true,
          existenteIds: resumenExistente.existenteIds || [],
          personalizado: false,
        }
      }

      const baseDia = buildRangoDiaBase({
        fecha,
        empleadoId,
        base: resumenExistente || null,
        existentes: registros.filter((item) => String(item.empleado_id) === String(empleadoId) && String(item.fecha) === String(fecha)),
      })

      return {
        ...baseDia,
        personalizado: Boolean(resumenExistente),
      }
    })
  } catch (err) {
    if (requestToken !== rangoDiasRequestToken) return
    rangoDias.value = []
    error.value = `No se pudieron preparar los días del rango: ${err?.response?.data?.error || err?.message || "Error desconocido"}`
  } finally {
    if (requestToken === rangoDiasRequestToken) {
      loadingRangoDias.value = false
    }
  }
}

const copiarDiaAnteriorRango = (index) => {
  if (index <= 0) return
  const filaAnterior = getRangoDiaEfectivo(rangoDias.value[index - 1])
  const filaActual = rangoDias.value[index]
  if (!filaAnterior || !filaActual || filaActual.tieneMultiplesRegistros) return

  rangoDias.value[index] = {
    ...filaActual,
    personalizado: true,
    cliente_id: filaAnterior.cliente_id,
    obra_id: filaAnterior.obra_id,
    modo: filaAnterior.modo,
    cantidad_horas: filaAnterior.cantidad_horas,
    hora_inicio: filaAnterior.hora_inicio,
    hora_fin: filaAnterior.hora_fin,
    cantidad_horas_extra_50: filaAnterior.cantidad_horas_extra_50,
    cantidad_horas_extra_100: esSabado(filaActual.fecha) ? filaAnterior.cantidad_horas_extra_100 : "",
    observaciones: filaAnterior.observaciones,
    es_prestada: filaAnterior.es_prestada,
    grupo_origen_id: filaAnterior.grupo_origen_id,
    grupo_destino_id: filaAnterior.grupo_destino_id,
  }
}

const aplicarPrimerDiaATodos = () => {
  const filaModeloBase = rangoDias.value.find((item) => item.incluir && !item.tieneMultiplesRegistros)
  const filaModelo = getRangoDiaEfectivo(filaModeloBase)
  if (!filaModelo) return

  hidratarPlantillaRango(filaModelo)
  aplicarPlantillaATodosLosDias()
}

const resetConflictoCargaRango = () => {
  conflictoCargaRangoVisible.value = false
  conflictoCargaRangoResumen.value = []
  conflictoCargaRangoTotal.value = 0
}

const getPayloadRangoKey = (payload) => `${payload?.empleado_id || ""}|${payload?.fecha || ""}`

const detectarConflictosCargaRango = async ({ payloads = [], empleadosObjetivo = [], fechaDesde = "", fechaHasta = "" }) => {
  const meses = getMesesEnRango(fechaDesde, fechaHasta)
  const pedidos = []

  for (const empleadoId of empleadosObjetivo) {
    for (const { mes, anio } of meses) {
      pedidos.push(
        api.getHoras(mes, anio, empleadoId).then((res) => ({ empleadoId, data: res?.data || [] }))
      )
    }
  }

  const respuestas = await Promise.all(pedidos)
  const existentesPorKey = new Map()

  for (const respuesta of respuestas) {
    for (const registro of respuesta.data || []) {
      const fechaRegistro = String(registro?.fecha || "")
      if (fechaRegistro < fechaDesde || fechaRegistro > fechaHasta) continue
      const key = `${String(registro?.empleado_id || "")}|${fechaRegistro}`
      const actuales = existentesPorKey.get(key) || []
      actuales.push(registro)
      existentesPorKey.set(key, actuales)
    }
  }

  const conflictos = []
  const resumenPorEmpleado = new Map()

  for (const item of payloads) {
    const key = getPayloadRangoKey(item.payload)
    const existentes = existentesPorKey.get(key) || []
    if (!existentes.length) continue

    conflictos.push({ key, payload: item.payload, existentes })

    const empleadoId = String(item.payload?.empleado_id || "")
    const fecha = String(item.payload?.fecha || "")
    if (!resumenPorEmpleado.has(empleadoId)) {
      resumenPorEmpleado.set(empleadoId, new Set())
    }
    resumenPorEmpleado.get(empleadoId).add(fecha)
  }

  const resumen = Array.from(resumenPorEmpleado.entries())
    .map(([empleadoId, fechasSet]) => ({
      empleadoId,
      empleado: getNombreEmpleado(empleadoId),
      fechas: Array.from(fechasSet).sort((a, b) => a.localeCompare(b, "es")),
    }))
    .sort((a, b) => a.empleado.localeCompare(b.empleado, "es", { sensitivity: "base" }))

  return {
    conflictos,
    existentesPorKey,
    resumen,
    total: conflictos.length,
  }
}

const cancelarConflictoCargaRango = () => {
  resetConflictoCargaRango()
}

const resolverConflictoCargaRango = async (accion) => {
  await saveHoraRango(accion)
}

const parseNumeroHoras = (value) => {
  return parseHoursInput(value)
}

const formatearHoras = (value) => formatHoursAsClock(value)

const parseLocalDate = (dateStr) => {
  if (!dateStr) return null
  const [year, month, day] = String(dateStr).split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

const formatLocalDate = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const getDateObject = (dateValue) => {
  if (!dateValue) return null
  if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return parseLocalDate(dateValue)
  }
  const parsed = new Date(dateValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getProximaFechaPorRegistros = (registros = []) => {
  const fechasValidas = (registros || [])
    .map((item) => getDateObject(item?.fecha))
    .filter(Boolean)

  if (!fechasValidas.length) return getTodayInputDate()

  const fechaMasAlta = new Date(Math.max(...fechasValidas.map((fecha) => fecha.getTime())))
  fechaMasAlta.setDate(fechaMasAlta.getDate() + 1)
  return formatLocalDate(normalizeToNonSunday(fechaMasAlta))
}

const getUltimaCargaGuardada = () => {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(ULTIMA_CARGA_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && parsed.empleado_id ? parsed : null
  } catch {
    return null
  }
}

const ultimaCargaRapida = ref(getUltimaCargaGuardada())

const guardarUltimaCargaRapida = ({ empleado_id, cliente_id, obra_id, fecha }) => {
  const payload = {
    empleado_id: empleado_id || "",
    cliente_id: cliente_id || "",
    obra_id: obra_id || "",
    fecha: fecha || getTodayInputDate(),
  }

  ultimaCargaRapida.value = payload

  if (typeof window !== "undefined") {
    window.localStorage.setItem(ULTIMA_CARGA_STORAGE_KEY, JSON.stringify(payload))
  }
}

const abrirCargaRapidaConDatos = ({ empleado_id, cliente_id, obra_id, fecha }) => {
  activeTab.value = "carga"
  modalidadCarga.value = "diaria"
  showFormRango.value = false
  error.value = ""
  editingId.value = null
  cargaDiariaMultiple.value = false
  empleadosMultiplesDiaria.value = []
  modoDiaria.value = "cantidad"
  focoModalDiaria = "cantidad"

  const fechaBase = getDateObject(fecha) || new Date()
  fechaBase.setDate(fechaBase.getDate() + 1)

  formDiaria.value = createEmptyFormDiaria({
    empleado_id: empleado_id || "",
    cliente_id: cliente_id || "",
    obra_id: obra_id || "",
    fecha: formatLocalDate(normalizeToNonSunday(fechaBase)),
  })

  syncObraDiariaPorEmpleado()
  showFormDiaria.value = true
}

const abrirCargaRapidaUltimoEmpleado = () => {
  const ultimoGuardado = ultimaCargaRapida.value

  if (ultimoGuardado?.empleado_id) {
    abrirCargaRapidaConDatos(ultimoGuardado)
    return
  }

  const ultimaHora = [...(horas.value || [])]
    .sort((a, b) => (getDateObject(b.fecha)?.getTime() || 0) - (getDateObject(a.fecha)?.getTime() || 0))[0]

  if (ultimaHora?.empleado_id) {
    abrirCargaRapidaConDatos(ultimaHora)
    return
  }

  openModalDiaria()
}

const abrirCargaRapidaEmpleado = (grupo) => {
  const ultimoRegistro = Array.isArray(grupo?.registros) && grupo.registros.length > 0
    ? grupo.registros[0]
    : null

  guardarUltimaCargaRapida({
    empleado_id: grupo?.empleado_id && grupo.empleado_id !== "sin_empleado" ? grupo.empleado_id : "",
    cliente_id: ultimoRegistro?.cliente_id || "",
    obra_id: ultimoRegistro?.obra_id || "",
    fecha: ultimoRegistro?.fecha || getTodayInputDate(),
  })

  abrirCargaRapidaConDatos({
    empleado_id: grupo?.empleado_id && grupo.empleado_id !== "sin_empleado" ? grupo.empleado_id : "",
    cliente_id: ultimoRegistro?.cliente_id || "",
    obra_id: ultimoRegistro?.obra_id || "",
    fecha: ultimoRegistro?.fecha || getTodayInputDate(),
  })
}

const calcularHorasDesdeHorario = (horaInicio, horaFin) => {
  if (!horaInicio || !horaFin) return 0
  const inicio = new Date(`2000-01-01T${horaInicio}`)
  const fin = new Date(`2000-01-01T${horaFin}`)
  const diferencia = (fin - inicio) / (1000 * 60 * 60)
  return Number.isFinite(diferencia) && diferencia > 0 ? diferencia : 0
}

const esSabado = (fechaStr) => {
  const fecha = parseLocalDate(fechaStr)
  return Boolean(fecha) && fecha.getDay() === 6
}

const esDomingo = (fechaStr) => {
  const fecha = parseLocalDate(fechaStr)
  return Boolean(fecha) && fecha.getDay() === 0
}

const esSabadoDiaria = computed(() => esSabado(formDiaria.value.fecha))

const validarDistribucionHorasExtra = (totalHoras, horasExtra50, horasExtra100) => {
  const extra50 = horasExtra50 === "" || horasExtra50 === null || horasExtra50 === undefined ? 0 : parseNumeroHoras(horasExtra50)
  const extra100 = horasExtra100 === "" || horasExtra100 === null || horasExtra100 === undefined ? 0 : parseNumeroHoras(horasExtra100)

  if (horasExtra50 !== "" && horasExtra50 !== null && horasExtra50 !== undefined && (!Number.isFinite(extra50) || extra50 < 0)) {
    return "Las horas extra al 50% deben ser 0 o mayores"
  }

  if (horasExtra100 !== "" && horasExtra100 !== null && horasExtra100 !== undefined && (!Number.isFinite(extra100) || extra100 < 0)) {
    return "Las horas extra al 100% deben ser 0 o mayores"
  }

  if ((extra50 + extra100) > totalHoras) {
    return "La suma de las horas extra (50% + 100%) no puede superar el total cargado"
  }

  return ""
}

const focusPrimerCampoDiaria = () => {
  nextTick(() => {
    if (focoModalDiaria === "cantidad") {
      if (modoDiaria.value === "horario") {
        inputHoraInicioDiariaRef.value?.focus()
      } else {
        inputCantidadDiariaRef.value?.focus()
      }
      return
    }

    selectEmpleadoDiariaRef.value?.focus()
  })
}

watch(showFormDiaria, (visible) => {
  if (visible) focusPrimerCampoDiaria()
})

watch(showFormRango, (visible) => {
  if (visible) {
    nextTick(() => selectEmpleadoRangoRef.value?.focus())
  }
})

const syncFilaRangoObraPorEmpleado = (fila) => {
  if (!isEmpleadoAdministrativo(formRango.value.empleado_id)) return fila
  const obraAdmin = getObraAdministrativaParaEmpleado(formRango.value.empleado_id)
  return {
    ...fila,
    cliente_id: "",
    obra_id: obraAdmin?.id || "",
  }
}

const handleFilaRangoClienteChange = (fila) => {
  const obraActual = obras.value.find((obra) => String(obra.id) === String(fila.obra_id))
  if (obraActual && fila.cliente_id && String(obraActual.cliente_id) !== String(fila.cliente_id)) {
    fila.obra_id = ""
  }
}

const handleFilaRangoObraChange = (fila) => {
  const obra = obras.value.find((item) => String(item.id) === String(fila.obra_id))
  if (obra?.cliente_id) {
    fila.cliente_id = obra.cliente_id
  }
}

const isEditableTarget = (target) => {
  const tagName = String(target?.tagName || "").toUpperCase()
  return ["INPUT", "TEXTAREA", "SELECT"].includes(tagName) || target?.isContentEditable === true
}

const handleKeyboardShortcutDown = (event) => {
  if ((showFormDiaria.value || showFormRango.value) && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault()
    if (showFormDiaria.value) saveHoraDiaria()
    if (showFormRango.value) saveHoraRango()
    return
  }

  if ((showFormDiaria.value || showFormRango.value) && event.key === "Escape") {
    event.preventDefault()
    if (showFormDiaria.value) closeModalDiaria()
    if (showFormRango.value) closeModalRango()
    return
  }

  if (isEditableTarget(event.target)) return

  if (event.ctrlKey && event.shiftKey && (event.key === "Control" || event.key === "Shift")) {
    event.preventDefault()
    ctrlShortcutArmed = false
    ctrlShortcutComboUsed = true
    abrirCargaRapidaUltimoEmpleado()
    return
  }

  if (event.key === "Control" && !event.shiftKey && !event.altKey && !event.metaKey) {
    ctrlShortcutArmed = true
    ctrlShortcutComboUsed = false
    return
  }

  if (ctrlShortcutArmed && event.key !== "Control") {
    ctrlShortcutComboUsed = true
  }
}

const handleKeyboardShortcutUp = (event) => {
  if (event.key !== "Control") return

  if (ctrlShortcutArmed && !ctrlShortcutComboUsed && !showFormDiaria.value && !showFormRango.value && !isEditableTarget(event.target)) {
    event.preventDefault()
    openModalDiaria()
  }

  ctrlShortcutArmed = false
  ctrlShortcutComboUsed = false
}

// Guardar hora diaria
const saveHoraDiaria = async () => {
  error.value = ""
  const empleadosObjetivo = editingId.value
    ? [formDiaria.value.empleado_id].filter(Boolean)
    : (cargaDiariaMultiple.value
      ? [...new Set((empleadosMultiplesDiaria.value || []).filter(Boolean))]
      : [formDiaria.value.empleado_id].filter(Boolean))

  if (!formDiaria.value.fecha) {
    error.value = "La fecha es obligatoria"
    return
  }

  if (!empleadosObjetivo.length) {
    error.value = cargaDiariaMultiple.value
      ? "Seleccioná al menos un empleado para la carga múltiple"
      : "Empleado y fecha son obligatorios"
    return
  }

  if (esDomingo(formDiaria.value.fecha)) {
    error.value = "No se pueden registrar horas los domingos"
    return
  }

  if (modoDiaria.value === "cantidad" && !formDiaria.value.cantidad_horas) {
    error.value = "Ingresá la cantidad de horas"
    return
  }
  if (modoDiaria.value === "horario" && (!formDiaria.value.hora_inicio || !formDiaria.value.hora_fin)) {
    error.value = "Ingresá hora de inicio y hora de fin"
    return
  }

  if (formDiaria.value.es_prestada && (!formDiaria.value.grupo_origen_id || !formDiaria.value.grupo_destino_id)) {
    error.value = "Selecciona grupo origen y destino para horas prestadas"
    return
  }

  const horasNormalesDiaria = parseNumeroHoras(formDiaria.value.cantidad_horas)
  if (modoDiaria.value === "cantidad" && (!Number.isFinite(horasNormalesDiaria) || horasNormalesDiaria <= 0)) {
    error.value = "Ingresá una cantidad de horas válida en formato hora real (hh.mm)"
    return
  }

  const totalHorasDiaria = modoDiaria.value === "cantidad"
    ? (horasNormalesDiaria || 0)
    : calcularHorasDesdeHorario(formDiaria.value.hora_inicio, formDiaria.value.hora_fin)

  const horasExtra50Diaria = parseNumeroHoras(formDiaria.value.cantidad_horas_extra_50) || 0
  const horasExtra100Diaria = parseNumeroHoras(formDiaria.value.cantidad_horas_extra_100) || 0
  const totalExtraDiaria = Math.round((horasExtra50Diaria + horasExtra100Diaria) * 100) / 100

  const errorHorasExtraDiaria = validarDistribucionHorasExtra(
    totalHorasDiaria,
    formDiaria.value.cantidad_horas_extra_50,
    formDiaria.value.cantidad_horas_extra_100
  )
  if (errorHorasExtraDiaria) {
    error.value = errorHorasExtraDiaria
    return
  }

  if (horasExtra100Diaria > 0 && !esSabado(formDiaria.value.fecha)) {
    error.value = "Las horas extra al 100% corresponden a sábado. Si necesitás combinarlas, usá esta opción en una carga diaria del sábado."
    return
  }

  saving.value = true
  try {
    const payloadBase = {
      fecha: formDiaria.value.fecha,
      cantidad_horas: modoDiaria.value === "cantidad" ? horasNormalesDiaria : null,
      cantidad_horas_extra: totalExtraDiaria > 0 ? totalExtraDiaria : null,
      cantidad_horas_extra_50: horasExtra50Diaria > 0 ? horasExtra50Diaria : null,
      cantidad_horas_extra_100: horasExtra100Diaria > 0 ? horasExtra100Diaria : null,
      hora_inicio: modoDiaria.value === "horario" ? formDiaria.value.hora_inicio || null : null,
      hora_fin: modoDiaria.value === "horario" ? formDiaria.value.hora_fin || null : null,
      es_hora_extra: totalExtraDiaria > 0,
      tipo_hora_extra: horasExtra100Diaria > 0 && horasExtra50Diaria === 0 ? "100" : (totalExtraDiaria > 0 ? "50" : null),
      observaciones: formDiaria.value.observaciones || "",
      es_prestada: formDiaria.value.es_prestada,
      grupo_origen_id: formDiaria.value.es_prestada ? formDiaria.value.grupo_origen_id : null,
      grupo_destino_id: formDiaria.value.es_prestada ? formDiaria.value.grupo_destino_id : null
    }

    if (editingId.value) {
      await api.updateHora(editingId.value, {
        ...payloadBase,
        empleado_id: formDiaria.value.empleado_id,
        cliente_id: formDiaria.value.cliente_id || null,
        obra_id: formDiaria.value.obra_id,
      })
    } else {
      for (const empleadoId of empleadosObjetivo) {
        const esEmpleadoAdmin = isEmpleadoAdministrativo(empleadoId)
        const payload = {
          ...payloadBase,
          empleado_id: empleadoId,
          cliente_id: esEmpleadoAdmin ? null : (formDiaria.value.cliente_id || null),
          obra_id: esEmpleadoAdmin ? null : (formDiaria.value.obra_id || null),
        }
        await api.createHora(payload)
      }
    }

    guardarUltimaCargaRapida({
      empleado_id: empleadosObjetivo[0],
      cliente_id: formDiaria.value.cliente_id || null,
      obra_id: formDiaria.value.obra_id || null,
      fecha: formDiaria.value.fecha,
    })

    await loadHoras()
    closeModalDiaria()
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    const prefijo = editingId.value
      ? "Error al actualizar hora"
      : (cargaDiariaMultiple.value ? "Error al crear horas múltiples" : "Error al crear hora")
    error.value = `${prefijo}: ${detalle}`
    console.error(err)
  } finally {
    saving.value = false
  }
}

// Guardar horas por rango
const saveHoraRango = async (accionConflictos = null) => {
  error.value = ""
  if (!accionConflictos) {
    resetConflictoCargaRango()
  }
  if (!formRango.value.fecha_desde || !formRango.value.fecha_hasta) {
    error.value = "Las fechas son obligatorias"
    return
  }

  const empleadosObjetivo = cargaRangoMultiple.value
    ? [...new Set((empleadosMultiplesRango.value || []).filter(Boolean))]
    : [formRango.value.empleado_id].filter(Boolean)

  if (!empleadosObjetivo.length) {
    error.value = cargaRangoMultiple.value
      ? "Seleccioná al menos un empleado para la carga múltiple"
      : "Empleado y fechas son obligatorios"
    return
  }

  const fechaDesdeLocal = parseLocalDate(formRango.value.fecha_desde)
  const fechaHastaLocal = parseLocalDate(formRango.value.fecha_hasta)

  if (!fechaDesdeLocal || !fechaHastaLocal || fechaDesdeLocal > fechaHastaLocal) {
    error.value = "La fecha inicial debe ser menor a la fecha final"
    return
  }

  const payloads = []

  if (cargaRangoMultiple.value) {
    if (formRango.value.es_prestada && (!formRango.value.grupo_origen_id || !formRango.value.grupo_destino_id)) {
      error.value = "Selecciona grupo origen y destino para horas prestadas"
      return
    }

    if (modoRango.value === "cantidad" && !formRango.value.cantidad_horas) {
      error.value = "Ingresá las horas de la plantilla"
      return
    }

    if (modoRango.value === "horario" && (!formRango.value.hora_inicio || !formRango.value.hora_fin)) {
      error.value = "Ingresá horario completo en la plantilla"
      return
    }

    const diasRango = getDiasRango(formRango.value.fecha_desde, formRango.value.fecha_hasta)
    if (!diasRango.length) {
      error.value = "No hay días hábiles para guardar en el rango seleccionado"
      return
    }

    for (const fecha of diasRango) {
      const horasNormales = modoRango.value === "cantidad"
        ? parseNumeroHoras(formRango.value.cantidad_horas)
        : null

      if (modoRango.value === "cantidad" && (!Number.isFinite(horasNormales) || horasNormales <= 0)) {
        error.value = `Las horas de la plantilla no tienen un formato válido (${formatearFecha(fecha)})`
        return
      }

      const totalHorasFila = modoRango.value === "cantidad"
        ? (horasNormales || 0)
        : calcularHorasDesdeHorario(formRango.value.hora_inicio, formRango.value.hora_fin)

      const horasExtra50 = parseNumeroHoras(formRango.value.cantidad_horas_extra_50) || 0
      const horasExtra100 = esSabado(fecha)
        ? (parseNumeroHoras(formRango.value.cantidad_horas_extra_100) || 0)
        : 0
      const totalExtra = Math.round((horasExtra50 + horasExtra100) * 100) / 100

      const errorExtras = validarDistribucionHorasExtra(
        totalHorasFila,
        formRango.value.cantidad_horas_extra_50,
        esSabado(fecha) ? formRango.value.cantidad_horas_extra_100 : ""
      )

      if (errorExtras) {
        error.value = `${formatearFecha(fecha)}: ${errorExtras}`
        return
      }

      for (const empleadoId of empleadosObjetivo) {
        const esEmpleadoAdmin = isEmpleadoAdministrativo(empleadoId)
        const obraAdmin = esEmpleadoAdmin ? getObraAdministrativaParaEmpleado(empleadoId) : null
        const obraId = esEmpleadoAdmin ? (obraAdmin?.id || null) : (formRango.value.obra_id || null)

        payloads.push({
          fila: null,
          payload: {
            empleado_id: empleadoId,
            cliente_id: esEmpleadoAdmin ? null : (formRango.value.cliente_id || null),
            obra_id: obraId,
            fecha,
            cantidad_horas: modoRango.value === "cantidad" ? horasNormales : null,
            cantidad_horas_extra: totalExtra > 0 ? totalExtra : null,
            cantidad_horas_extra_50: horasExtra50 > 0 ? horasExtra50 : null,
            cantidad_horas_extra_100: horasExtra100 > 0 ? horasExtra100 : null,
            hora_inicio: modoRango.value === "horario" ? formRango.value.hora_inicio || null : null,
            hora_fin: modoRango.value === "horario" ? formRango.value.hora_fin || null : null,
            es_hora_extra: totalExtra > 0,
            tipo_hora_extra: horasExtra100 > 0 && horasExtra50 === 0 ? "100" : (totalExtra > 0 ? "50" : null),
            observaciones: formRango.value.observaciones || "",
            es_prestada: formRango.value.es_prestada,
            grupo_origen_id: formRango.value.es_prestada ? formRango.value.grupo_origen_id : null,
            grupo_destino_id: formRango.value.es_prestada ? formRango.value.grupo_destino_id : null,
          }
        })
      }
    }
  } else {
    const filasEditables = rangoDias.value.filter((fila) => fila.incluir && !fila.tieneMultiplesRegistros)
    if (!filasEditables.length) {
      error.value = "No hay días editables para guardar en el rango seleccionado"
      return
    }

    const esEmpleadoAdmin = isEmpleadoAdministrativo(formRango.value.empleado_id)

    for (const filaOriginal of filasEditables) {
    const fila = getRangoDiaEfectivo(filaOriginal)
    const obraAdmin = esEmpleadoAdmin ? getObraAdministrativaParaEmpleado(formRango.value.empleado_id) : null
    const obraIdFila = esEmpleadoAdmin ? (obraAdmin?.id || "") : fila.obra_id

    if (fila.es_prestada && (!fila.grupo_origen_id || !fila.grupo_destino_id)) {
      error.value = `Completa grupo origen y destino en ${formatearFecha(fila.fecha)}`
      return
    }

    if (fila.modo === "cantidad" && !fila.cantidad_horas) {
      error.value = `Ingresá las horas de ${formatearFecha(fila.fecha)}`
      return
    }

    if (fila.modo === "horario" && (!fila.hora_inicio || !fila.hora_fin)) {
      error.value = `Ingresá horario completo en ${formatearFecha(fila.fecha)}`
      return
    }

    const horasNormales = fila.modo === "cantidad"
      ? parseNumeroHoras(fila.cantidad_horas)
      : null

    if (fila.modo === "cantidad" && (!Number.isFinite(horasNormales) || horasNormales <= 0)) {
      error.value = `Las horas de ${formatearFecha(fila.fecha)} no tienen un formato válido`
      return
    }

    const totalHorasFila = fila.modo === "cantidad"
      ? (horasNormales || 0)
      : calcularHorasDesdeHorario(fila.hora_inicio, fila.hora_fin)

    const horasExtra50 = parseNumeroHoras(fila.cantidad_horas_extra_50) || 0
    const horasExtra100 = parseNumeroHoras(fila.cantidad_horas_extra_100) || 0
    const totalExtra = Math.round((horasExtra50 + horasExtra100) * 100) / 100

    const errorExtras = validarDistribucionHorasExtra(
      totalHorasFila,
      fila.cantidad_horas_extra_50,
      fila.cantidad_horas_extra_100
    )

    if (errorExtras) {
      error.value = `${formatearFecha(fila.fecha)}: ${errorExtras}`
      return
    }

    if (horasExtra100 > 0 && !esSabado(fila.fecha)) {
      error.value = `Las horas al 100% solo corresponden a sábado. Revisá ${formatearFecha(fila.fecha)}`
      return
    }

    payloads.push({
      fila: filaOriginal,
      payload: {
        empleado_id: formRango.value.empleado_id,
        cliente_id: esEmpleadoAdmin ? null : (fila.cliente_id || null),
        obra_id: obraIdFila || null,
        fecha: fila.fecha,
        cantidad_horas: fila.modo === "cantidad" ? horasNormales : null,
        cantidad_horas_extra: totalExtra > 0 ? totalExtra : null,
        cantidad_horas_extra_50: horasExtra50 > 0 ? horasExtra50 : null,
        cantidad_horas_extra_100: horasExtra100 > 0 ? horasExtra100 : null,
        hora_inicio: fila.modo === "horario" ? fila.hora_inicio || null : null,
        hora_fin: fila.modo === "horario" ? fila.hora_fin || null : null,
        es_hora_extra: totalExtra > 0,
        tipo_hora_extra: horasExtra100 > 0 && horasExtra50 === 0 ? "100" : (totalExtra > 0 ? "50" : null),
        observaciones: fila.observaciones || "",
        es_prestada: fila.es_prestada,
        grupo_origen_id: fila.es_prestada ? fila.grupo_origen_id : null,
        grupo_destino_id: fila.es_prestada ? fila.grupo_destino_id : null,
      }
    })
    }
  }

  saving.value = true
  try {
    let conflictosDetectados = null
    if (cargaRangoMultiple.value) {
      conflictosDetectados = await detectarConflictosCargaRango({
        payloads,
        empleadosObjetivo,
        fechaDesde: formRango.value.fecha_desde,
        fechaHasta: formRango.value.fecha_hasta,
      })

      if (conflictosDetectados.total > 0 && !accionConflictos) {
        conflictoCargaRangoVisible.value = true
        conflictoCargaRangoResumen.value = conflictosDetectados.resumen
        conflictoCargaRangoTotal.value = conflictosDetectados.total
        saving.value = false
        return
      }
    }

    const clavesEliminadas = new Set()
    for (const item of payloads) {
      const key = getPayloadRangoKey(item.payload)

      if (cargaRangoMultiple.value && conflictosDetectados?.existentesPorKey?.has(key)) {
        if (accionConflictos === "omitir") {
          continue
        }

        if (accionConflictos === "reemplazar" && !clavesEliminadas.has(key)) {
          const existentes = conflictosDetectados.existentesPorKey.get(key) || []
          for (const existente of existentes) {
            await api.deleteHora(existente.id)
          }
          clavesEliminadas.add(key)
        }
      }

      if (item.fila?.tieneRegistrosExistentes && item.fila.existenteIds.length > 0) {
        for (const id of item.fila.existenteIds) {
          await api.deleteHora(id)
        }
      }

      await api.createHora(item.payload)
    }

    guardarUltimaCargaRapida({
      empleado_id: payloads[payloads.length - 1]?.payload.empleado_id,
      cliente_id: payloads[payloads.length - 1]?.payload.cliente_id,
      obra_id: payloads[payloads.length - 1]?.payload.obra_id,
      fecha: formRango.value.fecha_hasta,
    })

    resetConflictoCargaRango()
    await loadHoras()
    closeModalRango()
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    error.value = cargaRangoMultiple.value
      ? `Error al generar registros múltiples de horas: ${detalle}`
      : `Error al generar registros de horas: ${detalle}`
    console.error(err)
  } finally {
    saving.value = false
  }
}

// Eliminar hora
const deleteHora = async (id) => {
  if (!confirm("¿Eliminar este registro de horas?")) return

  saving.value = true
  try {
    await api.deleteHora(id)
    await loadHoras()
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    error.value = `Error al eliminar hora: ${detalle}`
    console.error(err)
  } finally {
    saving.value = false
  }
}

// Helpers
const getNombreEmpleado = (empleadoId) => {
  const emp = empleados.value.find((e) => e.id === empleadoId)
  return emp ? `${emp.nombre} ${emp.apellido}` : "-"
}

const getNombreCliente = (clienteId) => {
  if (!clienteId) return "Sin cliente"
  const cliente = clientes.value.find((c) => String(c.id) === String(clienteId))
  return cliente?.empresa || cliente?.razon_social || "Sin cliente"
}

const getNombreObra = (obraId) => {
  if (!obraId) return "Sin obra"
  const obra = obras.value.find((o) => String(o.id) === String(obraId))
  if (!obra) return "Sin obra"
  return isObraAdministrativa(obra) ? "Administracion" : obra.nombre
}

const getEtiquetaObraClienteResumen = (item) => {
  const nombreObra = item?.obra_nombre || getNombreObra(item?.obra_id)
  if (!item?.obra_id || nombreObra === "Administracion" || nombreObra === "Sin obra") {
    return nombreObra
  }

  const obra = obras.value.find((o) => String(o.id) === String(item.obra_id))
  if (!obra?.cliente_id) return nombreObra

  const nombreCliente = getNombreCliente(obra.cliente_id)
  if (!nombreCliente || nombreCliente === "Sin cliente") return nombreObra

  return `${nombreObra} - ${nombreCliente}`
}

const getNombreObraRegistro = (hora) => {
  const clienteNombre = hora?.cliente_id ? getNombreCliente(hora.cliente_id) : ""
  if (!hora?.obra_id) return "Sin obra"
  const obra = obras.value.find((o) => String(o.id) === String(hora?.obra_id))
  if (!obra) return "Sin obra"

  if (isObraAdministrativa(obra) && isEmpleadoAdministrativo(hora?.empleado_id)) {
    return "Administracion"
  }

  return clienteNombre ? `${clienteNombre} / ${obra.nombre}` : obra.nombre
}

const getNombreGrupo = (grupoId) => {
  const grupo = grupos.value.find((g) => String(g.id) === String(grupoId))
  return grupo ? grupo.nombre : "-"
}

const formatearFecha = (fecha) => {
  if (!fecha) return "-"
  const date = getDateObject(fecha)
  return date ? date.toLocaleDateString("es-AR") : "-"
}

const getCantidadHoras = (hora) => {
  const valor =
    hora?.cantidad_horas ??
    hora?.horas_trabajadas ??
    hora?.cantidad_hora ??
    hora?.horas ??
    0
  const numero = Number(valor)
  return Number.isFinite(numero) ? numero : 0
}

const horasAgrupadasPorEmpleado = computed(() => {
  const grupos = new Map()

  for (const hora of horas.value) {
    const empId = hora.empleado_id || "sin_empleado"
    if (!grupos.has(empId)) {
      grupos.set(empId, {
        empleado_id: empId,
        empleado: getNombreEmpleado(hora.empleado_id),
        totalHoras: 0,
        registros: []
      })
    }

    const grupo = grupos.get(empId)
    grupo.registros.push(hora)
    grupo.totalHoras += getCantidadHoras(hora)
  }

  return Array.from(grupos.values())
    .map((grupo) => {
      const registrosOrdenados = [...grupo.registros].sort((a, b) => {
        const fechaB = getDateObject(b.fecha)?.getTime() || 0
        const fechaA = getDateObject(a.fecha)?.getTime() || 0
        return fechaB - fechaA
      })

      return {
        ...grupo,
        registros: registrosOrdenados,
        ultimaFecha: registrosOrdenados[0]?.fecha || null,
        proximaFecha: getProximaFechaPorRegistros(registrosOrdenados),
      }
    })
    .sort((a, b) => a.empleado.localeCompare(b.empleado, "es", { sensitivity: "base" }))
})

const toggleEmpleadoHoras = (empleadoId) => {
  if (expandedEmpleadosHoras.value.has(empleadoId)) {
    expandedEmpleadosHoras.value.delete(empleadoId)
  } else {
    expandedEmpleadosHoras.value.add(empleadoId)
  }
  expandedEmpleadosHoras.value = new Set(expandedEmpleadosHoras.value)
}

const prestadasAgrupadasEmpleado = computed(() => {
  const byEmpleado = new Map()

  for (const item of resumenPrestadas.value || []) {
    const key = item.empleado || "Empleado"
    if (!byEmpleado.has(key)) {
      byEmpleado.set(key, {
        empleado: key,
        totalHoras: 0,
        registros: []
      })
    }

    const grupo = byEmpleado.get(key)
    const hs = Number(item.cantidad_horas || 0)
    grupo.totalHoras += Number.isFinite(hs) ? hs : 0
    grupo.registros.push(item)
  }

  return Array.from(byEmpleado.values())
    .map((g) => ({
      ...g,
      registros: g.registros.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    }))
    .sort((a, b) => b.totalHoras - a.totalHoras)
})

const togglePrestadasEmpleado = (empleado) => {
  if (expandedPrestadas.value.has(empleado)) {
    expandedPrestadas.value.delete(empleado)
  } else {
    expandedPrestadas.value.add(empleado)
  }
  expandedPrestadas.value = new Set(expandedPrestadas.value)
}

const generarResumenPdf = async () => {
  const mesNombre = nombresMes[Math.max(0, Number(filtroMes.value) - 1)] || `Mes ${filtroMes.value}`
  const ok = window.confirm(`Confirmación: ¿Querés generar el resumen PDF de ${mesNombre} ${filtroAnio.value}?`)
  if (!ok) return

  try {
    const res = await api.getResumenHorasPdf(filtroMes.value, filtroAnio.value)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `Resumen Horas ${mesNombre} ${filtroAnio.value}.pdf`
    link.click()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    error.value = `No se pudo generar el PDF: ${detalle}`
  }
}

// Aplicar filtros
const aplicarFiltros = async () => {
  if (activeTab.value === "carga") {
    await loadHoras()
  } else {
    await loadResumenes()
  }
}

onMounted(async () => {
  await loadDatos()
  await loadHoras()
  window.addEventListener("keydown", handleKeyboardShortcutDown)
  window.addEventListener("keyup", handleKeyboardShortcutUp)
  socket.on('horas:changed', loadHoras)
})
onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyboardShortcutDown)
  window.removeEventListener("keyup", handleKeyboardShortcutUp)
  socket.off('horas:changed', loadHoras)
})
</script>

<template>
  <LayoutShell
    title="Horas"
    subtitle="Registro y control de horas trabajadas"
  >
    <div class="horas-container">
      <!-- Tabs principales -->
      <div class="tabs">
        <button
          :class="['tab', { active: activeTab === 'carga' }]"
          @click="activeTab = 'carga'"
        >
          Carga de horas
        </button>
        <button
          :class="['tab', { active: activeTab === 'resumen' }]"
          @click="activeTab = 'resumen'; loadResumenes()"
        >
          Resumen
        </button>
      </div>

      <!-- Tab: Carga -->
      <div v-if="activeTab === 'carga'" class="tab-content">
        <!-- Subtabs de modalidad -->
        <div class="subtabs">
          <button
            :class="['subtab', { active: modalidadCarga === 'diaria' }]"
            @click="modalidadCarga = 'diaria'"
          >
            Carga diaria
          </button>
          <button
            :class="['subtab', { active: modalidadCarga === 'rango' }]"
            @click="modalidadCarga = 'rango'"
          >
            Carga por rango
          </button>
        </div>

        <!-- Modalidad: Carga diaria -->
        <div v-if="modalidadCarga === 'diaria'" class="modalidad-content">
          <section class="horas-topbar">
            <div class="horas-topbar-copy">
              <span class="section-kicker">Registro operativo</span>
              <h2>Carga diaria</h2>
              <p>Controlá las horas trabajadas por empleado, filtrá por período y mantené el seguimiento más ordenado.</p>
            </div>
            <button class="btn-primary horas-main-btn" @click="openModalDiaria()">
              + Registrar hora
            </button>
          </section>

          <div class="atajos-bar">
            <span><strong>⌨️ Atajos:</strong></span>
            <span><kbd>Ctrl</kbd> nueva carga</span>
            <span><kbd>Ctrl</kbd> + <kbd>Shift</kbd> cargar de nuevo al último empleado</span>
            <span><kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> navegar</span>
            <span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> guardar</span>
            <span><kbd>Esc</kbd> cerrar</span>
          </div>

          <!-- Filtros -->
          <div class="filtros">
            <div class="filtro-grupo">
              <label>Mes:</label>
              <select v-model.number="filtroMes" @change="aplicarFiltros">
                <option value="1">Enero</option>
                <option value="2">Febrero</option>
                <option value="3">Marzo</option>
                <option value="4">Abril</option>
                <option value="5">Mayo</option>
                <option value="6">Junio</option>
                <option value="7">Julio</option>
                <option value="8">Agosto</option>
                <option value="9">Septiembre</option>
                <option value="10">Octubre</option>
                <option value="11">Noviembre</option>
                <option value="12">Diciembre</option>
              </select>
            </div>

            <div class="filtro-grupo">
              <label>Año:</label>
              <input
                v-model.number="filtroAnio"
                type="number"
                @change="aplicarFiltros"
              />
            </div>

            <div class="filtro-grupo">
              <label>Empleado:</label>
              <select v-model="filtroEmpleado" @change="aplicarFiltros">
                <option value="">Todos</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </div>

            <div class="filtro-grupo">
              <label>Obra:</label>
              <select v-model="filtroObra" @change="aplicarFiltros">
                <option value="">Todas</option>
                <option v-for="obra in obrasNoAdministrativas" :key="obra.id" :value="obra.id">
                  {{ obra.nombre }}
                </option>
              </select>
            </div>
          </div>

          <!-- Mensaje de error -->
          <div v-if="error" class="error-alert">
            {{ error }}
          </div>

          <!-- Lista desplegable por empleado -->
          <div v-if="!loadingHoras && horas.length > 0" class="acordeon-empleados">
            <div
              v-for="grupo in horasAgrupadasPorEmpleado"
              :key="grupo.empleado_id"
              class="acordeon-item"
            >
              <div class="acordeon-header">
                <button class="acordeon-toggle" @click="toggleEmpleadoHoras(grupo.empleado_id)">
                  <div class="acordeon-titulo">
                    <span class="flecha" :class="{ abierta: expandedEmpleadosHoras.has(grupo.empleado_id) }">▶</span>
                    <span>{{ grupo.empleado }}</span>
                  </div>
                  <div class="acordeon-meta">
                    <span>{{ grupo.registros.length }} registros</span>
                    <span>{{ formatearHoras(grupo.totalHoras) }} hs</span>
                    <span v-if="grupo.ultimaFecha">Último: {{ formatearFecha(grupo.ultimaFecha) }}</span>
                  </div>
                </button>
                <button
                  v-if="grupo.empleado_id !== 'sin_empleado'"
                  class="btn-recarga"
                  @click="abrirCargaRapidaEmpleado(grupo)"
                >
                  + Cargar de nuevo
                </button>
              </div>

              <div v-if="expandedEmpleadosHoras.has(grupo.empleado_id)" class="acordeon-body">
                <div class="horas-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente / Obra</th>
                        <th>Fecha</th>
                        <th>Horas</th>
                        <th>Tipo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="hora in grupo.registros" :key="hora.id">
                        <td>
                          <div class="hora-main-cell">
                            <strong>{{ hora.obra_id ? getNombreObraRegistro(hora) : getNombreCliente(hora.cliente_id) }}</strong>
                            <small>{{ hora.observaciones || "Sin observaciones" }}</small>
                          </div>
                        </td>
                        <td class="hora-date-cell">{{ formatearFecha(hora.fecha) }}</td>
                        <td class="hora-total-cell">{{ formatearHoras(getCantidadHoras(hora)) }}</td>
                        <td>
                          <span
                            v-if="hora.es_hora_extra"
                            :class="['badge', String(hora.tipo_hora_extra || '') === '100' || String(hora.tipo || '') === 'extra_100' ? 'badge-extra-100' : 'badge-extra']"
                          >
                            {{ getEtiquetaTipoHora(hora) }}
                          </span>
                          <span v-else-if="hora.es_prestada" class="badge badge-prestada">
                            Prestada
                          </span>
                          <span v-else class="badge badge-normal">Normal</span>
                        </td>
                        <td>
                          <div class="acciones acciones-horas">
                            <button class="btn-edit" @click="openModalDiaria(hora)">
                              Editar
                            </button>
                            <button class="btn-delete" @click="deleteHora(hora.id)">
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Estado vacío -->
          <div v-if="!loadingHoras && horas.length === 0" class="empty-state">
            <p>No hay registros de horas en este período</p>
            <button class="btn-primary" @click="openModalDiaria()">
              Registrar primera hora
            </button>
          </div>

          <!-- Cargando -->
          <div v-if="loadingHoras" class="loading">
            Cargando...
          </div>
        </div>

        <!-- Modalidad: Carga por rango -->
        <div v-if="modalidadCarga === 'rango'" class="modalidad-content">
          <section class="horas-topbar">
            <div class="horas-topbar-copy">
              <span class="section-kicker">Carga masiva</span>
              <h2>Carga por rango</h2>
              <p>Generá varios registros en una sola operación para acelerar la carga de semanas completas.</p>
            </div>
            <button class="btn-primary horas-main-btn" @click="showFormRango = true">
              + Nueva carga por rango
            </button>
          </section>

          <div class="rango-info">
            <p>📅 Registra horas para un rango de fechas. El sistema generará automáticamente un registro por cada día hábil (lunes a viernes).</p>
          </div>

          <div v-if="error" class="error-alert">
            {{ error }}
          </div>
        </div>
      </div>

      <!-- Tab: Resumen -->
      <div v-if="activeTab === 'resumen'" class="tab-content">
        <section class="horas-topbar resumen-topbar">
          <div class="horas-topbar-copy">
            <span class="section-kicker">Vista analítica</span>
            <h2>Resumen mensual</h2>
            <p>Consolidá horas por empleado, obra, grupo y préstamos para revisar el período completo con una lectura más clara.</p>
          </div>
          <button class="btn-primary horas-main-btn" @click="generarResumenPdf">
            Generar resumen PDF
          </button>
        </section>

        <!-- Filtros para resumen -->
        <div class="filtros">
          <div class="filtro-grupo">
            <label>Mes:</label>
            <select v-model.number="filtroMes" @change="loadResumenes">
              <option value="1">Enero</option>
              <option value="2">Febrero</option>
              <option value="3">Marzo</option>
              <option value="4">Abril</option>
              <option value="5">Mayo</option>
              <option value="6">Junio</option>
              <option value="7">Julio</option>
              <option value="8">Agosto</option>
              <option value="9">Septiembre</option>
              <option value="10">Octubre</option>
              <option value="11">Noviembre</option>
              <option value="12">Diciembre</option>
            </select>
          </div>

          <div class="filtro-grupo">
            <label>Año:</label>
            <input
              v-model.number="filtroAnio"
              type="number"
              @change="loadResumenes"
            />
          </div>
        </div>

        <!-- Resumen por empleado -->
        <div class="resumen-seccion">
          <h3>Horas por empleado</h3>
          <div v-if="resumenEmpleado.length > 0" class="resumen-tabla">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Total horas</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(emp, idx) in resumenEmpleadoOrdenado" :key="idx">
                  <td>{{ emp.empleado || "-" }}</td>
                  <td>{{ formatearHoras(emp.total_horas) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">Sin datos para este período</p>
        </div>

        <!-- Resumen por obra -->
        <div class="resumen-seccion">
          <h3>Horas por obra</h3>
          <div v-if="resumenObra.length > 0" class="resumen-tabla">
            <table>
              <thead>
                <tr>
                  <th>Obra</th>
                  <th>Total horas</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(obra, idx) in resumenObraOrdenado" :key="idx">
                  <td>{{ getEtiquetaObraClienteResumen(obra) }}</td>
                  <td>{{ formatearHoras(obra.total_horas) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">Sin datos para este período</p>
        </div>

        <!-- Resumen por grupo -->
        <div class="resumen-seccion">
          <h3>Horas por grupo</h3>
          <div v-if="resumenGrupo.length > 0" class="resumen-tabla">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Total horas</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(grupo, idx) in resumenGrupoOrdenado" :key="idx">
                  <td>{{ getNombreGrupo(grupo.grupo_id) }}</td>
                  <td>{{ formatearHoras(grupo.total_horas) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">Sin datos para este período</p>
        </div>

        <!-- Resumen de horas prestadas por empleado -->
        <div class="resumen-seccion">
          <h3>Horas prestadas por empleado</h3>
          <div v-if="prestadasAgrupadasEmpleado.length > 0" class="prestadas-acordeon">
            <div
              v-for="grupo in prestadasAgrupadasEmpleado"
              :key="grupo.empleado"
              class="prestada-item"
            >
              <button class="prestada-header" @click="togglePrestadasEmpleado(grupo.empleado)">
                <div class="prestada-titulo">
                  <span class="flecha" :class="{ abierta: expandedPrestadas.has(grupo.empleado) }">▶</span>
                  <span>{{ grupo.empleado }}</span>
                </div>
                <div class="prestada-meta">
                  <span>{{ grupo.registros.length }} registros</span>
                  <span>{{ formatearHoras(grupo.totalHoras) }} hs</span>
                </div>
              </button>

              <div v-if="expandedPrestadas.has(grupo.empleado)" class="prestada-body resumen-tabla">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Grupo origen</th>
                      <th>Grupo destino</th>
                      <th>Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(prest, idx) in grupo.registros" :key="`${grupo.empleado}-${idx}`">
                      <td>{{ formatearFecha(prest.fecha) }}</td>
                      <td>{{ prest.grupo_origen }}</td>
                      <td>{{ prest.grupo_destino }}</td>
                      <td>{{ formatearHoras(prest.cantidad_horas) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <p v-else class="sin-datos">Sin horas prestadas en este período</p>
        </div>

        <div v-if="loadingResumen" class="loading">
          Cargando resúmenes...
        </div>
      </div>

      <!-- Modal: Carga diaria -->
      <div v-if="showFormDiaria" class="modal-overlay" @click.self="closeModalDiaria">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Registro diario</span>
              <h3>{{ editingId ? "Editar hora" : "Registrar hora diaria" }}</h3>
              <p>Cargá la jornada con sus horas normales, extras o prestadas dentro del mismo flujo operativo.</p>
            </div>
            <button class="btn-close" @click="closeModalDiaria">×</button>
          </div>

          <form @submit.prevent="saveHoraDiaria" class="modal-form">
            <label class="form-group">
              <span>Empleado {{ cargaDiariaMultiple && !editingId ? "(base opcional)" : "*" }}</span>
              <select
                ref="selectEmpleadoDiariaRef"
                v-model="formDiaria.empleado_id"
                :required="!cargaDiariaMultiple || Boolean(editingId)"
              >
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label v-if="!editingId" class="form-group checkbox">
              <input v-model="cargaDiariaMultiple" type="checkbox" />
              <span>Aplicar la misma carga a varios empleados</span>
            </label>

            <div v-if="cargaDiariaMultiple && !editingId" class="multi-empleados-panel">
              <div class="multi-empleados-header">
                <span>Seleccioná empleados</span>
                <div class="multi-empleados-actions">
                  <button type="button" class="btn-link" @click="empleadosMultiplesDiaria = empleados.map((emp) => emp.id)">
                    Marcar todos
                  </button>
                  <button type="button" class="btn-link" @click="empleadosMultiplesDiaria = []">
                    Limpiar
                  </button>
                </div>
              </div>
              <div class="multi-empleados-list">
                <label v-for="emp in empleados" :key="`multi-diaria-${emp.id}`" class="multi-empleado-item">
                  <input v-model="empleadosMultiplesDiaria" type="checkbox" :value="emp.id" />
                  <span>{{ emp.nombre }} {{ emp.apellido }}</span>
                </label>
              </div>
            </div>

            <label v-if="!esCargaDiariaAdminUnica" class="form-group">
              <span>Cliente</span>
              <select v-model="formDiaria.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ cliente.empresa || cliente.razon_social }}
                </option>
              </select>
            </label>

            <label v-if="!esCargaDiariaAdminUnica" class="form-group">
              <span>Obra</span>
              <select v-model="formDiaria.obra_id">
                <option value="">Sin obra</option>
                <option v-for="obra in obrasDisponiblesDiaria" :key="obra.id" :value="obra.id">
                  {{ obra.nombre }}
                </option>
              </select>
            </label>

            <div v-else class="info-rango">
              Obra: <strong>Administracion</strong>
            </div>

            <label class="form-group">
              <span>Fecha *</span>
              <input v-model="formDiaria.fecha" type="date" required />
            </label>

            <div class="modo-selector">
              <label :class="['modo-btn', { active: modoDiaria === 'cantidad' }]">
                <input type="radio" v-model="modoDiaria" value="cantidad" hidden />
                Cantidad de horas
              </label>
              <label :class="['modo-btn', { active: modoDiaria === 'horario' }]">
                <input type="radio" v-model="modoDiaria" value="horario" hidden />
                De hora a hora
              </label>
            </div>

            <label v-if="modoDiaria === 'cantidad'" class="form-group">
              <span>Cantidad de horas *</span>
              <input
                ref="inputCantidadDiariaRef"
                v-model="formDiaria.cantidad_horas"
                type="text"
                inputmode="decimal"
                placeholder="Ej: 8.30"
              />
            </label>

            <div v-if="modoDiaria === 'horario'" class="form-row">
              <label class="form-group">
                <span>Hora inicio *</span>
                <input ref="inputHoraInicioDiariaRef" v-model="formDiaria.hora_inicio" type="time" />
              </label>
              <label class="form-group">
                <span>Hora fin *</span>
                <input v-model="formDiaria.hora_fin" type="time" />
              </label>
            </div>

            <div class="form-row">
              <label class="form-group">
                <span>Horas extra al 50%</span>
                <input
                  v-model="formDiaria.cantidad_horas_extra_50"
                  type="text"
                  inputmode="decimal"
                  placeholder="Ej: 0.30"
                />
              </label>

              <label v-if="esSabadoDiaria" class="form-group">
                <span>Horas extra al 100%</span>
                <input
                  v-model="formDiaria.cantidad_horas_extra_100"
                  type="text"
                  inputmode="decimal"
                  placeholder="Ej: 0.30"
                />
              </label>
            </div>

            <div class="info-rango">
              <div>Formato de carga: <strong>hora real</strong>. Ejemplos: <strong>8.30</strong> = 8 horas y media, <strong>0.30</strong> = media hora.</div>
              <template v-if="esSabadoDiaria">
                Podés separar en la misma carga cuántas horas van al <strong>50%</strong> y cuántas al <strong>100%</strong>.
              </template>
              <template v-else>
                Para este día solo se habilitan <strong>horas extra al 50%</strong>. Las horas al <strong>100%</strong> se cargan únicamente en <strong>sábados</strong>.
              </template>
            </div>

            <label class="form-group checkbox">
              <input v-model="formDiaria.es_prestada" type="checkbox" />
              <span>Es hora prestada (entre grupos)</span>
            </label>

            <label class="form-group">
              <span>Observación</span>
              <textarea
                v-model="formDiaria.observaciones"
                rows="3"
                placeholder="Aclaración opcional sobre este registro..."
              ></textarea>
            </label>

            <template v-if="formDiaria.es_prestada">
              <label class="form-group">
                <span>Grupo origen *</span>
                <select v-model="formDiaria.grupo_origen_id" required>
                  <option value="">Seleccionar grupo...</option>
                  <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                    {{ grupo.nombre }}
                  </option>
                </select>
              </label>

              <label class="form-group">
                <span>Grupo destino *</span>
                <select v-model="formDiaria.grupo_destino_id" required>
                  <option value="">Seleccionar grupo...</option>
                  <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                    {{ grupo.nombre }}
                  </option>
                </select>
              </label>
            </template>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="saving">
                {{ saving ? "Guardando..." : "Guardar" }}
              </button>
              <button type="button" class="btn-secondary" @click="closeModalDiaria">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Modal: Carga por rango -->
      <div v-if="showFormRango" class="modal-overlay" @click.self="closeModalRango">
        <div class="modal modal-rango">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Registro por rango</span>
              <h3>Registrar horas por rango de fechas</h3>
              <p>Prepará una plantilla para varios días y resolvé la carga masiva con menos pasos manuales.</p>
            </div>
            <button class="btn-close" @click="closeModalRango">×</button>
          </div>

          <form @submit.prevent="saveHoraRango" class="modal-form">
            <label class="form-group">
              <span>Empleado {{ cargaRangoMultiple ? "(base opcional)" : "*" }}</span>
              <select
                ref="selectEmpleadoRangoRef"
                v-model="formRango.empleado_id"
                :required="!cargaRangoMultiple"
              >
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label class="form-group checkbox">
              <input v-model="cargaRangoMultiple" type="checkbox" />
              <span>Aplicar la plantilla a varios empleados</span>
            </label>

            <div v-if="cargaRangoMultiple" class="multi-empleados-panel">
              <div class="multi-empleados-header">
                <span>Seleccioná empleados</span>
                <div class="multi-empleados-actions">
                  <button type="button" class="btn-link" @click="empleadosMultiplesRango = empleados.map((emp) => emp.id)">
                    Marcar todos
                  </button>
                  <button type="button" class="btn-link" @click="empleadosMultiplesRango = []">
                    Limpiar
                  </button>
                </div>
              </div>
              <div class="multi-empleados-list">
                <label v-for="emp in empleados" :key="`multi-rango-${emp.id}`" class="multi-empleado-item">
                  <input v-model="empleadosMultiplesRango" type="checkbox" :value="emp.id" />
                  <span>{{ emp.nombre }} {{ emp.apellido }}</span>
                </label>
              </div>
            </div>

            <label v-if="!esCargaRangoAdminUnica" class="form-group">
              <span>Cliente</span>
              <select v-model="formRango.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ cliente.empresa || cliente.razon_social }}
                </option>
              </select>
            </label>

            <label v-if="!esCargaRangoAdminUnica" class="form-group">
              <span>Obra</span>
              <select v-model="formRango.obra_id">
                <option value="">Sin obra</option>
                <option v-for="obra in obrasDisponiblesRango" :key="obra.id" :value="obra.id">
                  {{ obra.nombre }}
                </option>
              </select>
            </label>

            <div v-else class="info-rango">
              Obra: <strong>Administracion</strong>
            </div>

            <div class="form-row">
              <label class="form-group">
                <span>Desde fecha *</span>
                <input v-model="formRango.fecha_desde" type="date" required />
              </label>

              <label class="form-group">
                <span>Hasta fecha *</span>
                <input v-model="formRango.fecha_hasta" type="date" required />
              </label>
            </div>

            <div class="info-rango">
              <div>Definí una plantilla general y usala para todo el rango. Después sólo abrís excepciones en los días que cambian.</div>
              <div>Formato de carga: <strong>hora real</strong>. Ejemplos: <strong>8.30</strong> = 8 horas y media, <strong>0.30</strong> = media hora.</div>
              <div>Los domingos se omiten automáticamente. Si un día ya tenía varios registros, queda bloqueado para no pisar información mezclada.</div>
            </div>

            <div v-if="conflictoCargaRangoVisible" class="conflicto-rango-box">
              <h4>Ya existen registros para parte de la carga</h4>
              <p>
                Se detectaron <strong>{{ conflictoCargaRangoTotal }}</strong> coincidencias de
                empleado + fecha.
              </p>
              <div class="conflicto-rango-list">
                <div v-for="item in conflictoCargaRangoResumen" :key="`conflicto-${item.empleadoId}`" class="conflicto-rango-item">
                  <strong>{{ item.empleado }}</strong>
                  <span>{{ item.fechas.map((f) => formatearFecha(f)).join(", ") }}</span>
                </div>
              </div>
              <div class="conflicto-rango-actions">
                <button type="button" class="btn-secondary" @click="cancelarConflictoCargaRango">
                  Cancelar
                </button>
                <button type="button" class="btn-secondary" @click="resolverConflictoCargaRango('omitir')" :disabled="saving">
                  Omitir existentes
                </button>
                <button type="button" class="btn-primary" @click="resolverConflictoCargaRango('reemplazar')" :disabled="saving">
                  Reemplazar existentes
                </button>
              </div>
            </div>

            <div v-if="cargaRangoMultiple" class="loading-rango-dias">
              Se aplicará esta plantilla a {{ empleadosMultiplesRango.length }} empleado(s)
              en {{ getDiasRango(formRango.fecha_desde, formRango.fecha_hasta).length }} día(s) hábil(es).
              <br />
              Tip: en modo múltiple no se sobrescriben registros existentes automáticamente.
            </div>

            <div v-else-if="loadingRangoDias" class="loading-rango-dias">
              Preparando días del rango...
            </div>

            <div v-else-if="rangoDias.length > 0" class="rango-grid-wrapper">
              <div class="rango-template-card">
                <div class="rango-grid-header">
                  <strong>Plantilla general</strong>
                  <div class="rango-template-actions">
                    <button type="button" class="btn-secondary btn-small" @click="aplicarPrimerDiaATodos">
                      Tomar primer día como plantilla
                    </button>
                    <button type="button" class="btn-secondary btn-small" @click="aplicarPlantillaATodosLosDias">
                      Aplicar plantilla a todos
                    </button>
                  </div>
                </div>

                <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group compact">
                  <span>Cliente</span>
                  <select v-model="formRango.cliente_id">
                    <option value="">Sin cliente</option>
                    <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                      {{ cliente.empresa || cliente.razon_social }}
                    </option>
                  </select>
                </label>

                <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group compact">
                  <span>Obra</span>
                  <select v-model="formRango.obra_id">
                    <option value="">Sin obra</option>
                    <option v-for="obra in obrasDisponiblesRango" :key="obra.id" :value="obra.id">
                      {{ obra.nombre }}
                    </option>
                  </select>
                </label>

                <div v-else class="info-rango compact">
                  Obra: <strong>Administracion</strong>
                </div>

                <div class="modo-selector compact">
                  <label :class="['modo-btn', { active: modoRango === 'cantidad' }]">
                    <input v-model="modoRango" type="radio" value="cantidad" hidden />
                    Cantidad
                  </label>
                  <label :class="['modo-btn', { active: modoRango === 'horario' }]">
                    <input v-model="modoRango" type="radio" value="horario" hidden />
                    Horario
                  </label>
                </div>

                <label v-if="modoRango === 'cantidad'" class="form-group compact">
                  <span>Horas de la plantilla</span>
                  <input v-model="formRango.cantidad_horas" type="text" inputmode="decimal" placeholder="Ej: 8.30" />
                </label>

                <div v-else class="form-row compact-row">
                  <label class="form-group compact">
                    <span>Inicio</span>
                    <input v-model="formRango.hora_inicio" type="time" />
                  </label>
                  <label class="form-group compact">
                    <span>Fin</span>
                    <input v-model="formRango.hora_fin" type="time" />
                  </label>
                </div>

                <div class="form-row compact-row">
                  <label class="form-group compact">
                    <span>Extra 50%</span>
                    <input v-model="formRango.cantidad_horas_extra_50" type="text" inputmode="decimal" placeholder="0.30" />
                  </label>
                  <label class="form-group compact">
                    <span>Extra 100% para sábados</span>
                    <input v-model="formRango.cantidad_horas_extra_100" type="text" inputmode="decimal" placeholder="0.30" />
                  </label>
                </div>

                <label class="form-group checkbox compact">
                  <input v-model="formRango.es_prestada" type="checkbox" />
                  <span>Hora prestada</span>
                </label>

                <div v-if="formRango.es_prestada" class="form-row compact-row">
                  <label class="form-group compact">
                    <span>Grupo origen</span>
                    <select v-model="formRango.grupo_origen_id">
                      <option value="">Seleccionar grupo...</option>
                      <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                        {{ grupo.nombre }}
                      </option>
                    </select>
                  </label>
                  <label class="form-group compact">
                    <span>Grupo destino</span>
                    <select v-model="formRango.grupo_destino_id">
                      <option value="">Seleccionar grupo...</option>
                      <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                        {{ grupo.nombre }}
                      </option>
                    </select>
                  </label>
                </div>

                <label class="form-group compact">
                  <span>Observación</span>
                  <input v-model="formRango.observaciones" type="text" placeholder="Opcional para todo el rango" />
                </label>
              </div>

              <div class="rango-grid-header">
                <strong>{{ rangoDias.length }} días en el rango</strong>
                <span class="rango-grid-hint">Personalizá sólo los días distintos.</span>
              </div>

              <div class="rango-grid">
                <div
                  v-for="(dia, index) in rangoDias"
                  :key="dia.key"
                  class="rango-day-card"
                  :class="{ bloqueado: dia.tieneMultiplesRegistros }"
                >
                  <div class="rango-day-top">
                    <div>
                      <strong>{{ formatearFecha(dia.fecha) }}</strong>
                      <div class="rango-day-date-raw">{{ dia.fecha }}</div>
                    </div>
                    <div class="rango-day-badges">
                      <span v-if="!dia.tieneMultiplesRegistros" :class="['badge', dia.personalizado ? 'badge-warning' : 'badge-normal']">
                        {{ dia.personalizado ? 'Excepción' : 'Plantilla' }}
                      </span>
                      <span v-if="dia.tieneRegistrosExistentes && !dia.tieneMultiplesRegistros" class="badge badge-warning">Ya cargado</span>
                      <span v-if="dia.tieneMultiplesRegistros" class="badge badge-danger">Varios registros</span>
                      <span v-if="esSabado(dia.fecha)" class="badge badge-extra-100">Sábado</span>
                    </div>
                  </div>

                  <label class="form-group checkbox compact">
                    <input v-model="dia.incluir" type="checkbox" :disabled="dia.tieneMultiplesRegistros" />
                    <span>Incluir este día</span>
                  </label>

                  <div v-if="dia.tieneMultiplesRegistros" class="info-rango warning">
                    Este día ya tiene varios registros. Para no mezclar datos distintos, editá ese caso desde <strong>Carga diaria</strong>.
                  </div>

                  <template v-else>
                    <div class="rango-day-actions">
                      <button type="button" class="btn-secondary btn-small" @click="setPersonalizacionDiaRango(index, !dia.personalizado)">
                        {{ dia.personalizado ? 'Usar plantilla' : 'Personalizar día' }}
                      </button>
                      <button type="button" class="btn-secondary btn-small" @click="copiarDiaAnteriorRango(index)" :disabled="index === 0">
                        Copiar día anterior
                      </button>
                    </div>

                    <div class="rango-day-summary">
                      {{ getResumenDiaRango(dia) }}
                    </div>

                    <div v-if="dia.personalizado" class="rango-day-editor">
                      <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group compact">
                        <span>Cliente</span>
                        <select v-model="dia.cliente_id" @change="handleFilaRangoClienteChange(dia)">
                          <option value="">Sin cliente</option>
                          <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                            {{ cliente.empresa || cliente.razon_social }}
                          </option>
                        </select>
                      </label>

                      <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group compact">
                        <span>Obra</span>
                        <select v-model="dia.obra_id" @change="handleFilaRangoObraChange(dia)">
                          <option value="">Sin obra</option>
                          <option v-for="obra in getObrasDisponiblesFilaRango(dia.cliente_id)" :key="obra.id" :value="obra.id">
                            {{ obra.nombre }}
                          </option>
                        </select>
                      </label>

                      <div v-else class="info-rango compact">
                        Obra: <strong>Administracion</strong>
                      </div>

                      <div class="modo-selector compact">
                        <label :class="['modo-btn', { active: dia.modo === 'cantidad' }]">
                          <input type="radio" v-model="dia.modo" value="cantidad" hidden />
                          Cantidad
                        </label>
                        <label :class="['modo-btn', { active: dia.modo === 'horario' }]">
                          <input type="radio" v-model="dia.modo" value="horario" hidden />
                          Horario
                        </label>
                      </div>

                      <label v-if="dia.modo === 'cantidad'" class="form-group compact">
                        <span>Horas</span>
                        <input v-model="dia.cantidad_horas" type="text" inputmode="decimal" placeholder="Ej: 8.30" />
                      </label>

                      <div v-else class="form-row compact-row">
                        <label class="form-group compact">
                          <span>Inicio</span>
                          <input v-model="dia.hora_inicio" type="time" />
                        </label>
                        <label class="form-group compact">
                          <span>Fin</span>
                          <input v-model="dia.hora_fin" type="time" />
                        </label>
                      </div>

                      <div class="form-row compact-row">
                        <label class="form-group compact">
                          <span>Extra 50%</span>
                          <input v-model="dia.cantidad_horas_extra_50" type="text" inputmode="decimal" placeholder="0.30" />
                        </label>
                        <label class="form-group compact" v-if="esSabado(dia.fecha)">
                          <span>Extra 100%</span>
                          <input v-model="dia.cantidad_horas_extra_100" type="text" inputmode="decimal" placeholder="0.30" />
                        </label>
                      </div>

                      <label class="form-group checkbox compact">
                        <input v-model="dia.es_prestada" type="checkbox" />
                        <span>Hora prestada</span>
                      </label>

                      <div v-if="dia.es_prestada" class="form-row compact-row">
                        <label class="form-group compact">
                          <span>Grupo origen</span>
                          <select v-model="dia.grupo_origen_id">
                            <option value="">Seleccionar grupo...</option>
                            <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                              {{ grupo.nombre }}
                            </option>
                          </select>
                        </label>
                        <label class="form-group compact">
                          <span>Grupo destino</span>
                          <select v-model="dia.grupo_destino_id">
                            <option value="">Seleccionar grupo...</option>
                            <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                              {{ grupo.nombre }}
                            </option>
                          </select>
                        </label>
                      </div>

                      <label class="form-group compact">
                        <span>Observación</span>
                        <input v-model="dia.observaciones" type="text" placeholder="Opcional" />
                      </label>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="saving">
                {{ saving ? "Guardando..." : "Guardar días del rango" }}
              </button>
              <button type="button" class="btn-secondary" @click="closeModalRango">
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
.modo-selector {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.modo-btn {
  flex: 1;
  text-align: center;
  padding: 0.5rem 1rem;
  background-color: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.375rem;
  color: #94a3b8;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.modo-btn:hover {
  background-color: rgba(30, 41, 59, 0.8);
  border-color: rgba(148, 163, 184, 0.3);
}

.modo-btn.active {
  background-color: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.modo-selector.compact {
  margin-bottom: 0.75rem;
}

.btn-small {
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
}

.loading-rango-dias {
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}

.rango-grid-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rango-grid-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.rango-grid-hint {
  color: #94a3b8;
  font-size: 0.9rem;
}

.rango-template-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  margin-bottom: 1rem;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(59, 130, 246, 0.25);
  border-radius: 0.9rem;
}

.rango-template-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.rango-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.rango-day-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.75rem;
}

.rango-day-card.bloqueado {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(69, 10, 10, 0.22);
}

.rango-day-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.rango-day-date-raw {
  margin-top: 0.2rem;
  color: #94a3b8;
  font-size: 0.8rem;
}

.rango-day-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

.rango-day-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.rango-day-summary {
  color: #cbd5e1;
  font-size: 0.95rem;
  line-height: 1.5;
}

.rango-day-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.compact {
  margin-bottom: 0;
}

.compact-row {
  gap: 0.75rem;
}

.info-rango.compact {
  margin-bottom: 0;
  padding: 0.75rem 1rem;
}

.info-rango.warning {
  background-color: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fecaca;
}

@media (max-width: 720px) {
  .rango-grid-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .rango-template-actions,
  .rango-day-actions {
    width: 100%;
    justify-content: stretch;
  }

  .rango-template-actions .btn-small,
  .rango-day-actions .btn-small {
    flex: 1 1 100%;
  }
}
.horas-container {
  padding: 1.5rem;
  display: grid;
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

.tabs {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  padding: 0.55rem;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 1rem;
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.28);
}

.tab {
  padding: 0.82rem 1.2rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.8rem;
  color: #94a3b8;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.68);
}

.tab.active {
  color: #eff6ff;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95));
  border-color: rgba(96, 165, 250, 0.4);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.22);
}

.subtabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  padding: 0.45rem;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.9rem;
}

.subtab {
  padding: 0.72rem 1rem;
  background-color: transparent;
  border: 1px solid transparent;
  color: #94a3b8;
  font-weight: 700;
  font-size: 0.875rem;
  cursor: pointer;
  border-radius: 0.7rem;
  transition: all 0.2s;
}

.subtab:hover {
  background-color: rgba(30, 41, 59, 0.72);
  border-color: rgba(148, 163, 184, 0.24);
}

.subtab.active {
  background: rgba(59, 130, 246, 0.16);
  border-color: rgba(96, 165, 250, 0.34);
  color: #dbeafe;
}

.tab-content,
.modalidad-content {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.rango-info {
  padding: 1rem 1.5rem;
  background: linear-gradient(180deg, rgba(30, 64, 175, 0.16), rgba(15, 23, 42, 0.72));
  border: 1px solid rgba(96, 165, 250, 0.26);
  border-radius: 0.9rem;
  color: #93c5fd;
  margin-bottom: 1.2rem;
  font-size: 0.9375rem;
}

.horas-topbar,
.filtros,
.atajos-bar,
.empty-state,
.resumen-seccion,
.prestada-item,
.acordeon-item {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.32);
}

.horas-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  margin-bottom: 1.2rem;
  border-radius: 1rem;
}

.horas-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.horas-topbar-copy h2 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.horas-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 64ch;
  line-height: 1.45;
}

.horas-main-btn {
  white-space: nowrap;
}

.horas-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.2rem;
}

.filtros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.35rem;
  padding: 1.5rem;
  border-radius: 1rem;
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
.filtro-grupo input {
  min-height: 3rem;
  padding: 0.78rem 0.9rem;
  background-color: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.filtro-grupo select:focus,
.filtro-grupo input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.error-alert {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.acordeon-empleados {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.acordeon-item {
  border-radius: 0.9rem;
  overflow: hidden;
}

.acordeon-header {
  width: 100%;
  padding: 0.85rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  background: rgba(30, 41, 59, 0.56);
}

.acordeon-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  background: transparent;
  border: none;
  color: #e2e8f0;
  cursor: pointer;
  padding: 0.25rem 0;
  text-align: left;
}

.acordeon-toggle:hover {
  color: #f8fafc;
}

.acordeon-titulo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.flecha {
  font-size: 0.7rem;
  color: #93c5fd;
  transition: transform 0.2s;
}

.flecha.abierta {
  transform: rotate(90deg);
}

.acordeon-meta {
  display: flex;
  gap: 1rem;
  color: #93c5fd;
  font-size: 0.85rem;
  align-items: center;
  flex-wrap: wrap;
}

.btn-recarga {
  padding: 0.35rem 0.75rem;
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 9999px;
  background: rgba(59, 130, 246, 0.14);
  color: #93c5fd;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-recarga:hover {
  background: rgba(59, 130, 246, 0.24);
  border-color: rgba(96, 165, 250, 0.7);
}

.acordeon-body {
  padding: 1.1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.horas-table {
  overflow-x: auto;
  margin-bottom: 0.25rem;
  padding: 0.15rem;
  background: rgba(8, 14, 30, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 0.9rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.8rem;
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
  vertical-align: middle;
}

.hora-main-cell {
  display: grid;
  gap: 0.22rem;
  min-width: 280px;
}

.hora-main-cell strong {
  color: #f8fafc;
  font-size: 0.98rem;
  font-weight: 600;
}

.hora-main-cell small {
  color: #94a3b8;
  font-size: 0.8rem;
  line-height: 1.35;
}

.hora-date-cell {
  white-space: nowrap;
  color: #e2e8f0;
}

.hora-total-cell {
  white-space: nowrap;
  color: #93c5fd;
  font-weight: 700;
  font-size: 1rem;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.badge-normal {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.badge-prestada {
  background-color: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.badge-extra {
  background-color: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

.badge-extra-100 {
  background-color: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
}

.acciones {
  display: flex;
  gap: 0.5rem;
}

.acciones-horas {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.btn-edit,
.btn-delete {
  min-height: 2.2rem;
  padding: 0.45rem 0.82rem;
  border: 1px solid transparent;
  border-radius: 0.65rem;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-edit {
  background-color: rgba(30, 64, 175, 0.36);
  color: #bfdbfe;
  border-color: rgba(96, 165, 250, 0.22);
}

.btn-edit:hover {
  background-color: rgba(30, 64, 175, 0.54);
  border-color: rgba(147, 197, 253, 0.42);
}

.btn-delete {
  background-color: rgba(127, 29, 29, 0.32);
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.18);
}

.btn-delete:hover {
  background-color: rgba(153, 27, 27, 0.5);
  border-color: rgba(252, 165, 165, 0.32);
}

.atajos-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  align-items: center;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  border-radius: 0.9rem;
  color: #cbd5e1;
  font-size: 0.85rem;
}

.atajos-bar kbd {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 0.35rem;
  background: rgba(30, 41, 59, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #f8fafc;
  font-size: 0.78rem;
  font-family: inherit;
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

/* Resumen */
.resumen-seccion {
  margin-bottom: 2rem;
  padding: 1.5rem;
  border-radius: 1rem;
}

.resumen-seccion h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #e2e8f0;
  font-size: 1.125rem;
}

.resumen-tabla {
  overflow-x: auto;
}

.resumen-tabla table {
  width: 100%;
  margin-bottom: 1rem;
}

.sin-datos {
  color: #94a3b8;
  font-style: italic;
}

.prestadas-acordeon {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.prestada-item {
  border-radius: 0.9rem;
  overflow: hidden;
}

.prestada-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  background-color: rgba(30, 41, 59, 0.7);
  border: none;
  cursor: pointer;
  color: #e2e8f0;
}

.prestada-header:hover {
  background-color: rgba(30, 41, 59, 0.9);
}

.prestada-titulo {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 600;
}

.prestada-meta {
  display: flex;
  gap: 1rem;
  color: #93c5fd;
  font-size: 0.85rem;
}

.prestada-body {
  padding: 0.75rem 0.85rem 0.35rem;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
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
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 1.15rem;
  width: 90%;
  max-width: 600px;
  box-shadow: 0 34px 80px rgba(2, 6, 23, 0.58);
  max-height: 90vh;
  overflow-y: auto;
}

.modal-rango {
  width: min(96vw, 980px);
  max-width: 980px;
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
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.form-group.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.form-group.checkbox input {
  width: auto;
}

.form-group.checkbox span {
  margin: 0;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.info-rango {
  padding: 0.75rem 1rem;
  background-color: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 0.8rem;
  color: #86efac;
  font-size: 0.875rem;
  text-align: center;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 0.15rem;
}

.multi-empleados-panel {
  padding: 0.85rem 1rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.65);
  display: grid;
  gap: 0.7rem;
}

.multi-empleados-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.multi-empleados-header > span {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.multi-empleados-actions {
  display: flex;
  gap: 0.65rem;
}

.btn-link {
  background: transparent;
  border: none;
  color: #93c5fd;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 0;
}

.btn-link:hover {
  color: #bfdbfe;
  text-decoration: underline;
}

.multi-empleados-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.5rem;
  max-height: 180px;
  overflow-y: auto;
}

.multi-empleado-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #e2e8f0;
  font-size: 0.9rem;
}

.multi-empleado-item input {
  width: 1rem;
  height: 1rem;
}

.conflicto-rango-box {
  display: grid;
  gap: 0.7rem;
  padding: 0.95rem 1rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(245, 158, 11, 0.45);
  background: rgba(120, 53, 15, 0.2);
  color: #fde68a;
}

.conflicto-rango-box h4 {
  margin: 0;
  color: #fef3c7;
}

.conflicto-rango-box p {
  margin: 0;
}

.conflicto-rango-list {
  display: grid;
  gap: 0.45rem;
  max-height: 180px;
  overflow-y: auto;
}

.conflicto-rango-item {
  display: grid;
  gap: 0.2rem;
  padding: 0.55rem 0.65rem;
  border-radius: 0.55rem;
  background: rgba(15, 23, 42, 0.45);
}

.conflicto-rango-item span {
  color: #fef9c3;
  font-size: 0.85rem;
}

.conflicto-rango-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.6rem;
}

.btn-primary {
  flex: 1;
  min-height: 3rem;
  padding: 0.75rem;
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
  border: none;
  border-radius: 0.8rem;
  font-weight: 700;
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
  min-height: 3rem;
  padding: 0.75rem;
  background-color: transparent;
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background-color: rgba(148, 163, 184, 0.1);
  border-color: rgba(148, 163, 184, 0.5);
}
</style>

