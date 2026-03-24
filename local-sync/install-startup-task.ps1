$taskName = "Marga Local Sync Dashboard"
$localSyncDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$hiddenStarterScript = Join-Path $localSyncDir "start-dashboard-hidden.vbs"
$starterScript = Join-Path $localSyncDir "start-dashboard.cmd"
$startupFolder = [Environment]::GetFolderPath("Startup")
$startupShortcut = Join-Path $startupFolder "Marga Local Sync Dashboard.lnk"
$viewerShortcut = Join-Path $startupFolder "Open Marga Sync Dashboard.lnk"
$viewerScript = Join-Path $localSyncDir "open-dashboard.cmd"
$wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"

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

$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument "`"$hiddenStarterScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

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

  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

  Write-Host "Installed scheduled task: $taskName"
  Write-Host "Startup viewer shortcut: $viewerShortcut"
  Write-Host "Dashboard URL: http://127.0.0.1:4310"
} catch {
  Set-Shortcut `
    -Path $startupShortcut `
    -TargetPath $wscriptPath `
    -Arguments "`"$hiddenStarterScript`"" `
    -WorkingDirectory $localSyncDir `
    -Description "Starts the Marga local sync dashboard hidden on sign-in."

  Write-Warning "Scheduled task creation was blocked. Created Startup shortcut instead."
  Write-Host "Startup shortcut: $startupShortcut"
  Write-Host "Dashboard URL: http://127.0.0.1:4310"
}
