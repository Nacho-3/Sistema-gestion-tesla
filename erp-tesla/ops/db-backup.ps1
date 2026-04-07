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

$pgDump = if ($env:PG_DUMP_PATH) { $env:PG_DUMP_PATH } else { Join-Path "C:\Program Files\PostgreSQL\18\bin" "pg_dump.exe" }

$dbHost = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$dbPort = if ($env:DB_PORT) { $env:DB_PORT } else { 5432 }
$dbName = if ($env:DB_NAME) { $env:DB_NAME } else { "erp_tesla" }
$dbUser = if ($env:DB_USER) { $env:DB_USER } else { "postgres" }
$dbPassword = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }

$backupRoot = if ($env:BACKUP_ROOT) { $env:BACKUP_ROOT } else { "C:\ERP-Tesla-Backups" }
$retentionDays = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 21 }

if (!(Test-Path $pgDump)) {
  throw "No existe pg_dump: $pgDump"
}

if (!(Test-Path $backupRoot)) {
  New-Item -ItemType Directory -Path $backupRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $backupRoot ("erp_tesla_" + $timestamp + ".backup")

$env:PGPASSWORD = $dbPassword
& $pgDump -h $dbHost -p $dbPort -U $dbUser -d $dbName -F c -f $backupFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump fallo con codigo $LASTEXITCODE"
}

Get-ChildItem -Path $backupRoot -Filter "*.backup" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$retentionDays) } |
  Remove-Item -Force

Write-Host "Backup OK: $backupFile"
