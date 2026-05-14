param(
  [string]$CaddyExe = "caddy",
  [string]$BackendPort = "3000",
  [string]$CaddyHttpsPort = "443",
  [switch]$ForceRestart,
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$caddyConfig = Join-Path $repoRoot "Caddyfile"
$logDir = Join-Path $repoRoot "ops"
$logFile = Join-Path $logDir "startup-services.log"

function Test-PortListening {
  param([int]$Port)

  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    return ($conn | Measure-Object).Count -gt 0
  } catch {
    $listenPattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+\d+\s*$"
    $netstat = netstat -ano | Select-String $listenPattern
    return ($netstat | Measure-Object).Count -gt 0
  }
}

function Ensure-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "No se encontró el comando '$Name' en PATH."
  }
}

function Resolve-CaddyExecutable {
  param([string]$Preferred)

  if ($Preferred -and (Test-Path $Preferred)) {
    return (Resolve-Path $Preferred).Path
  }

  $command = Get-Command $Preferred -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $fallbacks = @(
    "$env:LOCALAPPDATA\\Microsoft\\WinGet\\Links\\caddy.exe",
    "C:\\Program Files\\Caddy\\caddy.exe",
    "C:\\caddy\\caddy.exe"
  )

  foreach ($candidate in $fallbacks) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "No se encontró caddy.exe. Instalalo con winget o indicá ruta con -CaddyExe."
}

function Write-StartupLog {
  param([string]$Message)

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$stamp] $Message"
}

if (-not (Test-Path $backendDir)) {
  throw "No existe la carpeta backend: $backendDir"
}

if (-not (Test-Path $caddyConfig)) {
  throw "No existe el Caddyfile: $caddyConfig"
}

Ensure-Command -Name "npm"
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$resolvedCaddyExe = Resolve-CaddyExecutable -Preferred $CaddyExe
Write-StartupLog "Inicio de script. CaddyExe=$resolvedCaddyExe BackendPort=$BackendPort CaddyPort=$CaddyHttpsPort WhatIf=$WhatIf ForceRestart=$ForceRestart"

$backendRunning = Test-PortListening -Port ([int]$BackendPort)
$caddyPortListening = Test-PortListening -Port ([int]$CaddyHttpsPort)
$caddyProcess = Get-Process -Name "caddy" -ErrorAction SilentlyContinue | Select-Object -First 1
$caddyRunning = ($null -ne $caddyProcess) -and $caddyPortListening

if ($caddyPortListening -and -not $caddyProcess) {
  Write-StartupLog "Atención: el puerto $CaddyHttpsPort está en escucha pero no hay proceso caddy.exe."
}

if ($ForceRestart) {
  Write-Host "ForceRestart activo: cerrando procesos previos..."

  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match "backend\\server\.js" } |
    ForEach-Object {
      if (-not $WhatIf) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      Write-Host "Backend detenido (PID=$($_.ProcessId))"
    }

  Get-Process -Name "caddy" -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $WhatIf) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "Caddy detenido (PID=$($_.Id))"
  }

  Start-Sleep -Seconds 1
  $backendRunning = $false
  $caddyRunning = $false
}

if (-not $backendRunning) {
  Write-Host "Iniciando backend en $backendDir ..."
  Write-StartupLog "Iniciando backend (npm start) en $backendDir"
  if (-not $WhatIf) {
    try {
      $npmCmd = Get-Command npm.cmd -ErrorAction Stop | Select-Object -ExpandProperty Source
      Start-Process -FilePath $npmCmd -ArgumentList "start" -WorkingDirectory $backendDir -WindowStyle Minimized | Out-Null
      Write-StartupLog "Backend iniciado con npm.cmd: $npmCmd"
    } catch {
      Write-StartupLog "ERROR iniciando backend: $_"
      Write-Host "ERROR: No se pudo iniciar backend. Ver log para detalles."
    }
  }
} else {
  Write-Host "Backend ya estaba activo (puerto $BackendPort)."
  Write-StartupLog "Backend ya activo en puerto $BackendPort"
}

if (-not $caddyRunning) {
  Write-Host "Iniciando Caddy con config $caddyConfig ..."
  Write-StartupLog "Iniciando Caddy usando $resolvedCaddyExe"
  if (-not $WhatIf) {
    try {
      Start-Process -FilePath $resolvedCaddyExe -ArgumentList @("run", "--config", $caddyConfig) -WorkingDirectory $repoRoot -WindowStyle Minimized | Out-Null
      Write-StartupLog "Caddy iniciado correctamente"
    } catch {
      Write-StartupLog "ERROR iniciando Caddy: $_"
      Write-Host "ERROR: No se pudo iniciar Caddy. Ver log para detalles."
    }
  }
} else {
  Write-Host "Caddy ya estaba activo (puerto $CaddyHttpsPort)."
  Write-StartupLog "Caddy ya activo en puerto $CaddyHttpsPort"
}

if (-not $WhatIf) {
  Start-Sleep -Seconds 2
}

$backendFinal = Test-PortListening -Port ([int]$BackendPort)
$caddyFinal = Test-PortListening -Port ([int]$CaddyHttpsPort)

Write-Host ""
Write-Host "Estado final:"
Write-Host "- Backend puerto ${BackendPort}: $(if ($backendFinal) { 'OK' } else { 'NO ACTIVO' })"
Write-Host "- Caddy puerto ${CaddyHttpsPort}: $(if ($caddyFinal) { 'OK' } else { 'NO ACTIVO' })"
Write-StartupLog "Estado final: backend=$backendFinal caddy=$caddyFinal"
