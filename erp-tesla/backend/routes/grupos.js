import express from "express"
import db from "../db.js"
import { getIo } from '../socket.js'
import path from "path";
import fs from "fs/promises";

const router = express.Router()
const GRUPOS_FOLDER = path.join("C:\\Users\\usuario\\Desktop\\GESTION TESLA", "grupos");

const ensureGruposFolderExists = async () => {
  await fs.mkdir(GRUPOS_FOLDER, { recursive: true });
};

const saveGrupoFile = async (grupo) => {
  try {
    const grupoFolderPath = path.join(GRUPOS_FOLDER, grupo.nombre);
    await fs.mkdir(grupoFolderPath, { recursive: true });

    const grupoFilePath = path.join(grupoFolderPath, `${grupo.nombre}.txt`);

    // Obtener empleados del grupo
    const { data: empleados, error: empleadosError } = await db
      .from("empleados")
      .select("nombre, apellido, dni, valor_hora")
      .eq("grupo_id", grupo.id);

    if (empleadosError) {
      console.error("Error al obtener empleados del grupo:", empleadosError);
      throw empleadosError;
    }

    // Obtener obras del grupo
    const { data: obras, error: obrasError } = await db
      .from("obras")
      .select("nombre, estado, fecha_inicio")
      .eq("grupo_id", grupo.id);

    if (obrasError) {
      console.error("Error al obtener obras del grupo:", obrasError);
      throw obrasError;
    }

    // Generar contenido del archivo con resumen del grupo
    let grupoContent = `Resumen del Grupo:\n\n` +
      `Nombre: ${grupo.nombre}\n` +
      `Descripción: ${grupo.descripcion || "-"}\n` +
      `Fecha de Creación: ${new Date().toLocaleDateString()}\n` +
      `Estado: ${grupo.activo ? "Activo" : "Inactivo"}\n\n`;

    // Agregar resumen de empleados
    grupoContent += `Empleados del Grupo:\n`;
    if (empleados.length > 0) {
      empleados.forEach((empleado) => {
        grupoContent += `  - ${empleado.nombre} ${empleado.apellido}, DNI: ${empleado.dni}, Valor Hora: $${empleado.valor_hora}\n`;
      });
    } else {
      grupoContent += `  No hay empleados asignados a este grupo.\n`;
    }

    // Agregar resumen de obras
    grupoContent += `\nObras del Grupo:\n`;
    if (obras.length > 0) {
      obras.forEach((obra) => {
        grupoContent += `  - ${obra.nombre}, Estado: ${obra.estado}, Fecha de Inicio: ${obra.fecha_inicio || "-"}\n`;
      });
    } else {
      grupoContent += `  No hay obras asignadas a este grupo.\n`;
    }

    await fs.writeFile(grupoFilePath, grupoContent);
  } catch (error) {
    console.error("Error al guardar los datos del grupo:", error);
    throw error;
  }
};

const deleteGrupoFolder = async (grupo) => {
  try {
    const grupoFolderPath = path.join(GRUPOS_FOLDER, grupo.nombre);
    await fs.rm(grupoFolderPath, { recursive: true, force: true });
    console.log(`Carpeta del grupo eliminada: ${grupoFolderPath}`);
  } catch (error) {
    console.error("Error al eliminar la carpeta del grupo:", error);
    throw error;
  }
};

// Listar todos los grupos activos
router.get("/", async (req, res) => {
  try {
    const { data, error } = await db
      .from("grupos")
      .select("*")
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Resumen de un grupo: empleados, obras activas, total horas
router.get("/:id/resumen", async (req, res) => {
  try {
    const { id } = req.params
    const grupoIdInt = parseInt(id)

    const [resGrupo, resEmpleados, resObras] = await Promise.all([
      db.from("grupos").select("*").eq("id", grupoIdInt).single(),
      db.from("empleados").select("*").eq("grupo_id", grupoIdInt).eq("activo", true).order("apellido", { ascending: true }),
      db.from("obras").select("*").eq("grupo_id", grupoIdInt).order("created_at", { ascending: false })
    ])

    if (resGrupo.error) return res.status(404).json({ error: "Grupo no encontrado" })

    const empleados = resEmpleados.data || []
    const obras = resObras.data || []
    const obrasActivas = obras.filter(o => o.estado === "activa")
    const obrasFinalizadas = obras.filter(o => o.estado !== "activa")

    // Total horas del grupo (SELECT * + suma en JS para tolerar variaciones de columna)
    let totalHoras = 0
    if (empleados.length > 0) {
      const empIds = empleados.map(e => e.id)
      const placeholders = empIds.map((_, i) => `$${i + 1}`).join(",")
      const { pool } = await import("../db.js")
      const resHoras = await pool.query(
        `SELECT * FROM horas WHERE empleado_id IN (${placeholders})`,
        empIds
      )
      const getHs = (r) => r.cantidad_horas ?? r.cantidad_hora ?? r.horas ?? r.cantidad ?? 0
      totalHoras = resHoras.rows.reduce((sum, r) => sum + Number(getHs(r)), 0)
    }

    res.json({
      grupo: resGrupo.data,
      empleados,
      obras,
      resumen: {
        totalEmpleados: empleados.length,
        totalObras: obras.length,
        obrasActivas: obrasActivas.length,
        obrasFinalizadas: obrasFinalizadas.length,
        totalHoras
      }
    })
  } catch (err) {
    console.error("Error en resumen de grupo:", err)
    res.status(500).json({ error: err.message })
  }
})

// Crear grupo
router.post("/", async (req, res) => {
  try {
    const { nombre, descripcion } = req.body
    if (!nombre) return res.status(400).json({ error: "El nombre es obligatorio" })

    const { data, error } = await db
      .from("grupos")
      .insert([{ nombre, descripcion: descripcion || "", activo: true }])
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    await ensureGruposFolderExists();
    await saveGrupoFile(data);

    getIo()?.emit('grupos:changed')
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar grupo
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, descripcion } = req.body

    const { data: oldGrupo, error: fetchError } = await db
      .from("grupos")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !oldGrupo) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    const { data, error } = await db
      .from("grupos")
      .update({ nombre, descripcion })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    if (oldGrupo.nombre !== nombre) {
      await deleteGrupoFolder(oldGrupo);
      await saveGrupoFile(data);
    } else {
      await saveGrupoFile(data);
    }

    getIo()?.emit('grupos:changed')
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Eliminar grupo
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: grupo, error: grupoError } = await db
      .from("grupos")
      .select("*")
      .eq("id", id)
      .single();

    if (grupoError || !grupo) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    const { error } = await db.from("grupos").delete().eq("id", id);

    if (error) {
      return res.status(500).json({ error: "Error al eliminar el grupo." });
    }

    await deleteGrupoFolder(grupo);

    getIo()?.emit("grupos:changed");
    res.json({ message: "Grupo eliminado correctamente." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

export default router
