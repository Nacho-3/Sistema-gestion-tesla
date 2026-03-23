$ErrorActionPreference = "Stop"

$taskName = "ERP Tesla DB Backup"
$scriptPath = "C:\Users\usuario\Documents\Sistema Gestion TESLA\Sistema-gestion-tesla\erp-tesla\ops\db-backup.ps1"

if (!(Test-Path $scriptPath)) {
  throw "No existe el script de backup: $scriptPath"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $scriptPath + "`"")
$trigger = New-ScheduledTaskTrigger -Daily -At 20:00

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
  # no-op
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null

Write-Host "Tarea creada correctamente: $taskName"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, TaskPath | Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
