<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

// Estado
const horas = ref([])
const empleados = ref([])
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

// Filtros
const filtroMes = ref(new Date().getMonth() + 1)
const filtroAnio = ref(new Date().getFullYear())
const filtroEmpleado = ref("")
const filtroObra = ref("")
const nombresMes = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const ADMIN_GROUP_REGEX = /admin/i

// Formulario carga diaria
const formDiaria = ref({
  empleado_id: "",
  obra_id: "",
  fecha: new Date().toISOString().split("T")[0],
  hora_inicio: "",
  hora_fin: "",
  cantidad_horas: "",
  es_prestada: false,
  grupo_origen_id: "",
  grupo_destino_id: ""
})

// Formulario carga por rango
const formRango = ref({
  empleado_id: "",
  obra_id: "",
  fecha_desde: new Date().toISOString().split("T")[0],
  fecha_hasta: new Date().toISOString().split("T")[0],
  horas_por_dia: "",
  hora_inicio: "",
  hora_fin: "",
  es_prestada: false,
  grupo_origen_id: "",
  grupo_destino_id: ""
})

// Resumen
const resumenEmpleado = ref([])
const resumenObra = ref([])
const resumenGrupo = ref([])
const resumenPrestadas = ref([])

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
    const [resEmpleados, resObras, resGrupos] = await Promise.all([
      api.getEmpleados(),
      api.getObras(),
      api.getGrupos()
    ])
    empleados.value = resEmpleados.data || []
    obras.value = resObras.data || []
    grupos.value = resGrupos.data || []
  } catch (err) {
    console.error("Error al cargar datos:", err)
  }
}

const getEmpleadoById = (empleadoId) => empleados.value.find((e) => String(e.id) === String(empleadoId))

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

const obrasNoAdministrativas = computed(() => {
  return (obras.value || []).filter((obra) => !isObraAdministrativa(obra))
})

const syncObraDiariaPorEmpleado = () => {
  if (!isEmpleadoAdministrativo(formDiaria.value.empleado_id)) return
  const obraAdmin = getObraAdministrativaParaEmpleado(formDiaria.value.empleado_id)
  formDiaria.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

const syncObraRangoPorEmpleado = () => {
  if (!isEmpleadoAdministrativo(formRango.value.empleado_id)) return
  const obraAdmin = getObraAdministrativaParaEmpleado(formRango.value.empleado_id)
  formRango.value.obra_id = obraAdmin ? obraAdmin.id : ""
}

watch(() => formDiaria.value.empleado_id, syncObraDiariaPorEmpleado)
watch(() => formRango.value.empleado_id, syncObraRangoPorEmpleado)

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
    formDiaria.value = { ...hora }
    modoDiaria.value = (hora.hora_inicio && hora.hora_fin) ? "horario" : "cantidad"
  } else {
    editingId.value = null
    modoDiaria.value = "cantidad"
    formDiaria.value = {
      empleado_id: "",
      obra_id: "",
      fecha: new Date().toISOString().split("T")[0],
      hora_inicio: "",
      hora_fin: "",
      cantidad_horas: "",
      es_prestada: false,
      grupo_origen_id: "",
      grupo_destino_id: ""
    }
  }
  showFormDiaria.value = true
}

// Cerrar modal de carga diaria
const closeModalDiaria = () => {
  showFormDiaria.value = false
  editingId.value = null
  modoDiaria.value = "cantidad"
}

// Cerrar modal de carga por rango
const closeModalRango = () => {
  showFormRango.value = false
  modoRango.value = "cantidad"
  formRango.value = {
    empleado_id: "",
    obra_id: "",
    fecha_desde: new Date().toISOString().split("T")[0],
    fecha_hasta: new Date().toISOString().split("T")[0],
    horas_por_dia: "",
    hora_inicio: "",
    hora_fin: "",
    es_prestada: false,
    grupo_origen_id: "",
    grupo_destino_id: ""
  }
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

  saving.value = true
  try {
    const payload = {
      empleado_id: formDiaria.value.empleado_id,
      obra_id: formDiaria.value.obra_id,
      fecha: formDiaria.value.fecha,
      cantidad_horas: modoDiaria.value === "cantidad" ? formDiaria.value.cantidad_horas : null,
      hora_inicio: modoDiaria.value === "horario" ? formDiaria.value.hora_inicio || null : null,
      hora_fin: modoDiaria.value === "horario" ? formDiaria.value.hora_fin || null : null,
      es_prestada: formDiaria.value.es_prestada,
      grupo_origen_id: formDiaria.value.es_prestada ? formDiaria.value.grupo_origen_id : null,
      grupo_destino_id: formDiaria.value.es_prestada ? formDiaria.value.grupo_destino_id : null
    }

    if (editingId.value) {
      await api.updateHora(editingId.value, payload)
    } else {
      await api.createHora(payload)
    }
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

  if (new Date(formRango.value.fecha_desde) > new Date(formRango.value.fecha_hasta)) {
    error.value = "La fecha inicial debe ser menor a la fecha final"
    return
  }

  if (formRango.value.es_prestada && (!formRango.value.grupo_origen_id || !formRango.value.grupo_destino_id)) {
    error.value = "Selecciona grupo origen y destino para horas prestadas"
    return
  }

  saving.value = true
  try {
    // Generar registros de horas automáticamente
    const fechaInicio = new Date(formRango.value.fecha_desde)
    const fechaFin = new Date(formRango.value.fecha_hasta)
    let fechaActual = new Date(fechaInicio)

    while (fechaActual <= fechaFin) {
      const fechaStr = fechaActual.toISOString().split("T")[0]
      // Solo registrar de lunes a viernes (día 1-5)
      const dia = fechaActual.getDay()
      if (dia !== 0 && dia !== 6) {
        // no es domingo ni sábado
        await api.createHora({
          empleado_id: formRango.value.empleado_id,
          obra_id: formRango.value.obra_id,
          fecha: fechaStr,
          cantidad_horas: modoRango.value === "cantidad" ? parseFloat(formRango.value.horas_por_dia) : null,
          hora_inicio: modoRango.value === "horario" ? formRango.value.hora_inicio || null : null,
          hora_fin: modoRango.value === "horario" ? formRango.value.hora_fin || null : null,
          es_prestada: formRango.value.es_prestada,
          grupo_origen_id: formRango.value.es_prestada ? formRango.value.grupo_origen_id : null,
          grupo_destino_id: formRango.value.es_prestada ? formRango.value.grupo_destino_id : null
        })
      }
      fechaActual.setDate(fechaActual.getDate() + 1)
    }

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

const getNombreObra = (obraId) => {
  if (!obraId) return "Sin obra"
  const obra = obras.value.find((o) => String(o.id) === String(obraId))
  if (!obra) return "Sin obra"
  return isObraAdministrativa(obra) ? "Administración" : obra.nombre
}

const getNombreObraRegistro = (hora) => {
  if (!hora?.obra_id) return "Sin obra"
  const obra = obras.value.find((o) => String(o.id) === String(hora?.obra_id))
  if (!obra) return "Sin obra"

  if (isObraAdministrativa(obra) && isEmpleadoAdministrativo(hora?.empleado_id)) {
    return "Administración"
  }

  return obra.nombre
}

const getNombreGrupo = (grupoId) => {
  const grupo = grupos.value.find((g) => String(g.id) === String(grupoId))
  return grupo ? grupo.nombre : "-"
}

const formatearFecha = (fecha) => {
  if (!fecha) return "-"
  return new Date(fecha).toLocaleDateString("es-AR")
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
    .map((grupo) => ({
      ...grupo,
      registros: grupo.registros.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    }))
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
  socket.on('horas:changed', loadHoras)
})
onUnmounted(() => {
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
              <button class="acordeon-header" @click="toggleEmpleadoHoras(grupo.empleado_id)">
                <div class="acordeon-titulo">
                  <span class="flecha" :class="{ abierta: expandedEmpleadosHoras.has(grupo.empleado_id) }">▶</span>
                  <span>{{ grupo.empleado }}</span>
                </div>
                <div class="acordeon-meta">
                  <span>{{ grupo.registros.length }} registros</span>
                  <span>{{ grupo.totalHoras.toFixed(2) }} hs</span>
                </div>
              </button>

              <div v-if="expandedEmpleadosHoras.has(grupo.empleado_id)" class="acordeon-body">
                <div class="horas-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Obra</th>
                        <th>Fecha</th>
                        <th>Horas</th>
                        <th>Tipo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="hora in grupo.registros" :key="hora.id">
                        <td>{{ getNombreObra(hora.obra_id) }}</td>
                        <td>{{ formatearFecha(hora.fecha) }}</td>
                        <td>{{ getCantidadHoras(hora).toFixed(2) }}</td>
                        <td>
                          <span v-if="hora.es_prestada" class="badge badge-prestada">
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
                <tr v-for="(emp, idx) in resumenEmpleado" :key="idx">
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
                <tr v-for="(obra, idx) in resumenObra" :key="idx">
                  <td>{{ obra.obra_nombre || getNombreObra(obra.obra_id) }}</td>
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
                <tr v-for="(grupo, idx) in resumenGrupo" :key="idx">
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
              <select v-model="formDiaria.empleado_id" required>
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formDiaria.empleado_id)" class="form-group">
              <span>Obra</span>
              <select v-model="formDiaria.obra_id">
                <option value="">Sin obra</option>
                <option v-for="obra in obrasNoAdministrativas" :key="obra.id" :value="obra.id">
                  {{ obra.nombre }}
                </option>
              </select>
            </label>

            <div v-else class="info-rango">
              Obra: <strong>Administración</strong>
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
                v-model.number="formDiaria.cantidad_horas"
                type="number"
                step="0.5"
                placeholder="Ej: 8"
              />
            </label>

            <div v-if="modoDiaria === 'horario'" class="form-row">
              <label class="form-group">
                <span>Hora inicio *</span>
                <input v-model="formDiaria.hora_inicio" type="time" />
              </label>
              <label class="form-group">
                <span>Hora fin *</span>
                <input v-model="formDiaria.hora_fin" type="time" />
              </label>
            </div>

            <label class="form-group checkbox">
              <input v-model="formDiaria.es_prestada" type="checkbox" />
              <span>Es hora prestada (entre grupos)</span>
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
              <select v-model="formRango.empleado_id" required>
                <option value="">Seleccionar empleado...</option>
                <option v-for="emp in empleados" :key="emp.id" :value="emp.id">
                  {{ emp.nombre }} {{ emp.apellido }}
                </option>
              </select>
            </label>

            <label v-if="!isEmpleadoAdministrativo(formRango.empleado_id)" class="form-group">
              <span>Obra</span>
              <select v-model="formRango.obra_id">
                <option value="">Sin obra</option>
                <option v-for="obra in obrasNoAdministrativas" :key="obra.id" :value="obra.id">
                  {{ obra.nombre }}
                </option>
              </select>
            </label>

            <div v-else class="info-rango">
              Obra: <strong>Administración</strong>
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
                v-model.number="formRango.horas_por_dia"
                type="number"
                step="0.5"
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
  padding: 0.9rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(30, 41, 59, 0.7);
  border: none;
  cursor: pointer;
  color: #e2e8f0;
}

.acordeon-header:hover {
  background: rgba(30, 41, 59, 0.9);
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

