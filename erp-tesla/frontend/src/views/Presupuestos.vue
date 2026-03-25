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
const numeroSiguiente = ref(1)
const editingId = ref(null)
const editingNumero = ref(null)

const newMaterialItem = () => ({ uid: Date.now() + Math.random(), descripcion: "", cantidad: 1, precio_unitario: 0, ganancia_porcentaje: 0 })
const newManoObraItem = () => ({ uid: Date.now() + Math.random(), descripcion: "" })

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
})

const obrasDelCliente = computed(() => {
  if (!form.value.cliente_id) return []
  return obras.value.filter((obra) => String(obra.cliente_id) === String(form.value.cliente_id))
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
  return c ? c.razon_social : "-"
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
  try {
    const blob = await descargarPdfBlob(id)
    triggerBlobDownload(blob, numero)
  } catch (err) {
    error.value = "No se pudo descargar el PDF"
    console.error(err)
  }
}

const cambiarEstado = async (id, estado) => {
  try {
    await api.updateEstadoPresupuesto(id, estado)
    await loadData()
  } catch (err) {
    error.value = "No se pudo actualizar el estado"
    console.error(err)
  }
}

const eliminarPresupuesto = async (presupuesto) => {
  const confirmado = window.confirm(`Se eliminara el presupuesto #${presupuesto.numero}. Esta accion no se puede deshacer. Desea continuar?`)
  if (!confirmado) return

  ok.value = ""
  error.value = ""

  try {
    await api.deletePresupuesto(presupuesto.id)
    await loadData()
    ok.value = `Presupuesto #${presupuesto.numero} eliminado correctamente`
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
      <div class="hero-card">
        <div class="hero-text">
          <span class="hero-kicker">Presupuestos Tesla</span>
          <h2>Gestion de presupuestos</h2>
          <p>Crea, edita y envia presupuestos con calculo automatico de materiales, mano de obra e IVA.</p>
        </div>
        <div class="hero-actions">
          <div class="next-number">Proximo: #{{ numeroSiguiente }}</div>
          <button class="btn-primary hero-new-btn" @click="openForm">+ Nuevo presupuesto</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <span>Presupuestos registrados</span>
          <strong>{{ presupuestos.length }}</strong>
        </div>
        <div class="stat-card">
          <span>Total presupuestado</span>
          <strong>{{ formatMoney(totalPresupuestado) }}</strong>
        </div>
        <div class="stat-card">
          <span>Total pendiente</span>
          <strong>{{ formatMoney(totalPendiente) }}</strong>
        </div>
        <div class="stat-card">
          <span>Total aceptado</span>
          <strong>{{ formatMoney(totalAceptado) }}</strong>
        </div>
      </div>

      <div v-if="ok" class="ok-msg">{{ ok }}</div>
      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="loading" class="loading">Cargando...</div>

      <div v-if="showForm" class="form-card">
        <div class="form-header">
          <h3>{{ editingId ? `Editar presupuesto #${editingNumero}` : "Nuevo presupuesto" }}</h3>
          <div class="next-number-inline">Numero sugerido: #{{ numeroSiguiente }}</div>
        </div>

        <div class="grid-form">
          <div>
            <label>Cliente</label>
            <select :value="form.cliente_id" @change="(e) => setCliente(e.target.value)">
              <option value="">Seleccionar</option>
              <option v-for="c in clientes" :key="c.id" :value="c.id">{{ c.razon_social }}</option>
            </select>
          </div>

          <div>
            <label>Obra</label>
            <select v-model="form.obra_id">
              <option value="">Seleccionar</option>
              <option v-for="o in obrasDelCliente" :key="o.id" :value="o.id">{{ o.nombre }}</option>
            </select>
          </div>

          <div>
            <label>Fecha</label>
            <input v-model="form.fecha" type="date" />
          </div>

          <div>
            <label>Validez (dias)</label>
            <input v-model.number="form.validez_dias" type="number" min="1" />
          </div>

          <div>
            <label>Forma de pago</label>
            <input v-model="form.forma_pago" type="text" placeholder="Contado / Transferencia" />
          </div>

          <div class="iva-box">
            <label>
              <input v-model="form.aplica_iva" type="checkbox" /> Aplicar IVA a materiales
            </label>
            <input v-model.number="form.iva_porcentaje" type="number" min="0" step="0.01" :disabled="!form.aplica_iva" />
          </div>
        </div>

        <div class="items-grid">
          <div class="items-section section-mano-obra">
            <div class="section-head">
              <h4>Mano de obra</h4>
              <button class="btn-secondary" @click="addManoObraRow">+ Item</button>
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
                <td><button class="btn-link danger" @click="removeManoObraRow(row.uid)">Quitar</button></td>
              </tr>
            </tbody>
          </table>
          <div class="subtotal-general-box">
            <label>Subtotal general mano de obra</label>
            <input v-model.number="form.subtotal_general_mano_obra" type="number" min="0" step="0.01" />
          </div>
          </div>

          <div class="items-section section-materiales">
            <div class="section-head">
              <h4>Materiales</h4>
              <button class="btn-secondary" @click="addMaterialRow">+ Item</button>
            </div>
          <table>
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
                <td><button class="btn-link danger" @click="removeMaterialRow(row.uid)">Quitar</button></td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <div class="resumen-card">
          <div>Subtotal mano de obra: <strong>{{ formatMoney(subtotalManoObra) }}</strong></div>
          <div>Subtotal materiales: <strong>{{ formatMoney(subtotalMateriales) }}</strong></div>
          <div>IVA: <strong>{{ formatMoney(ivaMonto) }}</strong></div>
          <div class="total">TOTAL: {{ formatMoney(total) }}</div>
        </div>

        <div>
          <label>Observaciones</label>
          <textarea v-model="form.observaciones" rows="3" placeholder="Condiciones, alcance, notas"></textarea>
        </div>

        <div class="actions">
          <button class="btn-secondary" @click="closeForm">Cancelar</button>
          <button class="btn-primary" :disabled="saving" @click="savePresupuesto">
            {{ saving ? "Guardando..." : editingId ? "Actualizar presupuesto" : "Guardar presupuesto" }}
          </button>
        </div>
      </div>

      <div class="table-card">
        <div v-if="!loading && presupuestos.length === 0" class="empty">No hay presupuestos cargados.</div>

        <div class="presupuesto-grid" v-else>
          <article v-for="p in presupuestos" :key="p.id" class="presupuesto-card">
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
                <button class="btn-chip btn-chip-cert" @click="abrirCertificados(p)">
                  {{ Number(p.cantidad_certificados || 0) > 0 ? "Ver avances" : "Generar certificado" }}
                </button>
                <button class="btn-chip btn-chip-edit" @click="editPresupuesto(p.id)">Editar</button>
                <button class="btn-chip btn-chip-download" @click="descargarPdf(p.id, p.numero)">Descargar</button>
                <button class="btn-chip btn-chip-whatsapp" @click="enviarWhatsapp(p)">WhatsApp</button>
                <button class="btn-chip btn-chip-delete" @click="eliminarPresupuesto(p)">Eliminar</button>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </div>
  </LayoutShell>
</template>

<style scoped>
.presupuestos-page {
  --paper: #f3f1ec;
  --card: #ffffff;
  --ink: #1f2937;
  --muted: #6b7280;
  --line: #d7d3cc;
  --accent: #a16207;
  --accent-soft: #fef3c7;

  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--ink);
  padding: 14px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 94% -5%, rgba(161, 98, 7, 0.09), transparent 30%),
    radial-gradient(circle at 2% 108%, rgba(55, 65, 81, 0.09), transparent 42%),
    var(--paper);
  border: 1px solid #cbc6be;
}

.hero-card {
  display: flex;
  gap: 18px;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  background: linear-gradient(140deg, #ffffff 0%, #faf9f6 100%);
  color: var(--ink);
  border-radius: 14px;
  padding: 20px 20px 22px;
  border: 1px solid var(--line);
  box-shadow:
    0 14px 26px -24px rgba(17, 24, 39, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.hero-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hero-kicker {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.hero-card h2 {
  margin: 0;
  font-size: 2.1rem;
  line-height: 1.02;
  text-wrap: balance;
}

.hero-card p {
  margin: 0;
  color: var(--muted);
  font-size: 1.02rem;
  max-width: 680px;
}

.hero-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.next-number,
.next-number-inline {
  font-weight: 700;
  letter-spacing: 0.2px;
  background: #f6f5f2;
  color: #111827;
  border: 1px solid #d8d3c9;
  border-radius: 999px;
  padding: 9px 15px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.next-number-inline {
  color: #3f3f46;
  background: #f3f2ef;
  border-color: #dfd9cf;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.stat-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px 12px;
  display: grid;
  gap: 5px;
}

.stat-card span {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #78716c;
  font-weight: 700;
}

.stat-card strong {
  font-size: 1.05rem;
  color: var(--ink);
}

.meta-line-certificados strong {
  font-size: 0.92rem;
}

.cert-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-weight: 700;
}

.cert-badge-empty {
  background: #efe9df;
  color: #92400e;
}

.cert-badge-pending {
  background: #fef3c7;
  color: #b45309;
}

.cert-badge-ok {
  background: #dcfce7;
  color: #166534;
}

.form-card,
.table-card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 10px 24px -24px rgba(17, 24, 39, 0.6);
}

.form-card h3,
.items-section h4 {
  color: var(--ink);
  margin: 0;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.grid-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #78716c;
  margin-bottom: 5px;
  font-weight: 700;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #d6d3d1;
  border-radius: 10px;
  padding: 9px 10px;
  background: #fff;
  color: var(--ink);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: #a8a29e;
  box-shadow: 0 0 0 3px rgba(168, 162, 158, 0.14);
}

.iva-box {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.iva-box label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.iva-box input[type="checkbox"] {
  width: auto;
}

.items-section {
  margin-top: 8px;
  background: #f9f8f5;
  border: 1px solid #e4e0d8;
  border-radius: 12px;
  padding: 10px;
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 12px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.subtotal-general-box {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #d6d3d1;
}

.section-mano-obra h4 {
  color: #0f172a;
}

.section-materiales h4 {
  color: #7c2d12;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
}

th,
td {
  border-bottom: 1px solid #ece8e1;
  padding: 9px 8px;
  text-align: left;
  vertical-align: middle;
}

.table-card {
  overflow-x: auto;
}

.table-card select {
  min-width: 146px;
  background: #fff;
  color: var(--ink);
  border: 1px solid #d6d3d1;
}

.nro-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 46px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid #d6d0c2;
  background: #f7f5ef;
  font-weight: 700;
  font-size: 0.84rem;
}

.fecha-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid #e3dfd7;
  background: #fcfbf9;
  color: #57534e;
  font-size: 0.78rem;
  font-weight: 600;
}

.presupuesto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 10px;
}

.presupuesto-card {
  border: 1px solid #dfd9cc;
  border-radius: 12px;
  background: linear-gradient(165deg, #ffffff 0%, #fbfaf7 100%);
  padding: 10px;
  display: grid;
  gap: 8px;
  box-shadow: 0 10px 20px -22px rgba(15, 23, 42, 0.45);
}

.presupuesto-card-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.presupuesto-card-id {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.presupuesto-card-main {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: stretch;
}

.presupuesto-meta {
  display: grid;
  gap: 5px;
}

.meta-line {
  display: grid;
  gap: 1px;
}

.meta-label {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #78716c;
  font-weight: 700;
}

.meta-line strong {
  font-size: 0.87rem;
  color: #1f2937;
}

.presupuesto-total-block {
  min-width: 150px;
  border-radius: 10px;
  border: 1px solid #e2ddd0;
  background: #f9f7f2;
  padding: 8px 10px;
  display: grid;
  align-content: center;
  gap: 2px;
}

.presupuesto-total-block span {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #78716c;
  font-weight: 700;
}

.presupuesto-total-block strong {
  font-size: 1.04rem;
  color: #111827;
}

.presupuesto-card-footer {
  padding-top: 6px;
  border-top: 1px solid #ece8df;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.resumen-card {
  margin-top: 14px;
  background: linear-gradient(140deg, #ffffff 0%, #f8f7f4 100%);
  border: 1px solid #ddd6c8;
  border-radius: 10px;
  padding: 14px;
  display: grid;
  gap: 7px;
}

.total {
  font-size: 1.15rem;
  font-weight: 700;
}

.actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-primary,
.btn-secondary {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 600;
  transition: transform 0.16s ease, box-shadow 0.2s ease;
}

.btn-primary {
  background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  color: #fff;
  border-color: #1f2937;
  box-shadow: 0 8px 18px -12px rgba(17, 24, 39, 0.45);
}

.hero-new-btn {
  padding: 11px 16px;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0;
  border: 1px solid #1f2937;
  background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
  box-shadow: 0 8px 16px -12px rgba(17, 24, 39, 0.48);
}

.hero-new-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 18px -12px rgba(17, 24, 39, 0.58);
}

.btn-secondary {
  background: #f8f7f4;
  color: #374151;
  border-color: #d6d3d1;
}

.btn-primary:hover,
.btn-secondary:hover {
  transform: translateY(-1px);
}

.btn-chip {
  border: 1px solid #d8d3ca;
  background: #fff;
  color: #1f2937;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
}

.btn-chip:hover {
  background: #f7f6f3;
}

.btn-chip.whatsapp {
  background: #ecfdf3;
  border-color: #bbf7d0;
  color: #166534;
}

.btn-chip-edit {
  background: #eef2ff;
  border-color: #c7d2fe;
  color: #3730a3;
}

.btn-chip-download {
  background: #fff7ed;
  border-color: #fed7aa;
  color: #9a3412;
}

.btn-chip-whatsapp {
  background: #ecfdf3;
  border-color: #86efac;
  color: #166534;
}

.btn-chip-delete {
  background: #fef2f2;
  border-color: #fecaca;
  color: #991b1b;
}

.acciones-presupuesto {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-link {
  border: none;
  background: transparent;
  color: #4b5563;
  cursor: pointer;
  padding: 0;
  font-size: 0.82rem;
  font-weight: 700;
}

.btn-link.danger {
  color: #b91c1c;
}

.estado-cell {
  display: grid;
  gap: 6px;
}

.estado-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  width: fit-content;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid #d6d3d1;
}

.estado-pendiente {
  background: #fef3c7;
  color: #92400e;
  border-color: #fcd34d;
}

.estado-enviado {
  background: #e0f2fe;
  color: #075985;
  border-color: #7dd3fc;
}

.estado-aceptado {
  background: #dcfce7;
  color: #166534;
  border-color: #86efac;
}

.estado-rechazado {
  background: #fee2e2;
  color: #991b1b;
  border-color: #fca5a5;
}

.estado-select {
  max-width: 150px;
}

.ok-msg {
  color: #166534;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  padding: 9px 10px;
  font-weight: 600;
}

.error-msg {
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: 10px;
  padding: 9px 10px;
  font-weight: 600;
}

.loading,
.empty {
  color: #57534e;
}

.empty {
  text-align: center;
  font-weight: 600;
  padding: 18px;
}

@media (max-width: 700px) {
  .presupuestos-page {
    padding: 10px;
  }

  .hero-card {
    flex-direction: column;
    align-items: flex-start;
    padding: 16px;
  }

  .hero-card h2 {
    font-size: 1.65rem;
  }

  .hero-card p {
    font-size: 0.92rem;
  }

  .hero-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .items-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .presupuesto-card-main {
    grid-template-columns: 1fr;
  }

  .presupuesto-total-block {
    min-width: 0;
  }

  .presupuesto-grid {
    grid-template-columns: 1fr;
  }
}
</style>

