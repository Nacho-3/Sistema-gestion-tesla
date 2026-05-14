param(
  [string]$BackendServiceName = "ERP Tesla Backend",
  [string]$CaddyServiceName = "ERP Tesla Caddy",
  [string]$NssmExe = "nssm"
)

$ErrorActionPreference = "Stop"

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

function Invoke-Nssm {
  param([string[]]$Arguments)

  & $resolvedNssmExe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Falló nssm $($Arguments -join ' ') (exit code=$LASTEXITCODE)"
  }
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

foreach ($serviceName in @($CaddyServiceName, $BackendServiceName)) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    Write-Host "Servicio inexistente: $serviceName"
    continue
  }

  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  }

  Invoke-Nssm -Arguments @("remove", $serviceName, "confirm")
  Write-Host "Servicio eliminado: $serviceName"
}