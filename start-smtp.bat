@echo off
setlocal
cd /d "%~dp0"

if not exist "smtp\node_modules\" (
  echo [TMail] npm install smtp...
  pushd smtp && call npm install && popd
)

echo [TMail] SMTP dev :2525 -^> API ingest
start "TMail SMTP" cmd /k "cd /d "%~dp0smtp" && npm run dev"
endlocal
