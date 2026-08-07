@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo [TMail] copy .env.example -^> .env
  copy /Y ".env.example" ".env" >nul
)

if not exist "api\node_modules\" (
  echo [TMail] npm install api...
  pushd api && call npm install && popd
)
if not exist "web\node_modules\" (
  echo [TMail] npm install web...
  pushd web && call npm install && popd
)

echo.
echo [TMail] start services
echo   API  http://127.0.0.1:3100/health
echo   Web  http://127.0.0.1:5173
echo   SMTP optional: start-smtp.bat
echo.

start "TMail API" cmd /k "cd /d "%~dp0api" && npm run dev"
timeout /t 2 /nobreak >nul
start "TMail Web" cmd /k "cd /d "%~dp0web" && npm run dev"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo Done. Tutup window "TMail API" / "TMail Web" untuk stop.
endlocal
