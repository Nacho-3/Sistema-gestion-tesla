param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$TargetDatabase = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $repoRoot "backend\.env"

if (!(Test-Path $envPath)) {
  throw "No existe el archivo de entorno: $envPath"
}

Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $parts = $_ -split '=', 2
  if ($parts.Count -eq 2) {
    [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
  }
}

if (!(Test-Path $BackupFile)) {
  throw "No existe el backup: $BackupFile"
}

$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else { "C:\Program Files\PostgreSQL\18\bin" }
$pgRestore = Join-Path $pgBin "pg_restore.exe"

if (!(Test-Path $pgRestore)) {
  throw "No existe pg_restore: $pgRestore"
}

$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$dbPort = if ($env:DB_PORT) { $env:DB_PORT } else { 5432 }
$dbName = if ($TargetDatabase) { $TargetDatabase } elseif ($env:DB_NAME) { $env:DB_NAME } else { "erp_tesla" }
$dbUser = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$dbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }

$env:PGPASSWORD = $dbPassword
& $pgRestore -h $dbHost -p $dbPort -U $dbUser -d $dbName -c $BackupFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore fallo con codigo $LASTEXITCODE"
}

Write-Host "Restore OK sobre base: $dbName"