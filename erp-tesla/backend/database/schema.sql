-- ERP Tesla - Schema PostgreSQL local

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- TABLA DE USUARIOS (LOGIN)
-- =========================
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre VARCHAR(120),
  rol VARCHAR(30) DEFAULT 'admin',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usuario inicial
INSERT INTO usuarios (email, password_hash, nombre, rol)
VALUES ('admin@tesla.local', crypt('Admin1234', gen_salt('bf')), 'Administrador', 'admin')
ON CONFLICT (email) DO NOTHING;

-- =========================
-- TABLAS MAESTRAS
-- =========================
CREATE TABLE IF NOT EXISTS grupos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  razon_social VARCHAR(255) NOT NULL,
  cuit VARCHAR(30),
  direccion TEXT,
  telefono VARCHAR(50),
  email VARCHAR(120),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS obras (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  estado VARCHAR(30) NOT NULL DEFAULT 'activa',
  fecha_inicio DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS empleados (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  apellido VARCHAR(120) NOT NULL,
  dni VARCHAR(20) UNIQUE NOT NULL,
  grupo_id INTEGER REFERENCES grupos(id),
  valor_hora NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- HORAS
-- =========================
CREATE TABLE IF NOT EXISTS horas (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  fecha DATE NOT NULL,
  hora_inicio TIME,
  hora_fin TIME,
  cantidad_horas NUMERIC(8,2) NOT NULL,
  horas_trabajadas NUMERIC(8,2),
  es_prestada BOOLEAN DEFAULT FALSE,
  tipo VARCHAR(20) DEFAULT 'normal',
  grupo_origen_id INTEGER REFERENCES grupos(id),
  grupo_destino_id INTEGER REFERENCES grupos(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- LIQUIDACIONES Y PAGOS
-- =========================
CREATE TABLE IF NOT EXISTS liquidaciones (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  periodo_inicio DATE NOT NULL,
  periodo_fin DATE NOT NULL,
  total_horas NUMERIC(12,2) DEFAULT 0,
  monto_bruto NUMERIC(12,2) DEFAULT 0,
  descuentos NUMERIC(12,2) DEFAULT 0,
  monto_neto NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'pendiente',
  observaciones TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_liquidacion_periodo UNIQUE (empleado_id, periodo_inicio, periodo_fin)
);

CREATE TABLE IF NOT EXISTS pagos_sueldo (
  id SERIAL PRIMARY KEY,
  liquidacion_id INTEGER NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
  monto NUMERIC(12,2) NOT NULL,
  medio_pago VARCHAR(50),
  fecha_pago DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- COMPATIBILIDAD / MIGRACIÓN
-- =========================
-- Permite ejecutar este schema sobre una base vieja sin romper rutas actuales.

ALTER TABLE IF EXISTS liquidaciones
  ADD COLUMN IF NOT EXISTS periodo_inicio DATE,
  ADD COLUMN IF NOT EXISTS periodo_fin DATE,
  ADD COLUMN IF NOT EXISTS monto_bruto NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuentos NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_neto NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT '';

ALTER TABLE IF EXISTS pagos_sueldo
  ADD COLUMN IF NOT EXISTS fecha_pago DATE;

ALTER TABLE IF EXISTS horas
  ADD COLUMN IF NOT EXISTS horas_trabajadas NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'normal';

UPDATE horas
SET horas_trabajadas = COALESCE(horas_trabajadas, cantidad_horas)
WHERE horas_trabajadas IS NULL;

UPDATE horas
SET tipo = COALESCE(
  NULLIF(tipo, ''),
  CASE WHEN es_prestada THEN 'prestada' ELSE 'normal' END
)
WHERE tipo IS NULL OR tipo = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pagos_sueldo'
      AND column_name = 'fecha'
  ) THEN
    UPDATE pagos_sueldo
    SET fecha_pago = COALESCE(fecha_pago, fecha)
    WHERE fecha_pago IS NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS pagos_sueldo
  ALTER COLUMN fecha_pago SET DEFAULT CURRENT_DATE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'liquidaciones'
      AND column_name = 'anio'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'liquidaciones'
      AND column_name = 'mes'
  ) THEN
    UPDATE liquidaciones
    SET periodo_inicio = COALESCE(periodo_inicio, make_date(anio, mes, 1))
    WHERE periodo_inicio IS NULL
      AND anio IS NOT NULL
      AND mes IS NOT NULL;
  END IF;
END $$;

UPDATE liquidaciones
SET periodo_fin = COALESCE(periodo_fin, (date_trunc('month', periodo_inicio)::date + INTERVAL '1 month - 1 day')::date)
WHERE periodo_inicio IS NOT NULL
  AND periodo_fin IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_liquidacion_periodo'
      AND conrelid = 'liquidaciones'::regclass
  ) THEN
    ALTER TABLE liquidaciones DROP CONSTRAINT uq_liquidacion_periodo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_liquidacion_periodo'
      AND conrelid = 'liquidaciones'::regclass
  ) THEN
    ALTER TABLE liquidaciones
      ADD CONSTRAINT uq_liquidacion_periodo UNIQUE (empleado_id, periodo_inicio, periodo_fin);
  END IF;
END $$;

-- =========================
-- CAJA
-- =========================
CREATE TABLE IF NOT EXISTS movimientos_caja (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  detalle TEXT NOT NULL,
  monto_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalles_medio_pago (
  id SERIAL PRIMARY KEY,
  movimiento_id INTEGER NOT NULL REFERENCES movimientos_caja(id) ON DELETE CASCADE,
  medio_pago VARCHAR(30) NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- PRESUPUESTOS
-- =========================
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value_int INTEGER,
  value_text TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presupuestos (
  id SERIAL PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  obra_id INTEGER NOT NULL REFERENCES obras(id),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias INTEGER NOT NULL DEFAULT 15,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  forma_pago VARCHAR(120) DEFAULT 'Contado',
  observaciones TEXT DEFAULT '',
  subtotal_materiales NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 21,
  iva_monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id SERIAL PRIMARY KEY,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('material', 'mano_obra')),
  orden INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- ÍNDICES
-- =========================
CREATE INDEX IF NOT EXISTS idx_grupos_activo ON grupos(activo);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(activo);
CREATE INDEX IF NOT EXISTS idx_obras_estado ON obras(estado);
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados(activo);
CREATE INDEX IF NOT EXISTS idx_horas_fecha ON horas(fecha);
CREATE INDEX IF NOT EXISTS idx_horas_empleado ON horas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_periodo ON liquidaciones(periodo_inicio, periodo_fin);
CREATE INDEX IF NOT EXISTS idx_pagos_liquidacion ON pagos_sueldo(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha_pago ON pagos_sueldo(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_detalles_movimiento ON detalles_medio_pago(movimiento_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_obra ON presupuestos(obra_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_fecha ON presupuestos(fecha);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_presupuesto ON presupuesto_items(presupuesto_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_items_tipo ON presupuesto_items(tipo);

-- =========================
-- UPDATED_AT AUTOMÁTICO
-- =========================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_usuarios_updated_at ON usuarios;
CREATE TRIGGER trg_usuarios_updated_at BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_grupos_updated_at ON grupos;
CREATE TRIGGER trg_grupos_updated_at BEFORE UPDATE ON grupos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_clientes_updated_at ON clientes;
CREATE TRIGGER trg_clientes_updated_at BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_obras_updated_at ON obras;
CREATE TRIGGER trg_obras_updated_at BEFORE UPDATE ON obras FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_empleados_updated_at ON empleados;
CREATE TRIGGER trg_empleados_updated_at BEFORE UPDATE ON empleados FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_horas_updated_at ON horas;
CREATE TRIGGER trg_horas_updated_at BEFORE UPDATE ON horas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_liquidaciones_updated_at ON liquidaciones;
CREATE TRIGGER trg_liquidaciones_updated_at BEFORE UPDATE ON liquidaciones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_movimientos_caja_updated_at ON movimientos_caja;
CREATE TRIGGER trg_movimientos_caja_updated_at BEFORE UPDATE ON movimientos_caja FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_presupuestos_updated_at ON presupuestos;
CREATE TRIGGER trg_presupuestos_updated_at BEFORE UPDATE ON presupuestos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_config_updated_at ON app_config;
CREATE TRIGGER trg_app_config_updated_at BEFORE UPDATE ON app_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- DATOS MÍNIMOS
-- =========================
INSERT INTO grupos (nombre, descripcion)
SELECT x.nombre, x.descripcion
FROM (
  VALUES
    ('Tesla', 'Grupo operativo principal'),
    ('Teslita', 'Grupo operativo secundario'),
    ('grupo juani', 'Grupo operativo')
) AS x(nombre, descripcion)
WHERE NOT EXISTS (
  SELECT 1
  FROM grupos g
  WHERE lower(g.nombre) = lower(x.nombre)
);

DELETE FROM grupos g
WHERE g.nombre IN ('Grupo A', 'Grupo B')
  AND NOT EXISTS (SELECT 1 FROM obras o WHERE o.grupo_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM empleados e WHERE e.grupo_id = g.id)
  AND NOT EXISTS (SELECT 1 FROM horas h WHERE h.grupo_origen_id = g.id OR h.grupo_destino_id = g.id);

INSERT INTO clientes (razon_social, cuit, email)
SELECT 'Cliente Demo S.A.', '30-12345678-9', 'contacto@demo.com'
WHERE NOT EXISTS (
  SELECT 1
  FROM clientes c
  WHERE c.razon_social = 'Cliente Demo S.A.'
);

INSERT INTO app_config (key, value_int)
VALUES ('presupuesto_next_number', 1)
ON CONFLICT (key) DO NOTHING;
