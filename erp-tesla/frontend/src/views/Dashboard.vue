<script setup>
import { ref, onMounted } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"

const resumen = ref({
  obras_activas: 0,
  horas_mes: 0,
  sueldos_mes: 0,
  ingresos_mes: 0,
  egresos_mes: 0
})

const ultimosMovimientos = ref([])

const cargando = ref(false)
const error = ref("")

const toNumber = (valor) => {
  const num = Number(valor)
  return Number.isFinite(num) ? num : 0
}

const cargarResumen = async () => {
  cargando.value = true
  error.value = ""
  try {
    const mesActual = new Date().getMonth() + 1
    const anioActual = new Date().getFullYear()

    // Cargar obras activas
    const obrasRes = await api.getObras()
    resumen.value.obras_activas = obrasRes.data?.length || 0

    // Cargar horas del mes
    const horasRes = await api.getHoras(mesActual, anioActual)
    const totalHoras = (horasRes.data || []).reduce(
      (sum, h) => sum + toNumber(h.cantidad_horas ?? h.horas_trabajadas ?? h.cantidad_hora ?? h.horas),
      0
    )
    resumen.value.horas_mes = totalHoras

    // Cargar caja del mes
    const primerDia = `${anioActual}-${String(mesActual).padStart(2, '0')}-01`
    const ultimoDia = new Date(anioActual, mesActual, 0).toISOString().slice(0, 10)
    const cajaRes = await api.getMovimientosCaja(primerDia, ultimoDia)
    const { totales, movimientos } = cajaRes.data || {}
    resumen.value.ingresos_mes = toNumber(totales?.totalIngresos)
    resumen.value.egresos_mes = toNumber(totales?.totalEgresos)
    ultimosMovimientos.value = (movimientos || []).slice(0, 5)

    // Cargar sueldos del mes
    const liqRes = await api.getLiquidaciones(mesActual, anioActual)
    resumen.value.sueldos_mes = (liqRes.data || []).reduce(
      (sum, l) => sum + toNumber(l.total), 0
    )

  } catch (err) {
    console.error("Error al cargar resumen:", err)
    error.value = "Error al cargar datos del dashboard"
  } finally {
    cargando.value = false
  }
}

onMounted(async () => {
  await cargarResumen()
})
</script>

<template>
  <LayoutShell
    title="Panel general"
    subtitle="Visión rápida de la operación y administración"
  >
    <section class="dashboard-main">
      <section class="grid-cards">
        <article class="stat-card">
          <h2>Obras activas</h2>
          <p class="stat-value">{{ resumen.obras_activas }}</p>
          <p class="stat-caption">Proyectos actualmente en ejecución</p>
        </article>

        <article class="stat-card">
          <h2>Horas del mes</h2>
          <p class="stat-value">{{ resumen.horas_mes.toLocaleString("es-AR") }}</p>
          <p class="stat-caption">Total de horas registradas</p>
        </article>

        <article class="stat-card">
          <h2>Sueldos a pagar</h2>
          <p class="stat-value">
            $ {{ resumen.sueldos_mes.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
          </p>
          <p class="stat-caption">Monto estimado del período actual</p>
        </article>

        <article class="stat-card">
          <h2>Caja del mes</h2>
          <p class="stat-value ingresos">
            + $ {{ resumen.ingresos_mes.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
          </p>
          <p class="stat-value egresos">
            − $ {{ resumen.egresos_mes.toLocaleString("es-AR", { minimumFractionDigits: 2 }) }}
          </p>
          <p class="stat-caption">Ingresos y egresos registrados</p>
        </article>
      </section>

      <section class="panel-secundario">
        <div class="panel-col">
          <h3>Últimos movimientos de caja</h3>
          <template v-if="ultimosMovimientos.length">
            <ul class="movimientos-list">
              <li v-for="m in ultimosMovimientos" :key="m.id" class="movimiento-item">
                <span class="mov-fecha">{{ new Date(m.fecha).toLocaleDateString('es-AR') }}</span>
                <span class="mov-detalle">{{ m.concepto ?? m.detalle }}</span>
                <span :class="['mov-monto', m.tipo]">{{ m.tipo === 'ingreso' ? '+' : '−' }} $ {{ toNumber(m.monto_total).toLocaleString('es-AR', { minimumFractionDigits: 2 }) }}</span>
              </li>
            </ul>
          </template>
          <p v-else class="placeholder">Sin movimientos este mes.</p>
        </div>

        <div class="panel-col">
          <h3>Presupuestos pendientes</h3>
          <p class="placeholder">
            Próximamente se listarán los presupuestos en estado pendiente de respuesta.
          </p>
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
  gap: 2rem;
}
.grid-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.4rem;
}

.stat-card {
  padding: 1.3rem 1.4rem;
  border-radius: 1rem;
  background: radial-gradient(circle at top left, rgba(37, 99, 235, 0.5), rgba(15, 23, 42, 0.96));
  border: 1px solid rgba(75, 85, 99, 0.85);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.9),
    0 0 0 1px rgba(15, 23, 42, 0.8);
}

.stat-card h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  font-weight: 500;
  color: #d1d5db;
}

.stat-value {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 600;
  color: #f9fafb;
}

.stat-value.ingresos {
  color: #4ade80;
  font-size: 1.1rem;
}

.stat-value.egresos {
  color: #f97373;
  font-size: 1.1rem;
}

.stat-caption {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: #9ca3af;
}

.panel-secundario {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem;
}

.panel-col {
  padding: 1.5rem 1.6rem;
  border-radius: 1rem;
  background: radial-gradient(circle at top left, rgba(30, 64, 175, 0.45), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(75, 85, 99, 0.85);
  box-shadow:
    0 18px 38px rgba(15, 23, 42, 0.9),
    0 0 0 1px rgba(15, 23, 42, 0.8);
}

.panel-col h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 500;
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
  gap: 0.55rem;
}

.movimiento-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.875rem;
  color: #d1d5db;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  padding-bottom: 0.45rem;
}

.movimiento-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
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
  .dashboard-main {
    padding-inline: 1.5rem;
  }

  .grid-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-secundario {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .dashboard-header {
    padding-inline: 1.25rem;
  }

  .dashboard-main {
    padding: 1.5rem 1.25rem 2.5rem;
  }

  .grid-cards {
    grid-template-columns: 1fr;
  }
}
</style>