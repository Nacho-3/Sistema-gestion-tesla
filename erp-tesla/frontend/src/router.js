import { createRouter, createWebHistory } from "vue-router"
import Login from "./views/Login.vue"
import Dashboard from "./views/Dashboard.vue"
import Clientes from "./views/Clientes.vue"
import Obras from "./views/Obras.vue"
import Grupos from "./views/Grupos.vue"
import Empleados from "./views/Empleados.vue"
import Horas from "./views/Horas.vue"
import Sueldos from "./views/Sueldos.vue"
import Caja from "./views/Caja.vue"
import Presupuestos from "./views/Presupuestos.vue"
import Certificados from "./views/Certificados.vue"
import Facturas from "./views/Facturas.vue"

import { hasStoredSession } from "./session"

const routes = [
  { path: "/", component: Login },
  { path: "/dashboard", component: Dashboard },
  { path: "/clientes", component: Clientes },
  { path: "/obras", component: Obras },
  { path: "/grupos", component: Grupos },
  { path: "/empleados", component: Empleados },
  { path: "/horas", component: Horas },
  { path: "/sueldos", component: Sueldos },
  { path: "/caja", component: Caja },
  { path: "/presupuestos", component: Presupuestos },
  { path: "/certificados", component: Certificados },
  { path: "/facturas", component: Facturas },
  { path: "/gastos", component: () => import("./views/Gastos.vue") }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const session = hasStoredSession()

  if (to.path !== "/" && !session) {
    next("/")
  } else {
    next()
  }
})

export default router