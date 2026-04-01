<script setup>
import { ref, onMounted, onUnmounted } from "vue"
import api, { extractApiErrorMessage } from "../api"
import LayoutShell from "../components/LayoutShell.vue"
import socket from '../socket.js'

// Estado
const clientes = ref([])
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const editingId = ref(null)
const vistaActual = ref("lista") // "lista" o "ficha"
const clienteSeleccionado = ref(null)
const obrasCliente = ref([])
const presupuestosCliente = ref([])
const presupuestosAceptados = ref([])
const downloadingPdf = ref(false)

// Formulario
const form = ref({
  empresa: "",
  razon_social: "",
  cuit: "",
  direccion: "",
  telefono: "",
  email: "",
  iva: "Responsable Inscripto"
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

const cargarPresupuestosCliente = async (clienteId) => {
  const resPresupuestos = await api.getPresupuestos()
  const presupuestos = (resPresupuestos.data || []).filter(p => Number(p.cliente_id) === Number(clienteId))
  const isAceptado = (p) => ["aprobado", "aceptado"].includes(String(p.estado || "").toLowerCase())
  presupuestosAceptados.value = presupuestos.filter(isAceptado)
  presupuestosCliente.value = presupuestos.filter(p => !isAceptado(p))
}

// Ver ficha del cliente
const verFicha = async (cliente) => {
  clienteSeleccionado.value = cliente
  vistaActual.value = "ficha"
  
  // Cargar obras del cliente
  loading.value = true
  try {
    const [resObras] = await Promise.all([
      api.getObras(),
      cargarPresupuestosCliente(cliente.id)
    ])
    obrasCliente.value = resObras.data?.filter(o => o.cliente_id === cliente.id) || []
  } catch (err) {
    console.error("Error al cargar datos del cliente:", err)
  } finally {
    loading.value = false
  }
}

// Volver a la lista
const volverALista = () => {
  vistaActual.value = "lista"
  clienteSeleccionado.value = null
  obrasCliente.value = []
  presupuestosCliente.value = []
  presupuestosAceptados.value = []
}

const handlePresupuestosChanged = () => {
  if (vistaActual.value === "ficha" && clienteSeleccionado.value?.id) {
    cargarPresupuestosCliente(clienteSeleccionado.value.id).catch((err) => {
      console.error("Error al actualizar presupuestos del cliente:", err)
    })
  }
}

// Abrir formulario
const openForm = (cliente = null) => {
  if (cliente) {
    editingId.value = cliente.id
    form.value = { ...cliente }
  } else {
    editingId.value = null
    form.value = {
      empresa: "",
      razon_social: "",
      cuit: "",
      direccion: "",
      telefono: "",
      email: "",
      iva: "Responsable Inscripto"
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
    iva: "Responsable Inscripto"
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
    if (editingId.value) {
      await api.updateCliente(editingId.value, { ...form.value })
    } else {
      await api.createCliente({ ...form.value })
    }
    await loadClientes()
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

onMounted(() => {
  loadClientes()
  socket.on('clientes:changed', loadClientes)
  socket.on('presupuestos:changed', handlePresupuestosChanged)
})
onUnmounted(() => {
  socket.off('clientes:changed', loadClientes)
  socket.off('presupuestos:changed', handlePresupuestosChanged)
})
</script>

<template>
  <LayoutShell
    title="Clientes"
    subtitle="Administración de clientes y sus obras"
  >
    <div class="clientes-container">
      <!-- VISTA: LISTA DE CLIENTES -->
      <div v-if="vistaActual === 'lista'">
        <!-- Botón nuevo cliente -->
        <div class="clientes-header">
          <button class="btn-primary" @click="openForm()">
            + Nuevo cliente
          </button>
        </div>

        <!-- Mensaje de error -->
        <div v-if="error" class="error-alert">
          {{ error }}
        </div>

        <!-- Tabla de clientes -->
        <div v-if="!loading && clientes.length > 0" class="clientes-table">
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
              <tr v-for="cliente in clientes" :key="cliente.id">
                <td>{{ cliente.empresa || "-" }}</td>
                <td>{{ cliente.razon_social }}</td>
                <td>{{ cliente.cuit || "-" }}</td>
                <td>{{ cliente.telefono || "-" }}</td>
                <td>{{ cliente.iva || "-" }}</td>
                <td>
                  <div class="acciones">
                    <button class="btn-ficha" @click="verFicha(cliente)">
                      📋 Ver ficha
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Estado vacío -->
        <div v-if="!loading && clientes.length === 0" class="empty-state">
          <p>No hay clientes registrados</p>
          <button class="btn-primary" @click="openForm()">
            Crear primer cliente
          </button>
        </div>

        <!-- Cargando -->
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
          <h3>✅ Presupuestos aceptados</h3>
          <div v-if="presupuestosAceptados.length > 0" class="presupuestos-lista">
            <div v-for="p in presupuestosAceptados" :key="p.id" class="presupuesto-card">
              <div class="presupuesto-head">
                <h4>#{{ p.numero }} - {{ p.obra || 'Sin obra' }}</h4>
                <span class="presupuesto-estado estado-aprobado">{{ p.estado }}</span>
              </div>
              <div class="presupuesto-detalles">
                <span>{{ new Date(p.fecha).toLocaleDateString('es-AR') }}</span>
                <span>$ {{ Number(p.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 }) }}</span>
              </div>
            </div>
          </div>
          <p v-else class="sin-datos">No hay presupuestos aceptados para este cliente</p>
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
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Caja</p>
        </div>

        <!-- Cargando -->
        <div v-if="loading" class="loading-overlay">
          Cargando datos...
        </div>
      </div>

      <!-- Modal formulario -->
      <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
        <div class="modal">
          <div class="modal-header">
            <h3>{{ editingId ? "Editar cliente" : "Nuevo cliente" }}</h3>
            <button class="btn-close" @click="closeForm">×</button>
          </div>


          <form @submit.prevent="saveCliente" class="modal-form">
            <label class="form-group">
              <span>Empresa</span>
              <input
                v-model="form.empresa"
                type="text"
                placeholder="Nombre comercial (opcional)"
              />
            </label>
            <label class="form-group">
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

            <label class="form-group">
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
    </div>
  </LayoutShell>
</template>

<style scoped>
.clientes-container {
  padding: 1.5rem;
}

.clientes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.error-alert {
  padding: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid #ef4444;
  border-radius: 0.5rem;
  color: #fecaca;
  margin-bottom: 1.5rem;
}

.clientes-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
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
  background-color: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.5rem;
  color: #94a3b8;
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
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  background-color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 130%;
  max-width: 530px;
  max-height: 96vh;
  overflow-y: auto;
  box-shadow: 0 40px 25px -5px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.modal-header h3 {
  margin: 0;
  color: #e2e8f0;
  font-size: 1.25rem;
}

.btn-close {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s;
}

.btn-close:hover {
  color: #cbd5e1;
}

.modal-form {
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group span {
  font-size: 0.875rem;
  font-weight: 500;
  color: #cbd5e1;
}

.form-group input {
  padding: 0.5rem 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #3b82f6;
  background-color: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group select {
  padding: 0.5rem 0.75rem;
  background-color: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 0.375rem;
  color: #e2e8f0;
  font-size: 0.875rem;
  transition: all 0.2s;
  cursor: pointer;
}

.form-group select:focus {
  outline: none;
  border-color: #3b82f6;
  background-color: rgba(30, 41, 59, 1);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-group select option {
  background-color: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
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
</style>

