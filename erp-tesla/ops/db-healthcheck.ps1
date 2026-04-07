$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $repoRoot "backend\.env"

if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) {
      [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
    }
  }
}

$serviceName = "postgresql-x64-18"
$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { "C:\Program Files\PostgreSQL\18\bin" }
$psql = Join-Path $pgBin "psql.exe"
$pgIsReady = Join-Path $pgBin "pg_isready.exe"

$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$dbPort = if ($env:DB_PORT) { $env:DB_PORT } else { 5432 }
$dbName = if ($env:DB_NAME) { $env:DB_NAME } else { "erp_tesla" }
$dbUser = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$dbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }

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
