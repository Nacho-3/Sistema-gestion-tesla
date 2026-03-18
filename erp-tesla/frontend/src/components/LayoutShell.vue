<script setup>
import { computed } from "vue"
import { useRouter, useRoute } from "vue-router"

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
  { label: "Facturas", path: "/facturas" }
]

const activePath = computed(() => route.path)

const irA = (path) => {
  if (activePath.value !== path) {
    router.push(path)
  }
}

const cerrarSesion = () => {
  localStorage.removeItem("session")
  router.push("/")
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">ERP TESLA</span>
        <span class="sidebar-subtitle">Panel</span>
      </div>
      <nav class="sidebar-nav">
        <button
          v-for="item in itemsMenu"
          :key="item.path"
          type="button"
          class="nav-item"
          :class="{ active: activePath === item.path }"
          @click="irA(item.path)"
        >
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <div class="content">
      <header class="header">
        <div class="header-left">
          <h1 class="title">{{ props.title }}</h1>
          <p v-if="props.subtitle" class="subtitle">
            {{ props.subtitle }}
          </p>
        </div>
        <div class="header-right">
          <button type="button" class="btn-logout" @click="cerrarSesion">
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
  min-height: 100vh;
  display: flex;
  background: radial-gradient(circle at top, #020617 0%, #000 60%);
  color: #e5e7eb;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.sidebar {
  width: 230px;
  padding: 1.5rem 1.2rem;
  border-right: 1px solid rgba(148, 163, 184, 0.3);
  background: linear-gradient(to bottom, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.94));
  box-shadow: 12px 0 35px rgba(15, 23, 42, 0.9);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  margin-bottom: 1.8rem;
}

.sidebar-title {
  display: block;
  font-size: 0.95rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #e5e7eb;
}

.sidebar-subtitle {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.8rem;
  color: #9ca3af;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-item {
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 0.75rem;
  padding: 0.55rem 0.75rem;
  background: transparent;
  color: #d1d5db;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.08s ease;
}

.nav-item:hover {
  background: rgba(30, 64, 175, 0.45);
  color: #f9fafb;
  transform: translateX(1px);
}

.nav-item.active {
  background: linear-gradient(135deg, #38bdf8, #2563eb);
  color: #f9fafb;
  box-shadow:
    0 10px 22px rgba(37, 99, 235, 0.5),
    0 0 0 1px rgba(191, 219, 254, 0.4);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 1.5rem 3rem 1.25rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.3);
  background: linear-gradient(to right, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.7));
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.85);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.header-right {
  display: flex;
  align-items: center;
}

.title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #f9fafb;
}

.subtitle {
  margin: 0.25rem 0 0;
  color: #9ca3af;
  font-size: 0.95rem;
}

.btn-logout {
  border: 1px solid rgba(148, 163, 184, 0.7);
  border-radius: 999px;
  padding: 0.45rem 0.95rem;
  background: rgba(15, 23, 42, 0.7);
  color: #e5e7eb;
  font-size: 0.85rem;
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
  padding: 2rem 3rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

@media (max-width: 1024px) {
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
    padding-inline: 1.25rem;
  }

  .main {
    padding: 1.5rem 1.25rem 2.5rem;
  }
}
</style>

