param(
  [string]$TaskName = "ERP Tesla - Terminales al iniciar sesion",
  [switch]$SkipIfRunning
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "start-erp-terminals.ps1"

if (-not (Test-Path $scriptPath)) {
  throw "No existe el script de arranque: $scriptPath"
}

$actionArgs = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", ('"{0}"' -f $scriptPath)
)

if ($SkipIfRunning) {
  $actionArgs += "-SkipIfRunning"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($actionArgs -join " ")
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
  # no-op
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Tarea creada correctamente: $TaskName"
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath | Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
