$dashboardArgs = @(
  "dashboard-server.mjs"
)

$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*dashboard-server.mjs*"
}

if ($existing) {
  exit 0
}

$nodePath = (Get-Command node -ErrorAction Stop).Source

while ($true) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodePath
  $startInfo.Arguments = ($dashboardArgs -join " ")
  $startInfo.WorkingDirectory = $PSScriptRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $startInfo
  $null = $proc.Start()

  $proc.WaitForExit()
  Start-Sleep -Seconds 5
}
