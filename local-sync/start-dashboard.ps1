$dashboardArgs = @(
  "dashboard-server.mjs"
)

$stateDir = Join-Path $PSScriptRoot "state"
$stdoutLog = Join-Path $stateDir "dashboard-stdout.log"
$stderrLog = Join-Path $stateDir "dashboard-stderr.log"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*dashboard-server.mjs*"
}

if ($existing) {
  exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source

while ($true) {
  $proc = Start-Process `
    -FilePath $nodePath `
    -ArgumentList $dashboardArgs `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
  $proc.WaitForExit()
  Start-Sleep -Seconds 5
}
