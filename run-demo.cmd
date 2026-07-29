@echo off
REM Lenovo DataCenter Agent - one-click launcher
REM Auto-detects node.exe from PATH or common install locations.
setlocal
set "NODE_BIN="

REM 1) node on PATH?
where node >nul 2>&1
if %errorlevel%==0 (
  set "NODE_BIN=node"
  goto :found
)

REM 2) Common install locations
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
  goto :found
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  goto :found
)

REM 3) WorkBuddy managed node
for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%d\node.exe" (
    set "NODE_BIN=%%d\node.exe"
    goto :found
  )
)

echo ERROR: node.exe not found. Install Node.js from https://nodejs.org
pause
exit /b 1

:found
"%NODE_BIN%" "%~dp0run-demo.js" %*
if errorlevel 1 pause
