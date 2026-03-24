@echo off
setlocal
cd /d "%~dp0"

if exist "%SystemRoot%\System32\wscript.exe" if exist "%~dp0start-firebase-to-mysql-bridge-hidden.vbs" (
  "%SystemRoot%\System32\wscript.exe" "%~dp0start-firebase-to-mysql-bridge-hidden.vbs"
  exit /b 0
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-firebase-to-mysql-bridge.ps1"
