$ErrorActionPreference = "Stop"

$taskName = "ERP Tesla DB Backup"
$scriptPath = Join-Path $PSScriptRoot "db-backup.ps1"
$currentUser = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }

if (!(Test-Path $scriptPath)) {
  throw "No existe el script de backup: $scriptPath"
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $scriptPath + "`"")
$trigger = New-ScheduledTaskTrigger -Daily -At 20:00
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
  # no-op
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Tarea creada correctamente: $taskName"
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State, TaskPath | Format-Table -AutoSize
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
