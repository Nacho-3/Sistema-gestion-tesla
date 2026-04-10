import axios from "axios"
import { clearStoredSession } from "./session"

const isViteDevServer = window.location.port === "5173"
const DEFAULT_API_BASE_URL = isViteDevServer
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : "/api"
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 10000 // 10 segundos
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
  getObras() {
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

  getResumenHorasPdf(mes, anio) {
    const params = new URLSearchParams()
    if (mes) params.append("mes", mes)
    if (anio) params.append("anio", anio)
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
  getMovimientosCaja(fecha_inicio, fecha_fin, tipo, caja_codigo) {
    const params = new URLSearchParams()
    if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
    if (fecha_fin) params.append("fecha_fin", fecha_fin)
    if (tipo) params.append("tipo", tipo)
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    return api.get(`/caja?${params.toString()}`)
  },

  getResumenCajaPdf(fecha_inicio, fecha_fin, tipo, caja_codigo) {
    const params = new URLSearchParams()
    if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
    if (fecha_fin) params.append("fecha_fin", fecha_fin)
    if (tipo) params.append("tipo", tipo)
    if (caja_codigo) params.append("caja_codigo", caja_codigo)
    return api.get(`/caja/resumen/pdf?${params.toString()}`, { responseType: "blob" })
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

  updateMovimientoCaja(id, payload) {
    return api.put(`/caja/${id}`, payload)
  },

  deleteMovimientoCaja(id) {
    return api.delete(`/caja/${id}`)
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
  }
}