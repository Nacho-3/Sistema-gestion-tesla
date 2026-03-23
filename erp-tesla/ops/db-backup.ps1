$ErrorActionPreference = "Stop"

$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$pgDump = Join-Path $pgBin "pg_dump.exe"

$dbHost = "localhost"
$dbPort = 5432
$dbName = "erp_tesla"
$dbUser = "postgres"
$dbPassword = "Admin"

$backupRoot = "C:\ERP-Tesla-Backups"
$retentionDays = 14

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
