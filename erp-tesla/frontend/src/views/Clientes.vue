<script setup>
import { computed, ref, onMounted, onUnmounted } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

// Estado para movimientos de caja del cliente
const movimientosCajaCliente = ref([])
const loadingMovimientosCaja = ref(false)

// Estado
const clientes = ref([])
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
// Modal now only closes via the close button. Clicks outside no longer close it.
const editingId = ref(null)
const vistaActual = ref("lista") // "lista" o "ficha"
const clienteSeleccionado = ref(null)
const obrasCliente = ref([])
const presupuestosCliente = ref([])
const presupuestosAceptados = ref([])
const downloadingPdf = ref(false)
const filtroBusqueda = ref("")
const filtroIva = ref("")

// Formulario
const form = ref({
  empresa: "",
  razon_social: "",
  cuit: "",
  direccion: "",
  telefono: "",
  email: "",
  iva: "Responsable Inscripto",
  saldo_inicial_arrastre: 0,
  fecha_saldo_inicial_arrastre: new Date().toISOString().slice(0, 10),
  nota_saldo_inicial_arrastre: "",
})

const clientesFiltrados = computed(() => {
  const termino = String(filtroBusqueda.value || "").trim().toLowerCase()
  if (!termino) return clientes.value

  return clientes.value.filter((cliente) => {
    const campos = [
      cliente.empresa,
      cliente.razon_social,
      cliente.cuit,
      cliente.telefono,
      cliente.email,
      cliente.iva,
    ]

    return campos.some((campo) => String(campo || "").toLowerCase().includes(termino))
  })
})

const getclientesFiltradosPorIva = computed(() => {
  if (!filtroIva.value) return clientes.value
  return clientes.value.filter(c => String(c.iva || "").toLowerCase() === String(filtroIva.value).toLowerCase())
})

const clientesDisponibles = computed(() => {
  let resultado = clientes.value

  if (filtroBusqueda.value) {
    const termino = String(filtroBusqueda.value || "").trim().toLowerCase()
    resultado = resultado.filter((cliente) => {
      const campos = [
        cliente.empresa,
        cliente.razon_social,
        cliente.cuit,
        cliente.telefono,
        cliente.email,
        cliente.iva,
      ]

      return campos.some((campo) => String(campo || "").toLowerCase().includes(termino))
    })
  }

  if (filtroIva.value) {
    resultado = resultado.filter(c => String(c.iva || "").toLowerCase() === String(filtroIva.value).toLowerCase())
  }

  return resultado
})

const clientesConEmpresa = computed(() => clientes.value.filter((cliente) => String(cliente.empresa || "").trim()).length)
const clientesConCuit = computed(() => clientes.value.filter((cliente) => String(cliente.cuit || "").trim()).length)

const formatMoney = (value) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0)

const roundMoney = (value) => Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100

const formatDateAr = (value) => {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("es-AR")
}

const toDateInputValue = (value) => {
  if (!value) return new Date().toISOString().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
}

const esEstadoAceptado = (estado) => ["aceptado", "aprobado"].includes(String(estado || "").toLowerCase())

const calcularEstadoCobro = (deudaComputable, total, pagado) => {
  if (!deudaComputable) return "sin_deuda"
  if (pagado <= 0) return "pendiente"
  if (pagado < total) return "parcial"
  if (pagado === total) return "pagado"
  return "a_favor"
}

const labelEstadoCobro = (estado) => {
  const key = String(estado || "").toLowerCase()
  if (key === "pendiente") return "Pendiente"
  if (key === "parcial") return "Parcial"
  if (key === "pagado") return "Pagado"
  if (key === "a_favor") return "A favor"
  return "Sin deuda"
}

const claseEstadoCobro = (estado) => `estado-cobro estado-cobro-${String(estado || "sin_deuda").toLowerCase()}`

const pagosImputados = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => m.tipo === "ingreso" && Number(m.presupuesto_id) > 0)
)

const pagosNoImputados = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => m.tipo === "ingreso" && !Number(m.presupuesto_id))
)

const egresosCliente = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => m.tipo === "egreso")
)

const pagosImputadosPorPresupuesto = computed(() => {
  const map = new Map()
  for (const mov of pagosImputados.value) {
    const presupuestoId = Number(mov.presupuesto_id)
    const acumulado = Number(map.get(presupuestoId) || 0)
    map.set(presupuestoId, acumulado + (Number(mov.monto_total) || 0))
  }
  return map
})

const estadoCuentaPresupuestos = computed(() => {
  return (presupuestosAceptados.value || []).map((p) => {
    const totalConIva = Number(p.total) || 0
    const totalIva = Number(p.total_iva ?? p.iva_monto ?? 0) || 0
    const totalSinIva = Number(p.total_sin_iva ?? (totalConIva - totalIva)) || 0
    const deudaComputable = Boolean(p.deuda_computable ?? esEstadoAceptado(p.estado))
    const pagadoCaja = Number(p.total_pagado_caja)
    const pagadoFallback = Number(pagosImputadosPorPresupuesto.value.get(Number(p.id)) || 0)
    const pagado = Number.isFinite(pagadoCaja) ? pagadoCaja : pagadoFallback
    const saldoPendiente = deudaComputable ? Math.max(0, totalConIva - pagado) : 0
    const saldoAFavor = deudaComputable ? Math.max(0, pagado - totalConIva) : 0
    const estadoCobro = String(p.estado_cobro || "") || calcularEstadoCobro(deudaComputable, totalConIva, pagado)

    return {
      ...p,
      total_sin_iva: totalSinIva,
      total_iva: totalIva,
      total: totalConIva,
      pagado,
      saldo_pendiente: saldoPendiente,
      saldo_a_favor: saldoAFavor,
      estado_cobro: estadoCobro,
      deuda_computable: deudaComputable,
    }
  })
})

const totalDebeCliente = computed(() =>
  estadoCuentaPresupuestos.value.reduce((acc, p) => acc + (Number(p.saldo_pendiente) || 0), 0)
)

const totalPagadoPresupuestos = computed(() =>
  estadoCuentaPresupuestos.value.reduce((acc, p) => acc + (Number(p.pagado) || 0), 0)
)

const totalPagosNoImputados = computed(() =>
  pagosNoImputados.value.reduce((acc, mov) => acc + (Number(mov.monto_total) || 0), 0)
)

const totalAFavorCliente = computed(() =>
  estadoCuentaPresupuestos.value.reduce((acc, p) => acc + (Number(p.saldo_a_favor) || 0), 0)
)

const saldoInicialArrastreCliente = computed(() => roundMoney(clienteSeleccionado.value?.saldo_inicial_arrastre))

const totalCargosPresupuestosCliente = computed(() =>
  roundMoney(estadoCuentaPresupuestos.value.reduce((acc, p) => acc + (Number(p.total) || 0), 0))
)

const totalPagosCajaCliente = computed(() =>
  roundMoney((movimientosCajaCliente.value || []).reduce((acc, mov) => {
    const monto = Number(mov.monto_total) || 0
    return acc + (mov.tipo === "egreso" ? -monto : monto)
  }, 0))
)

const saldoPendienteFinalCliente = computed(() =>
  roundMoney(saldoInicialArrastreCliente.value + totalCargosPresupuestosCliente.value - totalPagosCajaCliente.value)
)

const movimientosCuentaCorriente = computed(() => {
  const rows = []
  const fechaArrastre = toDateInputValue(clienteSeleccionado.value?.fecha_saldo_inicial_arrastre)
  const notaArrastre = String(clienteSeleccionado.value?.nota_saldo_inicial_arrastre || "").trim()

  rows.push({
    tipo: "saldo_inicial",
    fechaRaw: fechaArrastre,
    fecha: formatDateAr(fechaArrastre),
    referencia: notaArrastre || "Arrastre sistema anterior",
    debe: roundMoney(Math.max(0, saldoInicialArrastreCliente.value)),
    haber: roundMoney(Math.max(0, -saldoInicialArrastreCliente.value)),
    impacto: roundMoney(saldoInicialArrastreCliente.value),
  })

  for (const p of estadoCuentaPresupuestos.value) {
    const total = roundMoney(p.total)
    rows.push({
      tipo: "presupuesto",
      fechaRaw: p.fecha,
      fecha: formatDateAr(p.fecha),
      referencia: `Presupuesto #${p.numero || "-"} - ${p.obra || "Sin obra"}`,
      debe: total,
      haber: 0,
      impacto: total,
    })
  }

  for (const mov of movimientosCajaCliente.value || []) {
    const presupuestoNumero = Number(mov.presupuesto_id) > 0
      ? (presupuestosPorId.value.get(Number(mov.presupuesto_id))?.numero || mov.presupuesto_id)
      : null
    const monto = roundMoney(mov.monto_total)
    if (mov.tipo === "egreso") {
      const detalle = String(mov.detalle || "Egreso en caja")
      const destinatario = String(mov.destinatario || "Devolucion al cliente").trim()

      rows.push({
        tipo: "egreso",
        fechaRaw: mov.fecha,
        fecha: formatDateAr(mov.fecha),
        referencia: `${detalle} - ${destinatario}`,
        debe: monto,
        haber: 0,
        impacto: monto,
      })
      continue
    }

    const detalle = String(mov.detalle || "Cobro en caja")
    const referencia = presupuestoNumero
      ? `${detalle} - Presupuesto #${presupuestoNumero}`
      : `${detalle} - Pago sin imputar`

    rows.push({
      tipo: "pago",
      fechaRaw: mov.fecha,
      fecha: formatDateAr(mov.fecha),
      referencia,
      debe: 0,
      haber: monto,
      impacto: -monto,
    })
  }

  rows.sort((a, b) => {
    const aKey = String(toDateInputValue(a.fechaRaw || "1900-01-01"))
    const bKey = String(toDateInputValue(b.fechaRaw || "1900-01-01"))
    if (aKey !== bKey) return aKey.localeCompare(bKey)
    const order = { saldo_inicial: 0, presupuesto: 1, pago: 2, egreso: 3 }
    return (order[a.tipo] ?? 99) - (order[b.tipo] ?? 99)
  })

  let saldo = 0
  return rows.map((row) => {
    saldo = roundMoney(saldo + row.impacto)
    return {
      ...row,
      saldo,
    }
  })
})

const presupuestosPorId = computed(() => {
  const map = new Map()
  for (const p of [...(presupuestosAceptados.value || []), ...(presupuestosCliente.value || [])]) {
    map.set(Number(p.id), p)
  }
  return map
})

// Cargar clientes
const loadClientes = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getClientes()
    clientes.value = (res.data || []).filter(c => String(c.razon_social || "").toUpperCase() !== "ADMINISTRACION INTERNA")
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al cargar clientes")
    console.error(err)
  } finally {
    loading.value = false
  }
}

const cargarPresupuestosCliente = async (clienteId) => {
  const resPresupuestos = await api.getPresupuestos()
  const presupuestos = (resPresupuestos.data || []).filter(p => Number(p.cliente_id) === Number(clienteId))
  const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase())
  presupuestosAceptados.value = presupuestos.filter(isAceptado)
  presupuestosCliente.value = presupuestos.filter(p => !isAceptado(p))
}

// Ver ficha del cliente
const verFicha = async (cliente) => {
  clienteSeleccionado.value = cliente
  vistaActual.value = "ficha"

  // Cargar obras y movimientos de caja del cliente
  loading.value = true
  loadingMovimientosCaja.value = true
  try {
    const [resObras, resMovimientos] = await Promise.all([
      api.getObras(),
      api.getMovimientosCaja(null, null, null, null, null)
    ])
    obrasCliente.value = resObras.data?.filter(o => o.cliente_id === cliente.id) || []

    await cargarPresupuestosCliente(cliente.id)

    // Filtrar movimientos de caja por cliente_id
    movimientosCajaCliente.value = (resMovimientos.data.movimientos || []).filter(m => Number(m.cliente_id) === Number(cliente.id))
  } catch (err) {
    console.error("Error al cargar datos del cliente:", err)
    movimientosCajaCliente.value = []
  } finally {
    loading.value = false
    loadingMovimientosCaja.value = false
  }
}

// Volver a la lista
const volverALista = () => {
  vistaActual.value = "lista"
  clienteSeleccionado.value = null
  obrasCliente.value = []
  presupuestosCliente.value = []
  presupuestosAceptados.value = []
}

const handlePresupuestosChanged = () => {
  if (vistaActual.value === "ficha" && clienteSeleccionado.value?.id) {
    cargarPresupuestosCliente(clienteSeleccionado.value.id).catch((err) => {
      console.error("Error al actualizar presupuestos del cliente:", err)
    })
  }
}

// Abrir formulario
const openForm = (cliente = null) => {
  if (cliente) {
    editingId.value = cliente.id
    form.value = {
      ...cliente,
      saldo_inicial_arrastre: roundMoney(cliente.saldo_inicial_arrastre),
      fecha_saldo_inicial_arrastre: toDateInputValue(cliente.fecha_saldo_inicial_arrastre),
      nota_saldo_inicial_arrastre: String(cliente.nota_saldo_inicial_arrastre || ""),
    }
  } else {
    editingId.value = null
    form.value = {
      empresa: "",
      razon_social: "",
      cuit: "",
      direccion: "",
      telefono: "",
      email: "",
      iva: "Responsable Inscripto",
      saldo_inicial_arrastre: 0,
      fecha_saldo_inicial_arrastre: new Date().toISOString().slice(0, 10),
      nota_saldo_inicial_arrastre: "",
    }
  }
  showForm.value = true
}

// Cerrar formulario
const closeForm = () => {
  showForm.value = false
  editingId.value = null
  form.value = {
    empresa: "",
    razon_social: "",
    cuit: "",
    direccion: "",
    telefono: "",
    email: "",
    iva: "Responsable Inscripto",
    saldo_inicial_arrastre: 0,
    fecha_saldo_inicial_arrastre: new Date().toISOString().slice(0, 10),
    nota_saldo_inicial_arrastre: "",
  }
}

// Guardar cliente
const saveCliente = async () => {
  error.value = ""
  if (!form.value.razon_social) {
    error.value = "La razón social es obligatoria"
    return
  }
  loading.value = true
  try {
    const payload = {
      ...form.value,
      saldo_inicial_arrastre: roundMoney(form.value.saldo_inicial_arrastre),
      fecha_saldo_inicial_arrastre: toDateInputValue(form.value.fecha_saldo_inicial_arrastre),
      nota_saldo_inicial_arrastre: String(form.value.nota_saldo_inicial_arrastre || "").trim(),
    }

    if (editingId.value) {
      await api.updateCliente(editingId.value, payload)
    } else {
      await api.createCliente(payload)
    }
    await loadClientes()
    if (clienteSeleccionado.value?.id && Number(clienteSeleccionado.value.id) === Number(editingId.value)) {
      const actualizado = clientes.value.find((c) => Number(c.id) === Number(editingId.value))
      if (actualizado) {
        clienteSeleccionado.value = actualizado
      }
    }
    closeForm()
  } catch (err) {
    error.value = editingId.value
      ? extractApiErrorMessage(err, "Error al actualizar cliente")
      : extractApiErrorMessage(err, "Error al crear cliente")
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Eliminar cliente
const deleteCliente = async (id) => {
  if (!confirm("¿Está seguro que desea eliminar este cliente?")) return

  loading.value = true
  try {
    await api.deleteCliente(id)
    await loadClientes()
    
    // Si estamos viendo la ficha del cliente eliminado, volver a la lista
    if (clienteSeleccionado.value && clienteSeleccionado.value.id === id) {
      volverALista()
    }
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al eliminar cliente")
    console.error(err)
  } finally {
    loading.value = false
  }
}

const descargarFichaPdf = async () => {
  if (!clienteSeleccionado.value) return

  downloadingPdf.value = true
  error.value = ""

  try {
    const res = await api.getClienteFichaPdf(clienteSeleccionado.value.id)
    const blob = new Blob([res.data], { type: "application/pdf" })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement("a")

    const fecha = new Date().toLocaleDateString("es-AR").replace(/\//g, "-")
    const nombreCliente = (clienteSeleccionado.value.razon_social || "Cliente")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()

    link.href = url
    link.download = `Ficha ${nombreCliente} actualizada ${fecha}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al generar la ficha PDF")
    console.error(err)
  } finally {
    downloadingPdf.value = false
  }
}

onMounted(() => {
  loadClientes()
  socket.on('clientes:changed', loadClientes)
  socket.on('presupuestos:changed', handlePresupuestosChanged)
})
onUnmounted(() => {
  socket.off('clientes:changed', loadClientes)
  socket.off('presupuestos:changed', handlePresupuestosChanged)
})
</script>

<template>
  <LayoutShell
    title="Clientes"
    subtitle="Administración de clientes y sus obras"
  >
    <div class="clientes-container">
      <!-- VISTA: LISTA DE CLIENTES -->
      <div v-if="vistaActual === 'lista'" class="clientes-list-view">
        <section class="clientes-topbar">
          <div class="clientes-topbar-copy">
            <span class="section-kicker">Base comercial</span>
            <h2>Gestión de clientes</h2>
          </div>
          <button class="btn-primary clientes-new-btn" @click="openForm()">
            + Nuevo cliente
          </button>
        </section>

        <section class="clientes-stats">
          <article class="clientes-stat-card">
            <span>Total de clientes</span>
            <strong>{{ clientes.length }}</strong>
            <small>Registros activos disponibles en el sistema.</small>
          </article>
          <article class="clientes-stat-card">
            <span>Con empresa</span>
            <strong>{{ clientesConEmpresa }}</strong>
            <small>Clientes con nombre comercial informado.</small>
          </article>
          <article class="clientes-stat-card">
            <span>Con CUIT</span>
            <strong>{{ clientesConCuit }}</strong>
            <small>Registros listos para documentación fiscal.</small>
          </article>
        </section>

        <section class="clientes-toolbar">
          <label class="clientes-search-field">
            <span>Buscar en tiempo real</span>
            <input
              v-model="filtroBusqueda"
              type="text"
              placeholder="Empresa, razón social, CUIT, teléfono, email o IVA"
            />
          </label>

          <label class="filtro-iva-field">
            <span>Filtrar por IVA</span>
            <select v-model="filtroIva">
              <option value="">Todos</option>
              <option value="Responsable Inscripto">Responsable Inscripto</option>
              <option value="Monotributista">Monotributista</option>
              <option value="Exento">Exento</option>
              <option value="Consumidor Final">Consumidor Final</option>
              <option value="No corresponde">No corresponde</option>
            </select>
          </label>

          <div class="clientes-toolbar-count">
            Mostrando {{ clientesDisponibles.length }} de {{ clientes.length }} clientes
          </div>
        </section>

        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <div v-if="!loading && clientesDisponibles.length > 0" class="clientes-table-shell">
          <div class="clientes-table-header-row">
            <div>
              <span class="section-kicker">Listado</span>
              <h3>Clientes registrados</h3>
            </div>
          </div>

          <div class="clientes-table">
            <table>
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Razón Social</th>
                  <th>CUIT</th>
                  <th>Teléfono</th>
                  <th>IVA</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cliente in clientesDisponibles" :key="cliente.id">
                  <td>
                    <div class="cliente-main-cell">
                      <strong>{{ cliente.empresa || cliente.razon_social || "-" }}</strong>
                      <small v-if="cliente.email">{{ cliente.email }}</small>
                    </div>
                  </td>
                  <td>{{ cliente.razon_social || "-" }}</td>
                  <td>{{ cliente.cuit || "-" }}</td>
                  <td>{{ cliente.telefono || "-" }}</td>
                  <td>
                    <span class="iva-badge">{{ cliente.iva || "-" }}</span>
                  </td>
                  <td>
                    <div class="acciones">
                      <button class="btn-ficha" @click="verFicha(cliente)">
                        Ver ficha
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="!loading && clientes.length === 0" class="empty-state">
          <p>No hay clientes registrados</p>
          <button class="btn-primary" @click="openForm()">
            Crear primer cliente
          </button>
        </div>

        <div v-if="!loading && clientes.length > 0 && clientesDisponibles.length === 0" class="empty-state empty-state-search">
          <p>No hay coincidencias para la búsqueda actual</p>
          <button class="btn-secondary" @click="filtroBusqueda = ''">
            Limpiar búsqueda
          </button>
        </div>

        <div v-if="loading" class="loading">
          Cargando...
        </div>
      </div>

      <!-- VISTA: FICHA DEL CLIENTE -->
      <div v-if="vistaActual === 'ficha' && clienteSeleccionado" class="ficha-container">
        <!-- Encabezado con botón volver -->
        <div class="ficha-header">
          <button class="btn-volver" @click="volverALista">
            ← Volver a la lista
          </button>
          <div class="ficha-acciones">
            <button class="btn-pdf" :disabled="downloadingPdf" @click="descargarFichaPdf">
              {{ downloadingPdf ? "Generando PDF..." : "🖨️ Descargar PDF" }}
            </button>
            <button class="btn-edit" @click="openForm(clienteSeleccionado)">
              ✏️ Editar
            </button>
            <button class="btn-delete" @click="deleteCliente(clienteSeleccionado.id)">
              🗑️ Eliminar
            </button>
          </div>
        </div>

        <!-- Datos generales -->
        <div class="ficha-seccion datos-principales">
          <h2>{{ clienteSeleccionado.empresa || '-' }}</h2>
          <h3 style="margin-top: 0; color: #444; font-weight: 500;">Razón social: {{ clienteSeleccionado.razon_social || '-' }}</h3>
          <div class="datos-grid">
            <div class="dato-item">
              <span class="dato-label">CUIT:</span>
              <span class="dato-valor">{{ clienteSeleccionado.cuit || "-" }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Teléfono:</span>
              <span class="dato-valor">{{ clienteSeleccionado.telefono || "-" }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Email:</span>
              <span class="dato-valor">{{ clienteSeleccionado.email || "-" }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">Dirección:</span>
              <span class="dato-valor">{{ clienteSeleccionado.direccion || "-" }}</span>
            </div>
            <div class="dato-item">
              <span class="dato-label">IVA:</span>
              <span class="dato-valor">{{ clienteSeleccionado.iva || "-" }}</span>
            </div>
          </div>
        </div>

        <!-- Obras asociadas -->
        <div class="ficha-seccion">
          <h3>🏗️ Obras asociadas</h3>
          <div v-if="obrasCliente.length > 0" class="obras-lista">
            <div v-for="obra in obrasCliente" :key="obra.id" class="obra-card">
              <div class="obra-info">
                <h4>{{ obra.nombre }}</h4>
                <p class="obra-estado" :class="`estado-${obra.estado}`">
                  {{ obra.estado }}
                </p>
              </div>
              <div class="obra-detalles">
                <span v-if="obra.fecha_inicio">
                  Inicio: {{ new Date(obra.fecha_inicio).toLocaleDateString('es-AR') }}
                </span>
                <span v-if="obra.fecha_fin">
                  Fin: {{ new Date(obra.fecha_fin).toLocaleDateString('es-AR') }}
                </span>
              </div>
            </div>
          </div>
          <p v-else class="sin-datos">No hay obras asociadas a este cliente</p>
        </div>

        <!-- Presupuestos generados -->
        <div class="ficha-seccion">
          <h3>📄 Presupuestos generados</h3>
          <div v-if="presupuestosCliente.length > 0" class="presupuestos-lista">
            <div v-for="p in presupuestosCliente" :key="p.id" class="presupuesto-card">
              <div class="presupuesto-head">
                <h4>#{{ p.numero }} - {{ p.obra || 'Sin obra' }}</h4>
                <span class="presupuesto-estado" :class="`estado-${String(p.estado || '').toLowerCase()}`">{{ p.estado }}</span>
              </div>
              <div class="presupuesto-detalles">
                <span>{{ new Date(p.fecha).toLocaleDateString('es-AR') }}</span>
                <span>$ {{ Number(p.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 }) }}</span>
              </div>
            </div>
          </div>
          <p v-else class="sin-datos">No hay presupuestos asociados a este cliente</p>
        </div>

        <!-- Presupuestos aceptados -->
        <div class="ficha-seccion">
          <h3>✅ Estado de cuenta por presupuesto aceptado</h3>
          <div class="estado-cuenta-resumen">
            <article class="estado-cuenta-card">
              <span>Saldo inicial (arrastre)</span>
              <strong>{{ formatMoney(saldoInicialArrastreCliente) }}</strong>
            </article>
            <article class="estado-cuenta-card">
              <span>Cargos por presupuestos</span>
              <strong>{{ formatMoney(totalCargosPresupuestosCliente) }}</strong>
            </article>
            <article class="estado-cuenta-card">
              <span>Pagos por caja</span>
              <strong>{{ formatMoney(totalPagosCajaCliente) }}</strong>
            </article>
            <article class="estado-cuenta-card">
              <span>Saldo pendiente final</span>
              <strong>{{ formatMoney(saldoPendienteFinalCliente) }}</strong>
            </article>
          </div>

          <div class="sin-datos" style="margin-bottom: 0.8rem;">
            Arrastre desde: {{ formatDateAr(clienteSeleccionado.fecha_saldo_inicial_arrastre) }}
            <span v-if="clienteSeleccionado.nota_saldo_inicial_arrastre"> | Nota: {{ clienteSeleccionado.nota_saldo_inicial_arrastre }}</span>
          </div>

          <div v-if="estadoCuentaPresupuestos.length > 0" class="tabla-shell">
            <table class="tabla">
              <thead>
                <tr>
                  <th>Presupuesto</th>
                  <th>Fecha</th>
                  <th>Obra</th>
                  <th>Sin IVA</th>
                  <th>IVA</th>
                  <th>Total</th>
                  <th>Pagado</th>
                  <th>Saldo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in estadoCuentaPresupuestos" :key="p.id">
                  <td>#{{ p.numero }}</td>
                  <td>{{ new Date(p.fecha).toLocaleDateString('es-AR') }}</td>
                  <td>{{ p.obra || 'Sin obra' }}</td>
                  <td>{{ formatMoney(p.total_sin_iva) }}</td>
                  <td>{{ formatMoney(p.total_iva) }}</td>
                  <td>{{ formatMoney(p.total) }}</td>
                  <td>{{ formatMoney(p.pagado) }}</td>
                  <td>
                    <div>{{ formatMoney(p.saldo_pendiente) }}</div>
                    <small v-if="Number(p.saldo_a_favor || 0) > 0">A favor: {{ formatMoney(p.saldo_a_favor) }}</small>
                  </td>
                  <td><span :class="claseEstadoCobro(p.estado_cobro)">{{ labelEstadoCobro(p.estado_cobro) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sin-datos">No hay presupuestos aceptados para este cliente</p>
        </div>

        <div class="ficha-seccion">
          <h3>📚 Cuenta corriente cronológica</h3>
          <div class="tabla-shell">
            <table class="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Referencia</th>
                  <th>Debe</th>
                  <th>Haber</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(mov, idx) in movimientosCuentaCorriente" :key="`${mov.tipo}-${idx}`">
                  <td>{{ mov.fecha }}</td>
                  <td>
                    <span class="estado-cobro" :class="mov.tipo === 'pago'
                      ? 'estado-cobro-pagado'
                      : (mov.tipo === 'egreso' ? 'estado-cobro-egreso' : (mov.tipo === 'presupuesto' ? 'estado-cobro-pendiente' : 'estado-cobro-sin_deuda'))">
                      {{ mov.tipo === 'saldo_inicial'
                        ? 'Saldo inicial'
                        : (mov.tipo === 'presupuesto' ? 'Presupuesto' : (mov.tipo === 'egreso' ? 'Egreso' : 'Pago')) }}
                    </span>
                  </td>
                  <td>{{ mov.referencia }}</td>
                  <td>{{ mov.debe > 0 ? formatMoney(mov.debe) : '-' }}</td>
                  <td>{{ mov.haber > 0 ? formatMoney(mov.haber) : '-' }}</td>
                  <td><strong>{{ formatMoney(mov.saldo) }}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Certificados asociados -->
        <div class="ficha-seccion">
          <h3>📋 Certificados asociados</h3>
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Certificados</p>
        </div>

        <!-- Facturas registradas -->
        <div class="ficha-seccion">
          <h3>🧾 Facturas registradas</h3>
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Facturas</p>
        </div>


        <!-- Historial de movimientos -->
        <div class="ficha-seccion">
          <h3>💰 Historial de movimientos</h3>
          <div v-if="loadingMovimientosCaja">
            <span class="spinner">Cargando movimientos...</span>
          </div>
          <div v-else-if="movimientosCajaCliente.length === 0">
            <p class="sin-datos">No hay movimientos de caja asociados a este cliente.</p>
          </div>
          <div v-else class="tabla-shell">
            <table class="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Presupuesto</th>
                  <th>Imputación</th>
                  <th>Monto</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="mov in movimientosCajaCliente" :key="mov.id">
                  <td>{{ new Date(mov.fecha).toLocaleDateString('es-AR') }}</td>
                  <td>{{ mov.tipo === 'egreso' ? `${mov.detalle} (egreso)` : mov.detalle }}</td>
                  <td>
                    <span v-if="mov.tipo === 'ingreso' && Number(mov.presupuesto_id) > 0">
                      #{{ presupuestosPorId.get(Number(mov.presupuesto_id))?.numero || mov.presupuesto_id }}
                    </span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <span :class="mov.tipo === 'egreso'
                      ? 'estado-cobro estado-cobro-pendiente'
                      : (Number(mov.presupuesto_id) > 0 ? 'estado-cobro estado-cobro-parcial' : 'estado-cobro estado-cobro-sin_deuda')">
                      {{ mov.tipo === 'egreso' ? 'Devolucion' : (Number(mov.presupuesto_id) > 0 ? 'Imputado' : 'No imputado') }}
                    </span>
                  </td>
                  <td>{{ mov.tipo === 'egreso' ? `-${formatMoney(mov.monto_total)}` : formatMoney(mov.monto_total) }}</td>
                  <td>{{ mov.observaciones || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading-overlay">
          Cargando datos...
        </div>
      </div>

      <!-- Modal formulario -->
      <div v-if="showForm" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Ficha comercial</span>
              <h3>{{ editingId ? "Editar cliente" : "Nuevo cliente" }}</h3>
              <p>Completá los datos principales para dejar la ficha lista y bien presentada.</p>
            </div>
            <button class="btn-close" @click="closeForm">×</button>
          </div>


          <form @submit.prevent="saveCliente" class="modal-form">
            <div class="modal-form-grid">
            <label class="form-group form-group-full">
              <span>Empresa</span>
              <input
                v-model="form.empresa"
                type="text"
                placeholder="Nombre comercial (opcional)"
              />
            </label>
            <label class="form-group form-group-full">
              <span>Razón Social *</span>
              <input
                v-model="form.razon_social"
                type="text"
                placeholder="Razón social registrada"
                required
              />
            </label>

            <label class="form-group">
              <span>CUIT</span>
              <input
                v-model="form.cuit"
                type="text"
                placeholder="XX-XXXXXXXX-X"
              />
            </label>

            <label class="form-group">
              <span>IVA *</span>
              <select
                v-model="form.iva"
                required
              >
                <option value="Responsable Inscripto">Responsable Inscripto</option>
                <option value="Monotributista">Monotributista</option>
                <option value="Exento">Exento</option>
                <option value="Consumidor Final">Consumidor Final</option>
                <option value="No corresponde">No corresponde</option>
              </select>
            </label>

            <label class="form-group form-group-full">
              <span>Dirección</span>
              <input
                v-model="form.direccion"
                type="text"
                placeholder="Calle y número"
              />
            </label>

            <label class="form-group">
              <span>Teléfono</span>
              <input
                v-model="form.telefono"
                type="text"
                placeholder="+54 9 XXXX-XXXXXX"
              />
            </label>

            <label class="form-group">
              <span>Email</span>
              <input
                v-model="form.email"
                type="text"
                id="email"
                placeholder="Ingrese el email o '-' si no aplica"
              />
            </label>

            <label class="form-group">
              <span>Saldo inicial (arrastre)</span>
              <input
                v-model.number="form.saldo_inicial_arrastre"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </label>

            <label class="form-group">
              <span>Fecha saldo inicial</span>
              <input
                v-model="form.fecha_saldo_inicial_arrastre"
                type="date"
              />
            </label>

            <label class="form-group form-group-full">
              <span>Nota saldo inicial</span>
              <input
                v-model="form.nota_saldo_inicial_arrastre"
                type="text"
                placeholder="Ej: Arrastre sistema anterior"
              />
            </label>
            </div>

            <div class="modal-actions">
              <button type="submit" class="btn-primary" :disabled="loading">
                {{ loading ? "Guardando..." : "Guardar cliente" }}
              </button>
              <button type="button" class="btn-secondary" @click="closeForm">
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
.clientes-container {
  padding: 1.5rem;
  display: grid;
  gap: 1.75rem;
}

.clientes-list-view {
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

.clientes-topbar,
.clientes-toolbar,
.clientes-table-shell,
.clientes-stat-card,
.empty-state {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.78));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.45);
}

.clientes-topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.2rem;
  flex-wrap: wrap;
  padding: 1.4rem 1.5rem;
  border-radius: 1rem;
}

.clientes-topbar-copy {
  display: grid;
  gap: 0.25rem;
}

.clientes-topbar-copy h2,
.clientes-table-header-row h3 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.45rem;
}

.clientes-topbar-copy p {
  margin: 0;
  color: #94a3b8;
  max-width: 58ch;
  line-height: 1.45;
}

.clientes-new-btn {
  white-space: nowrap;
}

.clientes-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.4rem;
}

.clientes-stat-card {
  padding: 1.15rem 1.2rem;
  border-radius: 0.95rem;
  display: grid;
  gap: 0.4rem;
}

.clientes-stat-card span {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.clientes-stat-card strong {
  font-size: 1.55rem;
  color: #f8fafc;
}

.clientes-stat-card small {
  color: #94a3b8;
  line-height: 1.35;
}

.clientes-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 1.15rem;
  flex-wrap: wrap;
  padding: 1.1rem 1.2rem;
  border-radius: 1rem;
}

.clientes-search-field {
  display: grid;
  gap: 0.45rem;
  flex: 1;
  min-width: min(100%, 420px);
}

.clientes-search-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.clientes-search-field input {
  width: 100%;
  padding: 0.85rem 0.95rem;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.clientes-search-field input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.clientes-toolbar-count {
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

.clientes-table-shell {
  border-radius: 1rem;
  overflow: hidden;
}

.clientes-table-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.15rem 0.75rem;
}

.clientes-table-header-row h3 {
  font-size: 1.1rem;
}

.clientes-table {
  overflow-x: auto;
  padding: 0 0.9rem 0.9rem;
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

.cliente-main-cell {
  display: grid;
  gap: 0.2rem;
}

.cliente-main-cell strong {
  color: #f8fafc;
  font-size: 0.96rem;
}

.cliente-main-cell small {
  color: #94a3b8;
  font-size: 0.78rem;
}

.iva-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  color: #bfdbfe;
  font-size: 0.8rem;
  font-weight: 600;
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

.btn-pdf {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
  background-color: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}

.btn-pdf:hover:not(:disabled) {
  background-color: rgba(99, 102, 241, 0.3);
}

.btn-pdf:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
  border-radius: 1rem;
  color: #94a3b8;
}

.empty-state-search {
  padding-block: 2.2rem;
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
  width: min(760px, 100%);
  max-height: min(88vh, 920px);
  overflow-y: auto;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 1.15rem;
  box-shadow: 0 34px 80px rgba(2, 6, 23, 0.58);
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
  font-size: 1.7rem;
  line-height: 1;
  cursor: pointer;
  padding: 0;
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
  display: grid;
  gap: 1.25rem;
}

.modal-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem 1.1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.48rem;
}

.form-group-full {
  grid-column: 1 / -1;
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
  background-color: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.15rem;
}

.modal-actions .btn-primary,
.modal-actions .btn-secondary {
  min-height: 3rem;
  border-radius: 0.8rem;
  font-weight: 700;
}

.btn-primary {
  flex: 1;
  padding: 0.6rem;
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
  padding: 0.6rem;
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

/* Botón Ver Ficha */
.btn-ficha {
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

.btn-ficha:hover {
  background-color: rgba(34, 197, 94, 0.3);
}

@media (max-width: 760px) {
  .clientes-topbar,
  .clientes-toolbar,
  .ficha-header {
    flex-direction: column;
    align-items: stretch;
  }

  .clientes-toolbar-count {
    white-space: normal;
  }

  .modal-overlay {
    padding: 1rem;
    align-items: flex-start;
  }

  .modal {
    width: 100%;
    margin-top: 1rem;
  }

  .modal-header,
  .modal-form {
    padding-left: 1rem;
    padding-right: 1rem;
  }

  .modal-form-grid {
    grid-template-columns: 1fr;
  }

  .form-group-full {
    grid-column: auto;
  }

  .modal-actions {
    flex-direction: column;
  }
}

/* Ficha del Cliente */
.ficha-container {
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

.ficha-header {
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

.ficha-acciones {
  display: flex;
  gap: 0.75rem;
}

.ficha-acciones .btn-edit,
.ficha-acciones .btn-delete,
.ficha-acciones .btn-pdf {
  padding: 0.75rem 1.25rem;
  font-size: 0.9375rem;
}

.ficha-seccion {
  margin-bottom: 2rem;
  padding: 1.5rem;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
}

.ficha-seccion h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #e2e8f0;
  font-size: 1.125rem;
  font-weight: 600;
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

.obras-lista {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.obra-card {
  padding: 1.25rem;
  background-color: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  transition: all 0.2s;
}

.obra-card:hover {
  background-color: rgba(30, 41, 59, 0.8);
  border-color: rgba(148, 163, 184, 0.3);
  transform: translateY(-2px);
}

.obra-info {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: 1rem;
}

.obra-info h4 {
  margin: 0;
  color: #f9fafb;
  font-size: 1.125rem;
  font-weight: 600;
}

.obra-estado {
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.estado-activa {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.estado-finalizada {
  background-color: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}

.estado-pausada {
  background-color: rgba(251, 191, 36, 0.2);
  color: #fde047;
}

.obra-detalles {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
  color: #94a3b8;
}

.presupuestos-lista {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.presupuesto-card {
  padding: 1.1rem;
  background-color: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
}

.presupuesto-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.7rem;
}

.presupuesto-head h4 {
  margin: 0;
  color: #f9fafb;
  font-size: 1rem;
  font-weight: 600;
}

.presupuesto-estado {
  padding: 0.25rem 0.6rem;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  background-color: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}

.estado-pendiente {
  background-color: rgba(251, 191, 36, 0.2);
  color: #fde047;
}

.estado-aprobado {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.estado-rechazado {
  background-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.presupuesto-detalles {
  display: flex;
  justify-content: space-between;
  font-size: 0.875rem;
  color: #cbd5e1;
}

.estado-cuenta-resumen {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.8rem;
  margin-bottom: 1rem;
}

.estado-cuenta-card {
  padding: 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.6rem;
  background: rgba(30, 41, 59, 0.62);
  display: grid;
  gap: 0.3rem;
}

.estado-cuenta-card span {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
  font-weight: 700;
}

.estado-cuenta-card strong {
  font-size: 1.1rem;
  color: #f8fafc;
}

.estado-cobro {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.estado-cobro-pendiente {
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
}

.estado-cobro-parcial {
  background: rgba(245, 158, 11, 0.18);
  color: #fde68a;
}

.estado-cobro-pagado {
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
}

.estado-cobro-egreso {
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
}

.estado-cobro-a_favor {
  background: rgba(16, 185, 129, 0.2);
  color: #a7f3d0;
}

.estado-cobro-sin_deuda {
  background: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}

.tabla td small {
  display: block;
  color: #94a3b8;
  margin-top: 0.2rem;
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

.filtro-iva-field {
  display: grid;
  gap: 0.45rem;
}

.filtro-iva-field span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #cbd5e1;
}

.filtro-iva-field select {
  padding: 0.85rem 0.95rem;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 0.85rem;
  color: #e2e8f0;
  font-size: 0.95rem;
}

.filtro-iva-field select:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}
</style>

