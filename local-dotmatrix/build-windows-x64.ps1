Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Project = Join-Path $Root 'MargaDotMatrixBridge\MargaDotMatrixBridge.csproj'
$OutDir = Join-Path $Root 'dist\win-x64'

dotnet publish $Project `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -o $OutDir

Copy-Item (Join-Path $Root 'config.example.json') (Join-Path $OutDir 'config.example.json') -Force
Copy-Item (Join-Path $Root 'README.md') (Join-Path $OutDir 'README.txt') -Force
Copy-Item (Join-Path $Root 'Install-MargaDotMatrixBridge.cmd') (Join-Path $OutDir 'Install-MargaDotMatrixBridge.cmd') -Force

Write-Host "Built: $(Join-Path $OutDir 'MargaDotMatrixBridge.exe')"
