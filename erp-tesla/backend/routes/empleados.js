import express from "express"
import db from "../db.js"
import { pool } from "../db.js"
import { getIo } from '../socket.js'
import path from "path";
import fs from "fs/promises";

const router = express.Router()
const TIPOS_EMPLEADO_VALIDOS = ["monotributista", "empleado_dependiente", "no_corresponde"]

const normalizeTipoEmpleado = (tipo) => (
  TIPOS_EMPLEADO_VALIDOS.includes(tipo) ? tipo : null
)

const normalizeValorHora = (valorHora, fallback = 0) => {
  if (valorHora === null || valorHora === undefined || valorHora === "") return fallback
  const valor = Number(valorHora)
  return Number.isFinite(valor) && valor >= 0 ? valor : fallback
}

const handleInternalError = (res, err, context) => {
  console.error(`[empleados] ${context}:`, err)
  return res.status(500).json({
    error: "Error interno del servidor",
    context,
  })
}

// Listar todos los empleados activos
router.get("/", async (req, res) => {
  try {
    const { data, error } = await db
      .from("empleados")
      .select("*")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    return handleInternalError(res, err, "listar_empleados")
  }
})

// Crear nuevo empleado
router.post("/", async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      dni,
      cuit,
      fecha_nacimiento,
      direccion,
      telefono,
      tipo,
      alias,
      grupo_id,
      valor_hora,
    } = req.body

    const nombreFinal = String(nombre || "").trim() || "Sin nombre"
    const apellidoFinal = String(apellido || "").trim() || "Sin apellido"
    const dniFinal = String(dni || "").trim() || `TEMP-${Date.now()}`
    const tipoFinal = normalizeTipoEmpleado(tipo)
    const valorHoraFinal = normalizeValorHora(valor_hora, 0)
    const grupoIdFinal = Number.isInteger(Number(grupo_id)) && Number(grupo_id) > 0
      ? Number(grupo_id)
      : null

    if (!grupoIdFinal) {
      return res.status(400).json({ error: "grupo_id es obligatorio para asignar el empleado" })
    }

    // Verificar que el DNI no exista
    const { data: existente } = await db
      .from("empleados")
      .select("id")
      .eq("dni", dniFinal)
      .eq("activo", true)
    
    if (existente && existente.length > 0) {
      return res.status(400).json({ error: "Este DNI ya existe" })
    }

    // Verificar que el CUIT no exista
    if (cuit) {
      const { data: cuitExistente } = await db
        .from("empleados")
        .select("id")
        .eq("cuit", cuit)
        .eq("activo", true)

      if (cuitExistente && cuitExistente.length > 0) {
        return res.status(400).json({ error: "Este CUIT ya existe" })
      }
    }

    const { data, error } = await db
      .from("empleados")
      .insert([
        {
          nombre: nombreFinal,
          apellido: apellidoFinal,
          dni: dniFinal,
          cuit,
          fecha_nacimiento,
          direccion,
          telefono,
          tipo: tipoFinal,
          alias,
          grupo_id: grupoIdFinal,
          valor_hora: valorHoraFinal,
          activo: true
        }
      ])
      .select()

    if (error) return res.status(400).json({ error: error.message })
    await ensureEmpleadosFolderExists();
    await saveEmpleadoFile(data[0]);

    getIo()?.emit('empleados:changed')
    res.status(201).json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "crear_empleado")
  }
})

// Obtener empleado por ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params

    // Obtener solo el empleado, sin queries adicionales
    const { data, error } = await db
      .from("empleados")
      .select("*")
      .eq("id", id)
      .single()

    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: "Empleado no encontrado" })

    // Retornar empleado con resumen simplificado
    res.json({
      ...data,
      resumen: {
        totalHoras: 0,
        horasPrestadas: 0,
        liquidacionesPendientes: 0,
        liquidacionesPagadas: 0
      }
    })
  } catch (err) {
    return handleInternalError(res, err, "obtener_empleado")
  }
})

// Actualizar empleado
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const {
      nombre,
      apellido,
      dni,
      cuit,
      fecha_nacimiento,
      direccion,
      telefono,
      tipo,
      alias,
      grupo_id,
      valor_hora,
    } = req.body

    const actualizaciones = {}
    if (nombre !== undefined) actualizaciones.nombre = nombre
    if (apellido !== undefined) actualizaciones.apellido = apellido
    if (grupo_id !== undefined) actualizaciones.grupo_id = grupo_id
    if (valor_hora !== undefined) actualizaciones.valor_hora = normalizeValorHora(valor_hora, 0)
    if (fecha_nacimiento !== undefined) actualizaciones.fecha_nacimiento = fecha_nacimiento
    if (direccion !== undefined) actualizaciones.direccion = direccion
    if (telefono !== undefined) actualizaciones.telefono = telefono
    if (alias !== undefined) actualizaciones.alias = alias

    if (tipo !== undefined) {
      if (!TIPOS_EMPLEADO_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: "Tipo inválido. Valores permitidos: monotributista, empleado_dependiente, no_corresponde" })
      }
      actualizaciones.tipo = tipo
    }

    // Validar DNI si se actualiza
    if (dni !== undefined) {
      const { data: existente } = await db
        .from("empleados")
        .select("id")
        .eq("dni", dni)
        .neq("id", id)

      if (existente && existente.length > 0) {
        return res.status(400).json({ error: "Este DNI ya existe" })
      }
      actualizaciones.dni = dni
    }

    // Validar CUIT si se actualiza
    if (cuit !== undefined) {
      const { data: cuitExistente } = await db
        .from("empleados")
        .select("id")
        .eq("cuit", cuit)
        .neq("id", id)

      if (cuitExistente && cuitExistente.length > 0) {
        return res.status(400).json({ error: "Este CUIT ya existe" })
      }
      actualizaciones.cuit = cuit
    }

    const { data, error } = await db
      .from("empleados")
      .update(actualizaciones)
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    if (data.length === 0) return res.status(404).json({ error: "Empleado no encontrado" })

    // Regenerar archivo del empleado actualizado
    await saveEmpleadoFile(data[0]);

    getIo()?.emit("empleados:changed")
    res.json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "actualizar_empleado")
  }
})

// Eliminar empleado
// Si tiene datos asociados, se realiza una baja lógica para preservar el historial.
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params

    const { data: empleado, error: empleadoError } = await db
      .from("empleados")
      .select("*")
      .eq("id", id)
      .single()

    if (empleadoError || !empleado) {
      return res.status(404).json({ error: "Empleado no encontrado" })
    }

    const { error } = await db.from("empleados").delete().eq("id", id)

    if (error) {
      return res.status(500).json({ error: "Error al eliminar el empleado." })
    }

    await deleteEmpleadoFolder(empleado);

    getIo()?.emit("empleados:changed")
    res.json({ message: "Empleado eliminado correctamente." })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar valor hora de un empleado
router.put("/:id/tarifa", async (req, res) => {
  try {
    const { valor_hora } = req.body
    const { id } = req.params
    const valorHoraNormalizado = normalizeValorHora(valor_hora, null)

    if (valorHoraNormalizado === null) {
      return res.status(400).json({ error: "Valor de hora inválido" })
    }

    const { data, error } = await db
      .from("empleados")
      .update({ valor_hora: valorHoraNormalizado })
      .eq("id", id)
      .select()

    if (error) return res.status(400).json({ error: error.message })
    getIo()?.emit('empleados:changed')
    res.json(data[0])
  } catch (err) {
    return handleInternalError(res, err, "actualizar_tarifa")
  }
})

// Generar carpetas y archivos para todos los empleados registrados
router.post("/generar-archivos", async (req, res) => {
  try {
    const { data: empleados, error } = await db
      .from("empleados")
      .select("*")
      .eq("activo", true);

    if (error) {
      return res.status(500).json({ error: "Error al obtener empleados." });
    }

    await ensureEmpleadosFolderExists();

    for (const empleado of empleados) {
      await saveEmpleadoFile(empleado);
    }

    res.json({ message: "Archivos generados para todos los empleados activos." });
  } catch (err) {
    return handleInternalError(res, err, "generar_archivos_empleados");
  }
});

export default router

const EMPLEADOS_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "empleados");

const ensureEmpleadosFolderExists = async () => {
  await fs.mkdir(EMPLEADOS_FOLDER, { recursive: true });
};

const saveEmpleadoFile = async (empleado) => {
  try {
    const empleadoFolderPath = path.join(EMPLEADOS_FOLDER, `${empleado.nombre}_${empleado.apellido}`);
    await fs.mkdir(empleadoFolderPath, { recursive: true });

    const empleadoFilePath = path.join(empleadoFolderPath, `${empleado.nombre}_${empleado.apellido}.txt`);

    // Obtener el nombre del grupo
    let nombreGrupo = "-";
    if (empleado.grupo_id) {
      const { data: grupo, error } = await db
        .from("grupos")
        .select("nombre")
        .eq("id", empleado.grupo_id)
        .single();

      if (!error && grupo) {
        nombreGrupo = grupo.nombre;
      }
    }

    // Formatear la fecha de nacimiento
    const fechaNacimientoFormateada = empleado.fecha_nacimiento
      ? new Date(empleado.fecha_nacimiento).toISOString().split("T")[0] // Formato YYYY-MM-DD
      : "-";

    // Generar contenido del archivo con resumen del empleado
    const empleadoContent = `Resumen del Empleado:\n\n` +
      `Nombre: ${empleado.nombre} ${empleado.apellido}\n` +
      `DNI: ${empleado.dni}\n` +
      `CUIT: ${empleado.cuit || "-"}\n` +
      `Fecha de Nacimiento: ${fechaNacimientoFormateada}\n` +
      `Dirección: ${empleado.direccion || "-"}\n` +
      `Teléfono: ${empleado.telefono || "-"}\n` +
      `Tipo: ${empleado.tipo || "-"}\n` +
      `Alias: ${empleado.alias || "-"}\n` +
      `Grupo: ${nombreGrupo}\n` +
      `Valor Hora: $${empleado.valor_hora || 0}`;

    await fs.writeFile(empleadoFilePath, empleadoContent);
  } catch (error) {
    console.error("Error al guardar los datos del empleado:", error);
    throw error;
  }
};

const deleteEmpleadoFolder = async (empleado) => {
  try {
    const empleadoFolderPath = path.join(EMPLEADOS_FOLDER, `${empleado.nombre}_${empleado.apellido}`);
    await fs.rm(empleadoFolderPath, { recursive: true, force: true });
    console.log(`Carpeta del empleado eliminada: ${empleadoFolderPath}`);
  } catch (error) {
    console.error("Error al eliminar la carpeta del empleado:", error);
    throw error;
  }
};
