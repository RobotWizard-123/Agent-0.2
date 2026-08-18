@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  pause
  exit /b 1
)

node scripts\clear-rack-backend-data.js
set "RACK_CLEAR_EXIT=%errorlevel%"

if not "%RACK_CLEAR_EXIT%"=="0" (
  echo [ERROR] Rack backend data cleanup failed.
) else (
  echo Rack backend data cleanup completed.
)

pause
exit /b %RACK_CLEAR_EXIT%
