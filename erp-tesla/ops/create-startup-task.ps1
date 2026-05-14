param(
  [string]$TaskName = "ERP Tesla - Caddy y Backend al iniciar"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "start-erp-services.ps1"

if (!(Test-Path $scriptPath)) {
  throw "No existe el script de arranque: $scriptPath"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $scriptPath + "`"")
$triggerAtStartup = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
  # no-op
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggerAtStartup -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Tarea creada correctamente: $TaskName"
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath | Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
