-- ERP Tesla - Schema PostgreSQL local

--Get-Process node | Stop-Process -Force

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
  es_prestada BOOLEAN DEFAULT FALSE,
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
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  total_horas NUMERIC(12,2) DEFAULT 0,
  valor_hora NUMERIC(12,2) DEFAULT 0,
  importe_horas NUMERIC(12,2) DEFAULT 0,
  importe_horas_extra NUMERIC(12,2) DEFAULT 0,
  no_remunerativo NUMERIC(12,2) DEFAULT 0,
  aguinaldo NUMERIC(12,2) DEFAULT 0,
  vacaciones NUMERIC(12,2) DEFAULT 0,
  adelantos NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_liquidacion_periodo UNIQUE (empleado_id, mes, anio)
);

CREATE TABLE IF NOT EXISTS pagos_sueldo (
  id SERIAL PRIMARY KEY,
  liquidacion_id INTEGER NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
  monto NUMERIC(12,2) NOT NULL,
  medio_pago VARCHAR(50),
  fecha DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
-- ÍNDICES
-- =========================
CREATE INDEX IF NOT EXISTS idx_grupos_activo ON grupos(activo);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(activo);
CREATE INDEX IF NOT EXISTS idx_obras_estado ON obras(estado);
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados(activo);
CREATE INDEX IF NOT EXISTS idx_horas_fecha ON horas(fecha);
CREATE INDEX IF NOT EXISTS idx_horas_empleado ON horas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_periodo ON liquidaciones(anio, mes);
CREATE INDEX IF NOT EXISTS idx_pagos_liquidacion ON pagos_sueldo(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_detalles_movimiento ON detalles_medio_pago(movimiento_id);

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

-- =========================
-- DATOS MÍNIMOS
-- =========================
INSERT INTO grupos (nombre, descripcion)
VALUES
  ('Grupo A', 'Grupo inicial'),
  ('Grupo B', 'Grupo inicial')
ON CONFLICT DO NOTHING;

INSERT INTO clientes (razon_social, cuit, email)
VALUES ('Cliente Demo S.A.', '30-12345678-9', 'contacto@demo.com')
ON CONFLICT DO NOTHING;
