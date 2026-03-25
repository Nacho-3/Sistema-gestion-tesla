import db from "./db.js"

async function createAdministrativeObra() {
  try {
    console.log("Buscando grupo Administrativo...")

    // 1. Obtener grupo Administrativo
    const { data: gruposData, error: gruposError } = await db
      .from("grupos")
      .select("id, nombre")

    if (gruposError || !gruposData) {
      console.error("Error obteniendo grupos:", gruposError)
      process.exit(1)
    }

    const grupos = gruposData.filter(g => /admin/i.test(g.nombre))

    if (gruposError || !grupos || grupos.length === 0) {
      console.error("No se encontró grupo Administrativo:", gruposError)
      process.exit(1)
    }

    const grupo = grupos[0]
    console.log(`✓ Grupo encontrado: ${grupo.nombre} (ID: ${grupo.id})`)

    // 2. Verificar si ya existe obra Administración
    const { data: obrasExistentes, error: obrasError } = await db
      .from("obras")
      .select("id, nombre")
      .eq("grupo_id", grupo.id)

    const obrasAdmin = (obrasExistentes || []).filter(o => /admin/i.test(o.nombre))

    if (obrasAdmin && obrasAdmin.length > 0) {
      const obra = obrasAdmin[0]
      console.log(`✓ La obra Administración ya existe (ID: ${obra.id})`)
      process.exit(0)
    }

    // 3. Obtener o crear cliente ADMINISTRACION INTERNA
    console.log("Buscando/creando cliente ADMINISTRACION INTERNA...")
    const { data: clienteExistente, error: clienteSearchError } = await db
      .from("clientes")
      .select("id")
      .eq("razon_social", "ADMINISTRACION INTERNA")
      .eq("activo", true)
      .maybeSingle()

    let clienteId
    if (clienteExistente?.id) {
      clienteId = clienteExistente.id
      console.log(`✓ Cliente encontrado (ID: ${clienteId})`)
    } else {
      const { data: clienteCreado, error: clienteCreateError } = await db
        .from("clientes")
        .insert([{ razon_social: "ADMINISTRACION INTERNA", activo: true }])
        .select("id")
        .single()

      if (clienteCreateError || !clienteCreado?.id) {
        console.error("Error creando cliente:", clienteCreateError)
        process.exit(1)
      }

      clienteId = clienteCreado.id
      console.log(`✓ Cliente creado (ID: ${clienteId})`)
    }

    // 4. Crear obra Administración
    console.log("Creando obra Administración...")
    const { data: obraCreada, error: obraError } = await db
      .from("obras")
      .insert([
        {
          nombre: "ADMINISTRACION",
          cliente_id: clienteId,
          grupo_id: grupo.id,
          estado: "activa",
          fecha_inicio: new Date().toISOString().split("T")[0]
        }
      ])
      .select("id, nombre")
      .single()

    if (obraError || !obraCreada?.id) {
      console.error("Error creando obra:", obraError)
      process.exit(1)
    }

    console.log(`✓ ¡Obra creada exitosamente!`)
    console.log(`  Obra ID: ${obraCreada.id}`)
    console.log(`  Nombre: ${obraCreada.nombre}`)
    console.log(`  Grupo: ${grupo.nombre}`)
    console.log(`  Cliente: ADMINISTRACION INTERNA`)

    process.exit(0)
  } catch (err) {
    console.error("Error:", err.message)
    process.exit(1)
  }
}

createAdministrativeObra()
