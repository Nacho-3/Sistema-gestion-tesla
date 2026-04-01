<script setup>
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

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

const syncObraDiariaPorEmpleado = () => {
  if (!isEmpleadoAdministrativo(formDiaria.value.empleado_id)) return
  formDiaria.value.cliente_id = ""
  const obraAdmin = getObraAdministrativaParaEmpleado(formDiaria.value.empleado_id)
  formDiaria.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

const syncObraRangoPorEmpleado = () => {
  if (!isEmpleadoAdministrativo(formRango.value.empleado_id)) return
  formRango.value.cliente_id = ""
  const obraAdmin = getObraAdministrativaParaEmpleado(formRango.value.empleado_id)
  formRango.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

watch(() => formDiaria.value.empleado_id, syncObraDiariaPorEmpleado)
watch(() => formRango.value.empleado_id, syncObraRangoPorEmpleado)
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
const syncExtraState = (formValue) => {
  const extra50 = parseNumeroHoras(formValue.cantidad_horas_extra_50) || 0
  const extra100 = parseNumeroHoras(formValue.cantidad_horas_extra_100) || 0
  const totalExtra = Math.round((extra50 + extra100) * 100) / 100

  formValue.es_hora_extra = totalExtra > 0
  formValue.cantidad_horas_extra = totalExtra > 0 ? String(totalExtra) : ""
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
  formRango.value.cantidad_horas_extra_100 = ""
  syncExtraState(formRango.value)
})

// Cargar resúmenes
const loadResumenes = async () => {
  loadingResumen.value = true
  error.value = ""
  try {
    console.log("Cargando resúmenes para mes:", filtroMes.value, "año:", filtroAnio.value)
    
    const resEmpl = await api.getResumenEmpleado(filtroMes.value, filtroAnio.value)
    const resObra = await api.getResumenObra(filtroMes.value, filtroAnio.value)
    const resGrupo = await api.getResumenGrupo(filtroMes.value, filtroAnio.value)
    const resPrestadas = await api.getResumenPrestadas(filtroMes.value, filtroAnio.value)
    
    console.log("Respuestas:", resEmpl, resObra, resGrupo, resPrestadas)
    
    // Forzar asignación limpia para reactividad
    resumenEmpleado.value = [...(resEmpl?.data || [])]
    resumenObra.value = [...(resObra?.data || [])]
    resumenGrupo.value = [...(resGrupo?.data || [])]
    resumenPrestadas.value = [...(resPrestadas?.data || [])]
    
    console.log("Resumen empleado:", resumenEmpleado.value)
    console.log("Resumen obra:", resumenObra.value)
    console.log("Resumen grupo:", resumenGrupo.value)
    console.log("Resumen prestadas:", resumenPrestadas.value)
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
    editingId.value = hora.id
    focoModalDiaria = "cantidad"
    const tipoExtraActual = hora.es_hora_extra ? (hora.tipo_hora_extra || (hora.tipo === "extra_100" ? "100" : "50")) : ""
    formDiaria.value = {
      ...hora,
      cliente_id: hora.cliente_id || "",
      cantidad_horas_extra: hora.es_hora_extra ? Number(hora.cantidad_horas || 0) : "",
      cantidad_horas_extra_50: tipoExtraActual === "50" ? Number(hora.cantidad_horas || 0) : "",
      cantidad_horas_extra_100: tipoExtraActual === "100" ? Number(hora.cantidad_horas || 0) : "",
      tipo_hora_extra: tipoExtraActual,
    }
    modoDiaria.value = (hora.hora_inicio && hora.hora_fin) ? "horario" : "cantidad"
  } else {
    editingId.value = null
    focoModalDiaria = "empleado"
    modoDiaria.value = "cantidad"
    formDiaria.value = createEmptyFormDiaria()
  }
  showFormDiaria.value = true
}

// Cerrar modal de carga diaria
const closeModalDiaria = () => {
  showFormDiaria.value = false
  editingId.value = null
  modoDiaria.value = "cantidad"
  formDiaria.value = createEmptyFormDiaria()
}

// Cerrar modal de carga por rango
const closeModalRango = () => {
  showFormRango.value = false
  modoRango.value = "cantidad"
  formRango.value = createEmptyFormRango()
}

const parseNumeroHoras = (value) => {
  if (value === "" || value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const raw = String(value).trim()
  if (!raw) return null
  const normalizado = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

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
  const esEmpleadoAdmin = isEmpleadoAdministrativo(formDiaria.value.empleado_id)

  // Asegurar que la obra esté sincronizada para empleados administrativos
  if (esEmpleadoAdmin && !formDiaria.value.obra_id) {
    const obraAdmin = getObraAdministrativaParaEmpleado(formDiaria.value.empleado_id)
    if (obraAdmin?.id) {
      formDiaria.value.obra_id = obraAdmin.id
    }
  }

  if (!formDiaria.value.empleado_id || !formDiaria.value.fecha) {
    error.value = "Empleado y fecha son obligatorios"
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

  const totalHorasDiaria = modoDiaria.value === "cantidad"
    ? (parseNumeroHoras(formDiaria.value.cantidad_horas) || 0)
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
    const payload = {
      empleado_id: formDiaria.value.empleado_id,
      cliente_id: formDiaria.value.cliente_id || null,
      obra_id: formDiaria.value.obra_id,
      fecha: formDiaria.value.fecha,
      cantidad_horas: modoDiaria.value === "cantidad" ? parseNumeroHoras(formDiaria.value.cantidad_horas) : null,
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
      await api.updateHora(editingId.value, payload)
    } else {
      await api.createHora(payload)
    }

    guardarUltimaCargaRapida({
      empleado_id: payload.empleado_id,
      cliente_id: payload.cliente_id,
      obra_id: payload.obra_id,
      fecha: payload.fecha,
    })

    await loadHoras()
    closeModalDiaria()
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    error.value = `${editingId.value ? "Error al actualizar hora" : "Error al crear hora"}: ${detalle}`
    console.error(err)
  } finally {
    saving.value = false
  }
}

// Guardar horas por rango
const saveHoraRango = async () => {
  error.value = ""
  const esEmpleadoAdmin = isEmpleadoAdministrativo(formRango.value.empleado_id)

  // Asegurar que la obra esté sincronizada para empleados administrativos
  if (esEmpleadoAdmin && !formRango.value.obra_id) {
    const obraAdmin = getObraAdministrativaParaEmpleado(formRango.value.empleado_id)
    if (obraAdmin?.id) {
      formRango.value.obra_id = obraAdmin.id
    }
  }

  if (!formRango.value.empleado_id || !formRango.value.fecha_desde || !formRango.value.fecha_hasta) {
    error.value = "Empleado y fechas son obligatorios"
    return
  }

  if (modoRango.value === "cantidad" && (!formRango.value.horas_por_dia || formRango.value.horas_por_dia <= 0)) {
    error.value = "Ingresá las horas por día (mayor a 0)"
    return
  }
  if (modoRango.value === "horario" && (!formRango.value.hora_inicio || !formRango.value.hora_fin)) {
    error.value = "Ingresá hora de inicio y hora de fin"
    return
  }

  const fechaDesdeLocal = parseLocalDate(formRango.value.fecha_desde)
  const fechaHastaLocal = parseLocalDate(formRango.value.fecha_hasta)

  if (!fechaDesdeLocal || !fechaHastaLocal || fechaDesdeLocal > fechaHastaLocal) {
    error.value = "La fecha inicial debe ser menor a la fecha final"
    return
  }

  if (formRango.value.es_prestada && (!formRango.value.grupo_origen_id || !formRango.value.grupo_destino_id)) {
    error.value = "Selecciona grupo origen y destino para horas prestadas"
    return
  }

  const totalHorasRango = modoRango.value === "cantidad"
    ? (parseNumeroHoras(formRango.value.horas_por_dia) || 0)
    : calcularHorasDesdeHorario(formRango.value.hora_inicio, formRango.value.hora_fin)

  const horasExtra50Rango = parseNumeroHoras(formRango.value.cantidad_horas_extra_50) || 0
  const horasExtra100Rango = parseNumeroHoras(formRango.value.cantidad_horas_extra_100) || 0
  const totalExtraRango = Math.round((horasExtra50Rango + horasExtra100Rango) * 100) / 100

  const errorHorasExtraRango = validarDistribucionHorasExtra(
    totalHorasRango,
    formRango.value.cantidad_horas_extra_50,
    formRango.value.cantidad_horas_extra_100
  )
  if (errorHorasExtraRango) {
    error.value = errorHorasExtraRango
    return
  }

  if (horasExtra100Rango > 0) {
    error.value = "La carga por rango genera días hábiles (lunes a viernes). Las horas al 100% del sábado cargalas desde Carga diaria."
    return
  }

  saving.value = true
  try {
    // Generar registros de horas automáticamente
    const fechaInicio = parseLocalDate(formRango.value.fecha_desde)
    const fechaFin = parseLocalDate(formRango.value.fecha_hasta)
    let fechaActual = new Date(fechaInicio)

    while (fechaActual <= fechaFin) {
      const fechaStr = formatLocalDate(fechaActual)
      // Solo registrar de lunes a viernes (día 1-5)
      const dia = fechaActual.getDay()
      if (dia !== 0 && dia !== 6) {
        // no es domingo ni sábado
        await api.createHora({
          empleado_id: formRango.value.empleado_id,
          cliente_id: formRango.value.cliente_id || null,
          obra_id: formRango.value.obra_id,
          fecha: fechaStr,
          cantidad_horas: modoRango.value === "cantidad" ? parseNumeroHoras(formRango.value.horas_por_dia) : null,
          cantidad_horas_extra: totalExtraRango > 0 ? totalExtraRango : null,
          cantidad_horas_extra_50: horasExtra50Rango > 0 ? horasExtra50Rango : null,
          cantidad_horas_extra_100: horasExtra100Rango > 0 ? horasExtra100Rango : null,
          hora_inicio: modoRango.value === "horario" ? formRango.value.hora_inicio || null : null,
          hora_fin: modoRango.value === "horario" ? formRango.value.hora_fin || null : null,
          es_hora_extra: totalExtraRango > 0,
          tipo_hora_extra: totalExtraRango > 0 ? "50" : null,
          es_prestada: formRango.value.es_prestada,
          grupo_origen_id: formRango.value.es_prestada ? formRango.value.grupo_origen_id : null,
          grupo_destino_id: formRango.value.es_prestada ? formRango.value.grupo_destino_id : null
        })
      }
      fechaActual.setDate(fechaActual.getDate() + 1)
    }

    guardarUltimaCargaRapida({
      empleado_id: formRango.value.empleado_id,
      cliente_id: formRango.value.cliente_id || null,
      obra_id: formRango.value.obra_id || null,
      fecha: formRango.value.fecha_hasta,
    })

    await loadHoras()
    closeModalRango()
  } catch (err) {
    const detalle = err?.response?.data?.error || err?.message || "Error desconocido"
    error.value = `Error al generar registros de horas: ${detalle}`
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
          <!-- Header -->
          <div class="horas-header">
            <button class="btn-primary" @click="openModalDiaria()">
              + Registrar hora
            </button>
          </div>

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
                    <span>{{ grupo.totalHoras.toFixed(2) }} hs</span>
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
                        <td>{{ hora.obra_id ? getNombreObraRegistro(hora) : getNombreCliente(hora.cliente_id) }}</td>
                        <td>{{ formatearFecha(hora.fecha) }}</td>
                        <td>{{ getCantidadHoras(hora).toFixed(2) }}</td>
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
                          <div class="acciones">
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
          <div class="rango-info">
            <p>📅 Registra horas para un rango de fechas. El sistema generará automáticamente un registro por cada día hábil (lunes a viernes).</p>
          </div>

          <div class="horas-header">
            <button class="btn-primary" @click="showFormRango = true">
              + Nueva carga por rango
            </button>
          </div>

          <div v-if="error" class="error-alert">
            {{ error }}
          </div>
        </div>
      </div>

      <!-- Tab: Resumen -->
      <div v-if="activeTab === 'resumen'" class="tab-content">
        <div class="resumen-header-acciones">
          <button class="btn-primary" @click="generarResumenPdf">
            Generar resumen PDF
          </button>
        </div>

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
                  <td>{{ emp.total_horas?.toFixed(2) || 0 }}</td>
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
                  <td>{{ obra.total_horas?.toFixed(2) || 0 }}</td>
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
                  <td>{{ grupo.total_horas?.toFixed(2) || 0 }}</td>
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
                  <span>{{ grupo.totalHoras.toFixed(2) }} hs</span>
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
                      <td>{{ Number(prest.cantidad_horas || 0).toFixed(2) }}</td>
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
            <h3>{{ editingId ? "Editar hora" : "Registrar hora diaria" }}</h3>
            <button class="btn-close" @click="closeModalDiaria">×</button>
          </div>

          <form @submit.prevent="saveHoraDiaria" class="modal-form">
            <label class="form-group">
              <span>Empleado *</span>
              <select ref="selectEmpleadoDiariaRef" v-model="formDiaria.empleado_id" required>
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formDiaria.empleado_id)" class="form-group">
              <span>Cliente</span>
              <select v-model="formDiaria.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ cliente.empresa || cliente.razon_social }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formDiaria.empleado_id)" class="form-group">
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
                placeholder="Ej: 8"
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
                  placeholder="Ej: 1"
                />
              </label>

              <label v-if="esSabadoDiaria" class="form-group">
                <span>Horas extra al 100%</span>
                <input
                  v-model="formDiaria.cantidad_horas_extra_100"
                  type="text"
                  inputmode="decimal"
                  placeholder="Ej: 2"
                />
              </label>
            </div>

            <div class="info-rango">
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
        <div class="modal">
          <div class="modal-header">
            <h3>Registrar horas por rango de fechas</h3>
            <button class="btn-close" @click="closeModalRango">×</button>
          </div>

          <form @submit.prevent="saveHoraRango" class="modal-form">
            <label class="form-group">
              <span>Empleado *</span>
              <select ref="selectEmpleadoRangoRef" v-model="formRango.empleado_id" required>
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group">
              <span>Cliente</span>
              <select v-model="formRango.cliente_id">
                <option value="">Sin cliente</option>
                <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">
                  {{ cliente.empresa || cliente.razon_social }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group">
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

            <div class="modo-selector">
              <label :class="['modo-btn', { active: modoRango === 'cantidad' }]">
                <input type="radio" v-model="modoRango" value="cantidad" hidden />
                Horas por día
              </label>
              <label :class="['modo-btn', { active: modoRango === 'horario' }]">
                <input type="radio" v-model="modoRango" value="horario" hidden />
                De hora a hora
              </label>
            </div>

            <label v-if="modoRango === 'cantidad'" class="form-group">
              <span>Horas por día *</span>
              <input
                v-model="formRango.horas_por_dia"
                type="text"
                inputmode="decimal"
                placeholder="Ej: 8"
              />
            </label>

            <div v-if="modoRango === 'horario'" class="form-row">
              <label class="form-group">
                <span>Hora inicio *</span>
                <input v-model="formRango.hora_inicio" type="time" />
              </label>
              <label class="form-group">
                <span>Hora fin *</span>
                <input v-model="formRango.hora_fin" type="time" />
              </label>
            </div>

            <label class="form-group">
              <span>Horas extra al 50% por día</span>
              <input
                v-model="formRango.cantidad_horas_extra_50"
                type="text"
                inputmode="decimal"
                placeholder="Ej: 1"
              />
            </label>

            <div class="info-rango">
              En <strong>carga por rango</strong> solo se habilitan horas extra al <strong>50%</strong>. Las horas al <strong>100%</strong> del sábado cargalas desde <strong>Carga diaria</strong>.
            </div>

            <label class="form-group checkbox">
              <input v-model="formRango.es_prestada" type="checkbox" />
              <span>Es hora prestada (entre grupos)</span>
            </label>

            <template v-if="formRango.es_prestada">
              <label class="form-group">
                <span>Grupo origen *</span>
                <select v-model="formRango.grupo_origen_id" required>
                  <option value="">Seleccionar grupo...</option>
                  <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                    {{ grupo.nombre }}
                  </option>
                </select>
              </label>

              <label class="form-group">
                <span>Grupo destino *</span>
                <select v-model="formRango.grupo_destino_id" required>
                  <option value="">Seleccionar grupo...</option>
                  <option v-for="grupo in grupos" :key="grupo.id" :value="grupo.id">
                    {{ grupo.nombre }}
                  </option>
                </select>
              </label>
            </template>

            <div class="info-rango">
              Se generarán registros automáticamente para cada día hábil (lunes a viernes) en el rango seleccionado.
            </div>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="saving">
                {{ saving ? "Generando..." : "Generar registros" }}
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
.horas-container {
  padding: 1.5rem;
}

.tabs {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  border-bottom: 2px solid rgba(148, 163, 184, 0.2);
}

.tab {
  padding: 0.75rem 1.5rem;
  background: none;
  border: none;
  color: #94a3b8;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
}

.tab:hover {
  color: #cbd5e1;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.subtabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.subtab {
  padding: 0.5rem 1rem;
  background-color: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #94a3b8;
  font-weight: 500;
  font-size: 0.875rem;
  cursor: pointer;
  border-radius: 0.375rem;
  transition: all 0.2s;
}

.subtab:hover {
  background-color: rgba(30, 41, 59, 0.8);
  border-color: rgba(148, 163, 184, 0.3);
}

.subtab.active {
  background-color: #3b82f6;
  border-color: #3b82f6;
  color: white;
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
  background-color: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.5rem;
  color: #93c5fd;
  margin-bottom: 2rem;
  font-size: 0.9375rem;
}

.resumen-header-acciones {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.horas-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.filtros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
  padding: 1.5rem;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
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

.filtro-grupo select,
.filtro-grupo input {
  padding: 0.5rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.875rem;
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
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  overflow: hidden;
  background-color: rgba(15, 23, 42, 0.55);
}

.acordeon-header {
  width: 100%;
  padding: 0.65rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  background: rgba(30, 41, 59, 0.7);
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
  padding: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.horas-table {
  overflow-x: auto;
  margin-bottom: 2rem;
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

.btn-edit,
.btn-delete {
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

.btn-delete {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.btn-delete:hover {
  background-color: rgba(239, 68, 68, 0.3);
}

.atajos-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  align-items: center;
  padding: 0.85rem 1rem;
  margin-bottom: 1rem;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
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

/* Resumen */
.resumen-seccion {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
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
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  overflow: hidden;
  background-color: rgba(15, 23, 42, 0.45);
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
  max-width: 600px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  max-height: 90vh;
  overflow-y: auto;
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
  border-radius: 0.375rem;
  color: #86efac;
  font-size: 0.875rem;
  text-align: center;
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
</style>

