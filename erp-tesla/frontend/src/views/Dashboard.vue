<script setup>
import { ref, onMounted, onUnmounted } from "vue"
import { useRouter } from "vue-router"
import api from "../api"
import socket from "../socket.js"
import LayoutShell from "../components/LayoutShell.vue"
import { formatHoursAsClock } from "../utils/hourFormat"

const router = useRouter()

// Regla de negocio: el dashboard trabaja siempre con estas 3 cajas fijas.
const CAJAS_DASHBOARD = Object.freeze([
  { key: "tesla", label: "Caja Tesla" },
  { key: "teslita", label: "Caja Teslita" },
  { key: "juani", label: "Caja Juani" },
])

const crearCajasMesDefault = () => ({
  tesla: { ingresos: 0, egresos: 0, saldo: 0 },
  teslita: { ingresos: 0, egresos: 0, saldo: 0 },
  juani: { ingresos: 0, egresos: 0, saldo: 0 },
})

const resumen = ref({
  obras_activas: 0,
  horas_mes: 0,
  sueldos_mes: 0,
  ingresos_mes: 0,
  egresos_mes: 0,
  cajas_mes: crearCajasMesDefault(),
  presupuestos_pendientes: []
})

const ultimosMovimientos = ref([])
let intervaloCambioMes = null
let claveMesActual = ""

const cargando = ref(false)
const error = ref("")

const irAObras = () => {
  router.push({ path: "/obras" })
}

const irAHoras = () => {
  router.push({ path: "/horas" })
}

const irASueldos = () => {
  router.push({ path: "/sueldos" })
}

const irACajaDashboard = (cajaCodigo) => {
  router.push({
    path: "/caja",
    query: { caja_codigo: String(cajaCodigo || "tesla").toLowerCase() },
  })
}


const irAmovimientoCaja = (movimiento) => {
  if (!movimiento?.id) return

  const query = {
    movimiento_id: String(movimiento.id)
  }

  if (movimiento.caja_codigo) {
    query.caja_codigo = String(movimiento.caja_codigo).toLowerCase()
  }

  router.push({
    path:"/caja",
    query,
  })
}

const irAEditarPresupuesto = (presupuesto) => {
  if (!presupuesto?.id) return

  router.push({
    path: "/presupuestos",
    query: {
      presupuesto_id: String(presupuesto.id)
    }
  })
}

const toNumber = (valor) => {
  const num = Number(valor)
  return Number.isFinite(num) ? num : 0
}

const normalizarCajasMes = (cajasMesApi) => {
  const origen = (cajasMesApi && typeof cajasMesApi === "object") ? cajasMesApi : {}
  const normalizado = crearCajasMesDefault()

  CAJAS_DASHBOARD.forEach(({ key }) => {
    const caja = origen[key] || {}
    normalizado[key] = {
      ingresos: toNumber(caja.ingresos),
      egresos: toNumber(caja.egresos),
      saldo: toNumber(caja.saldo),
    }
  })

  return normalizado
}

const getCajaResumen = (codigo) => {
  return resumen.value.cajas_mes?.[codigo] || { ingresos: 0, egresos: 0, saldo: 0 }
}

// Obtener mes y año actual
const getMesAnio = () => ({
  mes: new Date().getMonth() + 1,
  anio: new Date().getFullYear()
})

const getClaveMesActual = () => {
  const { mes, anio } = getMesAnio()
  return `${anio}-${String(mes).padStart(2, "0")}`
}

const resetearResumenMensual = () => {
  resumen.value.obras_activas = 0
  resumen.value.horas_mes = 0
  resumen.value.sueldos_mes = 0
  resumen.value.ingresos_mes = 0
  resumen.value.egresos_mes = 0
  resumen.value.cajas_mes = crearCajasMesDefault()
  resumen.value.presupuestos_pendientes = []
  ultimosMovimientos.value = []
}

const verificarCambioMes = async () => {
  const claveActual = getClaveMesActual()
  if (claveMesActual && claveMesActual !== claveActual) {
    claveMesActual = claveActual
    resetearResumenMensual()
    await cargarResumen()
    return
  }
  claveMesActual = claveActual
}

const cargarResumen = async () => {
  if (cargando.value) return
  cargando.value = true
  error.value = ""
  try {
    const { mes, anio } = getMesAnio()
    const res = await api.getDashboardResumen(mes, anio)
    const data = res?.data || {}

    resumen.value = {
      obras_activas: toNumber(data.obras_activas),
      horas_mes: toNumber(data.horas_mes),
      sueldos_mes: toNumber(data.sueldos_mes),
      ingresos_mes: toNumber(data.ingresos_mes),
      egresos_mes: toNumber(data.egresos_mes),
      cajas_mes: normalizarCajasMes(data.cajas_mes),
      presupuestos_pendientes: Array.isArray(data.presupuestos_pendientes) ? data.presupuestos_pendientes : [],
    }
    ultimosMovimientos.value = Array.isArray(data.ultimos_movimientos) ? data.ultimos_movimientos : []
  } catch (err) {
    console.error("Error al cargar resumen:", err)
    error.value = "Error al cargar datos del dashboard"
  } finally {
    cargando.value = false
  }
}

onMounted(async () => {
  claveMesActual = getClaveMesActual()
  await cargarResumen()
  intervaloCambioMes = setInterval(verificarCambioMes, 60 * 1000)

  // Escuchar cambios en tiempo real
  socket.on('obras:changed', cargarResumen)
  socket.on('liquidaciones:changed', cargarResumen)
  socket.on('horas:changed', cargarResumen)
  socket.on('caja:changed', cargarResumen)
  socket.on('presupuestos:changed', cargarResumen)
})

onUnmounted(() => {
  // Remover listeners cuando se desmonta el componente
  socket.off('obras:changed', cargarResumen)
  socket.off('liquidaciones:changed', cargarResumen)
  socket.off('horas:changed', cargarResumen)
  socket.off('caja:changed', cargarResumen)
  socket.off('presupuestos:changed', cargarResumen)
  if (intervaloCambioMes) {
    clearInterval(intervaloCambioMes)
    intervaloCambioMes = null
  }
})
</script>

<template>
  <LayoutShell
    title="Panel general"
    subtitle="Visión rápida de la operación y administración"
  >
    <section class="dashboard-main">
      <section class="dashboard-topbar">
        <div class="dashboard-topbar-copy">
          <span class="section-kicker">Resumen ejecutivo</span>
          <h2>Estado general de la operación</h2>
          <p>Seguí de un vistazo obras activas, horas acumuladas, masa salarial, cajas y los movimientos comerciales más recientes.</p>
        </div>
        <div class="dashboard-topbar-badge">
          <span>Mes en curso</span>
          <strong>{{ new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" }) }}</strong>
        </div>
      </section>

      <section class="grid-cards">
        <article
          class="stat-card stat-card-primary stat-card-clickable"
          role="button"
          tabindex="0"
          @click="irAObras"
          @keyup.enter="irAObras"
          @keyup.space.prevent="irAObras"
        >
          <span class="stat-kicker">Producción</span>
          <h2>Obras activas</h2>
          <p class="stat-value">{{ resumen.obras_activas }}</p>
          <p class="stat-caption">Proyectos actualmente en ejecución</p>
        </article>

        <article
          class="stat-card stat-card-hours stat-card-clickable"
          role="button"
          tabindex="0"
          @click="irAHoras"
          @keyup.enter="irAHoras"
          @keyup.space.prevent="irAHoras"
        >
          <span class="stat-kicker">Rendimiento</span>
          <h2>Horas del mes</h2>
          <p class="stat-value">{{ formatHoursAsClock(resumen.horas_mes) }}</p>
          <p class="stat-caption">Total de horas registradas</p>
        </article>

        <article
          class="stat-card stat-card-payroll stat-card-clickable"
          role="button"
          tabindex="0"
          @click="irASueldos"
          @keyup.enter="irASueldos"
          @keyup.space.prevent="irASueldos"
        >
          <span class="stat-kicker">Salarios</span>
          <h2>Sueldos a pagar</h2>
          <p class="stat-value">
            $ {{ resumen.sueldos_mes.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
          </p>
          <p class="stat-caption">Monto estimado del período actual</p>
        </article>

        <article
          v-for="caja in CAJAS_DASHBOARD"
          :key="caja.key"
          class="stat-card stat-card-caja stat-card-clickable"
          role="button"
          tabindex="0"
          @click="irACajaDashboard(caja.key)"
          @keyup.enter="irACajaDashboard(caja.key)"
          @keyup.space.prevent="irACajaDashboard(caja.key)"
        >
          <div class="stat-card-head">
            <div>
              <span class="stat-kicker">Caja</span>
              <h2>{{ caja.label }}</h2>
            </div>
          </div>
          <p class="stat-value saldo">
            $ {{ getCajaResumen(caja.key).saldo.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
          </p>
          <div class="caja-breakdown">
            <p class="stat-value ingresos">
              + $ {{ getCajaResumen(caja.key).ingresos.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
            </p>
            <p class="stat-value egresos">
              − $ {{ getCajaResumen(caja.key).egresos.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
            </p>
          </div>
          <p class="stat-caption">Saldo, ingresos y egresos de la caja</p>
        </article>
      </section>
      <section class="panel-secundario">
        <div class="panel-col">
          <div class="panel-head">
            <div>
              <span class="section-kicker">Caja</span>
              <h3>Últimos movimientos</h3>
            </div>
            <span class="panel-count">{{ ultimosMovimientos.length }}</span>
          </div>
          <template v-if="ultimosMovimientos.length">
            <ul class="movimientos-list">
              <li 
                v-for="m in ultimosMovimientos" 
                :key="m.id" 
                class="movimiento-item movimiento-item-clickable"
                role="button"
                tabindex="0"
                @click="irAmovimientoCaja(m)"
                @keyup.enter="irAmovimientoCaja(m)"
                @keyup.space.prevent="irAmovimientoCaja(m)"
              >
                <span class="mov-fecha">{{ new Date(m.fecha).toLocaleDateString('es-AR') }}</span>
                <span class="mov-detalle">{{ m.concepto ?? m.detalle }}</span>
                <span :class="['mov-monto', m.tipo]">
                  {{ m.tipo === 'ingreso' ? '+' : '−' }} $ {{ toNumber(m.monto_total ?? m.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 }) }}
                </span>
              </li>
            </ul>
          </template>
          <p v-else class="placeholder">Sin movimientos este mes.</p>
        </div>

        <div class="panel-col">
          <div class="panel-head">
            <div>
              <span class="section-kicker">Comercial</span>
              <h3>Presupuestos pendientes</h3>
            </div>
            <span class="panel-count">{{ resumen.presupuestos_pendientes.length }}</span>
          </div>
          <template v-if="resumen.presupuestos_pendientes.length">
            <ul class="movimientos-list">
              <li
                v-for="p in resumen.presupuestos_pendientes"
                :key="p.id"
                class="movimiento-item movimiento-item-clickable"
                role="button"
                tabindex="0"
                @click="irAEditarPresupuesto(p)"
                @keyup.enter="irAEditarPresupuesto(p)"
                @keyup.space.prevent="irAEditarPresupuesto(p)"
              >
                <span class="mov-fecha">{{ new Date(p.fecha).toLocaleDateString('es-AR') }}</span>
                <span class="mov-detalle">#{{ p.numero }} - {{ p.cliente }}</span>
                <span class="mov-monto">${{ toNumber(p.total).toLocaleString('es-AR', { minimumFractionDigits: 2 }) }}</span>
              </li>
            </ul>
          </template>
          <p v-else class="placeholder">Sin presupuestos pendientes.</p>
        </div>
      </section>

      <div v-if="cargando" class="overlay">
        <span>Cargando datos...</span>
      </div>
      <div v-if="error" class="overlay error">
        <span>{{ error }}</span>
      </div>
    </section>
  </LayoutShell>
</template>

<style scoped>
.dashboard-main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.dashboard-topbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.25rem;
  padding: 1.4rem 1.5rem;
  border-radius: 1.15rem;
  border: 1px solid rgba(96, 165, 250, 0.18);
  background:
    radial-gradient(circle at top right, rgba(59, 130, 246, 0.14), transparent 30%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.84));
}

.dashboard-topbar-copy {
  display: grid;
  gap: 0.35rem;
}

.section-kicker,
.stat-kicker {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.dashboard-topbar-copy h2 {
  margin: 0;
  color: #f8fafc;
  font-size: 1.55rem;
}

.dashboard-topbar-copy p {
  margin: 0;
  max-width: 66ch;
  color: #94a3b8;
  line-height: 1.5;
}

.dashboard-topbar-badge,
.panel-count
/*.caja-pill*/ {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.6rem 0.9rem;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: rgba(59, 130, 246, 0.1);
  color: #dbeafe;
  font-size: 0.8rem;
  font-weight: 700;
}

.dashboard-topbar-badge {
  flex-direction: column;
  align-items: flex-start;
  border-radius: 1rem;
  gap: 0.15rem;
}

.dashboard-topbar-badge span {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #93c5fd;
}

.dashboard-topbar-badge strong {
  text-transform: capitalize;
}

.grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.stat-card {
  position: relative;
  display: grid;
  gap: 0.45rem;
  padding: 1.3rem 1.4rem;
  border-radius: 1.05rem;
  background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.22), rgba(15, 23, 42, 0.96));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.35),
    0 0 0 1px rgba(15, 23, 42, 0.3);
  overflow: hidden;
}

.stat-card::after {
  content: "";
  position: absolute;
  width: 110px;
  height: 110px;
  right: -24px;
  top: -30px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(125, 211, 252, 0.12), transparent 66%);
}

.stat-card h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #d1d5db;
  position: relative;
  z-index: 1;
}

.stat-value {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  color: #f9fafb;
  position: relative;
  z-index: 1;
}

.stat-value.ingresos {
  color: #4ade80;
  font-size: 1.1rem;
}

.stat-value.egresos {
  color: #f97373;
  font-size: 1.1rem;
}

.stat-value.saldo {
  margin-bottom: 0.35rem;
  color: #93c5fd;
  font-size: 1.35rem;
}

.stat-caption {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: #9ca3af;
  position: relative;
  z-index: 1;
}

.stat-card-head,
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  position: relative;
  z-index: 1;
}

.caja-breakdown {
  display: grid;
  gap: 0.2rem;
  position: relative;
  z-index: 1;
}

.stat-card-primary {
  background: radial-gradient(circle at top left, rgba(14, 165, 233, 0.24), rgba(15, 23, 42, 0.96));
}

.stat-card-hours {
  background: radial-gradient(circle at top left, rgba(59, 130, 246, 0.24), rgba(15, 23, 42, 0.96));
}

.stat-card-payroll {
  background: radial-gradient(circle at top left, rgba(34, 197, 94, 0.18), rgba(15, 23, 42, 0.96));
}

.panel-secundario {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.panel-col {
  display: grid;
  gap: 1rem;
  padding: 1.3rem 1.4rem;
  border-radius: 1.05rem;
  background: radial-gradient(circle at top left, rgba(30, 64, 175, 0.22), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.35),
    0 0 0 1px rgba(15, 23, 42, 0.3);
  height: fit-content;
  align-self: start;
}

.panel-col h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #e5e7eb;
}

.placeholder {
  margin: 0;
  font-size: 0.9rem;
  color: #9ca3af;
}


.movimientos-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.movimiento-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.875rem;
  color: #d1d5db;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.85rem;
  background: rgba(255, 255, 255, 0.03);
  padding: 0.8rem 0.85rem;
}

.movimiento-item:last-child {
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.movimiento-item-clickable {
  cursor: pointer;
  transition: 
    transform 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.movimiento-item-clickable:hover,
.movimiento-item-clickable:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.22);
  outline: none;
}

.mov-fecha {
  color: #9ca3af;
  font-size: 0.8rem;
  white-space: nowrap;
}

.mov-detalle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mov-monto {
  font-weight: 600;
  white-space: nowrap;
}

.mov-monto.ingreso { color: #4ade80; }
.mov-monto.egreso  { color: #f97373; }

.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top, rgba(15, 23, 42, 0.7), rgba(15, 23, 42, 0.9));
  font-size: 0.95rem;
  color: #d1d5db;
  pointer-events: none;
}

.overlay.error {
  color: #fecaca;
}

@media (max-width: 1024px) {
  .grid-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-secundario {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .dashboard-topbar,
  .panel-head {
    flex-direction: column;
    align-items: stretch;
  }

  .grid-cards {
    grid-template-columns: 1fr;
  }

  .movimiento-item {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }
}

.stat-card-clickable {
  cursor: pointer;
  transition: 
    transform 0.2s ease,
    border-color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.stat-card-clickable:hover,
.stat-card-clickable:focus-visible {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.35);
  box-shadow:
    0 20px 40px rgba(15, 23, 42, 0.42),
    0 0 0 1px rgba(59, 130, 246, 0.2);
  outline: none;
}
</style>