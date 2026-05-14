-- MIGRACIÓN SEGURA: saldo_banco en cajas_semanales
ALTER TABLE IF EXISTS cajas_semanales ADD COLUMN IF NOT EXISTS saldo_banco NUMERIC(12,2);
ALTER TABLE IF EXISTS cajas_semanales ADD COLUMN IF NOT EXISTS saldo_pendiente_echeq NUMERIC(12,2);
ALTER TABLE IF EXISTS cajas_semanales ADD COLUMN IF NOT EXISTS saldo_echeq_depositados NUMERIC(12,2);
ALTER TABLE IF EXISTS cajas_semanales ADD COLUMN IF NOT EXISTS saldo_efectivo NUMERIC(12,2);
ALTER TABLE IF EXISTS cajas_semanales ADD COLUMN IF NOT EXISTS saldo_cheques NUMERIC(12,2);

-- MIGRACIÓN SEGURA: detalle en pagos_sueldo y reajuste_porcentaje en liquidaciones
ALTER TABLE IF EXISTS pagos_sueldo ADD COLUMN IF NOT EXISTS detalle TEXT DEFAULT '';
ALTER TABLE IF EXISTS liquidaciones ADD COLUMN IF NOT EXISTS reajuste_porcentaje NUMERIC(6,2) DEFAULT 0;

-- MIGRACIÓN SEGURA: dias_enfermedad en liquidaciones
ALTER TABLE IF EXISTS liquidaciones ADD COLUMN IF NOT EXISTS dias_enfermedad NUMERIC(12,2) DEFAULT 0;
ALTER TABLE IF EXISTS liquidaciones ADD COLUMN IF NOT EXISTS importe_enfermedad NUMERIC(12,2) DEFAULT 0;
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
  iva VARCHAR(100) DEFAULT 'Responsable Inscripto',
  empresa VARCHAR(255) DEFAULT '-',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS iva VARCHAR(100) DEFAULT 'Responsable Inscripto';

CREATE TABLE IF NOT EXISTS obras (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  estado VARCHAR(30) NOT NULL DEFAULT 'activa' CONSTRAINT chk_obras_estado CHECK (estado IN ('activa', 'finalizada', 'cerrada')),
  activo BOOLEAN DEFAULT TRUE,
  fecha_inicio DATE,
  horas_presupuestadas NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS empleados (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  apellido VARCHAR(120) NOT NULL,
  dni VARCHAR(20) NOT NULL,
  cuit VARCHAR(30),
  fecha_nacimiento DATE,
  direccion TEXT,
  telefono VARCHAR(50),
  tipo VARCHAR(30) CONSTRAINT chk_empleados_tipo CHECK (tipo IS NULL OR tipo IN ('monotributista', 'empleado_dependiente', 'no_corresponde')),
  alias VARCHAR(120),
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
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  obra_id INTEGER REFERENCES obras(id) ON DELETE SET NULL,
  fecha DATE NOT NULL,
  hora_inicio TIME,
  hora_fin TIME,
  cantidad_horas NUMERIC(8,2) NOT NULL,
  horas_trabajadas NUMERIC(8,2),
  es_hora_extra BOOLEAN DEFAULT FALSE,
  tipo_hora_extra VARCHAR(10),
  observaciones TEXT DEFAULT '',
  es_prestada BOOLEAN DEFAULT FALSE,
  tipo VARCHAR(20) DEFAULT 'normal',
  grupo_origen_id INTEGER REFERENCES grupos(id),
  grupo_destino_id INTEGER REFERENCES grupos(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS horas
  ADD COLUMN IF NOT EXISTS cliente_id INTEGER;

ALTER TABLE IF EXISTS horas
  ALTER COLUMN obra_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'horas_cliente_id_fkey'
      AND conrelid = 'horas'::regclass
  ) THEN
    ALTER TABLE horas
      ADD CONSTRAINT horas_cliente_id_fkey
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
  END IF;
END $$;

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
  presentismo NUMERIC(12,2) DEFAULT 0,
  horas_extra_cantidad NUMERIC(12,2) DEFAULT 0,
  importe_horas_extra NUMERIC(12,2) DEFAULT 0,
  horas_extra_100_cantidad NUMERIC(12,2) DEFAULT 0,
  importe_horas_extra_100 NUMERIC(12,2) DEFAULT 0,
  no_remunerativo NUMERIC(12,2) DEFAULT 0,
  aguinaldo NUMERIC(12,2) DEFAULT 0,
  vacaciones NUMERIC(12,2) DEFAULT 0,
  feriados_cantidad NUMERIC(12,2) DEFAULT 0,
  importe_feriados NUMERIC(12,2) DEFAULT 0,
  dias_no_trabajados NUMERIC(12,2) DEFAULT 0,
  descuento_dias_no_trabajados NUMERIC(12,2) DEFAULT 0,
  adelantos NUMERIC(12,2) DEFAULT 0,
  adicional NUMERIC(12,2) DEFAULT 0,
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
  redondeo_efectivo NUMERIC(12,2) NOT NULL DEFAULT 0,
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
  ADD COLUMN IF NOT EXISTS presentismo NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_extra_cantidad NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_horas_extra NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_extra_100_cantidad NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_horas_extra_100 NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_remunerativo NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aguinaldo NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vacaciones NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feriados_cantidad NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importe_feriados NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dias_no_trabajados NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_dias_no_trabajados NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adelantos NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adicional NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuentos NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monto_neto NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT '';

ALTER TABLE IF EXISTS pagos_sueldo
  ADD COLUMN IF NOT EXISTS fecha_pago DATE,
  ADD COLUMN IF NOT EXISTS redondeo_efectivo NUMERIC(12,2) DEFAULT 0;

ALTER TABLE IF EXISTS horas
  ADD COLUMN IF NOT EXISTS horas_trabajadas NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS es_hora_extra BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tipo_hora_extra VARCHAR(10),
  ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'normal';

ALTER TABLE IF EXISTS empleados
  ADD COLUMN IF NOT EXISTS cuit VARCHAR(30),
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
  ADD COLUMN IF NOT EXISTS direccion TEXT,
  ADD COLUMN IF NOT EXISTS telefono VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(30),
  ADD COLUMN IF NOT EXISTS alias VARCHAR(120);

UPDATE horas
SET horas_trabajadas = COALESCE(horas_trabajadas, cantidad_horas)
WHERE horas_trabajadas IS NULL;

UPDATE horas
SET tipo = CASE
  WHEN es_hora_extra = TRUE AND tipo_hora_extra = '100' THEN 'extra_100'
  WHEN es_hora_extra = TRUE THEN 'extra_50'
  WHEN es_prestada = TRUE THEN 'prestada'
  ELSE 'normal'
END
WHERE
  tipo IS DISTINCT FROM CASE
    WHEN es_hora_extra = TRUE AND tipo_hora_extra = '100' THEN 'extra_100'
    WHEN es_hora_extra = TRUE THEN 'extra_50'
    WHEN es_prestada = TRUE THEN 'prestada'
    ELSE 'normal'
  END;

UPDATE horas
SET tipo_hora_extra = CASE
  WHEN es_hora_extra = TRUE AND tipo = 'extra_100' THEN '100'
  WHEN es_hora_extra = TRUE AND tipo IN ('extra', 'extra_50') THEN '50'
  ELSE NULL
END
WHERE es_hora_extra = TRUE
  AND (
    tipo_hora_extra IS NULL
    OR tipo_hora_extra NOT IN ('50', '100')
  );

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

-- Obras: columna activo (soft-delete, igual que clientes/empleados/grupos)
ALTER TABLE IF EXISTS obras
  ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;

UPDATE obras SET activo = TRUE WHERE activo IS NULL;

-- Obras: Columna para el control de presupuesto de horas
ALTER TABLE IF EXISTS obras ADD COLUMN IF NOT EXISTS horas_presupuestadas NUMERIC(12,2) DEFAULT 0;

-- Obras: CHECK en estado para DBs existentes sin el constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_obras_estado'
      AND conrelid = 'obras'::regclass
  ) THEN
    ALTER TABLE obras ADD CONSTRAINT chk_obras_estado
      CHECK (estado IN ('activa', 'finalizada', 'cerrada'));
  END IF;
END $$;

-- Empleados: CHECK en tipo para DBs existentes sin el constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_empleados_tipo'
      AND conrelid = 'empleados'::regclass
  ) THEN
    UPDATE empleados
    SET tipo = NULL
    WHERE tipo IS NOT NULL AND tipo NOT IN ('monotributista', 'empleado_dependiente', 'no_corresponde');

    ALTER TABLE empleados ADD CONSTRAINT chk_empleados_tipo
      CHECK (tipo IS NULL OR tipo IN ('monotributista', 'empleado_dependiente', 'no_corresponde'));
  END IF;
END $$;

DO $$
BEGIN
  UPDATE empleados
  SET tipo = NULL
  WHERE tipo IS NOT NULL AND tipo NOT IN ('monotributista', 'empleado_dependiente', 'no_corresponde');

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_empleados_tipo'
      AND conrelid = 'empleados'::regclass
  ) THEN
    ALTER TABLE empleados DROP CONSTRAINT chk_empleados_tipo;
  END IF;

  ALTER TABLE empleados ADD CONSTRAINT chk_empleados_tipo
    CHECK (tipo IS NULL OR tipo IN ('monotributista', 'empleado_dependiente', 'no_corresponde'));
END $$;

-- Empleados: reemplazar UNIQUE global en DNI por índice parcial (solo activos)
-- Permite reutilizar DNI de empleados dados de baja (activo = false)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empleados_dni_key'
      AND conrelid = 'empleados'::regclass
  ) THEN
    ALTER TABLE empleados DROP CONSTRAINT empleados_dni_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_empleados_dni_activo ON empleados(dni) WHERE activo = TRUE;

-- =========================
-- CAJA
-- =========================
CREATE TABLE IF NOT EXISTS cajas_semanales (
  id SERIAL PRIMARY KEY,
  caja_codigo VARCHAR(20) NOT NULL DEFAULT 'tesla' CONSTRAINT chk_cajas_semanales_codigo CHECK (caja_codigo IN ('tesla', 'teslita', 'juani')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  saldo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ingresos NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_egresos NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_final NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_banco NUMERIC(12,2),
  saldo_pendiente_echeq NUMERIC(12,2),
  saldo_echeq_depositados NUMERIC(12,2),
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta' CONSTRAINT chk_cajas_semanales_estado CHECK (estado IN ('abierta', 'cerrada')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_cajas_semanales_rango CHECK (fecha_fin >= fecha_inicio),
  CONSTRAINT uq_cajas_semanales_periodo UNIQUE (caja_codigo, fecha_inicio, fecha_fin)
);

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  caja_codigo VARCHAR(20) NOT NULL DEFAULT 'tesla' CONSTRAINT chk_movimientos_caja_codigo CHECK (caja_codigo IN ('tesla', 'teslita', 'juani')),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  detalle TEXT NOT NULL,
  observaciones TEXT,
  categoria VARCHAR(20) CONSTRAINT chk_movimientos_categoria CHECK (categoria IS NULL OR categoria IN ('mano_obra', 'materiales', 'varios')),
  con_iva BOOLEAN NOT NULL DEFAULT true,
  destinatario TEXT,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  presupuesto_id INTEGER,
  monto_total NUMERIC(12,2) NOT NULL,
  CONSTRAINT chk_movimientos_reglas_tipo CHECK (
    (
      tipo = 'ingreso'
      AND categoria IN ('mano_obra', 'materiales', 'varios')
      AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NULL
      AND (presupuesto_id IS NULL OR cliente_id IS NOT NULL)
    )
    OR
    (
      tipo = 'egreso'
      AND categoria IS NULL
      AND cliente_id IS NULL
      AND presupuesto_id IS NULL
      AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NOT NULL
    )
  ),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gastos (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('tesla', 'facu', 'juani')),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  anio INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  iva_impuesto NUMERIC(12,2) DEFAULT 0,
  subtotal NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  pago_tesla NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE IF EXISTS movimientos_caja
  ADD COLUMN IF NOT EXISTS caja_codigo VARCHAR(20) NOT NULL DEFAULT 'tesla',
  ADD COLUMN IF NOT EXISTS caja_semanal_id INTEGER,
  ADD COLUMN IF NOT EXISTS observaciones TEXT,
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20),
  ADD COLUMN IF NOT EXISTS con_iva BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS destinatario TEXT,
  ADD COLUMN IF NOT EXISTS cliente_id INTEGER,
  ADD COLUMN IF NOT EXISTS presupuesto_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_movimientos_caja_semanal'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT fk_movimientos_caja_semanal
      FOREIGN KEY (caja_semanal_id)
      REFERENCES cajas_semanales(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE movimientos_caja
SET caja_codigo = 'tesla'
WHERE caja_codigo IS NULL OR caja_codigo = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_movimientos_presupuesto'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    UPDATE movimientos_caja mc
    SET presupuesto_id = NULL
    WHERE presupuesto_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM presupuestos p WHERE p.id = mc.presupuesto_id
      );

    ALTER TABLE movimientos_caja
      ADD CONSTRAINT fk_movimientos_presupuesto
      FOREIGN KEY (presupuesto_id)
      REFERENCES presupuestos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_monto_total_no_negativo'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT chk_movimientos_monto_total_no_negativo
      CHECK (monto_total >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS detalles_medio_pago (
  id SERIAL PRIMARY KEY,
  movimiento_id INTEGER NOT NULL REFERENCES movimientos_caja(id) ON DELETE CASCADE,
  medio_pago VARCHAR(30) NOT NULL CONSTRAINT chk_detalles_medio_pago_codigo CHECK (medio_pago IN ('efectivo', 'transferencia', 'cheque', 'echeq', 'retencion')),
  monto NUMERIC(12,2) NOT NULL CONSTRAINT chk_detalles_medio_pago_monto CHECK (monto > 0),
  identificador TEXT,
  banco TEXT,
  fecha_cobro DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS detalles_medio_pago
  ADD COLUMN IF NOT EXISTS identificador TEXT,
  ADD COLUMN IF NOT EXISTS banco TEXT,
  ADD COLUMN IF NOT EXISTS fecha_cobro DATE;

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
  proyecto TEXT DEFAULT '',
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias INTEGER NOT NULL DEFAULT 15,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  forma_pago VARCHAR(120) DEFAULT 'Contado',
  observaciones TEXT DEFAULT '',
  subtotal_materiales NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0,
  aplica_iva_materiales BOOLEAN NOT NULL DEFAULT TRUE,
  aplica_iva_mano_obra BOOLEAN NOT NULL DEFAULT FALSE,
  iva_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 21,
  iva_monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  mostrar_mano_obra_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  mostrar_materiales_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  info_interna_quien_hizo TEXT DEFAULT '',
  info_interna_quien_hizo_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  info_interna_quien_aprobo TEXT DEFAULT '',
  info_interna_quien_aprobo_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS presupuestos
  ADD COLUMN IF NOT EXISTS mostrar_mano_obra_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS mostrar_materiales_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aplica_iva_materiales BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS aplica_iva_mano_obra BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS proyecto TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS info_interna_quien_hizo TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS info_interna_quien_hizo_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS info_interna_quien_aprobo TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS info_interna_quien_aprobo_pdf BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS presupuesto_items (
  id SERIAL PRIMARY KEY,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('material', 'mano_obra')),
  orden INTEGER NOT NULL,
  etapa TEXT DEFAULT '',
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(12,2) NOT NULL DEFAULT 1,
  ganancia_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 0,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS presupuesto_items
  ADD COLUMN IF NOT EXISTS etapa TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS presupuesto_info_interna_items (
  id SERIAL PRIMARY KEY,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  mostrar_en_pdf BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificados (
  id SERIAL PRIMARY KEY,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  secuencia INTEGER NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
  tipo_registro VARCHAR(20) NOT NULL DEFAULT 'porcentaje' CHECK (tipo_registro IN ('porcentaje', 'monto')),
  porcentaje_avance NUMERIC(6,2) NOT NULL DEFAULT 0,
  importe_original NUMERIC(12,2) NOT NULL DEFAULT 0,
  certificado NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_base NUMERIC(12,2) NOT NULL DEFAULT 0,
  indice_cac NUMERIC(12,4) NOT NULL DEFAULT 1,
  indice_base_cac NUMERIC(12,2) NOT NULL DEFAULT 0,
  indice_actual_cac NUMERIC(12,2) NOT NULL DEFAULT 0,
  indice_origen VARCHAR(20) NOT NULL DEFAULT 'factor' CHECK (indice_origen IN ('factor', 'indices')),
  ajuste_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 0,
  actualizacion NUMERIC(12,2) NOT NULL DEFAULT 0,
  aplica_iva BOOLEAN NOT NULL DEFAULT TRUE,
  iva_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 21,
  iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cert_sin_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cert_con_iva NUMERIC(12,2) NOT NULL DEFAULT 0,
  acumulado_certificado NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pre_original NUMERIC(12,2) NOT NULL DEFAULT 0,
  pagos NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE certificados ADD COLUMN IF NOT EXISTS secuencia INTEGER;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'pendiente';
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS tipo_registro VARCHAR(20) NOT NULL DEFAULT 'porcentaje';
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS porcentaje_avance NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS monto_base NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS indice_cac NUMERIC(12,4) NOT NULL DEFAULT 1;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS indice_base_cac NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS indice_actual_cac NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS indice_origen VARCHAR(20) NOT NULL DEFAULT 'factor';
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS aplica_iva BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(6,2) NOT NULL DEFAULT 21;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS total_cert_con_iva NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS acumulado_certificado NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE certificados ADD COLUMN IF NOT EXISTS observaciones TEXT DEFAULT '';

UPDATE certificados
SET
  secuencia = COALESCE(secuencia, numero, 1),
  estado = COALESCE(NULLIF(estado, ''), 'pendiente'),
  tipo_registro = COALESCE(NULLIF(tipo_registro, ''), 'monto'),
  porcentaje_avance = COALESCE(porcentaje_avance, 0),
  monto_base = COALESCE(monto_base, certificado, 0),
  indice_cac = COALESCE(NULLIF(indice_cac, 0), 1),
  aplica_iva = COALESCE(aplica_iva, iva > 0),
  iva_porcentaje = COALESCE(iva_porcentaje, 21),
  total_cert_con_iva = COALESCE(total_cert_con_iva, total_cert_sin_iva + iva, 0),
  acumulado_certificado = COALESCE(acumulado_certificado, certificado, 0),
  observaciones = COALESCE(observaciones, '')
WHERE
  secuencia IS NULL
  OR estado IS NULL
  OR tipo_registro IS NULL
  OR porcentaje_avance IS NULL
  OR monto_base IS NULL
  OR indice_cac IS NULL
  OR aplica_iva IS NULL
  OR iva_porcentaje IS NULL
  OR total_cert_con_iva IS NULL
  OR acumulado_certificado IS NULL
  OR observaciones IS NULL;

WITH numerados AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY presupuesto_id ORDER BY fecha ASC, id ASC) AS nueva_secuencia
  FROM certificados
)
UPDATE certificados c
SET
  secuencia = n.nueva_secuencia,
  numero = n.nueva_secuencia
FROM numerados n
WHERE c.id = n.id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_horas_cantidad_pos'
      AND conrelid = 'horas'::regclass
  ) THEN
    ALTER TABLE horas
      ADD CONSTRAINT chk_horas_cantidad_pos
      CHECK (cantidad_horas > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_horas_trabajadas_pos'
      AND conrelid = 'horas'::regclass
  ) THEN
    ALTER TABLE horas
      ADD CONSTRAINT chk_horas_trabajadas_pos
      CHECK (horas_trabajadas IS NULL OR horas_trabajadas > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_presupuestos_totales_no_negativos'
      AND conrelid = 'presupuestos'::regclass
  ) THEN
    ALTER TABLE presupuestos
      ADD CONSTRAINT chk_presupuestos_totales_no_negativos
      CHECK (
        subtotal_materiales >= 0
        AND subtotal_mano_obra >= 0
        AND iva_monto >= 0
        AND total >= 0
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_certificados_valores_no_negativos'
      AND conrelid = 'certificados'::regclass
  ) THEN
    ALTER TABLE certificados
      ADD CONSTRAINT chk_certificados_valores_no_negativos
      CHECK (
        porcentaje_avance >= 0
        AND certificado >= 0
        AND monto_base >= 0
        AND indice_cac >= 0
        AND actualizacion >= 0
        AND iva >= 0
        AND total_cert_sin_iva >= 0
        AND total_cert_con_iva >= 0
        AND acumulado_certificado >= 0
        AND saldo_pre_original >= 0
        AND pagos >= 0
        AND saldo_pendiente >= 0
      );
  END IF;
END $$;

-- =========================
-- ÍNDICES
-- =========================
CREATE INDEX IF NOT EXISTS idx_grupos_activo ON grupos(activo);
CREATE INDEX IF NOT EXISTS idx_clientes_activo ON clientes(activo);
CREATE INDEX IF NOT EXISTS idx_obras_estado ON obras(estado);
CREATE INDEX IF NOT EXISTS idx_empleados_activo ON empleados(activo);
CREATE INDEX IF NOT EXISTS idx_horas_fecha ON horas(fecha);
CREATE INDEX IF NOT EXISTS idx_horas_empleado ON horas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_horas_fecha_empleado ON horas(fecha, empleado_id);
CREATE INDEX IF NOT EXISTS idx_horas_fecha_obra ON horas(fecha, obra_id);
CREATE INDEX IF NOT EXISTS idx_certificados_presupuesto ON certificados(presupuesto_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_certificados_presupuesto_secuencia ON certificados(presupuesto_id, secuencia);
CREATE INDEX IF NOT EXISTS idx_certificados_estado ON certificados(estado);
CREATE INDEX IF NOT EXISTS idx_certificados_presupuesto_estado ON certificados(presupuesto_id, estado);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_periodo ON liquidaciones(periodo_inicio, periodo_fin);
CREATE INDEX IF NOT EXISTS idx_pagos_liquidacion ON pagos_sueldo(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha_pago ON pagos_sueldo(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha_tipo ON movimientos_caja(fecha, tipo);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_codigo ON movimientos_caja(caja_codigo);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_semanal ON movimientos_caja(caja_semanal_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_fecha_tipo ON movimientos_caja(caja_codigo, fecha, tipo);
CREATE INDEX IF NOT EXISTS idx_cajas_semanales_codigo_inicio ON cajas_semanales(caja_codigo, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_movimientos_cliente ON movimientos_caja(cliente_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_presupuesto ON movimientos_caja(presupuesto_id);
CREATE INDEX IF NOT EXISTS idx_detalles_movimiento ON detalles_medio_pago(movimiento_id);
DROP INDEX IF EXISTS uq_detalles_medio_pago_movimiento_medio;
CREATE INDEX IF NOT EXISTS idx_detalles_medio_pago_movimiento_medio ON detalles_medio_pago(movimiento_id, medio_pago);
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

DROP TRIGGER IF EXISTS trg_certificados_updated_at ON certificados;
CREATE TRIGGER trg_certificados_updated_at BEFORE UPDATE ON certificados FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_config_updated_at ON app_config;
CREATE TRIGGER trg_app_config_updated_at BEFORE UPDATE ON app_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================
-- INTEGRIDAD REFERENCIAL
-- (debe ejecutarse luego de que todas las tablas existan)
-- =========================

-- movimientos_caja.cliente_id → clientes (ON DELETE SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movimientos_caja_cliente_id_fkey'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    UPDATE movimientos_caja
    SET cliente_id = NULL
    WHERE cliente_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = movimientos_caja.cliente_id);

    ALTER TABLE movimientos_caja
      ADD CONSTRAINT movimientos_caja_cliente_id_fkey
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- movimientos_caja.presupuesto_id → presupuestos (ON DELETE SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movimientos_caja_presupuesto_id_fkey'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    UPDATE movimientos_caja
    SET presupuesto_id = NULL
    WHERE presupuesto_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM presupuestos WHERE id = movimientos_caja.presupuesto_id);

    ALTER TABLE movimientos_caja
      ADD CONSTRAINT movimientos_caja_presupuesto_id_fkey
      FOREIGN KEY (presupuesto_id) REFERENCES presupuestos(id) ON DELETE SET NULL;
  END IF;
END $$;

-- movimientos_caja.categoria: normalizar nombre del CHECK (para DBs migradas sin constraint nombrado)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movimientos_caja_categoria_check'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja DROP CONSTRAINT movimientos_caja_categoria_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_categoria'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja DROP CONSTRAINT chk_movimientos_categoria;
  END IF;

  UPDATE movimientos_caja
  SET categoria = NULL
  WHERE categoria IS NOT NULL AND categoria NOT IN ('mano_obra', 'materiales', 'varios');

  ALTER TABLE movimientos_caja ADD CONSTRAINT chk_movimientos_categoria
    CHECK (categoria IS NULL OR categoria IN ('mano_obra', 'materiales', 'varios'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_caja_codigo'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja DROP CONSTRAINT chk_movimientos_caja_codigo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_caja_codigo'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT chk_movimientos_caja_codigo
      CHECK (caja_codigo IN ('tesla', 'teslita', 'juani'));
  END IF;
END $$;

UPDATE movimientos_caja
SET caja_codigo = LOWER(BTRIM(COALESCE(caja_codigo, '')))
WHERE caja_codigo IS NOT NULL
  AND caja_codigo <> LOWER(BTRIM(caja_codigo));

UPDATE movimientos_caja
SET caja_codigo = 'tesla'
WHERE caja_codigo IS NULL
  OR BTRIM(caja_codigo) = ''
  OR caja_codigo = 'general'
  OR caja_codigo NOT IN ('tesla', 'teslita', 'juani');

UPDATE movimientos_caja mc
SET cliente_id = p.cliente_id
FROM presupuestos p
WHERE mc.presupuesto_id = p.id
  AND mc.tipo = 'ingreso'
  AND mc.cliente_id IS NULL;

UPDATE movimientos_caja mc
SET cliente_id = p.cliente_id
FROM presupuestos p
WHERE mc.presupuesto_id = p.id
  AND mc.tipo = 'ingreso'
  AND mc.cliente_id IS NOT NULL
  AND mc.cliente_id <> p.cliente_id;

UPDATE movimientos_caja
SET categoria = NULL,
    cliente_id = NULL,
    presupuesto_id = NULL,
    destinatario = NULLIF(BTRIM(COALESCE(destinatario, '')), '')
WHERE tipo = 'egreso';

UPDATE movimientos_caja
SET destinatario = NULL
WHERE tipo = 'ingreso';

UPDATE movimientos_caja
SET categoria = NULL
WHERE categoria IS NOT NULL
  AND categoria NOT IN ('mano_obra', 'materiales', 'varios');

UPDATE movimientos_caja
SET monto_total = ABS(monto_total)
WHERE monto_total < 0;

DELETE FROM detalles_medio_pago
WHERE monto IS NULL
  OR monto <= 0
  OR medio_pago IS NULL
  OR LOWER(BTRIM(medio_pago)) NOT IN ('efectivo', 'transferencia', 'cheque', 'echeq', 'retencion');

UPDATE detalles_medio_pago
SET medio_pago = LOWER(BTRIM(medio_pago))
WHERE medio_pago IS NOT NULL
  AND medio_pago <> LOWER(BTRIM(medio_pago));

DELETE FROM detalles_medio_pago d
USING detalles_medio_pago duplicado
WHERE d.id < duplicado.id
  AND d.movimiento_id = duplicado.movimiento_id
  AND LOWER(BTRIM(d.medio_pago)) = LOWER(BTRIM(duplicado.medio_pago))
  AND COALESCE(NULLIF(BTRIM(d.identificador), ''), '-') = COALESCE(NULLIF(BTRIM(duplicado.identificador), ''), '-')
  AND COALESCE(d.monto, 0) = COALESCE(duplicado.monto, 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_reglas_tipo'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja DROP CONSTRAINT chk_movimientos_reglas_tipo;
  END IF;

  ALTER TABLE movimientos_caja
    ADD CONSTRAINT chk_movimientos_reglas_tipo
    CHECK (
      (
        tipo = 'ingreso'
        AND categoria IN ('mano_obra', 'materiales', 'varios')
        AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NULL
        AND (presupuesto_id IS NULL OR cliente_id IS NOT NULL)
      )
      OR
      (
        tipo = 'egreso'
        AND categoria IS NULL
        AND cliente_id IS NULL
        AND presupuesto_id IS NULL
        AND NULLIF(BTRIM(COALESCE(destinatario, '')), '') IS NOT NULL
      )
    );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_movimientos_monto_total_positivo'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT chk_movimientos_monto_total_positivo
      CHECK (monto_total > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_presupuestos_id_cliente ON presupuestos(id, cliente_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_movimientos_presupuesto_cliente'
      AND conrelid = 'movimientos_caja'::regclass
  ) THEN
    ALTER TABLE movimientos_caja
      ADD CONSTRAINT fk_movimientos_presupuesto_cliente
      FOREIGN KEY (presupuesto_id, cliente_id)
      REFERENCES presupuestos(id, cliente_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_detalles_medio_pago_codigo'
      AND conrelid = 'detalles_medio_pago'::regclass
  ) THEN
    ALTER TABLE detalles_medio_pago
      ADD CONSTRAINT chk_detalles_medio_pago_codigo
      CHECK (medio_pago IN ('efectivo', 'transferencia', 'cheque', 'echeq', 'retencion'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_detalles_medio_pago_monto'
      AND conrelid = 'detalles_medio_pago'::regclass
  ) THEN
    ALTER TABLE detalles_medio_pago
      ADD CONSTRAINT chk_detalles_medio_pago_monto
      CHECK (monto > 0);
  END IF;
END $$;

-- =========================
-- ÍNDICES CAC
-- =========================
CREATE TABLE IF NOT EXISTS indices_cac (
  id SERIAL PRIMARY KEY,
  periodo VARCHAR(100) NOT NULL,
  valor NUMERIC(12,4) NOT NULL CHECK (valor > 0),
  fecha_publicacion DATE,
  notas TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Presupuestos: columna para referenciar el índice CAC base al momento del contrato
ALTER TABLE IF EXISTS presupuestos
  ADD COLUMN IF NOT EXISTS indice_cac_base_id INTEGER REFERENCES indices_cac(id) ON DELETE SET NULL;
