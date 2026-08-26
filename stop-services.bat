@echo off
REM Stops all three trading-dashboard services.
powershell -NoProfile -Command "Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mt5_api\.py' -and $_.Name -like 'python*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'serve-dashboard\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo All services stopped.
pause
