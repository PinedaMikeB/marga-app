Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $BridgeRoot 'start-marga-dotmatrix-bridge.ps1'
$TaskName = 'Marga Dot Matrix Print Bridge'

if (-not (Test-Path $ScriptPath)) {
    throw "Bridge script not found: $ScriptPath"
}

$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description 'Local raw printer bridge for Marga billing dot-matrix invoice printing.' `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started: $TaskName"
Write-Host 'The billing Dot Matrix Print button can now send invoices to the local raw print bridge.'
