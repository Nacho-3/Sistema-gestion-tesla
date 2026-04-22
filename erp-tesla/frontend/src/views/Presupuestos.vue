<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue"
import { useRouter } from "vue-router"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

const router = useRouter()
const presupuestos = ref([])
const clientes = ref([])
const obras = ref([])
const loading = ref(false)
const saving = ref(false)
const error = ref("")
const ok = ref("")

const showForm = ref(false)
const showDeleteConfirm = ref(false)
const presupuestoAEliminar = ref(null)
const numeroSiguiente = ref(1)
const editingId = ref(null)
const editingNumero = ref(null)
const filtroBusqueda = ref("")
const filtroCliente = ref("")
const filtroEstado = ref("todos")

const ESTADOS_PRESUPUESTO = [
  { key: "pendiente", label: "Pendientes", description: "Presupuestos en análisis o sin respuesta." },
  { key: "enviado", label: "Enviados", description: "Propuestas enviadas y esperando definición." },
  { key: "aceptado", label: "Aceptados", description: "Presupuestos confirmados para avanzar." },
  { key: "rechazado", label: "Rechazados", description: "Propuestas descartadas o no aprobadas." },
]

const newMaterialItem = () => ({ uid: Date.now() + Math.random(), descripcion: "", cantidad: 1, precio_unitario: 0, ganancia_porcentaje: 0 })
const newManoObraItem = () => ({ uid: Date.now() + Math.random(), descripcion: "" })
const newInfoInternaItem = () => ({ uid: Date.now() + Math.random(), descripcion: "", mostrar_en_pdf: false })

const form = ref({
  cliente_id: "",
  obra_id: "",
  fecha: new Date().toISOString().slice(0, 10),
  validez_dias: 15,
  forma_pago: "Contado",
  aplica_iva: true,
  iva_porcentaje: 21,
  subtotal_general_mano_obra: 0,
  observaciones: "",
  items_materiales: [newMaterialItem()],
  items_mano_obra: [newManoObraItem()],
  info_interna_quien_hizo: "",
  info_interna_quien_hizo_pdf: false,
  info_interna_quien_aprobo: "",
  info_interna_quien_aprobo_pdf: false,
  items_info_interna: [],
})

const obrasDelCliente = computed(() => {
  if (!form.value.cliente_id) return []
  return obras.value.filter((obra) => String(obra.cliente_id) === String(form.value.cliente_id))
})

const getEtiquetaCliente = (cliente) => {
  if (!cliente) return "-"
  const empresa = String(cliente.empresa || "").trim()
  const razonSocial = String(cliente.razon_social || "").trim()
  return empresa || razonSocial || "-"
}

const clientesOrdenados = computed(() => {
  return [...clientes.value].sort((a, b) =>
    getEtiquetaCliente(a).localeCompare(getEtiquetaCliente(b), "es", { sensitivity: "base" })
  )
})

const setCliente = (clienteId) => {
  form.value.cliente_id = clienteId
  const obrasCliente = obras.value.filter((obra) => String(obra.cliente_id) === String(clienteId))
  if (!obrasCliente.some((obra) => String(obra.id) === String(form.value.obra_id))) {
    form.value.obra_id = obrasCliente[0]?.id || ""
  }
}

const materialRowsValidas = computed(() =>
  form.value.items_materiales.filter((item) => item.descripcion && Number(item.cantidad) > 0)
)

const manoObraRowsValidas = computed(() =>
  form.value.items_mano_obra.filter((item) => item.descripcion)
)

const subtotalMateriales = computed(() =>
  materialRowsValidas.value.reduce((acc, item) => {
    const cantidad = Number(item.cantidad) || 0
    const unitarioBase = Number(item.precio_unitario) || 0
    const ganancia = Math.max(0, Number(item.ganancia_porcentaje) || 0)
    const unitarioConGanancia = unitarioBase * (1 + ganancia / 100)
    return acc + cantidad * unitarioConGanancia
  }, 0)
)

const subtotalManoObra = computed(() =>
  Number(form.value.subtotal_general_mano_obra) || 0
)

const ivaMonto = computed(() => {
  if (!form.value.aplica_iva) return 0
  return subtotalMateriales.value * ((Number(form.value.iva_porcentaje) || 0) / 100)
})

const total = computed(() => subtotalMateriales.value + subtotalManoObra.value + ivaMonto.value)

const totalPresupuestado = computed(() =>
  presupuestos.value.reduce((acc, p) => acc + (Number(p.total) || 0), 0)
)

const totalPendiente = computed(() =>
  presupuestos.value
    .filter((p) => String(p.estado || "") === "pendiente")
    .reduce((acc, p) => acc + (Number(p.total) || 0), 0)
)

const totalAceptado = computed(() =>
  presupuestos.value
    .filter((p) => String(p.estado || "") === "aceptado")
    .reduce((acc, p) => acc + (Number(p.total) || 0), 0)
)

const presupuestosCoincidentes = computed(() => {
  const termino = String(filtroBusqueda.value || "").trim().toLowerCase()

  return presupuestos.value.filter((presupuesto) => {
    if (filtroCliente.value && String(presupuesto.cliente_id) !== String(filtroCliente.value)) {
      return false
    }

    if (!termino) return true

    const cliente = String(presupuesto.cliente || getClienteNombre(presupuesto.cliente_id) || "").toLowerCase()
    const obra = String(presupuesto.obra || getObraNombre(presupuesto.obra_id) || "").toLowerCase()
    const numero = String(presupuesto.numero || "").toLowerCase()
    const formaPago = String(presupuesto.forma_pago || "").toLowerCase()
    const estado = String(presupuesto.estado || "").toLowerCase()

    return [cliente, obra, numero, formaPago, estado].some((value) => value.includes(termino))
  })
})

const conteoEstados = computed(() => {
  const conteos = { todos: presupuestosCoincidentes.value.length }
  ESTADOS_PRESUPUESTO.forEach((estado) => {
    conteos[estado.key] = presupuestosCoincidentes.value.filter((item) => String(item.estado || "").toLowerCase() === estado.key).length
  })
  return conteos
})

const presupuestosFiltrados = computed(() => {
  if (filtroEstado.value === "todos") return presupuestosCoincidentes.value
  return presupuestosCoincidentes.value.filter((item) => String(item.estado || "").toLowerCase() === filtroEstado.value)
})

const seccionesEstado = computed(() => {
  const estadosVisibles = filtroEstado.value === "todos"
    ? ESTADOS_PRESUPUESTO
    : ESTADOS_PRESUPUESTO.filter((estado) => estado.key === filtroEstado.value)

  return estadosVisibles.map((estado) => ({
    ...estado,
    items: presupuestosFiltrados.value.filter((item) => String(item.estado || "").toLowerCase() === estado.key),
  }))
})

const formatDate = (value) => {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("es-AR")
}

const estadoLabel = (estado) => {
  const key = String(estado || "").toLowerCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

const estadoClass = (estado) => {
  const key = String(estado || "").toLowerCase()
  return `estado-pill estado-${key}`
}

const certificadoStatusLabel = (presupuesto) => {
  const cantidad = Number(presupuesto?.cantidad_certificados || 0)
  if (!cantidad) return "Sin certificar"
  if (presupuesto?.tiene_certificados_pendientes) return `Certificado pendiente (${cantidad})`
  return `Certificado al dia (${cantidad})`
}

const certificadoStatusClass = (presupuesto) => {
  const cantidad = Number(presupuesto?.cantidad_certificados || 0)
  if (!cantidad) return "cert-badge cert-badge-empty"
  if (presupuesto?.tiene_certificados_pendientes) return "cert-badge cert-badge-pending"
  return "cert-badge cert-badge-ok"
}

const abrirCertificados = (presupuesto) => {
  error.value = ""
  ok.value = ""
  const query = Number(presupuesto?.cantidad_certificados || 0) > 0
    ? { presupuesto_id: String(presupuesto.id), modo: "avances" }
    : { presupuesto_id: String(presupuesto.id), modo: "generar" }

  router.push({ path: "/certificados", query })
}

const precioUnitarioConGanancia = (row) => {
  const base = Number(row?.precio_unitario) || 0
  const ganancia = Math.max(0, Number(row?.ganancia_porcentaje) || 0)
  return base * (1 + ganancia / 100)
}

const subtotalMaterialRowConGanancia = (row) => {
  const cantidad = Number(row?.cantidad) || 0
  return cantidad * precioUnitarioConGanancia(row)
}

const formatMoney = (value) => {
  const n = Number(value) || 0
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

const getClienteNombre = (id) => {
  const c = clientes.value.find((item) => item.id === id)
  return getEtiquetaCliente(c)
}

const getObraNombre = (id) => {
  const o = obras.value.find((item) => item.id === id)
  return o ? o.nombre : "-"
}

const addMaterialRow = () => {
  form.value.items_materiales.push(newMaterialItem())
}

const removeMaterialRow = (uid) => {
  if (form.value.items_materiales.length === 1) return
  form.value.items_materiales = form.value.items_materiales.filter((item) => item.uid !== uid)
}

const addManoObraRow = () => {
  form.value.items_mano_obra.push(newManoObraItem())
}

const removeManoObraRow = (uid) => {
  if (form.value.items_mano_obra.length === 1) return
  form.value.items_mano_obra = form.value.items_mano_obra.filter((item) => item.uid !== uid)
}

const addInfoInternaRow = () => {
  form.value.items_info_interna.push(newInfoInternaItem())
}

const removeInfoInternaRow = (uid) => {
  form.value.items_info_interna = form.value.items_info_interna.filter((item) => item.uid !== uid)
}

const resetForm = () => {
  editingId.value = null
  editingNumero.value = null
  form.value = {
    cliente_id: "",
    obra_id: "",
    fecha: new Date().toISOString().slice(0, 10),
    validez_dias: 15,
    forma_pago: "Contado",
    aplica_iva: true,
    iva_porcentaje: 21,
    subtotal_general_mano_obra: 0,
    observaciones: "",
    items_materiales: [newMaterialItem()],
    items_mano_obra: [newManoObraItem()],
    info_interna_quien_hizo: "",
    info_interna_quien_hizo_pdf: false,
    info_interna_quien_aprobo: "",
    info_interna_quien_aprobo_pdf: false,
    items_info_interna: [],
  }
}

const loadData = async () => {
  loading.value = true
  error.value = ""
  try {
    const [resPresupuestos, resClientes, resObras, resNumero] = await Promise.all([
      api.getPresupuestos(),
      api.getClientes(),
      api.getObras(),
      api.getNumeroSiguientePresupuesto(),
    ])

    presupuestos.value = resPresupuestos.data || []
    clientes.value = resClientes.data || []
    obras.value = resObras.data || []
    numeroSiguiente.value = Number(resNumero.data?.numero_siguiente) || 1
  } catch (err) {
    error.value = "No se pudieron cargar los datos de presupuestos"
    console.error(err)
  } finally {
    loading.value = false
  }
}

const openForm = () => {
  resetForm()
  showForm.value = true
}

const limpiarFiltros = () => {
  filtroBusqueda.value = ""
  filtroCliente.value = ""
  filtroEstado.value = "todos"
}

const editPresupuesto = async (id) => {
  error.value = ""
  ok.value = ""
  try {
    const { data } = await api.getPresupuesto(id)
    const materiales = (data?.items || []).filter((item) => item.tipo === "material")
    const manoObra = (data?.items || []).filter((item) => item.tipo === "mano_obra")

    editingId.value = data.id
    editingNumero.value = data.numero
    form.value = {
      cliente_id: data.cliente_id || "",
      obra_id: data.obra_id || "",
      fecha: data.fecha ? String(data.fecha).slice(0, 10) : new Date().toISOString().slice(0, 10),
      validez_dias: Number(data.validez_dias) || 15,
      forma_pago: data.forma_pago || "Contado",
      aplica_iva: Number(data.iva_monto || 0) > 0,
      iva_porcentaje: Number(data.iva_porcentaje) || 21,
      subtotal_general_mano_obra: Number(data.subtotal_mano_obra) || 0,
      observaciones: data.observaciones || "",
      items_materiales: materiales.length
        ? materiales.map((item) => ({
            uid: Date.now() + Math.random(),
            descripcion: item.descripcion || "",
            cantidad: Number(item.cantidad) || 0,
            ganancia_porcentaje: Math.max(0, Number(item.ganancia_porcentaje) || 0),
            precio_unitario:
              (Number(item.precio_unitario) || 0) /
              (1 + Math.max(0, Number(item.ganancia_porcentaje) || 0) / 100),
          }))
        : [newMaterialItem()],
      items_mano_obra: manoObra.length
        ? manoObra.map((item) => ({
            uid: Date.now() + Math.random(),
            descripcion: item.descripcion || "",
          }))
        : [newManoObraItem()],
      info_interna_quien_hizo: data.info_interna_quien_hizo || "",
      info_interna_quien_hizo_pdf: Boolean(data.info_interna_quien_hizo_pdf),
      info_interna_quien_aprobo: data.info_interna_quien_aprobo || "",
      info_interna_quien_aprobo_pdf: Boolean(data.info_interna_quien_aprobo_pdf),
      items_info_interna: Array.isArray(data.items_info_interna)
        ? data.items_info_interna.map((item) => ({
            uid: Date.now() + Math.random(),
            descripcion: item.descripcion || "",
            mostrar_en_pdf: Boolean(item.mostrar_en_pdf),
          }))
        : [],
    }

    showForm.value = true
  } catch (err) {
    error.value = "No se pudo cargar el presupuesto para editar"
    console.error(err)
  }
}

const closeForm = () => {
  showForm.value = false
  resetForm()
}

const openDeleteConfirm = (presupuesto) => {
  presupuestoAEliminar.value = presupuesto
  showDeleteConfirm.value = true
  error.value = ""
  ok.value = ""
}

const closeDeleteConfirm = () => {
  showDeleteConfirm.value = false
  presupuestoAEliminar.value = null
}

const savePresupuesto = async () => {
  ok.value = ""
  error.value = ""

  if (!form.value.cliente_id || !form.value.obra_id) {
    error.value = "Cliente y obra son obligatorios"
    return
  }

  const payload = {
    cliente_id: Number(form.value.cliente_id),
    obra_id: Number(form.value.obra_id),
    fecha: form.value.fecha,
    validez_dias: Number(form.value.validez_dias) || 15,
    forma_pago: form.value.forma_pago,
    aplica_iva: Boolean(form.value.aplica_iva),
    iva_porcentaje: Number(form.value.iva_porcentaje) || 0,
    subtotal_general_mano_obra: Number(form.value.subtotal_general_mano_obra) || 0,
    observaciones: form.value.observaciones,
    items_materiales: form.value.items_materiales.map((item) => ({
      descripcion: String(item.descripcion || "").trim(),
      cantidad: Number(item.cantidad) || 0,
      ganancia_porcentaje: Math.max(0, Number(item.ganancia_porcentaje) || 0),
      precio_unitario: Number(item.precio_unitario) || 0,
    })),
    items_mano_obra: form.value.items_mano_obra.map((item) => ({
      descripcion: String(item.descripcion || "").trim(),
      cantidad: 1,
      precio_unitario: 0,
    })),
    info_interna_quien_hizo: String(form.value.info_interna_quien_hizo || "").trim(),
    info_interna_quien_hizo_pdf: Boolean(form.value.info_interna_quien_hizo_pdf),
    info_interna_quien_aprobo: String(form.value.info_interna_quien_aprobo || "").trim(),
    info_interna_quien_aprobo_pdf: Boolean(form.value.info_interna_quien_aprobo_pdf),
    items_info_interna: form.value.items_info_interna.map((item) => ({
      descripcion: String(item.descripcion || "").trim(),
      mostrar_en_pdf: Boolean(item.mostrar_en_pdf),
    })),
  }

  saving.value = true
  const wasEditing = Boolean(editingId.value)
  try {
    if (editingId.value) {
      await api.updatePresupuesto(editingId.value, payload)
    } else {
      await api.createPresupuesto(payload)
    }
    await loadData()
    closeForm()
    ok.value = wasEditing ? "Presupuesto actualizado correctamente" : "Presupuesto generado correctamente"
  } catch (err) {
    error.value = err?.response?.data?.error || "No se pudo guardar el presupuesto"
    console.error(err)
  } finally {
    saving.value = false
  }
}

const buildWhatsappMessage = (presupuesto) => {
  const totalTexto = formatMoney(presupuesto.total)
  return `Hola, te compartimos el presupuesto Nro ${presupuesto.numero} de Tesla Montajes Electricos. Total: ${totalTexto}.`
}

const descargarPdfBlob = async (id) => {
  const res = await api.getPresupuestoPdf(id)
  return new Blob([res.data], { type: "application/pdf" })
}

const triggerBlobDownload = (blob, numero) => {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `Presupuesto-${numero}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

const enviarWhatsapp = async (presupuesto) => {
  error.value = ""
  ok.value = ""

  try {
    const mensaje = buildWhatsappMessage(presupuesto)
    const pdfBlob = await descargarPdfBlob(presupuesto.id)
    const fileName = `Presupuesto-${presupuesto.numero}.pdf`

    if (navigator.share && navigator.canShare) {
      const pdfFile = new File([pdfBlob], fileName, { type: "application/pdf" })
      if (navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: `Presupuesto ${presupuesto.numero}`,
          text: mensaje,
          files: [pdfFile],
        })
        return
      }
    }

    // Fallback desktop/web: abre WhatsApp para elegir contacto y descarga el PDF para adjuntar manualmente.
    triggerBlobDownload(pdfBlob, presupuesto.numero)
    const link = `https://wa.me/?text=${encodeURIComponent(mensaje)}`
    window.open(link, "_blank", "noopener,noreferrer")
    ok.value = "Se abrio WhatsApp para elegir contacto. Se descargo el PDF para adjuntarlo al mensaje."
  } catch (err) {
    if (err?.name === "AbortError") return
    error.value = "No se pudo preparar el envio por WhatsApp"
    console.error(err)
  }
}

const descargarPdf = async (id, numero) => {
  error.value = ""
  ok.value = ""
  try {
    const blob = await descargarPdfBlob(id)
    triggerBlobDownload(blob, numero)
  } catch (err) {
    error.value = "No se pudo descargar el PDF"
    console.error(err)
  }
}

const cambiarEstado = async (id, estado) => {
  error.value = ""
  ok.value = ""
  try {
    await api.updateEstadoPresupuesto(id, estado)
    await loadData()
  } catch (err) {
    error.value = "No se pudo actualizar el estado"
    console.error(err)
  }
}

const eliminarPresupuesto = async () => {
  if (!presupuestoAEliminar.value) return
  ok.value = ""
  error.value = ""

  try {
    await api.deletePresupuesto(presupuestoAEliminar.value.id)
    await loadData()
    ok.value = `Presupuesto #${presupuestoAEliminar.value.numero} eliminado correctamente`
    closeDeleteConfirm()
  } catch (err) {
    error.value = err?.response?.data?.error || "No se pudo eliminar el presupuesto"
    console.error(err)
  }
}

onMounted(async () => {
  await loadData()
  socket.on('presupuestos:changed', loadData)
})
onUnmounted(() => {
  socket.off('presupuestos:changed', loadData)
})
</script>

<template>
  <LayoutShell title="Presupuestos" subtitle="Generacion de presupuestos, edicion, envio por WhatsApp y gestion de estados">
    <div class="presupuestos-page">
      <section class="topbar-card">
        <div class="topbar-copy">
          <span class="section-kicker">Panel de presupuestos</span>
          <h2>Listado operativo</h2>
          <p>Filtrá rápido, revisá por estado y abrí el alta o edición en un modal separado.</p>
        </div>
        <div class="topbar-actions">
          <div class="topbar-number">Próximo: #{{ numeroSiguiente }}</div>
          <button class="btn-primary topbar-new-btn" @click="openForm">+ Nuevo presupuesto</button>
        </div>
      </section>

      <div class="stats-grid">
        <div class="stat-card stat-card-count">
          <span>Presupuestos registrados</span>
          <strong>{{ presupuestos.length }}</strong>
          <small>Base total de propuestas generadas en el sistema.</small>
        </div>
        <div class="stat-card stat-card-total">
          <span>Total presupuestado</span>
          <strong>{{ formatMoney(totalPresupuestado) }}</strong>
          <small>Suma consolidada de todos los presupuestos emitidos.</small>
        </div>
        <div class="stat-card stat-card-pending">
          <span>Total pendiente</span>
          <strong>{{ formatMoney(totalPendiente) }}</strong>
          <small>Importe que sigue en etapa comercial o sin cierre.</small>
        </div>
        <div class="stat-card stat-card-accepted">
          <span>Total aceptado</span>
          <strong>{{ formatMoney(totalAceptado) }}</strong>
          <small>Monto confirmado para avanzar a certificados y facturacion.</small>
        </div>
      </div>

      <section class="filters-card">
        <div class="filters-main-row">
          <label class="filter-field filter-field-search">
            <span>Buscar</span>
            <input v-model="filtroBusqueda" type="text" placeholder="Numero, cliente, obra o forma de pago" />
          </label>

          <label class="filter-field">
            <span>Cliente</span>
            <select v-model="filtroCliente">
              <option value="">Todos</option>
              <option v-for="cliente in clientesOrdenados" :key="cliente.id" :value="cliente.id">{{ getEtiquetaCliente(cliente) }}</option>
            </select>
          </label>

          <div class="filter-actions">
            <button type="button" class="btn-secondary" @click="limpiarFiltros">Limpiar filtros</button>
          </div>
        </div>

        <div class="state-filter-row">
          <button
            type="button"
            class="state-filter-chip"
            :class="{ active: filtroEstado === 'todos' }"
            @click="filtroEstado = 'todos'"
          >
            <span>Todos</span>
            <strong>{{ conteoEstados.todos }}</strong>
          </button>
          <button
            v-for="estado in ESTADOS_PRESUPUESTO"
            :key="estado.key"
            type="button"
            class="state-filter-chip"
            :class="['state-filter-chip-' + estado.key, { active: filtroEstado === estado.key }]"
            @click="filtroEstado = estado.key"
          >
            <span>{{ estado.label }}</span>
            <strong>{{ conteoEstados[estado.key] }}</strong>
          </button>
        </div>
      </section>

      <div v-if="ok" class="ok-msg">{{ ok }}</div>
      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="loading" class="loading">Cargando...</div>

      <section v-if="!loading && presupuestos.length === 0 && presupuestosFiltrados.length === 0" class="empty-state global-empty-state">
        <div class="empty-copy">
          <h4>No hay presupuestos cargados</h4>
          <p>Generá el primero desde el botón superior y después administralos desde el tablero por estados.</p>
        </div>
        <button class="btn-primary empty-cta" @click="openForm">Crear presupuesto</button>
      </section>

      <section class="estado-board" v-else>
        <article v-for="seccion in seccionesEstado" :key="seccion.key" class="estado-column">
          <header class="estado-column-header">
            <div>
              <span class="section-kicker">{{ seccion.label }}</span>
              <h3>{{ seccion.label }}</h3>
              <p>{{ seccion.description }}</p>
            </div>
            <div class="list-header-badge">{{ seccion.items.length }}</div>
          </header>

          <div v-if="seccion.items.length === 0" class="estado-empty-card">
            <strong>Sin presupuestos en esta columna</strong>
            <span>No hay coincidencias con los filtros actuales.</span>
          </div>

          <div v-else class="presupuesto-stack">
            <article v-for="p in seccion.items" :key="p.id" class="presupuesto-card">
              <header class="presupuesto-card-header">
                <div class="presupuesto-card-id">
                  <span class="nro-pill">#{{ p.numero }}</span>
                  <span class="fecha-pill">{{ formatDate(p.fecha) }}</span>
                </div>
                <span :class="estadoClass(p.estado)">{{ estadoLabel(p.estado) }}</span>
              </header>

              <div class="presupuesto-card-main">
                <div class="presupuesto-meta">
                  <div class="meta-line">
                    <span class="meta-label">Cliente</span>
                    <strong>{{ p.cliente || getClienteNombre(p.cliente_id) }}</strong>
                  </div>
                  <div class="meta-line">
                    <span class="meta-label">Obra</span>
                    <strong>{{ p.obra || getObraNombre(p.obra_id) }}</strong>
                  </div>
                  <div class="meta-line">
                    <span class="meta-label">Forma de pago</span>
                    <strong>{{ p.forma_pago || "-" }}</strong>
                  </div>
                  <div class="meta-line meta-line-certificados">
                    <span class="meta-label">Certificados</span>
                    <strong :class="certificadoStatusClass(p)">{{ certificadoStatusLabel(p) }}</strong>
                  </div>
                </div>

                <div class="presupuesto-total-block">
                  <span>Total</span>
                  <strong>{{ formatMoney(p.total) }}</strong>
                  <small v-if="Number(p.cantidad_certificados || 0) > 0">
                    Certificado: {{ formatMoney(p.total_certificado_con_iva) }} · Pagado: {{ formatMoney(p.total_pagado_certificados) }}
                  </small>
                </div>
              </div>

              <footer class="presupuesto-card-footer">
                <select :value="p.estado" class="estado-select" @change="(e) => cambiarEstado(p.id, e.target.value)">
                  <option value="pendiente">Pendiente</option>
                  <option value="enviado">Enviado</option>
                  <option value="aceptado">Aceptado</option>
                  <option value="rechazado">Rechazado</option>
                </select>

                <div class="acciones-presupuesto">
                  <button type="button" class="btn-chip btn-chip-cert" @click="abrirCertificados(p)">
                    {{ Number(p.cantidad_certificados || 0) > 0 ? "Ver avances" : "Generar certificado" }}
                  </button>
                  <button type="button" class="btn-chip btn-chip-edit" @click="editPresupuesto(p.id)">Editar</button>
                  <button type="button" class="btn-chip btn-chip-download" @click="descargarPdf(p.id, p.numero)">Descargar</button>
                  <button type="button" class="btn-chip btn-chip-whatsapp" @click="enviarWhatsapp(p)">WhatsApp</button>
                  <button type="button" class="btn-chip btn-chip-delete" @click="openDeleteConfirm(p)">Eliminar</button>
                </div>
              </footer>
            </article>
          </div>
        </article>
      </section>

      <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
        <div class="modal modal-presupuesto">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker">{{ editingId ? 'Edicion' : 'Alta' }}</span>
              <h3>{{ editingId ? `Editar presupuesto #${editingNumero}` : 'Nuevo presupuesto' }}</h3>
              <p>Definí cliente, obra, materiales, mano de obra y condiciones comerciales en una sola carga, con el resumen siempre visible.</p>
            </div>
            <div class="modal-header-actions">
              <div class="next-number-inline">Numero sugerido: #{{ numeroSiguiente }}</div>
              <button type="button" class="btn-close" aria-label="Cerrar modal" @click="closeForm">×</button>
            </div>
          </div>

          <form @submit.prevent="savePresupuesto" class="modal-form modal-form-presupuesto">
            <div class="modal-summary-pills">
              <div class="summary-pill">
                <span>Cliente</span>
                <strong>{{ form.cliente_id ? getClienteNombre(Number(form.cliente_id)) : 'Sin seleccionar' }}</strong>
              </div>
              <div class="summary-pill">
                <span>Obra</span>
                <strong>{{ form.obra_id ? getObraNombre(Number(form.obra_id)) : 'Sin seleccionar' }}</strong>
              </div>
              <div class="summary-pill">
                <span>Total estimado</span>
                <strong>{{ formatMoney(total) }}</strong>
              </div>
            </div>

            <section class="modal-section">
              <div class="modal-section-header">
                <div>
                  <span class="section-kicker">Datos comerciales</span>
                  <h4>Cliente, obra y condiciones generales</h4>
                </div>
                <small>Completá el frente comercial del presupuesto antes de cargar materiales y mano de obra.</small>
              </div>

              <div class="grid-form grid-form-top">
                <div class="field-card">
                  <label>Cliente</label>
                  <select :value="form.cliente_id" @change="(e) => setCliente(e.target.value)">
                    <option value="">Seleccionar</option>
                    <option v-for="c in clientesOrdenados" :key="c.id" :value="c.id">{{ getEtiquetaCliente(c) }}</option>
                  </select>
                </div>

                <div class="field-card">
                  <label>Obra</label>
                  <select v-model="form.obra_id">
                    <option value="">Seleccionar</option>
                    <option v-for="o in obrasDelCliente" :key="o.id" :value="o.id">{{ o.nombre }}</option>
                  </select>
                </div>

                <div class="field-card">
                  <label>Fecha</label>
                  <input v-model="form.fecha" type="date" />
                </div>

                <div class="field-card">
                  <label>Validez (dias)</label>
                  <input v-model.number="form.validez_dias" type="number" min="1" />
                </div>

                <div class="field-card">
                  <label>Forma de pago</label>
                  <input v-model="form.forma_pago" type="text" placeholder="Contado / Transferencia" />
                </div>

                <div class="field-card iva-box field-card-accent">
                  <label>
                    <input v-model="form.aplica_iva" type="checkbox" /> Aplicar IVA a materiales
                  </label>
                  <input v-model.number="form.iva_porcentaje" type="number" min="0" step="0.01" :disabled="!form.aplica_iva" />
                </div>
              </div>
            </section>

            <div class="items-grid">
              <section class="items-section section-mano-obra">
                <div class="section-head">
                  <div>
                    <span class="section-kicker">Operativa</span>
                    <h4>Mano de obra</h4>
                  </div>
                  <button type="button" class="btn-secondary" @click="addManoObraRow">+ Item</button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Descripcion</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in form.items_mano_obra" :key="row.uid">
                      <td><input v-model="row.descripcion" type="text" placeholder="Detalle de tarea" /></td>
                      <td><button type="button" class="btn-link danger" @click="removeManoObraRow(row.uid)">Quitar</button></td>
                    </tr>
                  </tbody>
                </table>
                <div class="subtotal-general-box">
                  <label>Subtotal general mano de obra</label>
                  <input v-model.number="form.subtotal_general_mano_obra" type="number" min="0" step="0.01" />
                </div>
              </section>

              <section class="items-section section-materiales">
                <div class="section-head">
                  <div>
                    <span class="section-kicker">Costeo</span>
                    <h4>Materiales</h4>
                  </div>
                  <button type="button" class="btn-secondary" @click="addMaterialRow">+ Item</button>
                </div>
                <div class="materials-table-wrap">
                  <table class="materials-table">
                    <thead>
                      <tr>
                        <th>Descripcion</th>
                        <th>Cantidad</th>
                        <th>Precio unitario</th>
                        <th>Ganancia % (interno)</th>
                        <th>P. c/ganancia</th>
                        <th>Subtotal</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in form.items_materiales" :key="row.uid">
                        <td><input v-model="row.descripcion" type="text" placeholder="Material" /></td>
                        <td><input v-model.number="row.cantidad" type="number" min="0" step="0.01" /></td>
                        <td><input v-model.number="row.precio_unitario" type="number" min="0" step="0.01" /></td>
                        <td><input v-model.number="row.ganancia_porcentaje" type="number" min="0" step="0.01" /></td>
                        <td>{{ formatMoney(precioUnitarioConGanancia(row)) }}</td>
                        <td>{{ formatMoney(subtotalMaterialRowConGanancia(row)) }}</td>
                        <td><button type="button" class="btn-link danger" @click="removeMaterialRow(row.uid)">Quitar</button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div class="resumen-card">
              <div class="resumen-line"><span>Subtotal mano de obra</span><strong>{{ formatMoney(subtotalManoObra) }}</strong></div>
              <div class="resumen-line"><span>Subtotal materiales</span><strong>{{ formatMoney(subtotalMateriales) }}</strong></div>
              <div class="resumen-line"><span>IVA</span><strong>{{ formatMoney(ivaMonto) }}</strong></div>
              <div class="total">TOTAL: {{ formatMoney(total) }}</div>
            </div>

            <div class="observaciones-block">
              <label>Observaciones</label>
              <textarea v-model="form.observaciones" rows="3" placeholder="Condiciones, alcance, notas"></textarea>
            </div>

            <section class="modal-section modal-section-interna">
              <div class="modal-section-header">
                <div>
                  <span class="section-kicker">Solo uso interno</span>
                  <h4>Información interna</h4>
                </div>
                <small>Estos datos son privados. Cada campo tiene su propio tilde: si está marcado aparece en el PDF, si no está marcado no aparece.</small>
              </div>

              <div class="interna-cabecera-grid">
                <div class="interna-field-row">
                  <div class="interna-input-wrap">
                    <label>Quien hizo el presupuesto</label>
                    <input v-model="form.info_interna_quien_hizo" type="text" placeholder="Nombre o iniciales" />
                  </div>
                  <label class="interna-pdf-check">
                    <input v-model="form.info_interna_quien_hizo_pdf" type="checkbox" />
                    <span>Sale en PDF</span>
                  </label>
                </div>

                <div class="interna-field-row">
                  <div class="interna-input-wrap">
                    <label>Quien aprobo el presupuesto</label>
                    <input v-model="form.info_interna_quien_aprobo" type="text" placeholder="Nombre o iniciales" />
                  </div>
                  <label class="interna-pdf-check">
                    <input v-model="form.info_interna_quien_aprobo_pdf" type="checkbox" />
                    <span>Sale en PDF</span>
                  </label>
                </div>
              </div>

              <div class="interna-items-header">
                <span>Items internos adicionales</span>
                <button type="button" class="btn-secondary btn-secondary-sm" @click="addInfoInternaRow">+ Agregar item</button>
              </div>

              <div v-if="form.items_info_interna.length === 0" class="interna-empty">
                Sin ítems internos. Usá "+ Agregar item" para añadir.
              </div>

              <div v-else class="interna-items-list">
                <div v-for="row in form.items_info_interna" :key="row.uid" class="interna-item-row">
                  <input v-model="row.descripcion" type="text" placeholder="Descripcion del item interno" class="interna-item-input" />
                  <label class="interna-pdf-check">
                    <input v-model="row.mostrar_en_pdf" type="checkbox" />
                    <span>Sale en PDF</span>
                  </label>
                  <button type="button" class="btn-link danger" @click="removeInfoInternaRow(row.uid)">Quitar</button>
                </div>
              </div>
            </section>

            <div class="actions modal-actions">
              <button type="button" class="btn-secondary" @click="closeForm">Cancelar</button>
              <button type="submit" class="btn-primary" :disabled="saving">
                {{ saving ? 'Guardando...' : editingId ? 'Actualizar presupuesto' : 'Guardar presupuesto' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="closeDeleteConfirm">
        <div class="modal modal-confirmacion">
          <div class="modal-header modal-header-confirmacion">
            <div class="modal-header-copy">
              <span class="section-kicker">Accion critica</span>
              <h3>Eliminar presupuesto</h3>
              <p>Esta acción quitará el presupuesto del tablero, del historial y de los reportes asociados.</p>
            </div>
            <button type="button" class="btn-close" aria-label="Cerrar modal" @click="closeDeleteConfirm">×</button>
          </div>

          <div class="modal-form modal-form-confirmacion">
            <div class="confirmacion-icono">!</div>
            <div v-if="presupuestoAEliminar" class="confirmacion-copy">
              <p>¿Querés eliminar definitivamente el presupuesto #{{ presupuestoAEliminar.numero }}?</p>
              <div class="confirmacion-resumen">
                <span>{{ presupuestoAEliminar.cliente || getClienteNombre(presupuestoAEliminar.cliente_id) }}</span>
                <strong>{{ formatMoney(presupuestoAEliminar.total) }}</strong>
                <small>{{ presupuestoAEliminar.obra || getObraNombre(presupuestoAEliminar.obra_id) }}</small>
              </div>
            </div>

            <div class="actions modal-actions modal-actions-confirmacion">
              <button type="button" class="btn-secondary" @click="closeDeleteConfirm">Cancelar</button>
              <button type="button" class="btn-primary btn-danger" @click="eliminarPresupuesto">Eliminar presupuesto</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.presupuestos-page {
  --page: #0d1420;
  --surface: rgba(17, 24, 39, 0.72);
  --surface-strong: rgba(17, 24, 39, 0.9);
  --surface-soft: rgba(30, 41, 59, 0.62);
  --line: rgba(148, 163, 184, 0.16);
  --line-strong: rgba(148, 163, 184, 0.24);
  --ink: #edf2f7;
  --muted: #9aa6b8;
  --accent: #7dd3fc;
  --accent-strong: #3b82f6;
  --accent-soft: rgba(59, 130, 246, 0.12);
  --success: #86efac;
  --danger: #fca5a5;

  display: grid;
  gap: 14px;
  color: var(--ink);
}

.topbar-card,
.filters-card,
.estado-column,
.global-empty-state,
.stat-card,
.modal {
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.1), transparent 32%),
    linear-gradient(180deg, rgba(17, 24, 39, 0.94), rgba(15, 23, 36, 0.92));
  border: 1px solid var(--line);
  box-shadow: 0 16px 34px -30px rgba(0, 0, 0, 0.78);
}

.topbar-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 18px;
  border-radius: 16px;
}

.topbar-copy {
  display: grid;
  gap: 4px;
}

.section-kicker {
  display: inline-block;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}

.topbar-copy h2,
.estado-column-header h3,
.modal-header h3 {
  margin: 0;
  font-size: 1.35rem;
}

.topbar-copy p,
.estado-column-header p {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.modal-header-copy {
  display: grid;
  gap: 0.35rem;
}

.modal-header-copy p {
  margin: 0;
  max-width: 60ch;
  color: var(--muted);
  line-height: 1.45;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.topbar-number,
.next-number-inline,
.list-header-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  background: var(--accent-soft);
  color: #dbeafe;
  font-size: 0.8rem;
  font-weight: 800;
}

.topbar-new-btn {
  white-space: nowrap;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.stat-card {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 14px;
  overflow: hidden;
}

.stat-card::after {
  content: "";
  position: absolute;
  width: 96px;
  height: 96px;
  right: -18px;
  bottom: -28px;
  border-radius: 50%;
  opacity: 0.8;
}

.stat-card-count::after { background: radial-gradient(circle, rgba(216, 162, 90, 0.18), transparent 65%); }
.stat-card-total::after { background: radial-gradient(circle, rgba(96, 165, 250, 0.18), transparent 65%); }
.stat-card-pending::after { background: radial-gradient(circle, rgba(250, 204, 21, 0.16), transparent 65%); }
.stat-card-accepted::after { background: radial-gradient(circle, rgba(74, 222, 128, 0.16), transparent 65%); }

.stat-card span {
  position: relative;
  z-index: 1;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a8b3c4;
}

.stat-card strong {
  position: relative;
  z-index: 1;
  font-size: 1.2rem;
}

.stat-card small {
  position: relative;
  z-index: 1;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.35;
}

.filters-card {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
}

.filters-main-row {
  display: grid;
  grid-template-columns: minmax(260px, 1.6fr) minmax(220px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.filter-field {
  display: grid;
  gap: 6px;
}

.filter-field span,
label {
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9ba8bc;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 11px;
  background: rgba(9, 15, 26, 0.72);
  color: var(--ink);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: rgba(216, 162, 90, 0.36);
  box-shadow: 0 0 0 3px rgba(216, 162, 90, 0.1);
}

.filter-actions {
  display: flex;
  align-items: center;
}

.state-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.state-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--ink);
  cursor: pointer;
  font-weight: 700;
}

.state-filter-chip strong {
  display: inline-flex;
  min-width: 24px;
  justify-content: center;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.78rem;
}

.state-filter-chip.active {
  border-color: rgba(125, 211, 252, 0.36);
  background: rgba(59, 130, 246, 0.12);
  color: #dbeafe;
}

.state-filter-chip-pendiente.active { background: rgba(250, 204, 21, 0.12); color: #fde68a; }
.state-filter-chip-enviado.active { background: rgba(96, 165, 250, 0.12); color: #bfdbfe; }
.state-filter-chip-aceptado.active { background: rgba(74, 222, 128, 0.12); color: #bbf7d0; }
.state-filter-chip-rechazado.active { background: rgba(248, 113, 113, 0.12); color: #fecaca; }

.ok-msg,
.error-msg {
  border-radius: 12px;
  padding: 10px 12px;
  font-weight: 700;
}

.ok-msg {
  background: rgba(22, 101, 52, 0.14);
  border: 1px solid rgba(74, 222, 128, 0.24);
  color: #bbf7d0;
}

.error-msg {
  background: rgba(127, 29, 29, 0.18);
  border: 1px solid rgba(248, 113, 113, 0.24);
  color: #fecaca;
}

.loading {
  color: var(--muted);
}

.estado-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  align-items: start;
}

.estado-column {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  min-height: 220px;
}

.estado-column-header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}

.estado-empty-card,
.global-empty-state {
  display: grid;
  gap: 6px;
  justify-items: center;
  text-align: center;
  padding: 20px 16px;
  border-radius: 16px;
}

.estado-empty-card {
  border: 1px dashed var(--line-strong);
  background: rgba(255, 255, 255, 0.02);
  color: var(--muted);
}

.global-empty-state {
  border: 1px dashed var(--line-strong);
}

.empty-copy h4 {
  margin: 0;
  font-size: 1.05rem;
}

.empty-copy p {
  margin: 0;
  color: var(--muted);
  max-width: 560px;
  line-height: 1.45;
}

.empty-cta {
  min-width: 220px;
}

.presupuesto-stack {
  display: grid;
  gap: 10px;
}

.presupuesto-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(10, 16, 28, 0.86), rgba(15, 23, 36, 0.78));
  transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.presupuesto-card:hover {
  transform: translateY(-1px);
  border-color: rgba(125, 211, 252, 0.22);
  box-shadow: 0 18px 28px -24px rgba(59, 130, 246, 0.45);
}

.presupuesto-card-header,
.presupuesto-card-footer,
.presupuesto-card-id,
.acciones-presupuesto {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.presupuesto-card-header,
.presupuesto-card-footer {
  justify-content: space-between;
}

.presupuesto-card-main {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: start;
}

.presupuesto-meta {
  display: grid;
  gap: 5px;
}

.meta-line {
  display: grid;
  gap: 2px;
}

.meta-label {
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9aa6b8;
  font-weight: 800;
}

.meta-line strong {
  font-size: 0.84rem;
}

.meta-line-certificados strong {
  font-size: 0.82rem;
}

.cert-badge {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  font-weight: 700;
}

.cert-badge-empty { background: rgba(217, 119, 6, 0.16); color: #fdba74; }
.cert-badge-pending { background: rgba(250, 204, 21, 0.14); color: #fde68a; }
.cert-badge-ok { background: rgba(34, 197, 94, 0.14); color: #bbf7d0; }

.presupuesto-total-block {
  min-width: 136px;
  display: grid;
  align-self: start;
  align-content: start;
  gap: 3px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background: rgba(59, 130, 246, 0.08);
  height: fit-content;
}

.presupuesto-total-block span {
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #b7c2d1;
  font-weight: 800;
}

.presupuesto-total-block strong {
  font-size: 1rem;
}

.presupuesto-total-block small {
  color: var(--muted);
  font-size: 0.76rem;
  line-height: 1.35;
}

.nro-pill,
.fecha-pill,
.estado-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
}

.nro-pill {
  min-width: 40px;
  padding: 5px 10px;
  background: rgba(59, 130, 246, 0.14);
  border: 1px solid rgba(125, 211, 252, 0.22);
  color: #dbeafe;
}

.fecha-pill {
  padding: 5px 10px;
  border: 1px solid var(--line);
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.04);
}

.estado-pill {
  padding: 5px 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.estado-pendiente { background: rgba(250, 204, 21, 0.14); color: #fde68a; border-color: rgba(250, 204, 21, 0.2); }
.estado-enviado { background: rgba(96, 165, 250, 0.14); color: #bfdbfe; border-color: rgba(96, 165, 250, 0.2); }
.estado-aceptado { background: rgba(74, 222, 128, 0.14); color: #bbf7d0; border-color: rgba(74, 222, 128, 0.2); }
.estado-rechazado { background: rgba(248, 113, 113, 0.14); color: #fecaca; border-color: rgba(248, 113, 113, 0.2); }

.estado-select {
  max-width: 138px;
}

.btn-primary,
.btn-secondary,
.btn-chip {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 9px 13px;
  cursor: pointer;
  font-weight: 700;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent-strong), #0ea5e9);
  color: #eff6ff;
  border-color: rgba(125, 211, 252, 0.3);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.04);
  color: var(--ink);
  border-color: var(--line);
}

.btn-primary:hover,
.btn-secondary:hover,
.btn-chip:hover,
.btn-link:hover,
.btn-close:hover {
  transform: translateY(-1px);
}

.btn-chip {
  padding: 6px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--line);
  color: var(--ink);
  font-size: 0.72rem;
}

.btn-chip-edit { background: rgba(99, 102, 241, 0.14); color: #c7d2fe; border-color: rgba(99, 102, 241, 0.18); }
.btn-chip-download { background: rgba(249, 115, 22, 0.12); color: #fdba74; border-color: rgba(249, 115, 22, 0.16); }
.btn-chip-whatsapp { background: rgba(34, 197, 94, 0.12); color: #bbf7d0; border-color: rgba(34, 197, 94, 0.16); }
.btn-chip-delete { background: rgba(239, 68, 68, 0.12); color: #fecaca; border-color: rgba(239, 68, 68, 0.16); }

.btn-danger {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.92), rgba(190, 24, 93, 0.92));
  border-color: rgba(248, 113, 113, 0.28);
  color: #fff1f2;
}

.btn-link {
  border: none;
  background: transparent;
  color: #e5e7eb;
  cursor: pointer;
  font-weight: 700;
}

.btn-link.danger {
  color: #f87171;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at top, rgba(15, 23, 42, 0.45), rgba(2, 6, 23, 0.82)),
    rgba(2, 6, 23, 0.68);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.modal {
  width: min(1420px, 98vw);
  max-height: 92vh;
  overflow: auto;
  border-radius: 18px;
  padding: 18px;
}

.modal-presupuesto {
  width: min(1460px, 98vw);
}

.modal-confirmacion {
  width: min(520px, 92vw);
  max-height: none;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}

.modal-header-confirmacion {
  margin-bottom: 10px;
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-close {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--ink);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.modal-form {
  display: grid;
  gap: 14px;
}

.modal-summary-pills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.summary-pill {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.92));
}

.summary-pill span {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #9ba8bc;
}

.summary-pill strong {
  font-size: 0.95rem;
}

.modal-section {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
}

.modal-section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.modal-section-header > div {
  display: grid;
  gap: 3px;
}

.modal-section-header h4,
.section-head h4 {
  margin: 0;
  font-size: 1rem;
}

.modal-section-header small {
  max-width: 36rem;
  color: var(--muted);
  line-height: 1.45;
}

.grid-form-top {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.field-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(9, 15, 26, 0.32);
}

.field-card-accent {
  border-color: rgba(96, 165, 250, 0.18);
  background: rgba(30, 64, 175, 0.08);
}

.grid-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.iva-box {
  display: grid;
  gap: 8px;
}

.iva-box label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.iva-box input[type="checkbox"] {
  width: auto;
}

.items-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.85fr) minmax(620px, 1.4fr);
  gap: 14px;
  align-items: start;
}

.items-section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  align-self: start;
}

.section-mano-obra {
  min-width: 0;
}

.section-materiales {
  min-width: 0;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.section-head > div {
  display: grid;
  gap: 3px;
}

.section-mano-obra h4 { color: #f8fafc; }
.section-materiales h4 { color: #dbeafe; }

table {
  width: 100%;
  border-collapse: collapse;
  background: rgba(2, 6, 23, 0.24);
  border-radius: 12px;
  overflow: hidden;
}

.materials-table-wrap {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
}

.materials-table {
  min-width: 760px;
}

.materials-table th,
.materials-table td {
  white-space: nowrap;
}

.materials-table td:first-child,
.materials-table th:first-child {
  width: 26%;
}

.materials-table td input {
  min-width: 0;
}

th,
td {
  padding: 9px 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  text-align: left;
}

th {
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #9aa6b8;
}

.subtotal-general-box {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--line-strong);
}

.resumen-card {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background: rgba(59, 130, 246, 0.08);
}

.resumen-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink);
}

.total {
  font-size: 1.06rem;
  font-weight: 800;
}

.observaciones-block {
  display: grid;
  gap: 6px;
}

.modal-section-interna {
  border: 1px solid rgba(216, 162, 90, 0.18);
  border-radius: 14px;
  padding: 14px 16px;
  background: rgba(216, 162, 90, 0.04);
}

.interna-cabecera-grid {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.interna-field-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: end;
}

.interna-input-wrap {
  display: grid;
  gap: 5px;
}

.interna-pdf-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  padding-bottom: 10px;
  text-transform: none;
  letter-spacing: 0;
}

.interna-pdf-check input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--accent-strong);
  cursor: pointer;
}

.interna-items-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  margin-bottom: 8px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #9ba8bc;
}

.btn-secondary-sm {
  padding: 5px 10px;
  font-size: 0.78rem;
}

.interna-empty {
  font-size: 0.82rem;
  color: var(--muted);
  padding: 8px 0;
}

.interna-items-list {
  display: grid;
  gap: 8px;
}

.interna-item-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
}

.interna-item-input {
  min-width: 0;
}

.modal-form-confirmacion {
  justify-items: center;
  text-align: center;
}

.confirmacion-icono {
  width: 54px;
  height: 54px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(248, 113, 113, 0.24);
  background: rgba(127, 29, 29, 0.36);
  color: #fecaca;
  font-size: 1.5rem;
  font-weight: 800;
}

.confirmacion-copy {
  display: grid;
  gap: 12px;
  width: 100%;
}

.confirmacion-copy p,
.confirmacion-resumen small {
  margin: 0;
  color: var(--muted);
}

.confirmacion-resumen {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(248, 113, 113, 0.16);
  background: rgba(127, 29, 29, 0.16);
}

.confirmacion-resumen strong {
  color: #fecaca;
  font-size: 1rem;
}

.modal-actions-confirmacion {
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-actions {
  padding-top: 6px;
}

@media (max-width: 960px) {
  .filters-main-row {
    grid-template-columns: 1fr;
  }

  .presupuesto-card-main {
    grid-template-columns: 1fr;
  }

  .presupuesto-total-block {
    min-width: 0;
  }

  .items-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .topbar-card,
  .modal-header,
  .modal-section-header,
  .presupuesto-card-footer,
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .topbar-actions,
  .modal-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .stats-grid,
  .estado-board,
  .grid-form {
    grid-template-columns: 1fr;
  }

  .modal-overlay {
    padding: 12px;
  }

  .modal {
    width: 100%;
    max-height: 94vh;
    padding: 14px;
  }

  .actions button,
  .topbar-new-btn,
  .filter-actions button {
    width: 100%;
  }
}
</style>

