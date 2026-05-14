param(
  [string]$BackendServiceName = "ERP Tesla Backend",
  [string]$CaddyServiceName = "ERP Tesla Caddy"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Este script debe ejecutarse en PowerShell como administrador."
  }
}

$serviceNames = @($BackendServiceName, $CaddyServiceName)
$existing = @()

Assert-Administrator

foreach ($serviceName in $serviceNames) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    throw "No existe el servicio '$serviceName'. Ejecutá install-windows-services.ps1 primero."
  }
  $existing += $serviceName
}

foreach ($serviceName in $existing) {
  Restart-Service -Name $serviceName -Force
}

Get-Service -Name $existing | Select-Object Name, Status | Format-Table -AutoSize