param(
  [string]$RepoRoot,
  [switch]$SkipIfRunning
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$backendDir = Join-Path $RepoRoot "backend"

if (-not (Test-Path $backendDir)) {
  throw "No existe la carpeta backend: $backendDir"
}

function Test-ListeningPort {
  param([int]$Port)

  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    return ($conn | Measure-Object).Count -gt 0
  } catch {
    return $false
  }
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
  $safeCommand = $Command.Replace("'", "''")

  if ($Skip -and $Port -gt 0) {
    return "Set-Location -LiteralPath '$safePath'; `$Host.UI.RawUI.WindowTitle = '$safeTitle'; if ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) { Write-Host 'Ya estaba en ejecucion (puerto $Port).'; } else { $safeCommand }"
  }

  return "Set-Location -LiteralPath '$safePath'; `$Host.UI.RawUI.WindowTitle = '$safeTitle'; $safeCommand"
}

$backendAlreadyRunning = Test-ListeningPort -Port 3000
$caddyAlreadyRunning = Test-ListeningPort -Port 443

$backendCommand = New-WindowCommand -Path $backendDir -Title "ERP Tesla Backend" -Command "npm start" -Skip $SkipIfRunning.IsPresent -Port 3000
$caddyCommand = New-WindowCommand -Path $RepoRoot -Title "ERP Tesla Caddy" -Command "caddy run" -Skip $SkipIfRunning.IsPresent -Port 443

if (-not ($SkipIfRunning -and $backendAlreadyRunning)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-Command", $backendCommand) | Out-Null
}

if (-not ($SkipIfRunning -and $caddyAlreadyRunning)) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-Command", $caddyCommand) | Out-Null
}
