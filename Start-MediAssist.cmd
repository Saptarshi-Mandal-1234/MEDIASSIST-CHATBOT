@echo off
cd /d "%~dp0mediassist-backend"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo Open the localhost address shown below in your browser.
echo Keep this window open while using MediAssist. Press Ctrl+C to stop.
call npm start
pause
