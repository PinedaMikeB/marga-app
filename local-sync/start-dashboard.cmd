@echo off
setlocal
cd /d "%~dp0"

:restart
node dashboard-server.mjs
set "exitcode=%errorlevel%"
echo [%date% %time%] dashboard-server.mjs exited with code %exitcode%. Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto restart
