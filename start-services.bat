@echo off
REM ============================================================
REM  Starts all three services in visible console windows.
REM  Safe to re-run: existing instances are stopped first,
REM  so you'll never hit the port-5000 conflict.
REM ============================================================

echo Stopping any existing instances...
powershell -NoProfile -Command "Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mt5_api\.py' -and $_.Name -like 'python*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve-dashboard\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul

set ROOT=%~dp0

echo Starting MT5 API (port 5000)...
start "MT5 API" cmd /k "cd /d %ROOT%pythonMt5 && python mt5_api.py"

echo Starting Cloudflare Tunnel (API + Dashboard)...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel run mt5-api"

echo Starting Dashboard server (port 8080)...
start "Dashboard Server" cmd /k "cd /d %ROOT%trading-dashboard && node serve-dashboard.js"

echo.
echo All services started. Dashboard: https://dashboard.jakemt5.host
echo (Give the API ~10 seconds before its first request.)
pause
