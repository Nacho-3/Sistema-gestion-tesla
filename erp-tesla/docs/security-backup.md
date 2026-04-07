# Seguridad y Backups

## Estado actual

- El backend exige autenticación JWT para todas las rutas salvo `/auth/login`.
- La API HTTP usa cookie `HttpOnly` para sesión.
- El usuario admin por defecto ya no se crea desde `schema.sql`.
- La sesión del frontend se guarda en `sessionStorage` y migra automáticamente si antes estaba en `localStorage`.
- El backend puede generar backups automáticos de PostgreSQL por cambios y también en forma periódica.

## Variables recomendadas

Tomá como base `backend/.env.example` y configurá valores reales en `backend/.env`.

Críticas:

- `DB_PASSWORD`: usá una contraseña fuerte y única.
- `JWT_SECRET`: usá una cadena larga, aleatoria y única.
- `ALLOWED_ORIGINS`: dejá sólo las URLs reales que van a usar el sistema.

Bootstrap opcional de admin:

- `APP_BOOTSTRAP_ADMIN=true`
- `APP_BOOTSTRAP_ADMIN_EMAIL=admin@tu-dominio`
- `APP_BOOTSTRAP_ADMIN_PASSWORD=clave-fuerte`

Usalo sólo para crear el primer usuario. Después conviene volver a `false`.

## Backup automático

Configuración disponible en `backend/.env`:

- `BACKUP_ENABLED=true`: activa el servicio.
- `BACKUP_ON_WRITE=true`: programa backup cuando hay POST, PUT, PATCH o DELETE exitosos.
- `BACKUP_ON_START=false`: opcional, genera backup al iniciar el backend.
- `BACKUP_ROOT=C:\ERP-Tesla-Backups`: carpeta destino.
- `BACKUP_RETENTION_DAYS=21`: retención.
- `BACKUP_DEBOUNCE_MS=120000`: espera antes de ejecutar después de cambios.
- `BACKUP_MIN_INTERVAL_MS=900000`: evita correr demasiados backups seguidos.
- `BACKUP_PERIODIC_MS=21600000`: backup periódico adicional. En este ejemplo, cada 6 horas.
- `PG_DUMP_PATH=...\pg_dump.exe`: ruta a `pg_dump`.

## Scripts operativos

Backup manual:

```powershell
cd backend
npm run backup:now
```

Tarea programada de Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\create-db-backup-task.ps1
```

Healthcheck de PostgreSQL:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\db-healthcheck.ps1
```

Logout de sesión:

```text
POST /auth/logout
```

Consulta de usuario autenticado:

```text
GET /auth/me
```

## Restauración

Ejemplo con `pg_restore`:

```powershell
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -p 5432 -U postgres -d erp_tesla "C:\ERP-Tesla-Backups\archivo.backup"
```

Script local:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\db-restore.ps1 -BackupFile "C:\ERP-Tesla-Backups\archivo.backup"
```

Práctica recomendada:

- Restaurar primero en una base de prueba.
- Verificar tablas críticas: clientes, obras, horas, liquidaciones, caja, presupuestos y certificados.
- Recién después restaurar sobre producción.

## Recomendaciones pendientes

- Copiar backups a otra PC, NAS o nube. Si el backup queda sólo en la misma máquina, no cubre falla total del disco o ransomware.
- Implementar roles reales por módulo si van a existir usuarios no administradores.
