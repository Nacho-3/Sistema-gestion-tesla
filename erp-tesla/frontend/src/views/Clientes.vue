<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

// Estado para movimientos de caja del cliente
const movimientosCajaCliente = ref([])
const loadingMovimientosCaja = ref(false)
const movimientoEditando=ref(null)
const formEdicionMovimiento=ref({
  detalle: "",
  observaciones: "",
  monto_total: 0,
})
const asignacionesEnEdicion=ref([])

// Estado para notas de credito
const notasCreditoCliente = ref([])
const loadingNotasCredito = ref(false)
const notaCreditoEditando = ref(null)
const showNotaCreditoModal = ref(false)
const formNotaCredito = ref({
  fecha: new Date().toISOString().slice(0, 10),
  concepto: "",
  observaciones: "",
  monto_total: 0,
  presupuestos_asignaciones: [],
})

const notasActivasExpandida = ref(true)
const notasAnuladasExpandida = ref(false)

const notasCreditoAnuladas = computed(() =>
  (notasCreditoCliente.value || []).filter((n) => String(n.estado || "").toLowerCase() === "anulada")
)

const esNotaAnulada = (nota) => String(nota.estado || "").toLowerCase() === "anulada"

// Estado
const clientes = ref([])
const loading = ref(false)
const loadingFicha = ref(false)
const error = ref("")
const showForm = ref(false)
// Modal now only closes via the close button. Clicks outside no longer close it.
const editingId = ref(null)
const vistaActual = ref("lista") // "lista" o "ficha"
const clienteSeleccionado = ref(null)
const obrasCliente = ref([])
const presupuestosCliente = ref([])
const presupuestosAceptados = ref([])
const loadingPresupuestosCliente = ref(false)
const presupuestosInicializados = ref(false)
const downloadingPdf = ref(false)
const downloadingHistoricoPdf = ref(false)
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

const movimientoTieneImputacion = (mov) => {
  if (mov?.tipo !== "ingreso") return false

  if (
    Array.isArray(mov.presupuestos_asignaciones) &&
    mov.presupuestos_asignaciones.some(
      (a) => Number(a.presupuestoId) > 0 && (Number(a.monto_asignado) || 0) > 0
    )
  ) {
    return true
  }

  if (Array.isArray(mov.presupuestos_ids) && mov.presupuestos_ids.some((id) => Number(id) > 0)) {
    return true
  }

  return Number(mov.presupuesto_id) > 0
}

const pagosImputados = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => movimientoTieneImputacion(m))
)

const pagosNoImputados = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => m.tipo === "ingreso" && !movimientoTieneImputacion(m))
)

const egresosCliente = computed(() =>
  (movimientosCajaCliente.value || []).filter((m) => m.tipo === "egreso")
)

const pagosImputadosPorPresupuesto = computed(() => {
  const map = new Map()

  for (const mov of movimientosCajaCliente.value || []) {
    if (mov.tipo !== "ingreso") continue

    if (
      Array.isArray(mov.presupuestos_asignaciones) &&
      mov.presupuestos_asignaciones.length > 0
    ) {
      for (const asignacion of mov.presupuestos_asignaciones) {
        const presupuestoId = Number(asignacion.presupuesto_id)
        const montoAsignado = Number(asignacion.monto_asignado) || 0
        if (!(presupuestoId > 0 || !(montoAsignado > 0))) continue

        map.set(
          presupuestoId,
          Number(map.get(presupuestoId) || 0) + montoAsignado
        )
      }
      continue
    }

    if (Array.isArray(mov.presupuestos_ids) && mov.presupuestos_ids.length === 1){
      const presupuestoId = Number(mov.presupuestos_ids[0])
      const monto = Number(mov.monto_total) || 0
      if (presupuestoId > 0 && monto > 0) {
        map.set(
          presupuestoId,
          Number(map.get(presupuestoId) || 0) + monto
        )
      }
      continue
    }

    if (Number(mov.presupuesto_id) > 0) {
      const presupuestoId = Number(mov.presupuesto_id)
      const monto = Number(mov.monto_total) || 0
      if (monto > 0) {
        map.set(
          presupuestoId,
          Number(map.get(presupuestoId) || 0) + monto
        )
      }
    }
  }
  return map
})

const notasCreditoActivas = computed(() =>
  (notasCreditoCliente.value || []).filter((n) => String(n.estado ||"").toLowerCase() === "activa")
)

const notasCreditoPorPresupuesto = computed(() => {
  const map = new Map()
  for (const n of notasCreditoActivas.value) {
    const asignaciones = Array.isArray(n.presupuestos_asignaciones) ? n.presupuestos_asignaciones : []
    for (const a of asignaciones){
      const pid = Number(a.presupuesto_id)
      const monto = Number(a.monto_asignado) || 0
      map.set(pid, Number(map.get(pid) || 0) + monto)
    }
  }
  return map
})

const estadoCuentaPresupuestos = computed(() => {
  return (presupuestosAceptados.value || []).map((p) => {
    const totalOriginal = Number(p.total) || 0
    const totalIva = Number(p.total_iva ?? p.iva_monto ?? 0) || 0
    const totalSinIva = Number(p.total_sin_iva ?? (totalOriginal - totalIva)) || 0
    const deudaComputable = Boolean(p.deuda_computable ?? esEstadoAceptado(p.estado))

    const descuentoNotas = Number(notasCreditoPorPresupuesto.value.get(Number(p.id)) || 0)
    const totalExigible = deudaComputable ? Math.max(0, totalOriginal - descuentoNotas) : 0

    const pagadoCaja = Number(p.total_pagado_caja)
    const pagadoFallback = Number(pagosImputadosPorPresupuesto.value.get(Number(p.id)) || 0)
    const pagado = Number.isFinite(pagadoCaja) ? pagadoCaja : pagadoFallback

    const saldoPendiente = deudaComputable ? Math.max(0, totalExigible - pagado) : 0
    const saldoAFavor = deudaComputable ? Math.max(0, pagado - totalExigible) : 0

    const estadoCobro = totalExigible <= 0.01
      ? "sin_deuda"
      : calcularEstadoCobro(deudaComputable, totalExigible, pagado)
    
    return {
      ...p,
      total_original: totalOriginal,
      total_descuento_nc: descuentoNotas,
      total_sin_iva: totalSinIva,
      total_iva: totalIva,
      total: totalExigible,
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

const movimientosCuentaCorriente = computed (() => {
  const rows = []
  const fechaArrastre = toDateInputValue(clienteSeleccionado.value?.fecha_saldo_inicial_arrastre)
  const notaArrastre = String(clienteSeleccionado.value?.nota_saldo_inicial_arrastre || "").trim()

  rows.push({
    tipo: "saldo_inicial",
    fechaRaw: fechaArrastre,
    fechaCreacionRaw: `${fechaArrastre}T00:00:00`,
    ordenDia: -1,
    fecha: formatDateAr(fechaArrastre),
    referencia: notaArrastre || "Arrastre sistema anterior",
    debe: roundMoney(Math.max(0, saldoInicialArrastreCliente.value)),
    haber: roundMoney(Math.max(0, -saldoInicialArrastreCliente.value)),
    impacto: roundMoney(saldoInicialArrastreCliente.value),
  })

  for (const p of estadoCuentaPresupuestos.value) {
    const total = roundMoney(p.total_original ?? p.total)

    rows.push({
      tipo: "presupuesto",
      fechaRaw: p.fecha,
      fechaCreacionRaw: p.created_at || p.fecha,
      ordenDia: Number(p.id) || 0,
      fecha: formatDateAr(p.fecha),
      referencia: `Presupuesto #${p.numero || "-"} - ${p.obra || "Sin obra"}`,
      debe: total,
      haber: 0,
      impacto: total,
    })
  }

  for (const nota of notasCreditoActivas.value) {
    const asignaciones = Array.isArray(nota.presupuestos_asignaciones) ? nota.presupuestos_asignaciones : []
    const nums = asignaciones
      .map((a) => presupuestosPorId.value.get(Number(a.presupuesto_id))?.numero || a.presupuesto_id)
      .filter(Boolean)
    const refPres = nums.length > 0 ? ` (Presupuestos: ${nums.join(", ")})` : ""
    const monto = roundMoney(nota.monto_total)

    rows.push({
      tipo: "nota_credito",
      fechaRaw: nota.fecha,
      fechaCreacionRaw: nota.created_at || nota.fecha,
      ordenDia: Number(nota.id) || 0,
      fecha: formatDateAr(nota.fecha),
      referencia: `Nota de crédito: ${nota.concepto || "-"}${refPres}`,
      debe: 0,
      haber: monto,
      impacto: -monto,
    })
  }

  for (const mov of movimientosCajaCliente.value || []) {
    let presupuestosNumeros = []

    if (Array.isArray(mov.presupuestos_ids) && mov.presupuestos_ids.length > 0) {
      presupuestosNumeros = mov.presupuestos_ids
        .map((id) => presupuestosPorId.value.get(Number(id))?.numero || id)
        .filter(Boolean)
    } else if (Number(mov.presupuesto_id) > 0) {
      const num = presupuestosPorId.value.get(Number(mov.presupuesto_id))?.numero || mov.presupuesto_id
      presupuestosNumeros = [num]
    }

    const monto = roundMoney(mov.monto_total)

    if (mov.tipo === "egreso") {
      const detalle = String(mov.detalle || "Egreso en caja")
      const destinatario = String(mov.destinatario || "Devolucion al cliente").trim()

      rows.push({
        tipo: "egreso",
        fechaRaw: mov.fecha,
        fechaCreacionRaw: mov.created_at || mov.fecha,
        ordenDia: Number(mov.id) || 0,
        fecha: formatDateAr(mov.fecha),
        referencia: `${detalle} - ${destinatario}`,
        debe: monto,
        haber: 0,
        impacto: monto,
      })
      continue
    }

    const detalle = String(mov.detalle || "Cobro en caja")
    const referencia = presupuestosNumeros.length > 0
      ? `${detalle} - Presupuestos #${presupuestosNumeros.join(", #")}`
      : `${detalle} - Pago sin imputar`

    rows.push({
      tipo: "pago",
      fechaRaw: mov.fecha,
      fechaCreacionRaw: mov.created_at || mov.fecha,
      ordenDia: Number(mov.id) || 0,
      fecha: formatDateAr(mov.fecha),
      referencia,
      debe: 0,
      haber: monto,
      impacto: -monto,
    })
  }

  rows.sort((a,b) => {
    const aDate = String(toDateInputValue(a.fechaRaw || "1900-01-01"))
    const bDate = String(toDateInputValue(b.fechaRaw || "1900-01-01"))

    if (aDate !== bDate) return aDate.localeCompare(bDate)

    const aCreated = new Date (a.fechaCreacionRaw || `${aDate}T00:00:00`).getTime()
    const bCreated = new Date (b.fechaCreacionRaw || `${bDate}T00:00:00`).getTime()

    if (aCreated !== bCreated) return aCreated - bCreated

    if ((a.ordenDia ?? 0) !== (b.ordenDia ?? 0)) {
      return (a.ordenDia ?? 0) - (b.ordenDia ?? 0)
    }

    return String(a.referencia || "").localeCompare(String(b.referencia || ""))
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

onMounted(() => {
  loadClientes()
  socket.on('clientes:changed', loadClientes)
  socket.on('presupuestos:changed', handlePresupuestosChanged)
  socket.on('caja:changed', handleCajaChanged)
  socket.on('notas_credito:changed', handleNotasCreditoChanged)
})

const handleNotasCreditoChanged = () => {
  if (vistaActual.value === "ficha" && clienteSeleccionado.value?.id) {
    cargarNotasCreditoCliente(clienteSeleccionado.value.id).catch((err) => {
      console.error("Error al actualizar notas de crédito del cliente:", err)
    })
  }
}

const cargarPresupuestosCliente = async (clienteId) => {
  loadingPresupuestosCliente.value = true
  try {
    let resPresupuestos
    try {
      // Fast path: backend-side filter when available.
      resPresupuestos = await api.getPresupuestos(clienteId)
    } catch (errFiltrado) {
      console.warn("Fallo carga filtrada de presupuestos; aplicando fallback general:", errFiltrado)
      resPresupuestos = await api.getPresupuestos()
    }

    const presupuestos = (resPresupuestos.data || []).filter(p => Number(p.cliente_id) === Number(clienteId))
    const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase().trim())
    presupuestosAceptados.value = presupuestos.filter(isAceptado)
    presupuestosCliente.value = presupuestos.filter(p => !isAceptado(p))
    presupuestosInicializados.value = true
  } catch (err) {
    console.error("Error al cargar presupuestos del cliente:", err)
    // No limpiar datos existentes para evitar pantallas vacias por errores transitorios.
  } finally {
    loadingPresupuestosCliente.value = false
  }
}

const cargarMovimientosCajaCliente = async (clienteId) => {
  loadingMovimientosCaja.value = true
  try {
    const resMovimientos = await api.getMovimientosCaja(null, null, null, null, null, null, clienteId)
    movimientosCajaCliente.value = (resMovimientos.data?.movimientos || [])
  } catch (err) {
    console.error("Error al cargar movimientos del cliente:", err)
    movimientosCajaCliente.value = []
  } finally {
    loadingMovimientosCaja.value = false
  }
}

const cargarNotasCreditoCliente = async (clienteId) => {
  loadingNotasCredito.value = true
  try {
    const res = await api.getNotasCreditoCliente(clienteId)
    notasCreditoCliente.value = res.data || []
  } catch (err) {
    console.error("Error al cargar notas de crédito del cliente:", err)
    notasCreditoCliente.value = []
  } finally {
    loadingNotasCredito.value = false
  }
}

// Ver ficha del cliente
const verFicha = async (cliente) => {
  if (loadingFicha.value) return
  loadingFicha.value = true

  try {
    clienteSeleccionado.value = cliente
    const [obrasRes] = await Promise.allSettled([
      api.getObras(),
      cargarPresupuestosCliente(cliente.id),
      cargarMovimientosCajaCliente(cliente.id),
      cargarNotasCreditoCliente(cliente.id),
    ])

    if (obrasRes.status === "fulfilled") {
      obrasCliente.value = obrasRes.value.data?.filter(o => o.cliente_id === cliente.id) || []
    } else {
      console.error("Error al cargar obras del cliente:", obrasRes.reason)
      obrasCliente.value = []
    }

    vistaActual.value = "ficha"
  } catch (err) {
    console.error("Error inesperado al abrir la ficha:", err)
  } finally {
    loadingFicha.value = false
  }
}

// Volver a la lista
const volverALista = () => {
  vistaActual.value = "lista"
  clienteSeleccionado.value = null
  obrasCliente.value = []
  presupuestosCliente.value = []
  presupuestosAceptados.value = []
  presupuestosInicializados.value = false
  notasCreditoCliente.value = []
}

const handlePresupuestosChanged = () => {
  if (vistaActual.value === "ficha" && clienteSeleccionado.value?.id) {
    cargarPresupuestosCliente(clienteSeleccionado.value.id).catch((err) => {
      console.error("Error al actualizar presupuestos del cliente:", err)
    })
  }
}

const handleCajaChanged = () => {
  if (vistaActual.value === "ficha" && clienteSeleccionado.value?.id) {
    cargarMovimientosCajaCliente(clienteSeleccionado.value.id).catch((err) => {
      console.error("Error al actualizar movimientos del cliente:", err)
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

const descargarFichaHistoricaPdf = async () => {
  if (!clienteSeleccionado.value) return

  downloadingHistoricoPdf.value = true
  error.value = ""

  try {
    const res = await api.getClienteFichaHistoricaPdf(clienteSeleccionado.value.id)
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
    link.download = `Ficha historica ${nombreCliente} actualizada ${fecha}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    error.value = extractApiErrorMessage(err, "Error al generar la ficha histórica PDF")
    console.error(err)
  } finally {
    downloadingHistoricoPdf.value = false
  }
}

//Edicion de movimientos de caja

const abrirEdicionMovimiento = (movimiento) => {
  movimientoEditando.value = movimiento.id
  formEdicionMovimiento.value ={
    detalle: movimiento.detalle || "",
    observaciones: movimiento.observaciones || "",
    monto_total: movimiento.monto_total || 0,
  }
  
  // Cargar asignaciones existentes o crear nuevas
  if (Array.isArray(movimiento.presupuestos_asignaciones) && movimiento.presupuestos_asignaciones.length > 0) {
    asignacionesEnEdicion.value = JSON.parse(JSON.stringify(movimiento.presupuestos_asignaciones))
  } else if (Array.isArray(movimiento.presupuestos_ids) && movimiento.presupuestos_ids.length > 0) {
    // Si no hay asignaciones pero hay presupuestos, crear distribución equitativa
    const monto = Number(movimiento.monto_total) || 0
    const montosPorPresupuesto = monto / movimiento.presupuestos_ids.length
    asignacionesEnEdicion.value = movimiento.presupuestos_ids.map(id => ({
      presupuesto_id: id,
      monto_asignado: montosPorPresupuesto
    }))
  } else {
    asignacionesEnEdicion.value = []
  }
}

const cancelarEdicion = () => {
  movimientoEditando.value = null
  formEdicionMovimiento.value = {
    detalle: "",
    observaciones: "",
    monto_total: 0,
  }
  asignacionesEnEdicion.value = []
}

const guardarEdicionMovimiento = async () => {
  try {
    // Obtener movimiento original
    const movOriginal = movimientosCajaCliente.value.find(m => m.id === movimientoEditando.value)
    if (!movOriginal) {
      alert("Error: Movimiento no encontrado")
      return
    }

    // Construir payload
    const payload = {
      detalle: formEdicionMovimiento.value.detalle,
      observaciones: formEdicionMovimiento.value.observaciones,
      monto_total: formEdicionMovimiento.value.monto_total,
    }

    // Si hay asignaciones editables, enviarlas tal como estén
    if (Array.isArray(asignacionesEnEdicion.value) && asignacionesEnEdicion.value.length > 0) {
      payload.presupuestos_asignaciones = asignacionesEnEdicion.value.map(a => ({
        presupuesto_id: a.presupuesto_id,
        monto_asignado: Number(a.monto_asignado) || 0
      }))
    }

    const { data: movimientoActualizado } = await api.updateMovimientoCaja(movimientoEditando.value, payload)

    // Actualizar localmente con la respuesta del backend para reflejar asignaciones y presupuestos
    const idx = movimientosCajaCliente.value.findIndex(m => Number(m.id) === Number(movimientoEditando.value))
    if (idx >= 0 && movimientoActualizado) {
      movimientosCajaCliente.value[idx] = movimientoActualizado
    }

    if (clienteSeleccionado.value?.id) {
      await Promise.all([
        cargarMovimientosCajaCliente(clienteSeleccionado.value.id),
        cargarPresupuestosCliente(clienteSeleccionado.value.id),
      ])
    }

    cancelarEdicion()
  } catch (error) {
    console.error("Error actualizando movimiento:", error)
    alert("Error al actualizar movimiento")
  }
}

const abrirNuevaNotaCredito = () => {
  notaCreditoEditando.value = null
  formNotaCredito.value = {
    fecha: new Date().toISOString().slice(0, 10),
    concepto: "",
    observaciones: "",
    monto_total: 0,
    presupuestos_asignaciones: [],
  }
  showNotaCreditoModal.value = true
}

const editarNotaCredito = (nota) => {
  notaCreditoEditando.value = nota.id
  formNotaCredito.value = {
    fecha: nota.fecha ? String(nota.fecha).slice(0,10) : new Date().toISOString().slice(0, 10),
    concepto: nota.concepto || "",
    observaciones: nota.observaciones || "",
    monto_total: Number(nota.monto_total) || 0,
    presupuestos_asignaciones: (nota.presupuestos_asignaciones || []).map((a) => ({
      presupuesto_id: Number(a.presupuesto_id),
      monto_asignado: Number(a.monto_asignado) || 0,
    })),
  }
  showNotaCreditoModal.value = true
}

const agregarAsignacionNotaCredito = () => {
  formNotaCredito.value.presupuestos_asignaciones.push({
    presupuesto_id: "",
    monto_asignado: 0,
  })
}

const eliminarAsignacionNotaCredito = (index) => {
  formNotaCredito.value.presupuestos_asignaciones.splice(index, 1)
}

const totalNcNotaCredito = computed(() => 
  roundMoney(Number(formNotaCredito.value.monto_total) || 0)
)

const totalAsignadoNotaCredito = computed(() =>
  roundMoney(
    (formNotaCredito.value.presupuestos_asignaciones || []).reduce(
      (acc, a) => acc + (Number(a.monto_asignado) || 0),
      0
    )
  )
)

const diferenciaNotaCredito = computed(() =>
  roundMoney(totalNcNotaCredito.value - totalAsignadoNotaCredito.value)
)

const claseDiferenciaAsignacionNotaCredito = computed(() => {
  if (diferenciaNotaCredito.value > 0.01) return "diferencia-positiva"
  if (diferenciaNotaCredito.value < -0.01) return "diferencia-negativa"
  return "diferencia-cero"
})

const saldoPendientePorPresupuesto = computed(() => {
  const map = new Map()
  for (const p of estadoCuentaPresupuestos.value) {
    map.set(Number(p.id), Number(p.saldo_pendiente) || 0)
  }
  return map
})

const opcionesPresupuestosPorFila = (index) => {
  const filas = formNotaCredito.value.presupuestos_asignaciones || []
  const actualId = Number(filas[index]?.presupuesto_id) || 0

  const usadosEnOtrasFilas = new Set(
    filas
      .filter((_, i) => i !== index)
      .map((f) => Number(f.presupuesto_id))
      .filter((id) => id > 0)
  )

  return (presupuestosAceptados.value || []).filter((p) => {
    const pid = Number(p.id)
    const pendiente = Number(saldoPendientePorPresupuesto.value.get(pid) || 0)
    const esActual = pid === actualId
    return (pendiente > 0.01 || esActual) && !usadosEnOtrasFilas.has(pid)
  })
}

const calcularValorResultantePresupuesto = (presupuestoId, montoAsignado) => {
  const total = Number(presupuestosPorId.value.get(Number(presupuestoId))?.total || 0)
  const asignado = Number(montoAsignado) || 0
  return roundMoney(total - asignado)
}

const guardarNotaCredito = async () => {
  if (!clienteSeleccionado.value?.id) return

  try {
    const asignaciones = (formNotaCredito.value.presupuestos_asignaciones || []).map((a) => ({
      presupuesto_id: Number(a.presupuesto_id),
      monto_asignado: Number(a.monto_asignado) || 0,
    }))

    const montoTotal = Number(formNotaCredito.value.monto_total) || 0
    const sumaAsignaciones = roundMoney(
      asignaciones.reduce((acc, a) => acc + (Number(a.monto_asignado) || 0), 0)
    )

    if (!String(formNotaCredito.value.concepto || "").trim()) {
      alert("El concepto es obligatorio")
      return
    }

    if (!(montoTotal > 0)) {
      alert("El monto total debe ser mayor a cero")
      return
    }

    if (asignaciones.length === 0) {
      alert("Debe asignar al menos un presupuesto a la nota de crédito")
      return
    }

    if (asignaciones.some((a) => !Number.isInteger(a.presupuesto_id) || a.presupuesto_id <= 0)) {
      alert("Todos los presupuestos asignados deben tener un ID válido")
      return
    }

    if (asignaciones.some((a) => !(a.monto_asignado > 0))) {
      alert("Todos los montos asignados deben ser mayores a cero")
      return
    }

    if (Math.abs(sumaAsignaciones - montoTotal) > 0.01) {
      alert("La suma de los montos asignados debe coincidir con el monto total")
      return
    }

    const payload = {
      fecha: formNotaCredito.value.fecha,
      concepto: formNotaCredito.value.concepto,
      observaciones: formNotaCredito.value.observaciones,
      monto_total: montoTotal,
      presupuestos_asignaciones: asignaciones,
    }

    if (notaCreditoEditando.value) {
      await api.updateNotaCreditoCliente(clienteSeleccionado.value.id, notaCreditoEditando.value, payload)
    } else {
      await api.createNotaCreditoCliente(clienteSeleccionado.value.id, payload)
    }

    showNotaCreditoModal.value = false
    await Promise.all([
      cargarNotasCreditoCliente(clienteSeleccionado.value.id),
      cargarPresupuestosCliente(clienteSeleccionado.value.id),
    ])
  } catch (error) {
    alert(extractApiErrorMessage(error, "No se pudo guardar la nota de crédito"))
  }
}

const anularNotaCredito = async (notaId) => {
  if (!clienteSeleccionado.value?.id) return

  const nota = (notasCreditoCliente.value || []).find(
    (n) => Number(n.id) === Number(notaId)
  )

  if (nota && esNotaAnulada(nota)) return

  if (!confirm("¿Anular nota de crédito?")) return
  
  try{
    await api.deleteNotaCreditoCliente(clienteSeleccionado.value.id, notaId)
    await Promise.all([
      cargarNotasCreditoCliente(clienteSeleccionado.value.id),
      cargarPresupuestosCliente(clienteSeleccionado.value.id)
    ])
  } catch (error) {
    alert(extractApiErrorMessage(error, "No se pudo anular la nota de crédito"))
  }
}

const calcularDiferencia = (presupuestoId, montoAsignado) => {
  const total = presupuestosPorId.value.get(Number(presupuestoId))?.total || 0
  return total - montoAsignado
}

const obtenerClaseDiferencia = (presupuestoId, montoAsignado) => {
  const diff = calcularDiferencia(presupuestoId, montoAsignado)
  if (diff > 0.01) return 'diferencia-positiva'
  if (diff < -0.01) return 'diferencia-negativa'
  return 'diferencia-cero'
}

onBeforeUnmount(() => {
  socket.off('clientes:changed', loadClientes)
  socket.off('presupuestos:changed', handlePresupuestosChanged)
  socket.off('caja:changed', handleCajaChanged)
  socket.off('notas_credito:changed', handleNotasCreditoChanged)
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

          <div v-if="loadingPresupuestosCliente && !presupuestosInicializados">
            <span class="spinner">Cargando presupuestos del cliente...</span>
          </div>
          <div v-else-if="estadoCuentaPresupuestos.length > 0" class="tabla-shell">
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
          <div class="ficha-seccion-header">
            <h3>📚 Cuenta corriente cronológica</h3>
            <button class="btn-pdf" :disabled="downloadingHistoricoPdf" @click="descargarFichaHistoricaPdf">
              {{ downloadingHistoricoPdf ? "Generando historial..." : "🖨️ Cuenta Corriente PDF" }}
            </button>
          </div>
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
                    <span 
                      class="estado-cobro"
                      :class="
                        mov.tipo === 'pago'
                          ? 'estado-cobro-pagado'
                          : mov.tipo === 'egreso'
                            ? 'estado-cobro-egreso'
                            : mov.tipo === 'presupuesto'
                              ? 'estado-cobro-pendiente'
                              : mov.tipo === 'nota_credito'
                                ? 'estado-cobro-parcial'
                                : 'estado-cobro-sin_deuda'
                      "
                    >
                      {{
                        mov.tipo === 'saldo_inicial'
                          ? 'Saldo inicial'
                          : mov.tipo === 'presupuesto'
                            ? 'Presupuesto'
                            : mov.tipo === 'egreso'
                              ? 'Egreso'
                              : mov.tipo === 'nota_credito'
                                ? 'Nota de crédito'
                                : 'Pago'
                      }}
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
          <div v-if="loadingMovimientosCaja && movimientosCajaCliente.length === 0">
            <span class="spinner">Cargando movimientos...</span>
          </div>
          <div v-else-if="movimientosCajaCliente.length === 0">
            <p class="sin-datos">No hay movimientos registrados a este cliente.</p>
          </div>
          <div v-else class="tabla-shell">
            <table class="tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Observaciones</th>
                  <th>Monto total</th>
                  <th>Presupuestos asignados</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="mov in movimientosCajaCliente" :key="mov.id">
                  <td>{{ new Date(mov.fecha).toLocaleDateString('es-AR') }}</td>
                  <td>{{ mov.tipo === 'egreso' ? `${mov.detalle} (egreso)` : mov.detalle }}</td>
                  <td>{{ mov.observaciones || '-' }}</td>
                  <td>{{ mov.tipo === 'egreso' ? `-${formatMoney(mov.monto_total)}` : formatMoney(mov.monto_total) }}</td>
                  <td>
                    <span v-if="mov.tipo === 'ingreso' && Array.isArray(mov.presupuestos_ids) && mov.presupuestos_ids.length > 0">
                      {{ mov.presupuestos_ids.map(id => `#${presupuestosPorId.get(Number(id))?.numero || id}`).join(', ') }}
                    </span>
                    <span v-else>-</span>
                  </td>
                  <td>
                    <button class="btn-edit-movimiento" @click="abrirEdicionMovimiento(mov)" title="Editar movimiento">
                      ✏️ Editar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Notas de credito -->
        <div class="ficha-seccion">
          <div class="ficha-seccion-header">
            <h3>💳 Notas de crédito</h3>
            <button class="btn-edit-movimiento" @click="abrirNuevaNotaCredito">
              + Nueva nota de crédito
            </button>
          </div>

          <div v-if="loadingNotasCredito && notasCreditoCliente.length === 0">
            <span class="spinner">Cargando notas de crédito...</span>
          </div>

          <div v-else-if="notasCreditoCliente.length === 0">
            <p class="sin-datos">No hay notas de crédito disponibles.</p>
          </div>


          <template v-else>
            <div class="notas-credito-subseccion">
              <div class="notas-credito-subseccion-header">
                <h4>Activas ({{ notasCreditoActivas.length }}) </h4>
                <button class="btn-toggle-seccion" @click="notasActivasExpandida = !notasActivasExpandida">
                  {{ notasActivasExpandida ? "▾ Contraer" : "▸ Expandir" }}
                </button>
              </div>

              <div v-if="notasActivasExpandida">
                <div v-if="notasCreditoActivas.length === 0">
                  <p class="sin-datos">No hay notas de crédito activas.</p>
                </div>
                <div v-else class="tabla-shell">
                  <table class="tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th>Monto</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="n in notasCreditoActivas" :key="n.id">
                        <td>{{ formatDateAr(n.fecha) }}</td>
                        <td>{{ n.concepto || "-" }}</td>
                        <td>{{ formatMoney(n.monto_total) }}</td>
                        <td>
                          <span class="estado-cobro estado-cobro-pagado">
                            {{ n.estado || "-" }}
                          </span>
                        </td>
                        <td>
                          <div class="acciones-nota-credito">
                            <button class="btn-edit-movimiento" @click="editarNotaCredito(n)" title="Editar nota de crédito">
                              ✏️ Editar
                            </button>
                            <button
                              class="btn-edit-movimiento"
                              @click="anularNotaCredito(n.id)"
                              :disabled="esNotaAnulada(n)"
                              title="Anular nota de crédito"
                            >
                              🗑️ Anular
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="notas-credito-subseccion">
              <div class="notas-credito-subseccion-header">
                <h4>Anuladas ({{ notasCreditoAnuladas.length }})</h4>
                <button class="btn-toggle-seccion" @click="notasAnuladasExpandida = !notasAnuladasExpandida">
                  {{ notasAnuladasExpandida ? "▾ Contraer" : "▸ Expandir" }}
                </button>
              </div>

              <div v-if="notasAnuladasExpandida">
                <div v-if="notasCreditoAnuladas.length === 0">
                  <p class="sin-datos">No hay notas de crédito anuladas.</p>
                </div>
                <div v-else class="tabla-shell">
                  <table class="tabla">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th>Monto</th>
                        <th>Estado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="n in notasCreditoAnuladas" :key="n.id">
                        <td>{{ formatDateAr(n.fecha) }}</td>
                        <td>{{ n.concepto || "-" }}</td>
                        <td>{{ formatMoney(n.monto_total) }}</td>
                        <td>
                          <span class="estado-cobro estado-cobro-pendiente">
                            {{ n.estado || "-" }}
                          </span>
                        </td>
                        <td>
                          <div class="acciones-nota-credito">
                            <button class="btn-edit-movimiento" @click="editarNotaCredito(n)" title="Editar nota de crédito">
                              ✏️ Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </template>
        </div>
 

          <!-- Modal de edición de movimiento -->
          <div v-if="movimientoEditando" class="modal-overlay">
            <div class="modal">
              <div class="modal-header">
                <div class="modal-header-copy">
                  <span class="section-kicker modal-kicker">Editar movimiento</span>
                  <h3>Modificar pago</h3>
                </div>
                <button class="btn-close" @click="cancelarEdicion">×</button>
              </div>

              <form @submit.prevent="guardarEdicionMovimiento" class="modal-form">
                <div class="modal-form-grid">
                  <label class="form-group form-group-full">
                    <span>Detalle *</span>
                    <input
                      v-model="formEdicionMovimiento.detalle"
                      type="text"
                      required
                    />
                  </label>

                  <label class="form-group form-group-full">
                    <span>Observaciones</span>
                    <textarea
                      v-model="formEdicionMovimiento.observaciones"
                      placeholder="Notas adicionales (opcional)"
                      rows="3"
                    ></textarea>
                  </label>

                  <label class="form-group">
                    <span>Monto</span>
                    <input
                      v-model.number="formEdicionMovimiento.monto_total"
                      type="number"
                      min="0"
                      step="0.01"
                    />
                  </label>
                </div>

                <!-- Tabla de distribución de presupuestos -->
                <div v-if="asignacionesEnEdicion.length > 0" class="modal-form-grid">
                  <div class="form-group form-group-full">
                    <span>Distribución por presupuesto</span>
                    <table class="tabla-asignaciones">
                      <thead>
                        <tr>
                          <th>Presupuesto</th>
                          <th>Total presupuesto</th>
                          <th>Monto a asignar</th>
                          <th>Diferencia</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="asig in asignacionesEnEdicion" :key="asig.presupuesto_id">
                          <td class="presupuesto-num">#{{ presupuestosPorId.get(Number(asig.presupuesto_id))?.numero || asig.presupuesto_id }}</td>
                          <td class="presupuesto-total">{{ formatMoney(presupuestosPorId.get(Number(asig.presupuesto_id))?.total || 0) }}</td>
                          <td class="presupuesto-input">
                            <input
                              v-model.number="asig.monto_asignado"
                              type="number"
                              min="0"
                              step="0.01"
                            />
                          </td>
                          <td class="presupuesto-diferencia">
                            <span :class="obtenerClaseDiferencia(asig.presupuesto_id, asig.monto_asignado)">{{ formatMoney(calcularDiferencia(asig.presupuesto_id, asig.monto_asignado)) }}</span>
                          </td>
                          <td class="presupuesto-accion">
                            <button
                              type="button"
                              class="btn-usar-total"
                              @click="asig.monto_asignado = presupuestosPorId.get(Number(asig.presupuesto_id))?.total || 0"
                              title="Usar el monto total del presupuesto"
                            >
                              Usar total
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" @click="cancelarEdicion">Cancelar</button>
                  <button type="submit" class="btn btn-primary">Guardar cambios</button>
                </div>
              </form>
            </div>
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
    
      <div v-if="showNotaCreditoModal" class="modal-overlay">
        <div class="modal modal-nota-credito">
          <div class="modal-header">
            <div class="modal-header-copy">
              <span class="section-kicker modal-kicker">Nota de crédito</span>
              <h3>{{ notaCreditoEditando ? "Editar nota de crédito" : "Nueva nota de crédito" }}</h3>
            </div>
            <button class="btn-close" @click="showNotaCreditoModal = false">×</button>
          </div>

          <form @submit.prevent="guardarNotaCredito" class="modal-form">
            <div class="modal-form-grid">
              <label class="form-group">
                <span>Fecha</span>
                <input v-model="formNotaCredito.fecha" type="date" required/>
              </label>

              <label class="form-group form-group-full">
                <span>Concepto</span>
                <input v-model="formNotaCredito.concepto" type="text" required/>
              </label>

              <label class="form-group">
                <span>Monto total</span>
                <input v-model.number="formNotaCredito.monto_total" type="number" min="0" step="0.01" required/>
              </label>

              <label class="form-group form-group-full">
                <span>Observaciones</span>
                <textarea 
                  v-model="formNotaCredito.observaciones"
                  class="textarea-observaciones-nc"
                  placeholder="Notas adicionales (opcional)"
                ></textarea>
              </label>
            </div>

            <div class="nota-credito-resumen">
              <div class="nota-credito-resumen-item">
                <span>Total NC: </span>
                <strong>{{ formatMoney(totalNcNotaCredito) }}</strong>
              </div>
              <div class="nota-credito-resumen-item">
                <span>Total asignado: </span>
                <strong>{{ formatMoney(totalAsignadoNotaCredito) }}</strong>
              </div>
              <div class="nota-credito-resumen-item">
                <span>Diferencia: </span>
                <strong :class="claseDiferenciaAsignacionNotaCredito">
                  {{ formatMoney(diferenciaNotaCredito) }}
                </strong>
              </div>
            </div>

            <div class="form-group form-group-full">
              <div class="ficha-seccion-header">
                <h3 class="asignaciones-titulo">Asignaciones por presupuestos</h3>
                <button type="button" class="btn-agregar-asignacion" @click="agregarAsignacionNotaCredito">
                  + Agregar asignación
                </button>
              </div>

              <table class="tabla-asignaciones" v-if="formNotaCredito.presupuestos_asignaciones.length">
                <thead>
                  <tr>
                    <th>Presupuesto</th>
                    <th>Total Presupuesto</th>
                    <th>Monto Asignado</th>
                    <th>Valor resultante</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(a, index) in formNotaCredito.presupuestos_asignaciones" :key="index">
                    <td>
                      <select v-model="a.presupuesto_id">
                        <option :value="0" disabled>Seleccione un presupuesto</option>
                        <option v-for="p in presupuestosAceptados" :key="p.id" :value="Number(p.id)">
                          #{{ p.numero }} - {{ p.obra || 'Sin obra' }}
                        </option>
                      </select>
                    </td>

                    <td class="presupuesto-total">
                      {{ formatMoney(presupuestosPorId.get(Number(a.presupuesto_id))?.total || 0) }}
                    </td>

                    <td>
                      <input v-model.number="a.monto_asignado" type="number" min="0" step="0.01" required/>
                    </td>

                    <td class="presupuesto-diferencia">
                      <span class="diferencia-cero">
                        {{ formatMoney(calcularValorResultantePresupuesto(a.presupuesto_id, a.monto_asignado)) }}
                      </span>
                    </td>

                    <td class="presupuesto-accion">
                      <button type="button" class="btn-delete-icon" @click="eliminarAsignacionNotaCredito(index)">
                        🗑️
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn-secondary" @click="showNotaCreditoModal = false">
                Cancelar
              </button>
              <button type="button" class="btn-primary" @click="guardarNotaCredito">
                Guardar
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

.modal-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.85rem;
  margin-top: 0.4rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
}

.modal-footer .btn {
  min-width: 136px;
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

  .ficha-seccion-header {
    flex-direction: column;
    align-items: stretch;
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

.ficha-seccion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.1rem;
}

.ficha-seccion-header h3 {
  margin-bottom: 0;
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

.tabla-asignaciones {
  width: 100%;
  border-collapse: collapse;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 0.5rem;
  overflow: hidden;
}

.tabla-asignaciones thead {
  background: rgba(30, 41, 59, 0.8);
}

.tabla-asignaciones th {
  padding: 0.75rem;
  text-align: left;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 0.85rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.tabla-asignaciones td {
  padding: 0.75rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  color: #e2e8f0;
}

.tabla-asignaciones tbody tr:hover {
  background: rgba(56, 189, 248, 0.05);
}

.tabla-asignaciones input {
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.24);
  color: #e2e8f0;
  padding: 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.tabla-asignaciones input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.btn-edit-movimiento {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.1rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.9), rgba(37, 99, 235, 0.9));
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 0.5rem;
  color: #e0e7ff;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
}

.btn-edit-movimiento:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 1), rgba(37, 99, 235, 1));
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
  transform: translateY(-1px);
}

.btn-edit-movimiento:active {
  transform: translateY(0);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25);
}

.presupuesto-num {
  font-weight: 600;
  color: #e2e8f0;
  min-width: 60px;
}

.presupuesto-total {
  color: #cbd5e1;
  text-align: right;
  min-width: 120px;
  font-family: 'Courier New', monospace;
}

.presupuesto-input {
  min-width: 150px;
}

.presupuesto-input input {
  width: 100%;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #e2e8f0;
  padding: 0.6rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-family: 'Courier New', monospace;
  transition: border-color 0.2s ease;
}

.presupuesto-input input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.6);
  background: rgba(15, 23, 42, 0.95);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.presupuesto-diferencia {
  text-align: right;
  min-width: 110px;
  font-family: 'Courier New', monospace;
  font-weight: 500;
}

.diferencia-cero {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
  padding: 0.3rem 0.6rem;
  border-radius: 0.25rem;
  display: inline-block;
}

.diferencia-positiva {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.1);
  padding: 0.3rem 0.6rem;
  border-radius: 0.25rem;
  display: inline-block;
}

.diferencia-negativa {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  padding: 0.3rem 0.6rem;
  border-radius: 0.25rem;
  display: inline-block;
}

.presupuesto-accion {
  min-width: 110px;
  text-align: right;
}

.btn-usar-total {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 0.8rem;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 0.375rem;
  color: #22c55e;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-usar-total:hover {
  background: rgba(34, 197, 94, 0.25);
  border-color: rgba(34, 197, 94, 0.5);
  box-shadow: 0 2px 6px rgba(34, 197, 94, 0.2);
}

.btn-usar-total:active {
  transform: scale(0.98);
}

@media (max-width: 768px) {
  .modal-footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .modal-footer .btn {
    width: 100%;
  }
}

.modal-nota-credito{
  width:min(1040px, 96vw);
  max-height: min(84vh, 860px);
}

.nota-credito-resumen{
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
}

.nota-credito-resumen-card{
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.7rem;
  padding: 0.7rem 0.85rem;
  display: grid;
  gap: 0.2rem;
}

.nota-credito-resumen-item span{
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #93c5fd;
}

.nota-credito-resumen-item strong{
  color: #e2e8f0;
  font-size: 1rem;
}

@media (max-width: 760px){
  .modal-nota-credito{
    width: 100%;
    max-height: 90vh;
  }

  .nota-credito-resumen{
    grid-template-columns: 1fr;
  }
}

.textarea-observaciones-nc{
  width: 100%;
  min-height: 88px;
  max-height: 88px;
  resize: none;
}

.asignaciones-header{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  margin-bottom: 0.9rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 0.7rem;
  background: rgba(15, 23, 42, 0.46);
}

.asignaciones-titulo {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: #dbeafe;
  letter-spacing: 0.01em;
}

.btn-agregar-asignacion {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.52rem 0.9rem;
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 0.5rem;
  background: rgba(30, 64, 175, 0.28);
  color: #bfdbfe;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-agregar-asignacion:hover {
  background: rgba(37, 99, 235, 0.35);
  border-color: rgba(147, 197, 253, 0.62);
}

.acciones-nota-credito{
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.btn-delete-movimiento{
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.1rem;
  background: linear-gradient(135deg, rgba(220, 38, 38, 0.9), rgba(185,28,28,0.9));
  border: 1px solid rgba(248, 113, 113, 0.38);
  border-radius: 0.5rem;
  color: #fee2e2;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.24);
}

.btn-delete-movimiento:hover{
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220,38,38,0.95));
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.34);
  transform: translateY(-1px);
}

.btn-delete-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.15rem;
  height: 2.15rem;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 0.48rem;
  background: rgba(127, 29, 29, 0.32);
  color: #fecaca;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-delete-icon:hover {
  background: rgba(185, 28, 28, 0.42);
  border-color: rgba(252, 165, 165, 0.52);
}

@media (max-width: 760px) {
  .asignaciones-header {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-agregar-asignacion {
    width: 100%;
  }

  .acciones-nota-credito {
    flex-direction: column;
    align-items: stretch;
  }
}

.notas-credito-subseccion{
  margin-top: 0.9rem;
}

.notas-credito-subseccion-header {
  display:flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.65rem;
}

.notas-credito-subseccion-header h4{
  margin: 0;
  color: #e2e8f0;
  font-size: 0.98rem;
  font-weight: 700;
}

.btn-delete-movimiento:disabled{
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-toggle-seccion {
margin-left: auto;
display: inline-flex;
align-items: center;
gap: 0.35rem;
padding: 0.4rem 0.75rem;
border-radius: 999px;
border: 1px solid rgba(148, 163, 184, 0.34);
background: rgba(15, 23, 42, 0.72);
color: #cbd5e1;
font-size: 0.8rem;
font-weight: 700;
cursor: pointer;
transition: all 0.18s ease;
}

.btn-toggle-seccion:hover {
border-color: rgba(147, 197, 253, 0.55);
color: #e2e8f0;
background: rgba(30, 41, 59, 0.9);
}

@media (max-width: 760px) {
.btn-toggle-seccion {
width: fit-content;
align-self: flex-end;
}
}

</style>

