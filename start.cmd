@echo off
chcp 65001 >nul
rem ============================================================================
rem  "Text po-chelovecheski" - web app launcher (double-click to start)
rem  First run: installs dependencies. Then starts dev server + opens browser.
rem  If .env with GigaChat key exists, also starts the GigaChat proxy.
rem ============================================================================
title Text Server
cd /d "%~dp0app"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Install Node.js from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies. See messages above.
    pause
    exit /b 1
  )
)

rem Check for GigaChat key
set GIGACHAT_ENABLED=0
if exist .env (
  findstr /C:"GIGACHAT_AUTH_KEY=" .env >nul 2>&1
  if not errorlevel 1 (
    set GIGACHAT_ENABLED=1
  )
)

if %GIGACHAT_ENABLED%==1 (
  echo Starting GigaChat proxy on port 4173...
  start "GigaChat Proxy" cmd /c "npm run web"
  timeout /t 2 /nobreak >nul
)

echo Starting dev server... Browser will open automatically.
echo Close this window to stop the server.
call npm run dev
pause
