$taskName = "Marga Local Sync Dashboard"
$localSyncDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$dashboardScript = Join-Path $localSyncDir "dashboard-server.mjs"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupShortcut = Join-Path $startupFolder "Marga Local Sync Dashboard.lnk"
$viewerShortcut = Join-Path $startupFolder "Open Marga Sync Dashboard.lnk"
$viewerScript = Join-Path $localSyncDir "open-dashboard.cmd"

function Set-Shortcut {
  param(
    [string]$Path,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$Description
  )

  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.Save()
}

$action = New-ScheduledTaskAction -Execute $nodeCommand -Argument "`"$dashboardScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Runs the Marga local sync dashboard and office-side sync loop." `
    -Force `
    -ErrorAction Stop | Out-Null

  Set-Shortcut `
    -Path $viewerShortcut `
    -TargetPath $viewerScript `
    -WorkingDirectory $localSyncDir `
    -Description "Opens the Marga live sync dashboard on sign-in."

  Write-Host "Installed scheduled task: $taskName"
  Write-Host "Startup viewer shortcut: $viewerShortcut"
  Write-Host "Dashboard URL: http://127.0.0.1:4310"
} catch {
  Set-Shortcut `
    -Path $startupShortcut `
    -TargetPath (Join-Path $localSyncDir "start-dashboard.cmd") `
    -WorkingDirectory $localSyncDir `
    -Description "Starts the Marga local sync dashboard and sync loop on sign-in."

  Write-Warning "Scheduled task creation was blocked. Created Startup shortcut instead."
  Write-Host "Startup shortcut: $startupShortcut"
  Write-Host "Dashboard URL: http://127.0.0.1:4310"
}
