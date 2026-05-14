param(
  [string]$BackendServiceName = "ERP Tesla Backend",
  [string]$CaddyServiceName = "ERP Tesla Caddy",
  [string]$NssmExe = "nssm",
  [string]$NodeExe = "node",
  [string]$CaddyExe = "caddy",
  [switch]$StartAfterInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$backendEntry = Join-Path $backendDir "server.js"
$caddyConfig = Join-Path $repoRoot "Caddyfile"
$logsDir = Join-Path $PSScriptRoot "service-logs"

function Assert-Administrator {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Este script debe ejecutarse en PowerShell como administrador."
  }
}

function Resolve-Executable {
  param(
    [string]$Candidate,
    [string[]]$Fallbacks,
    [string]$Label
  )

  if ($Candidate -and (Test-Path $Candidate)) {
    return (Resolve-Path $Candidate).Path
  }

  $command = Get-Command $Candidate -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  foreach ($fallback in $Fallbacks) {
    if (Test-Path $fallback) {
      return (Resolve-Path $fallback).Path
    }
  }

  throw "No se encontró $Label. Indicá la ruta con el parámetro correspondiente."
}

function Ensure-NssmSuccess {
  param(
    [string]$Message,
    [int]$ExitCode
  )

  if ($ExitCode -ne 0) {
    throw "$Message (exit code=$ExitCode)"
  }
}

function Invoke-Nssm {
  param([string[]]$Arguments)

  & $resolvedNssmExe @Arguments
  Ensure-NssmSuccess -Message "Falló nssm $($Arguments -join ' ')" -ExitCode $LASTEXITCODE
}

function Format-CommandLineArgument {
  param([string]$Argument)

  if ($null -eq $Argument) {
    return ""
  }

  if ($Argument -notmatch '[\s"]') {
    return $Argument
  }

  $escaped = $Argument -replace '"', '\"'
  return '"' + $escaped + '"'
}

function Install-ServiceWithNssm {
  param(
    [string]$ServiceName,
    [string]$Executable,
    [string[]]$AppArguments,
    [string]$AppDirectory,
    [string]$StdoutLog,
    [string]$StderrLog,
    [string]$Description
  )

  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($service) {
    Write-Host "Actualizando servicio existente: $ServiceName"
  } else {
    Write-Host "Instalando servicio: $ServiceName"
    Invoke-Nssm -Arguments @("install", $ServiceName, $Executable)
  }

  Invoke-Nssm -Arguments @("set", $ServiceName, "Application", $Executable)
  $appParameters = ($AppArguments | ForEach-Object { Format-CommandLineArgument -Argument $_ }) -join " "
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppParameters", $appParameters)
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppDirectory", $AppDirectory)
  Invoke-Nssm -Arguments @("set", $ServiceName, "DisplayName", $ServiceName)
  Invoke-Nssm -Arguments @("set", $ServiceName, "Description", $Description)
  Invoke-Nssm -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START")
  Invoke-Nssm -Arguments @("set", $ServiceName, "ObjectName", "LocalSystem")
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppExit", "Default", "Restart")
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppRestartDelay", "5000")
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppStdout", $StdoutLog)
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppStderr", $StderrLog)
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppRotateFiles", "1")
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppRotateOnline", "1")
  Invoke-Nssm -Arguments @("set", $ServiceName, "AppRotateBytes", "1048576")

  sc.exe failure "$ServiceName" reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
  sc.exe failureflag "$ServiceName" 1 | Out-Null
}

if (-not (Test-Path $backendEntry)) {
  throw "No existe el backend: $backendEntry"
}

if (-not (Test-Path $caddyConfig)) {
  throw "No existe el Caddyfile: $caddyConfig"
}

if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

Assert-Administrator

$resolvedNssmExe = Resolve-Executable -Candidate $NssmExe -Fallbacks @(
  "C:\Program Files\NSSM\win64\nssm.exe",
  "C:\Program Files\NSSM\nssm.exe",
  "$env:ChocolateyInstall\bin\nssm.exe",
  "$env:LOCALAPPDATA\Programs\nssm\win64\nssm.exe",
  "$env:LOCALAPPDATA\Programs\nssm\nssm.exe",
  "$env:USERPROFILE\Downloads\nssm-2.24\win64\nssm.exe",
  "$env:USERPROFILE\Downloads\nssm\win64\nssm.exe"
) -Label "nssm.exe"

$resolvedNodeExe = Resolve-Executable -Candidate $NodeExe -Fallbacks @(
  "C:\Program Files\nodejs\node.exe"
) -Label "node.exe"

$resolvedCaddyExe = Resolve-Executable -Candidate $CaddyExe -Fallbacks @(
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\caddy.exe",
  "C:\Program Files\Caddy\caddy.exe",
  "C:\caddy\caddy.exe"
) -Label "caddy.exe"

$backendStdout = Join-Path $logsDir "backend-stdout.log"
$backendStderr = Join-Path $logsDir "backend-stderr.log"
$caddyStdout = Join-Path $logsDir "caddy-stdout.log"
$caddyStderr = Join-Path $logsDir "caddy-stderr.log"

Install-ServiceWithNssm `
  -ServiceName $BackendServiceName `
  -Executable $resolvedNodeExe `
  -AppArguments @("server.js") `
  -AppDirectory $backendDir `
  -StdoutLog $backendStdout `
  -StderrLog $backendStderr `
  -Description "Backend Node.js del ERP Tesla"

Install-ServiceWithNssm `
  -ServiceName $CaddyServiceName `
  -Executable $resolvedCaddyExe `
  -AppArguments @("run", "--config", ".\\Caddyfile") `
  -AppDirectory $repoRoot `
  -StdoutLog $caddyStdout `
  -StderrLog $caddyStderr `
  -Description "Proxy reverso Caddy del ERP Tesla"

Write-Host ""
Write-Host "Servicios instalados correctamente."
Write-Host "- Backend: $BackendServiceName"
Write-Host "- Caddy:   $CaddyServiceName"
Write-Host "- Logs:    $logsDir"

if ($StartAfterInstall) {
  Write-Host ""
  Write-Host "Iniciando servicios..."
  Start-Service -Name $BackendServiceName
  Start-Service -Name $CaddyServiceName
  Get-Service -Name $BackendServiceName, $CaddyServiceName | Select-Object Name, Status | Format-Table -AutoSize
}