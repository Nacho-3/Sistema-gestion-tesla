<script setup>
import {ref, watch, onMounted} from "vue"
import api from "../api";
import LayoutShell from "../components/LayoutShell.vue";

const mes = ref(new Date().getMonth() + 1)
const anio = ref(new Date().getFullYear())
const tipos = ref([
    {key: "tesla", titulo: "Gastos Tesla"},
    {key: "facu", titulo: "Gastos Facu"},
    {key: "juani", titulo: "Gastos Juani"},
])

const tiposVisibles = ref(["tesla", "facu", "juani"])

const gastos = ref({tesla: [], facu: [], juani: []})
const loading = ref(false)
const error = ref("")
const guardando = ref(false)
const generandoPdf = ref(false)
const showResumenModal = ref(false)

const showForm = ref(false)
const editandoID = ref(null)
const form = ref({
    tipo: "tesla",
    mes: mes.value,
    anio: anio.value,
    descripcion: "",
    iva_impuesto: 0,
    subtotal: 0,
    total: 0,
    pago_tesla: 0
})

const resetForm = (tipo = "tesla") => {
    form.value = {
        tipo,
        mes: mes.value,
        anio: anio.value,
        descripcion: "",
        iva_impuesto: 0,
        subtotal: 0,
        total: 0,
        pago_tesla: 0
    }
    editandoID.value = null
}

const formatCurrency = (value) =>
    `$ ${Number(value || 0).toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`

const cargarGastos = async () =>{
    loading.value=true
    error.value=""
    try {
        const [tesla, facu, juani] = await Promise.all([
            api.getGastos("tesla", mes.value, anio.value),
            api.getGastos("facu", mes.value, anio.value),
            api.getGastos("juani", mes.value, anio.value)
        ])
        gastos.value.tesla = tesla.data || []
        gastos.value.facu = facu .data || []
        gastos.value.juani = juani .data || []
    } catch (err) {
        error.value = "Error al cargar gastos: " + (err?.response?.data?.error || err.message)
    } finally {
        loading.value=false
    }
}

const eliminarGasto = async (id, tipo) => {
    if (!confirm("¿Eliminar este gasto?")) return
    await api.deleteGasto(id)
    gastos.value[tipo] = gastos.value[tipo].filter(g => g.id !== id)
}

const abrirForm = (tipo, gasto = null) => {
    if (!gasto){
        resetForm(tipo)
    } else{
        editandoID.value = gasto.id
        form.value = {
            tipo,
            mes: gasto.mes ?? mes.value,
            anio: gasto.anio ?? anio.value,
            descripcion: gasto.descripcion || "",
            iva_impuesto: Number(gasto.iva_impuesto || 0),
            subtotal: Number(gasto.subtotal || 0),
            total: Number(gasto.total || 0),
            pago_tesla: Boolean(gasto.pago_tesla)
        }
    }
    showForm.value = true
}

const cerrarForm = () => {
    showForm.value = false
    resetForm("tesla")
}

const guardarGasto = async () => {
    guardando.value = true
    error.value = ""
    try {
        const payload = {
            ...form.value,
            mes: Number(mes.value),
            anio: Number(anio.value),
            iva_impuesto: Number(form.value.iva_impuesto || 0),
            subtotal: Number(form.value.subtotal || 0),
            total: Number(form.value.total || 0),
            pago_tesla: Number(form.value.pago_tesla || 0)
        }

        if (editandoID.value) {
            await api.updateGasto(editandoID.value, payload)
        } else {
            await api.createGasto(payload)
        }

        await cargarGastos()
        cerrarForm()
    } catch (err) {
        error.value = "Error al guardar gasto: " + (err?.response?.data?.error || err.message)
    } finally {
        guardando.value = false
    }

}

const abrirModalResumenPdf = () => {
    showResumenModal.value = true
}

const cerrarModalResumenPdf = () => {
    if (generandoPdf.value) return
    showResumenModal.value = false
}

const descargarResumenPdf = async (tiposSeleccionados = tipos.value.map((tipo) => tipo.key), sufijo = "General") => {
    generandoPdf.value = true
    error.value = ""
    try {
        const res = await api.getGastosResumenPdf(mes.value, anio.value, tiposSeleccionados)
        const blob = new Blob([res.data], { type: "application/pdf" })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `Resumen Gastos ${sufijo} ${String(mes.value).padStart(2, "0")}-${anio.value}.pdf`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
        showResumenModal.value = false
    } catch (err) {
        error.value = "Error al generar PDF de gastos: " + (err?.response?.data?.error || err.message)
    } finally {
        generandoPdf.value = false
    }
}

watch([mes, anio], cargarGastos)
onMounted(cargarGastos)

</script>

<template>
	<LayoutShell
		title="Gastos"
		subtitle="Base inicial del módulo"
	>
		<section class="gastos-base">
            <div class="gastos-filtros">
                <div class="filtro-box">
                    <span class="filtro-titulo">Periodo</span>
                    <label>
                        Mes
                        <select v-model.number="mes">
                            <option value="1">Enero</option>
                            <option value="2">Febrero</option>
                            <option value="3">Marzo</option>
                            <option value="4">Abril</option>
                            <option value="5">Mayo</option>
                            <option value="6">Junio</option>
                            <option value="7">Julio</option>
                            <option value="8">Agosto</option>
                            <option value="9">Septiembre</option>
                            <option value="10">Octubre</option>
                            <option value="11">Noviembre</option>
                            <option value="12">Diciembre</option>
                        </select>
                    </label>
                    <label>
                        Año
                        <input v-model.number="anio" type="number" min="2020" max="2100" />
                    </label>
                </div>

                <div class="filtro-box">
                    <span class="filtro-titulo">Tipos</span>
                    <div class="filtro-tipos">
                        <label v-for="tipo in tipos" :key="tipo.key" class="filtro-pill" :class="{ activo: tiposVisibles.includes(tipo.key) }">
                            <input type="checkbox" :value="tipo.key" v-model="tiposVisibles" hidden />
                            {{ tipo.titulo }}
                        </label>
                    </div>
                </div>

                <button class="btn-imprimir-resumen" :disabled="generandoPdf || loading" @click="abrirModalResumenPdf">
                    {{ generandoPdf ? "Generando..." : "Imprimir resumen" }}
                </button>

            </div>

			<div class="gastos-grid">
                <article v-for="tipo in tipos.filter(t => tiposVisibles.includes(t.key))" :key="tipo.key" class="gastos-card">
                    <div class="card-header">
                        <h3>{{ tipo.titulo }}</h3>
                        <button class="btn-agregar" @click="abrirForm(tipo.key)">Agregar</button>
                    </div>

                    <p v-if="loading" class="msg-cargando">Cargando gastos...</p>
                    <p v-else-if="error" class="msg-error">{{ error }}</p>

                    <table v-else class="gastos-tabla">
                        <thead>
                            <tr>
                                <th>Descripción</th>
                                <th>IVA / Imp.</th>
                                <th>Subtotal</th>
                                <th>Total</th>
                                <th>Pago tesla</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="gasto in gastos[tipo.key]" :key="gasto.id">
                                <td>{{ gasto.descripcion }}</td>
                                <td>{{ formatCurrency(gasto.iva_impuesto) }}</td>
                                <td>{{ formatCurrency(gasto.subtotal) }}</td>
                                <td>{{ formatCurrency(gasto.total) }}</td>
                                <td>{{ formatCurrency(gasto.pago_tesla) }}</td>
                                <td>
                                    <button class="btn-editar" @click="abrirForm(tipo.key, gasto)">Editar</button>
                                    <button class="btn-eliminar" @click="eliminarGasto(gasto.id, tipo.key)">Eliminar</button>
                                </td>
                            </tr>
                            <tr v-if="gastos[tipo.key].length === 0">
                                <td colspan="6" class="sin-datos">No hay gastos registrados</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr>
                                <td><strong>Totales</strong></td>
                                <td>{{ formatCurrency(gastos[tipo.key].reduce((acc, g) => acc + Number(g.iva_impuesto || 0), 0)) }}</td>
                                <td>{{ formatCurrency(gastos[tipo.key].reduce((acc, g) => acc + Number(g.subtotal || 0), 0)) }}</td>
                                <td>{{ formatCurrency(gastos[tipo.key].reduce((acc, g) => acc + Number(g.total || 0), 0)) }}</td>
                                <td>{{ formatCurrency(gastos[tipo.key].reduce((acc, g) => acc + Number(g.pago_tesla || 0), 0)) }}</td>
                                <td></td>
                            </tr>
                        </tfoot>

                    </table>

                </article>

			</div>
		</section>

		<div v-if="showForm" class="modal-overlay">
            <div class="modal">
                <h3>{{ editandoID ? "Editar gasto" : "Nuevo gasto" }}</h3>

                <label>Descripción</label>
                <input v-model="form.descripcion" type="text" />

                <label>IVA / Impuesto</label>
                <input v-model.number="form.iva_impuesto" type="number" step="0.01" min="0" />

                <label>Subtotal</label>
                <input v-model.number="form.subtotal" type="number" step="0.01" min="0" />

                <label>Total</label>
                <input v-model.number="form.total" type="number" step="0.01" min="0" />

                <label>Pago Tesla</label>
                <input v-model.number="form.pago_tesla" type="number" step="0.01" min="0" />

                <div class="modal-actions">
                <button @click="guardarGasto" :disabled="guardando">
                    {{ guardando ? "Guardando..." : "Guardar" }}
                </button>
                <button @click="cerrarForm" type="button">Cancelar</button>
                </div>
            </div>
        </div>

        <div v-if="showResumenModal" class="modal-overlay" @click.self="cerrarModalResumenPdf">
            <div class="modal modal-resumen-opciones">
                <h3>Descargar resumen de gastos</h3>
                <p class="modal-resumen-texto">Elegí qué resumen querés descargar para {{ String(mes).padStart(2, "0") }}/{{ anio }}.</p>

                <div class="modal-resumen-botones">
                    <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['tesla'], 'Tesla')">Gastos Tesla</button>
                    <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['facu'], 'Facu')">Gastos Facu</button>
                    <button type="button" :disabled="generandoPdf" @click="descargarResumenPdf(['juani'], 'Juani')">Gastos Juani</button>
                    <button type="button" class="btn-resumen-general" :disabled="generandoPdf" @click="descargarResumenPdf(['tesla', 'facu', 'juani'], 'General')">Resumen General (los 3)</button>
                </div>

                <div class="modal-actions">
                    <button type="button" @click="cerrarModalResumenPdf" :disabled="generandoPdf">Cerrar</button>
                </div>
            </div>
        </div>

	</LayoutShell>
</template>

<style scoped>
.gastos-base {
	display: grid;
	gap: 1rem;
}

.gastos-filtros {
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
}

.gastos-filtros label {
	display: grid;
	gap: 0.35rem;
	color: #cbd5e1;
}

.gastos-filtros select {
	min-width: 130px;
	border: 1px solid rgba(148, 163, 184, 0.35);
	border-radius: 10px;
	padding: 0.45rem 0.6rem;
	background: rgba(15, 23, 42, 0.8);
	color: #e2e8f0;
	cursor: pointer;
}

.gastos-filtros input {
	min-width: 120px;
	border: 1px solid rgba(148, 163, 184, 0.35);
	border-radius: 10px;
	padding: 0.45rem 0.6rem;
	background: rgba(15, 23, 42, 0.8);
	color: #e2e8f0;
}

.gastos-filtros .filtro-box {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	flex-wrap: wrap;
	border: 1px solid rgba(148, 163, 184, 0.2);
	border-radius: 10px;
	padding: 0.6rem 1rem;
	background: rgba(15, 23, 42, 0.72);
}

.filtro-titulo {
	font-size: 0.75rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: #64748b;
	margin-right: 0.25rem;
}

.filtro-tipos {
	display: flex;
	flex-direction: row;
	flex-wrap: nowrap;
	gap: 0.5rem;
}

.filtro-pill {
	display: inline-flex;
	align-items: center;
	padding: 0.3rem 0.75rem;
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 8px;
	background: rgba(30, 41, 59, 0.6);
	color: #94a3b8;
	font-size: 0.82rem;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
	user-select: none;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.filtro-pill.activo {
	background: rgba(59, 130, 246, 0.18);
	border-color: rgba(59, 130, 246, 0.5);
	color: #93c5fd;
}

.filtro-pill:hover {
	border-color: rgba(148, 163, 184, 0.45);
}

.filtro-check {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	color: #cbd5e1;
	font-size: 0.88rem;
	cursor: pointer;
}

.btn-imprimir-resumen {
	align-self: stretch;
	border: 1px solid rgba(59, 130, 246, 0.35);
	border-radius: 8px;
	padding: 0.55rem 0.9rem;
	background: rgba(59, 130, 246, 0.18);
	color: #bfdbfe;
	font-size: 0.84rem;
	font-weight: 700;
	cursor: pointer;
	white-space: nowrap;
}

.btn-imprimir-resumen:hover:not(:disabled) {
	border-color: rgba(59, 130, 246, 0.55);
	background: rgba(59, 130, 246, 0.26);
}

.btn-imprimir-resumen:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.gastos-grid {
	display: grid;
	grid-template-columns: 1fr;
	gap: 0.9rem;
}

.gastos-card {
	border: 1px solid rgba(148, 163, 184, 0.25);
	border-radius: 14px;
	padding: 1rem;
	background: rgba(15, 23, 42, 0.72);
}

.gastos-card h3 {
	margin: 0 0 0.4rem;
}

.gastos-card p {
	margin: 0.2rem 0;
}


.modal-overlay{
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal{
    background: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    width: min(90vw, 480px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    color: #e2e8f0;
}

.modal h3{
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
    color: #f8fafc;
}

.modal label{
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06rem;
    color: #94a3b8;
}

.modal input{
    padding: 0.6rem 0.75rem;
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 0.95rem;
    width: 100%;
}

.modal-actions{
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
}

.modal-actions button{
    flex: 1;
    padding: 0.65rem;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
}

.modal-actions button:first-child{
    background: #3b82f6;
    color: #fff;
}

.modal-actions button:first-child:disabled{
    opacity: 0.5;
    cursor: not-allowed;
}

.modal-actions button:last-child{
    background: rgba(148, 163, 184, 0.25);
    color: #cbd5e1;
}

.btn-agregar{
    padding: 0.35rem 0.85rem;
    background: rgba(74,222,128,0.15);
    color: #86efac;
    border: 1px solid rgba(74,222,128,0.3);
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
}

.btn-editar{
    padding: 0.3rem 0.65rem;
    background: rgba(59,130,246,0.15);
    color: #93c5fd;
    border: 1px solid rgba(59,130,246,0.25);
    border-radius: 6px;
    font-size: 0.78rem;
    cursor: pointer;
    margin-right: 0.3rem;
}

.btn-eliminar{
    padding: 0.3rem 0.65rem;
    background: rgba(239,68,68,0.14);
    color: #fca5a5;
    border: 1px solid rgba(239,68,68,0.22);
    border-radius: 6px;
    font-size: 0.78rem;
    cursor: pointer;
}

.card-header{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
}

.gastos-tabla {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.88rem;
}

.gastos-tabla thead tr {
	background: rgba(30, 41, 59, 0.8);
}

.gastos-tabla th {
	padding: 0.55rem 0.75rem;
	text-align: left;
	font-weight: 700;
	font-size: 0.78rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: #94a3b8;
	border-bottom: 1px solid rgba(148, 163, 184, 0.2);
	white-space: nowrap;
}

.gastos-tabla td {
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid rgba(148, 163, 184, 0.1);
	color: #e2e8f0;
}

.gastos-tabla tbody tr:hover {
	background: rgba(30, 41, 59, 0.5);
}

.gastos-tabla tfoot tr {
	background: rgba(30, 41, 59, 0.6);
}

.gastos-tabla tfoot td {
	padding: 0.55rem 0.75rem;
	border-top: 1px solid rgba(148, 163, 184, 0.25);
	border-bottom: none;
	color: #f8fafc;
	font-weight: 600;
}

.sin-datos {
	text-align: center;
	color: #64748b;
	padding: 1rem 0 !important;
}

.modal-resumen-opciones {
    width: min(92vw, 520px);
}

.modal-resumen-texto {
    margin: 0;
    color: #cbd5e1;
    font-size: 0.9rem;
}

.modal-resumen-botones {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.45rem;
}

.modal-resumen-botones button {
    width: 100%;
    padding: 0.62rem 0.8rem;
    border-radius: 8px;
    border: 1px solid rgba(59, 130, 246, 0.35);
    background: rgba(59, 130, 246, 0.18);
    color: #bfdbfe;
    font-weight: 700;
    cursor: pointer;
}

.modal-resumen-botones button:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.27);
}

.modal-resumen-botones button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}

.modal-resumen-botones .btn-resumen-general {
    border-color: rgba(34, 197, 94, 0.35);
    background: rgba(34, 197, 94, 0.16);
    color: #bbf7d0;
}

.modal-resumen-botones .btn-resumen-general:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.24);
}
</style>
