@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  set "PATH=%ProgramFiles%\nodejs;%LocalAppData%\Programs\nodejs;%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2;%PATH%"
)
node scripts\diagnose-agent.js
echo.
echo exit code: %errorlevel%
pause
