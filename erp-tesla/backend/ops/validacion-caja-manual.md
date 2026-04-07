# Validacion manual de Caja

Usar esta guia despues de correr:

```bash
npm run validate:caja-db
```

Objetivo:
- validar UI + backend + base
- confirmar que la DB rechaza inconsistencias
- confirmar que los datos guardados quedan coherentes en movimientos_caja y detalles_medio_pago

## 1. Egreso valido

En Caja:
- elegir una subcaja, por ejemplo Tesla
- crear un egreso
- completar destinatario
- completar detalle
- monto total: 1500
- desglose: efectivo 1500

Resultado esperado:
- guarda sin error
- aparece en la lista de la subcaja elegida
- en detalle figura la caja correcta y el destinatario

SQL de control:

```sql
SELECT id, fecha, caja_codigo, tipo, categoria, destinatario, cliente_id, presupuesto_id, monto_total
FROM movimientos_caja
ORDER BY id DESC
LIMIT 5;

SELECT movimiento_id, medio_pago, monto
FROM detalles_medio_pago
WHERE movimiento_id = <ID_DEL_MOVIMIENTO>;
```

Debe verse:
- tipo = 'egreso'
- categoria = null
- cliente_id = null
- presupuesto_id = null
- destinatario con valor
- un detalle de pago valido

## 2. Egreso invalido sin destinatario

En Caja:
- crear un egreso
- dejar destinatario vacio
- completar monto y desglose correctos

Resultado esperado:
- la UI no deberia dejar guardar
- si alguien fuerza el request, la base rechaza por chk_movimientos_reglas_tipo

## 3. Ingreso valido

En Caja:
- crear un ingreso
- categoria: mano de obra o materiales
- opcionalmente asociar cliente
- si elegis presupuesto, que sea del mismo cliente
- monto total: 2000
- desglose: transferencia 2000

Resultado esperado:
- guarda sin error
- en DB el destinatario queda null
- categoria queda informada

SQL de control:

```sql
SELECT id, caja_codigo, tipo, categoria, destinatario, cliente_id, presupuesto_id, monto_total
FROM movimientos_caja
ORDER BY id DESC
LIMIT 5;
```

Debe verse:
- tipo = 'ingreso'
- categoria en ('mano_obra', 'materiales')
- destinatario = null

## 4. Ingreso invalido con presupuesto de otro cliente

En Caja:
- elegir un cliente
- intentar asociar un presupuesto de otro cliente

Resultado esperado:
- idealmente la UI ya lo evita filtrando presupuestos
- si alguien fuerza el request, backend o DB deben rechazarlo
- la FK compuesta fk_movimientos_presupuesto_cliente no debe permitir una combinacion inconsistente

SQL para detectar inconsistencias historicas:

```sql
SELECT mc.id, mc.cliente_id, mc.presupuesto_id, p.cliente_id AS presupuesto_cliente_id
FROM movimientos_caja mc
JOIN presupuestos p ON p.id = mc.presupuesto_id
WHERE mc.cliente_id IS DISTINCT FROM p.cliente_id;
```

Debe devolver 0 filas.

## 5. Validar filtro por subcaja

En Caja:
- crear al menos un movimiento en Tesla y otro en Teslita
- crear al menos un movimiento en Juani
- cambiar entre tabs

Resultado esperado:
- cada tab muestra solo su caja
- el PDF resumen respeta la subcaja seleccionada

SQL de control:

```sql
SELECT caja_codigo, tipo, COUNT(*)
FROM movimientos_caja
GROUP BY caja_codigo, tipo
ORDER BY caja_codigo, tipo;
```

Control puntual para asegurar que no exista Caja General:

```sql
SELECT COUNT(*) AS movimientos_en_general
FROM movimientos_caja
WHERE caja_codigo = 'general';
```

Debe devolver `0`.

## 6. Validar detalles de medio de pago

La base ahora exige:
- medio_pago valido: efectivo, transferencia, cheque, echeq, retencion
- monto > 0
- no repetir el mismo medio para un mismo movimiento

SQL de control rapido:

```sql
SELECT movimiento_id, medio_pago, COUNT(*)
FROM detalles_medio_pago
GROUP BY movimiento_id, medio_pago
HAVING COUNT(*) > 1;

SELECT *
FROM detalles_medio_pago
WHERE medio_pago NOT IN ('efectivo', 'transferencia', 'cheque', 'echeq', 'retencion')
   OR monto <= 0;
```

Ambas consultas deben devolver 0 filas.

## 7. Chequeo final de consistencia

```sql
SELECT id, tipo, categoria, destinatario, cliente_id, presupuesto_id
FROM movimientos_caja
WHERE (tipo = 'egreso' AND (categoria IS NOT NULL OR cliente_id IS NOT NULL OR presupuesto_id IS NOT NULL OR destinatario IS NULL OR BTRIM(destinatario) = ''))
   OR (tipo = 'ingreso' AND (categoria IS NULL OR destinatario IS NOT NULL));
```

Debe devolver 0 filas.

## 8. Prueba manual minima recomendada

1. Crear un egreso valido en Caja Tesla con destinatario y desglose simple.
2. Crear un ingreso valido en Caja Teslita con categoria y un solo medio de pago.
3. Crear un egreso valido en Caja Juani.
4. Volver a cada tab y confirmar que solo aparece el movimiento de esa caja.
5. Ejecutar estas dos consultas:

```sql
SELECT caja_codigo, COUNT(*)
FROM movimientos_caja
GROUP BY caja_codigo
ORDER BY caja_codigo;

SELECT COUNT(*) AS movimientos_en_general
FROM movimientos_caja
WHERE caja_codigo = 'general';
```

Resultado esperado:
- aparecen solo `tesla`, `teslita` y `juani`
- `movimientos_en_general = 0`

## Comandos utiles

Validacion automatica de constraints:

```bash
npm run validate:caja-db
```

Aplicar schema nuevamente si hiciste cambios:

```bash
node ops/apply-schema.mjs
```