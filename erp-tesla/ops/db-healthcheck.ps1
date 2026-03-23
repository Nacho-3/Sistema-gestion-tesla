$ErrorActionPreference = "Stop"

$serviceName = "postgresql-x64-18"
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$psql = Join-Path $pgBin "psql.exe"
$pgIsReady = Join-Path $pgBin "pg_isready.exe"

$dbHost = "localhost"
$dbPort = 5432
$dbName = "erp_tesla"
$dbUser = "postgres"
$dbPassword = "Admin"

Write-Host "== PostgreSQL healthcheck =="

$svc = Get-Service -Name $serviceName -ErrorAction Stop
if ($svc.Status -ne "Running") {
  Write-Error "Servicio $serviceName no esta corriendo. Estado: $($svc.Status)"
}
Write-Host "Servicio OK: $serviceName ($($svc.Status))"

$ready = & $pgIsReady -h $dbHost -p $dbPort -d $dbName -U $dbUser
Write-Host $ready
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_isready fallo."
}

$env:PGPASSWORD = $dbPassword
$query = "SELECT NOW() AS hora_servidor, COUNT(*) AS total_clientes FROM clientes;"
& $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -c $query
if ($LASTEXITCODE -ne 0) {
  Write-Error "Consulta de prueba fallo."
}

Write-Host "Healthcheck OK"
