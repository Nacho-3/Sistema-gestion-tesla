<script setup>
import { ref, onMounted } from "vue"
import api from "../api"
import LayoutShell from "../components/LayoutShell.vue"

// Estado
const clientes = ref([])
const loading = ref(false)
const error = ref("")
const showForm = ref(false)
const editingId = ref(null)
const vistaActual = ref("lista") // "lista" o "ficha"
const clienteSeleccionado = ref(null)
const obrasCliente = ref([])
const downloadingPdf = ref(false)

// Formulario
const form = ref({
  razon_social: "",
  cuit: "",
  direccion: "",
  telefono: "",
  email: ""
})

// Cargar clientes
const loadClientes = async () => {
  loading.value = true
  error.value = ""
  try {
    const res = await api.getClientes()
    clientes.value = res.data || []
  } catch (err) {
    error.value = "Error al cargar clientes"
    console.error(err)
  } finally {
    loading.value = false
  }
}

// Ver ficha del cliente
const verFicha = async (cliente) => {
  clienteSeleccionado.value = cliente
  vistaActual.value = "ficha"
  
  // Cargar obras del cliente
  loading.value = true
  try {
    const resObras = await api.getObras()
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
}

// Abrir formulario
const openForm = (cliente = null) => {
  if (cliente) {
    editingId.value = cliente.id
    form.value = { ...cliente }
  } else {
    editingId.value = null
    form.value = {
      razon_social: "",
      cuit: "",
      direccion: "",
      telefono: "",
      email: ""
    }
  }
  showForm.value = true
}

// Cerrar formulario
const closeForm = () => {
  showForm.value = false
  editingId.value = null
  form.value = {
    razon_social: "",
    cuit: "",
    direccion: "",
    telefono: "",
    email: ""
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
      await api.updateCliente(editingId.value, form.value)
    } else {
      await api.createCliente(form.value)
    }
    await loadClientes()
    
    // Si estamos editando el cliente seleccionado, actualizarlo
    if (clienteSeleccionado.value && editingId.value === clienteSeleccionado.value.id) {
      clienteSeleccionado.value = { ...clienteSeleccionado.value, ...form.value }
    }
    
    closeForm()
  } catch (err) {
    error.value = editingId.value ? "Error al actualizar cliente" : "Error al crear cliente"
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
    error.value = "Error al eliminar cliente"
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
    error.value = "Error al generar la ficha PDF"
    console.error(err)
  } finally {
    downloadingPdf.value = false
  }
}

onMounted(() => {
  loadClientes()
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
                <th>Razón Social</th>
                <th>CUIT</th>
                <th>Teléfono</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cliente in clientes" :key="cliente.id">
                <td>{{ cliente.razon_social }}</td>
                <td>{{ cliente.cuit || "-" }}</td>
                <td>{{ cliente.telefono || "-" }}</td>
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
          <h2>{{ clienteSeleccionado.razon_social }}</h2>
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
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Presupuestos</p>
        </div>

        <!-- Presupuestos aceptados -->
        <div class="ficha-seccion">
          <h3>✅ Presupuestos aceptados</h3>
          <p class="sin-datos">Funcionalidad disponible cuando se implemente el módulo de Presupuestos</p>
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
              <span>Razón Social *</span>
              <input
                v-model="form.razon_social"
                type="text"
                placeholder="Nombre de la empresa"
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
                type="email"
                placeholder="contacto@empresa.com"
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

