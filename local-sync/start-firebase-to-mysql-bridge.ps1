$bridgeArgs = @(
  "run-local-sync.mjs",
  "--baseline", "live",
  "--apply",
  "--loop-seconds", "30",
  "--out-dir", ".\\output\\firebase-to-mysql",
  "--state-file", ".\\state\\firebase-to-mysql-last-run.json"
)

$stateDir = Join-Path $PSScriptRoot "state"
$stdoutLog = Join-Path $stateDir "firebase-to-mysql-stdout.log"
$stderrLog = Join-Path $stateDir "firebase-to-mysql-stderr.log"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*run-local-sync.mjs*" -and $_.CommandLine -like "*--apply*"
}

if ($existing) {
  Write-Host "Firebase-to-MySQL bridge is already running."
  exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
Start-Process `
  -FilePath $nodePath `
  -ArgumentList $bridgeArgs `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru | Out-Null
