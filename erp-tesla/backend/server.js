import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import authRoutes from "./auth.js"
import clientesRoutes from "./routes/clientes.js"
import obrasRoutes from "./routes/obras.js"
import gruposRoutes from "./routes/grupos.js"
import empleadosRoutes from "./routes/empleados.js"
import horasRoutes from "./routes/horas.js"
import liquidacionesRoutes from "./routes/liquidaciones.js"
import cajaRoutes from "./routes/caja.js"
import presupuestosRoutes from "./routes/presupuestos.js"


dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())
app.use("/auth", authRoutes)
app.use("/clientes", clientesRoutes)
app.use("/obras", obrasRoutes)
app.use("/grupos", gruposRoutes)
app.use("/empleados", empleadosRoutes)
app.use("/horas", horasRoutes)
app.use("/liquidaciones", liquidacionesRoutes)
app.use("/caja", cajaRoutes)
app.use("/presupuestos", presupuestosRoutes)

app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000")
})