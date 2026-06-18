<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useRouter, useRoute } from "vue-router"
import { connectAuthenticatedSocket, disconnectSocket } from "../socket.js"
import { clearStoredSession, hasStoredSession } from "../session"
import api from "../api"

const props = defineProps({
  title: {
    type: String,
    required: true
  },
  subtitle: {
    type: String,
    default: ""
  }
})

const router = useRouter()
const route = useRoute()
const backupRunning = ref(false)
const backendHealth = ref({
  state: "checking",
  title: "Verificando backend",
  detail: "Chequeando conexión con el servidor",
  checkedAt: null,
})
let healthIntervalId = null

const itemsMenu = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Clientes", path: "/clientes" },
  { label: "Obras", path: "/obras" },
  { label: "Grupos", path: "/grupos" },
  { label: "Empleados", path: "/empleados" },
  { label: "Horas", path: "/horas" },
  { label: "Sueldos", path: "/sueldos" },
  { label: "Caja", path: "/caja" },
  { label: "Presupuestos", path: "/presupuestos" },
  { label: "Certificados", path: "/certificados" },
  { label: "Índices CAC", path: "/indices-cac" },
  { label: "Facturas", path: "/facturas" },
  { label: "Gastos", path: "/gastos" }
]

const activePath = computed(() => route.path)
const currentMenuItem = computed(() => itemsMenu.find((item) => item.path === activePath.value) || null)
const healthCheckedLabel = computed(() => {
  if (!backendHealth.value.checkedAt) return "Sin chequeo reciente"
  return `Último chequeo ${backendHealth.value.checkedAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`
})

const irA = (path) => {
  if (activePath.value !== path) {
    router.push(path)
  }
}

const cerrarSesion = async () => {
  try {
    await api.logout()
  } catch {
    // no-op
  }
  disconnectSocket()
  clearStoredSession()
  router.push("/")
}

const generarBackup = async () => {
  if (backupRunning.value) return

  backupRunning.value = true
  try {
    const { data } = await api.createBackup()
    const destino = data?.filePath ? `\n${data.filePath}` : ""
    window.alert(`Backup generado correctamente.${destino}`)
  } catch (error) {
    const message = error?.response?.data?.error || "No se pudo generar el backup"
    window.alert(message)
  } finally {
    backupRunning.value = false
  }
}

const actualizarEstadoBackend = async () => {
  try {
    const { data } = await api.getHealth()
    const dbOk = String(data?.db || "").toLowerCase() === "ok"
    backendHealth.value = {
      state: dbOk ? "healthy" : "degraded",
      title: dbOk ? "Backend operativo" : "Backend degradado",
      detail: dbOk ? "Servidor y base de datos respondiendo" : "Servidor activo con problemas en base de datos",
      checkedAt: new Date(),
    }
  } catch (error) {
    backendHealth.value = {
      state: "down",
      title: "Backend caído",
      detail: "No responde el servidor. Conviene revisar o reiniciar.",
      checkedAt: new Date(),
    }
  }
}

onMounted(() => {
  if (hasStoredSession()) {
    connectAuthenticatedSocket()
  }

  actualizarEstadoBackend()
  healthIntervalId = window.setInterval(actualizarEstadoBackend, 30000)
})

onUnmounted(() => {
  if (healthIntervalId) {
    window.clearInterval(healthIntervalId)
    healthIntervalId = null
  }
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-brand-mark">T</div>
        <div class="sidebar-brand-copy">
          <span class="sidebar-title">ERP TESLA LAB</span>
          <span class="sidebar-subtitle">Panel de cambios y pruebas</span>
        </div>
      </div>

      <div class="sidebar-section-label">Navegacion principal</div>

      <nav class="sidebar-nav">
        <button
          v-for="item in itemsMenu"
          :key="item.path"
          type="button"
          class="nav-item"
          :class="{ active: activePath === item.path }"
          @click="irA(item.path)"
        >
          <span class="nav-item-label">{{ item.label }}</span>
          <span class="nav-item-indicator"></span>
        </button>
      </nav>

      <div class="sidebar-footer-card">
        <span class="sidebar-footer-kicker">Modulo actual</span>
        <strong>{{ currentMenuItem?.label || props.title }}</strong>
        <small>Navegá entre áreas desde este panel sin salir de la operación activa.</small>
      </div>
    </aside>

    <div class="content">
      <header class="header">
        <div class="header-left">
          <div class="header-eyebrow-row">
            <span class="header-kicker">Panel Tesla</span>
            <span class="header-module-pill">{{ currentMenuItem?.label || props.title }}</span>
          </div>
          <h1 class="title">{{ props.title }}</h1>
          <p v-if="props.subtitle" class="subtitle">
            {{ props.subtitle }}
          </p>
        </div>
        <div class="header-right">
          <div class="header-status-card" :class="`header-status-card-${backendHealth.state}`">
            <span class="status-dot"></span>
            <div>
              <strong>{{ backendHealth.title }}</strong>
              <small>{{ backendHealth.detail }}</small>
            </div>
            <span class="header-status-meta">{{ healthCheckedLabel }}</span>
          </div>
          <button type="button" class="btn-backup header-action-btn" :disabled="backupRunning" @click="generarBackup">
            {{ backupRunning ? "Generando backup..." : "Backup manual" }}
          </button>
          <button type="button" class="btn-logout header-action-btn" @click="cerrarSesion">
            Cerrar sesión
          </button>
        </div>
      </header>

      <main class="main">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  height: 100vh;
  display: flex;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 22%),
    radial-gradient(circle at top, rgba(14, 165, 233, 0.08), transparent 18%),
    linear-gradient(180deg, #040816 0%, #020617 45%, #02040a 100%);
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sidebar {
  width: 268px;
  padding: 1.35rem 1.1rem 1.15rem;
  border-right: 1px solid rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.16), transparent 26%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.95));
  box-shadow: 18px 0 42px rgba(2, 6, 23, 0.55);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 1rem;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.35rem 0.25rem 0.8rem;
}

.sidebar-brand-mark {
  width: 2.85rem;
  height: 2.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.95rem;
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  color: #eff6ff;
  font-size: 1.2rem;
  font-weight: 800;
  box-shadow: 0 16px 30px -18px rgba(37, 99, 235, 0.85);
}

.sidebar-brand-copy {
  display: grid;
  gap: 0.2rem;
}

.sidebar-title {
  display: block;
  font-size: 0.9rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #f8fafc;
  font-weight: 800;
}

.sidebar-subtitle {
  display: block;
  font-size: 0.8rem;
  color: #8ea2c7;
}

.sidebar-section-label {
  padding: 0 0.35rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.nav-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 0.95rem;
  padding: 0.8rem 0.9rem;
  background: rgba(255, 255, 255, 0.02);
  color: #d8e1ee;
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background-color 0.16s ease, color 0.16s ease, transform 0.12s ease, border-color 0.16s ease, box-shadow 0.16s ease;
}

.nav-item-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.nav-item-indicator {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.34);
  transition: background-color 0.16s ease, transform 0.16s ease;
}

.nav-item:hover {
  background: rgba(30, 64, 175, 0.22);
  border-color: rgba(96, 165, 250, 0.18);
  color: #f9fafb;
  transform: translateX(1px);
}

.nav-item:hover .nav-item-indicator {
  background: rgba(125, 211, 252, 0.8);
}

.nav-item.active {
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  color: #f9fafb;
  box-shadow:
    0 10px 22px rgba(37, 99, 235, 0.5),
    0 0 0 1px rgba(191, 219, 254, 0.4);
  border-color: rgba(191, 219, 254, 0.4);
}

.nav-item.active .nav-item-indicator {
  background: #eff6ff;
  transform: scale(1.15);
}

.sidebar-footer-card {
  margin-top: auto;
  display: grid;
  gap: 0.35rem;
  padding: 1rem;
  border-radius: 1rem;
  border: 1px solid rgba(96, 165, 250, 0.14);
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.72), rgba(15, 23, 42, 0.94));
}

.sidebar-footer-kicker {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.sidebar-footer-card strong {
  color: #f8fafc;
}

.sidebar-footer-card small {
  color: #8ea2c7;
  line-height: 1.45;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.header {
  padding: 1.35rem 2.35rem 1.2rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.12), transparent 28%),
    linear-gradient(to right, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.82));
  box-shadow: 0 14px 34px rgba(2, 6, 23, 0.42);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.header-eyebrow-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex-wrap: wrap;
}

.header-kicker {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.header-module-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: rgba(59, 130, 246, 0.1);
  color: #dbeafe;
  font-size: 0.78rem;
  font-weight: 700;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.header-status-card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.65rem 0.9rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(30, 41, 59, 0.44);
}

.header-status-card-healthy {
  border-color: rgba(74, 222, 128, 0.18);
  background: linear-gradient(180deg, rgba(20, 83, 45, 0.18), rgba(15, 23, 42, 0.44));
}

.header-status-card-degraded {
  border-color: rgba(250, 204, 21, 0.22);
  background: linear-gradient(180deg, rgba(113, 63, 18, 0.2), rgba(15, 23, 42, 0.44));
}

.header-status-card-down {
  border-color: rgba(248, 113, 113, 0.24);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.22), rgba(15, 23, 42, 0.44));
}

.header-status-card-checking {
  border-color: rgba(125, 211, 252, 0.16);
}

.header-status-card strong {
  display: block;
  color: #f8fafc;
  font-size: 0.84rem;
}

.header-status-card small {
  display: block;
  color: #8ea2c7;
  font-size: 0.76rem;
}

.header-status-meta {
  margin-left: 0.4rem;
  padding-left: 0.7rem;
  border-left: 1px solid rgba(148, 163, 184, 0.12);
  color: #8ea2c7;
  font-size: 0.72rem;
  white-space: nowrap;
}

.status-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: #7dd3fc;
  box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.1);
}

.header-status-card-healthy .status-dot {
  background: #4ade80;
  box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.12);
}

.header-status-card-degraded .status-dot {
  background: #facc15;
  box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.12);
}

.header-status-card-down .status-dot {
  background: #f87171;
  box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.14);
}

.title {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #f9fafb;
}

.subtitle {
  margin: 0.1rem 0 0;
  color: #94a3b8;
  font-size: 0.98rem;
  line-height: 1.45;
}

.btn-backup,
.btn-logout {
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 0.95rem;
  padding: 0.7rem 1rem;
  color: #e5e7eb;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  transition:
    background-color 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    transform 0.08s ease,
    box-shadow 0.1s ease;
}

.header-action-btn {
  min-height: 42px;
}

.btn-backup {
  background: linear-gradient(180deg, rgba(21, 128, 61, 0.18), rgba(20, 83, 45, 0.18));
  border-color: rgba(74, 222, 128, 0.28);
  color: #dcfce7;
}

.btn-backup:hover {
  background: rgba(21, 128, 61, 0.28);
  border-color: rgba(74, 222, 128, 0.8);
  color: #f0fdf4;
  box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.35);
  transform: translateY(-1px);
}

.btn-backup:disabled {
  opacity: 0.7;
  cursor: wait;
  transform: none;
}

.btn-logout {
  background: rgba(15, 23, 42, 0.72);
}

.btn-logout:hover {
  background: rgba(220, 38, 38, 0.15);
  border-color: rgba(248, 113, 113, 0.9);
  color: #fecaca;
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.5);
  transform: translateY(-1px);
}

.btn-logout:active {
  transform: translateY(0);
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.3);
}

.main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 1.85rem 2.35rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

@media (max-width: 1024px) {
  .sidebar {
    width: 232px;
  }

  .header {
    padding-inline: 1.5rem;
  }

  .main {
    padding-inline: 1.5rem;
  }
}

@media (max-width: 640px) {
  .sidebar {
    display: none;
  }

  .header {
    padding-block: 1.1rem;
    padding-inline: 1.25rem;
    align-items: flex-start;
    flex-direction: column;
  }

  .header-right {
    width: 100%;
  }

  .header-status-card,
  .header-action-btn {
    width: 100%;
    justify-content: center;
  }

  .header-status-meta {
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  }

  .title {
    font-size: 1.7rem;
  }

  .main {
    padding: 1.5rem 1.25rem 2.5rem;
  }
}
</style>

