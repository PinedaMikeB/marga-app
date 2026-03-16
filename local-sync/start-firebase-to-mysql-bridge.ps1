$bridgeArgs = @(
  "run-local-sync.mjs",
  "--baseline", "live",
  "--apply",
  "--loop-seconds", "30",
  "--out-dir", ".\\output\\firebase-to-mysql",
  "--state-file", ".\\state\\firebase-to-mysql-last-run.json"
)

$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*run-local-sync.mjs*" -and $_.CommandLine -like "*--apply*"
}

if ($existing) {
  Write-Host "Firebase-to-MySQL bridge is already running."
  exit 0
}

Start-Process `
  -FilePath "node" `
  -ArgumentList $bridgeArgs `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Minimized

Write-Host "Started Firebase-to-MySQL bridge."
