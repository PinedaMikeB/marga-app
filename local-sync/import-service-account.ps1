param(
  [Parameter(Mandatory = $true)]
  [string]$JsonPath,

  [string]$EnvPath = ""
)

if (-not $EnvPath) {
  $scriptRoot = $PSScriptRoot
  if (-not $scriptRoot) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  $EnvPath = Join-Path $scriptRoot ".env"
}

$resolvedJsonPath = Resolve-Path $JsonPath -ErrorAction Stop
$json = Get-Content $resolvedJsonPath -Raw | ConvertFrom-Json

if (-not $json.client_email) {
  throw "The service-account JSON is missing client_email."
}

if (-not $json.private_key) {
  throw "The service-account JSON is missing private_key."
}

if (-not (Test-Path $EnvPath)) {
  $examplePath = Join-Path $PSScriptRoot ".env.example"
  if (Test-Path $examplePath) {
    Copy-Item $examplePath $EnvPath
  } else {
    New-Item -ItemType File -Path $EnvPath -Force | Out-Null
  }
}

$lines = Get-Content $EnvPath -ErrorAction SilentlyContinue
if (-not $lines) {
  $lines = @()
}

$escapedPrivateKey = ($json.private_key -replace "`r", "" -replace "`n", "\n")
$updates = @{
  "GOOGLE_SERVICE_ACCOUNT_EMAIL" = $json.client_email
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY" = '"' + $escapedPrivateKey + '"'
}

foreach ($key in $updates.Keys) {
  $value = $updates[$key]
  $pattern = "^" + [regex]::Escape($key) + "="
  $matched = $false

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $lines[$i] = "$key=$value"
      $matched = $true
      break
    }
  }

  if (-not $matched) {
    $lines += "$key=$value"
  }
}

Set-Content -Path $EnvPath -Value $lines -Encoding UTF8

Write-Host "Updated service-account entries in $EnvPath"
Write-Host "Email: $($json.client_email)"
