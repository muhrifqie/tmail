@echo off
setlocal
cd /d "%~dp0"

echo [TMail] kill node di port 3100 / 5173 / 2525 (best effort)
for %%P in (3100 5173 2525) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr LISTENING') do (
    echo kill PID %%A port %%P
    taskkill /F /PID %%A >nul 2>&1
  )
)
echo Done.
endlocal
