param(
  [string]$RepoRoot,
  [switch]$SkipIfRunning
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$backendDir = Join-Path $RepoRoot "backend"
$logFile = Join-Path $PSScriptRoot "startup-terminals.log"

if (-not (Test-Path $backendDir)) {
  throw "No existe la carpeta backend: $backendDir"
}

function Test-ListeningPort {
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

function Write-StartupLog {
  param([string]$Message)

  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$stamp] $Message"
}

function Resolve-RequiredCommand {
  param(
    [string]$Name,
    [string[]]$Fallbacks,
    [string]$Label
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  foreach ($candidate in $Fallbacks) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "No se encontró $Label en PATH ni en rutas conocidas."
}

function Escape-PowerShellSingleQuoted {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function New-WindowCommand {
  param(
    [string]$Path,
    [string]$Title,
    [string]$Command,
    [bool]$Skip,
    [int]$Port
  )

  $safePath = $Path.Replace("'", "''")
  $safeTitle = $Title.Replace("'", "''")
  # $Command already contains the needed quoting for executable paths.
  # Escaping single quotes again here turns "& 'C:\\...\\npm.cmd'" into
  # "& ''C:\\...\\npm.cmd''", which PowerShell cannot execute.
  $safeCommand = $Command

  if ($Skip -and $Port -gt 0) {
    return "Set-Location -LiteralPath '$safePath'; `$Host.UI.RawUI.WindowTitle = '$safeTitle'; if ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { Write-Host 'Ya estaba en ejecucion (puerto $Port).'; } else { $safeCommand }"
  }

  return "Set-Location -LiteralPath '$safePath'; `$Host.UI.RawUI.WindowTitle = '$safeTitle'; $safeCommand"
}

$repoRootSafe = Escape-PowerShellSingleQuoted -Value $RepoRoot
if (-not (Test-Path $PSScriptRoot)) {
  throw "No existe el directorio de ops: $PSScriptRoot"
}

if (-not (Test-Path $logFile)) {
  New-Item -Path $logFile -ItemType File -Force | Out-Null
}

$resolvedNpmCmd = Resolve-RequiredCommand -Name "npm.cmd" -Fallbacks @(
  "C:\Program Files\nodejs\npm.cmd"
) -Label "npm.cmd"

$resolvedCaddyExe = Resolve-RequiredCommand -Name "caddy" -Fallbacks @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\caddy.exe",
  "C:\Program Files\Caddy\caddy.exe",
  "C:\caddy\caddy.exe"
) -Label "caddy.exe"

$npmSafe = Escape-PowerShellSingleQuoted -Value $resolvedNpmCmd
$caddySafe = Escape-PowerShellSingleQuoted -Value $resolvedCaddyExe

Write-StartupLog "Inicio. RepoRoot=$RepoRoot SkipIfRunning=$($SkipIfRunning.IsPresent) npm=$resolvedNpmCmd caddy=$resolvedCaddyExe"

$backendAlreadyRunning = Test-ListeningPort -Port 3000
$caddyAlreadyRunning = Test-ListeningPort -Port 443

Write-StartupLog "Estado previo: backend3000=$backendAlreadyRunning caddy443=$caddyAlreadyRunning"

$backendStart = "& '$npmSafe' start"
$caddyStart = "& '$caddySafe' run"

$backendCommand = New-WindowCommand -Path $backendDir -Title "ERP Tesla Backend" -Command $backendStart -Skip $SkipIfRunning.IsPresent -Port 3000
$caddyCommand = New-WindowCommand -Path $RepoRoot -Title "ERP Tesla Caddy" -Command $caddyStart -Skip $SkipIfRunning.IsPresent -Port 443

if (-not ($SkipIfRunning -and $backendAlreadyRunning)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-Command", $backendCommand) | Out-Null
  Write-StartupLog "Lanzado backend en nueva terminal"
} else {
  Write-StartupLog "Backend no se relanza por SkipIfRunning"
}

if (-not ($SkipIfRunning -and $caddyAlreadyRunning)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-Command", $caddyCommand) | Out-Null
  Write-StartupLog "Lanzado caddy en nueva terminal"
} else {
  Write-StartupLog "Caddy no se relanza por SkipIfRunning"
}

Start-Sleep -Milliseconds 1200
$backendFinal = Test-ListeningPort -Port 3000
$caddyFinal = Test-ListeningPort -Port 443
Write-StartupLog "Estado final: backend3000=$backendFinal caddy443=$caddyFinal"
