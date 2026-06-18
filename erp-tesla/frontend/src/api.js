import axios from "axios"
import { clearStoredSession } from "./session"

// Detectamos si estamos en la consola de laboratorio (puerto 5174)
const isLaboratorio = window.location.port === "5174"

// Si es laboratorio va al 5001. Si es el dev común (producción local), va al 3000.
const DEFAULT_API_BASE_URL = isLaboratorio
  ? `${window.location.protocol}//${window.location.hostname}:5001`
  : `${window.location.protocol}//${window.location.hostname}:3000`
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 10000 
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearStoredSession()
      if (window.location.pathname !== "/") {
        window.location.href = "/"
      }
    }
    return Promise.reject(error)
  }
)

export const extractApiErrorMessage = (err, fallback = "Ocurrio un error inesperado") => {
  const responseData = err?.response?.data
  const detail = responseData?.detalle
  const context = responseData?.context

  if (typeof responseData?.error === "string" && responseData.error.trim()) {
    if (detail && typeof detail === "object") {
      const detailText = Object.entries(detail)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" | ")
      if (detailText) return `${responseData.error} (${detailText})`
    }
    if (context) return `${responseData.error} [${context}]`
    return responseData.error
  }

  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message
  }

  return fallback
}

export const withApiErrorMessage = (err, fallback) => ({
  ok: false,
  message: extractApiErrorMessage(err, fallback),
  raw: err,
})

export default {
  getDashboardResumen(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/dashboard/resumen?${params.toString()}`)
  },

  // Auth
  login(email, password) {
    return api.post("/auth/login", { email, password })
  },

  logout() {
    return api.post("/auth/logout")
  },

  me() {
    return api.get("/auth/me")
  },

  createBackup() {
    return api.post("/auth/backup")
  },

  getHealth() {
    return api.get("/health")
  },

  // Clientes
  getClientes() {
    return api.get("/clientes")
  },

  getCliente(id) {
    return api.get(`/clientes/${id}`)
  },

  createCliente(payload) {
    return api.post("/clientes", payload)
  },

  updateCliente(id, payload) {
    return api.put(`/clientes/${id}`, payload)
  },

  deleteCliente(id) {
    return api.delete(`/clientes/${id}`)
  },

  getClienteFichaPdf(id) {
    return api.get(`/clientes/${id}/ficha-pdf`, { responseType: "blob" })
  },

  // Obras
  getObras(includeAdmin = false) {
    if (includeAdmin) {
      return api.get("/obras?include_admin=1")
    }
    return api.get("/obras")
  },

  getObra(id) {
    return api.get(`/obras/${id}`)
  },

  createObra(payload) {
    return api.post("/obras", payload)
  },

  updateObra(id, payload) {
    return api.put(`/obras/${id}`, payload)
  },

  updateObraEstado(id, estado) {
    return api.patch(`/obras/${id}/estado`, { estado })
  },

  deleteObra(id) {
    return api.delete(`/obras/${id}`)
  },

  getObraPdf(id, mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/obras/${id}/pdf?${params.toString()}`, { responseType: "blob" })
  },

  // Grupos
  getGrupos() {
    return api.get("/grupos")
  },

  getGrupoResumen(id) {
    return api.get(`/grupos/${id}/resumen`)
  },

  createGrupo(payload) {
    return api.post("/grupos", payload)
  },

  updateGrupo(id, payload) {
    return api.put(`/grupos/${id}`, payload)
  },

  deleteGrupo(id) {
    return api.delete(`/grupos/${id}`)
  },

  // Empleados
  getEmpleados() {
    return api.get("/empleados")
  },

  getEmpleado(id) {
    return api.get(`/empleados/${id}`)
  },

  createEmpleado(payload) {
    return api.post("/empleados", payload)
  },

  updateEmpleado(id, payload) {
    return api.put(`/empleados/${id}`, payload)
  },

  deleteEmpleado(id) {
    return api.delete(`/empleados/${id}`)
  },

  updateTarifa(empleado_id, valor_hora) {
    return api.put(`/empleados/${empleado_id}/tarifa`, { valor_hora })
  },

  // Horas
  getHoras(mes, anio, empleado_id, obra_id) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    if (empleado_id) params.append("empleado_id", empleado_id)
    if (obra_id) params.append("obra_id", obra_id)
    return api.get(`/horas?${params.toString()}`)
  },

  createHora(payload) {
    return api.post("/horas", payload)
  },

  updateHora(id, payload) {
    return api.put(`/horas/${id}`, payload)
  },

  deleteHora(id) {
    return api.delete(`/horas/${id}`)
  },

  getResumenEmpleado(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/horas/resumen/empleado?${params.toString()}`)
  },

  getResumenObra(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/horas/resumen/obra?${params.toString()}`)
  },

  getResumenGrupo(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/horas/resumen/grupo?${params.toString()}`)
  },

  getResumenPrestadas(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/horas/resumen/prestadas?${params.toString()}`)
  },

  getResumenPrestadasPdf(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    return api.get(`/horas/resumen/prestadas/pdf?${params.toString()}`, { responseType: "blob" })
  },

  getResumenHorasPdf(mes, anio, grupo) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    if (grupo) params.append("grupo", grupo)
    return api.get(`/horas/resumen/pdf?${params.toString()}`, { responseType: "blob" })
  },

  // Sueldos y Liquidaciones
  getLiquidaciones(mes, anio, empleado_id) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
    if (empleado_id) params.append("empleado_id", empleado_id)
    return api.get(`/liquidaciones?${params.toString()}`)
  },

  getLiquidacion(id) {
    return api.get(`/liquidaciones/${id}`)
  },

  createLiquidacion(payload) {
    return api.post("/liquidaciones", payload)
  },

  updateLiquidacion(id, payload) {
    return api.put(`/liquidaciones/${id}`, payload)
  },

  getLiquidacionPdf(id) {
    return api.get(`/liquidaciones/${id}/pdf`, { responseType: "blob" })
  },

  deleteLiquidacion(id) {
    return api.delete(`/liquidaciones/${id}`)
  },

  getPagos(liquidacion_id) {
    return api.get(`/liquidaciones/${liquidacion_id}/pagos`)
  },

  createPago(liquidacion_id, payload) {
    return api.post(`/liquidaciones/${liquidacion_id}/pagos`, payload)
  },

  deletePago(id) {
    return api.delete(`/liquidaciones/pagos/${id}`)
  },

  // Caja
  getMovimientosCaja(fecha_inicio, fecha_fin, tipo, caja_codigo, caja_semanal_id, busqueda) {
    const params = new URLSearchParams()
    if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
    if (fecha_fin) params.append("fecha_fin", fecha_fin)
    if (tipo) params.append("tipo", tipo)
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    if (caja_semanal_id) params.append("caja_semanal_id", caja_semanal_id)
    if (busqueda) params.append("busqueda", busqueda)
    return api.get(`/caja?${params.toString()}`)
  },

  getResumenCajaPdf(fecha_inicio, fecha_fin, tipo, caja_codigo, resumen_modo = "general", busqueda) {
      const params = new URLSearchParams()
      if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
      if (fecha_fin) params.append("fecha_fin", fecha_fin)
      if (tipo) params.append("tipo", tipo)
      if (caja_codigo) params.append("caja_codigo", caja_codigo)
      if (resumen_modo) params.append("resumen_modo", resumen_modo)
      if (busqueda) params.append("busqueda", busqueda)
      return api.get(`/caja/resumen/pdf?${params.toString()}` , { responseType: "blob" })
    },

  getMovimientoCaja(id) {
    return api.get(`/caja/${id}`)
  },

  getMovimientoCajaPdf(id) {
    return api.get(`/caja/${id}/pdf`, { responseType: "blob" })
  },

  createMovimientoCaja(payload) {
    return api.post("/caja", payload)
  },

  importarSueldosACaja(mes, anio) {
    return api.post("/caja/importar-sueldos", { mes, anio })
  },

  getResumenImportacionSueldos(mes, anio) {
    return api.get("/caja/importar-sueldos/resumen", { params: { mes, anio } })
  },

  getResumenImportacionSueldosPdf(mes, anio) {
    return api.get("/caja/importar-sueldos/resumen/pdf", { params: { mes, anio }, responseType: "blob" })
  },

  getEstadoImportacionSueldos(mes, anio) {
    return api.get("/caja/importar-sueldos/estado", { params: { mes, anio } })
  },

  updateMovimientoCaja(id, payload) {
    return api.put(`/caja/${id}`, payload)
  },

  deleteMovimientoCaja(id) {
    return api.delete(`/caja/${id}`)
  },

  getSemanasCaja(caja_codigo) {
    const params = new URLSearchParams()
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    return api.get(`/caja/semanas?${params.toString()}`)
  },

  getSemanaCajaActual(caja_codigo, fecha) {
    const params = new URLSearchParams()
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    if (fecha) params.append("fecha", fecha)
    return api.get(`/caja/semana-actual?${params.toString()}`)
  },

  cerrarSemanaCaja(id, payload) {
    return api.post(`/caja/semanas/${id}/cerrar`, payload)
  },

  updateSemanaCajaSaldos(id, payload) {
    return api.post(`/caja/semanas/${id}/saldos`, payload)
  },

  getLibroChequesCaja(caja_codigo, estado, busqueda) {
    const params = new URLSearchParams()
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    if (estado) params.append("estado", estado)
    if (busqueda) params.append("busqueda", busqueda)
    return api.get(`/caja/libro-cheques?${params.toString()}`)
  },

  getChequesDisponiblesCaja(caja_codigo) {
    const params = new URLSearchParams()
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    return api.get(`/caja/libro-cheques/disponibles?${params.toString()}`)
  },

  getLibroChequesPdf(caja_codigo, listado = "ambos", busqueda) {
    const params = new URLSearchParams()
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    if (listado) params.append("listado", listado)
    if (busqueda) params.append("busqueda", busqueda)
    return api.get(`/caja/libro-cheques/pdf?${params.toString()}`, { responseType: "blob" })
  },

  transferirChequesCaja(payload) {
    return api.post("/caja/libro-cheques/transferir", payload)
  },

  // Presupuestos
  getPresupuestos() {
    return api.get("/presupuestos")
  },

  getPresupuesto(id) {
    return api.get(`/presupuestos/${id}`)
  },

  createPresupuesto(payload) {
    return api.post("/presupuestos", payload)
  },

  updatePresupuesto(id, payload) {
    return api.put(`/presupuestos/${id}`, payload)
  },

  deletePresupuesto(id) {
    return api.delete(`/presupuestos/${id}`)
  },

  updateEstadoPresupuesto(id, estado) {
    return api.patch(`/presupuestos/${id}/estado`, { estado })
  },

  getPresupuestoPdf(id) {
    return api.get(`/presupuestos/${id}/pdf`, { responseType: "blob" })
  },

  getPresupuestoMaterialesPdf(id) {
    return api.get(`/presupuestos/${id}/pdf-materiales`, { responseType: "blob" })
  },

  getNumeroSiguientePresupuesto() {
    return api.get("/presupuestos/config/numero-siguiente")
  },

  updateNumeroSiguientePresupuesto(numero_siguiente) {
    return api.put("/presupuestos/config/numero-siguiente", { numero_siguiente })
  },

  getCertificados() {
    return api.get("/certificados")
  },

  getCertificadosResumenPorPresupuesto() {
    return api.get("/certificados/resumen-por-presupuesto")
  },

  createCertificado(payload) {
    return api.post("/certificados", payload)
  },

  updateCertificado(id, payload) {
    return api.put(`/certificados/${id}`, payload)
  },

  deleteCertificado(id) {
    return api.delete(`/certificados/${id}`)
  },

  getCertificadoPdf(id) {
    return api.get(`/certificados/${id}/pdf`, { responseType: "blob" })
  },

  getCertificadosPresupuestoPdf(presupuestoId) {
    return api.get(`/certificados/presupuesto/${presupuestoId}/pdf`, { responseType: "blob" })
  },

  // Índices CAC
  getIndicesCac() {
    return api.get("/indices-cac")
  },
  createIndiceCac(payload) {
    return api.post("/indices-cac", payload)
  },
  updateIndiceCac(id, payload) {
    return api.put(`/indices-cac/${id}`, payload)
  },
  deleteIndiceCac(id) {
    return api.delete(`/indices-cac/${id}`)
  },

  //gastos

  getGastos: (tipo, mes, anio) =>
    api.get("/gastos", { params: { tipo, mes, anio } }),

  getGastosCatalogoFijos: () =>
    api.get("/gastos/catalogo-fijos"),

  createGastoFijoCatalogo: (data) =>
    api.post("/gastos/catalogo-fijos", data),

  updateGastoFijoCatalogo: (id, data) =>
    api.put(`/gastos/catalogo-fijos/${id}`, data),

  deleteGastoFijoCatalogo: (id) =>
    api.delete(`/gastos/catalogo-fijos/${id}`),

  syncGastosPeriodo: (payload) =>
    api.post("/gastos/bulk", payload),

  getGastosResumenPdf: (mes, anio, tipos) =>
    api.get("/gastos/resumen/pdf", {
      params: { mes, anio, tipos: Array.isArray(tipos) ? tipos.join(",") : tipos },
      responseType: "blob"
    }),

  createGasto: (data) =>
    api.post("/gastos", data),

  updateGasto: (id, data) =>
    api.put(`/gastos/${id}`, data),

  deleteGasto: (id) =>
    api.delete(`/gastos/${id}`),
}
