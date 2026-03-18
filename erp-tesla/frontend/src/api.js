import axios from "axios"

const api = axios.create({
  baseURL: "http://localhost:3000",
  timeout: 10000 // 10 segundos
})

export default {
  // Auth
  login(email, password) {
    return api.post("/auth/login", { email, password })
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
  getMovimientosCaja(fecha_inicio, fecha_fin, tipo) {
    const params = new URLSearchParams()
    if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
    if (fecha_fin) params.append("fecha_fin", fecha_fin)
    if (tipo) params.append("tipo", tipo)
    return api.get(`/caja?${params.toString()}`)
  },

  getResumenCajaPdf(fecha_inicio, fecha_fin, tipo) {
    const params = new URLSearchParams()
    if (fecha_inicio) params.append("fecha_inicio", fecha_inicio)
    if (fecha_fin) params.append("fecha_fin", fecha_fin)
    if (tipo) params.append("tipo", tipo)
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
  }
}