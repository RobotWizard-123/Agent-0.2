@echo off
chcp 65001 >nul
REM 机房智能管理 Agent V0.2 —— 适配版一键启动器
REM 解决：PATH 中缺失 System32 导致 node/cmd 无法定位的问题
setlocal EnableDelayedExpansion

echo.
echo ============================================
echo  Lenovo DataCenter Agent - 适配版启动器
echo ============================================
echo.

REM ---------- 1. 修复 PATH，确保系统目录存在 ----------
REM 很多 Windows 环境（或被某些工具修改后）会丢失 C:\Windows\System32，
REM 导致 where/node/cmd/start 等命令全部失效。这里强制加回。
set "PATH=%SystemRoot%\System32;%SystemRoot%;%PATH%"

REM 简单去重：把 PATH 拆成临时变量再拼回去
set "UNIQUE_PATH="
set "SEEN="
for %%P in ("%PATH:;=" "%") do (
  set "CUR=%%~P"
  if not "!CUR!"=="" (
    set "LOWER=!CUR:\=\!"
    if not defined SEEN_!LOWER! (
      set "SEEN_!LOWER!=1"
      if "!UNIQUE_PATH!"=="" (
        set "UNIQUE_PATH=!CUR!"
      ) else (
        set "UNIQUE_PATH=!UNIQUE_PATH!;!CUR!"
      )
    )
  )
)
set "PATH=%UNIQUE_PATH%"
set "SEEN_="
set "UNIQUE_PATH="

REM ---------- 2. 定位 node.exe ----------
set "NODE_BIN="

REM 2.0 用户可手动设置 NODE_PATH 强制指定
if defined NODE_PATH (
  if exist "%NODE_PATH%" (
    set "NODE_BIN=%NODE_PATH%"
    echo [INFO] 使用环境变量 NODE_PATH 指定的 Node.js: %NODE_BIN%
    goto :found
  ) else (
    echo [WARN] 环境变量 NODE_PATH 指向的路径不存在: %NODE_PATH%
  )
)

REM 2.1 先尝试 PATH 中的 node（优先 node.exe，过滤掉 .cmd wrapper）
where node.exe >nul 2>&1
if %errorlevel%==0 (
  for /f "delims=" %%a in ('where node.exe') do (
    set "NODE_BIN=%%a"
    goto :found
  )
)

REM 2.2 常见安装位置
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE_BIN=%ProgramFiles%\nodejs\node.exe"
  goto :found
)
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
  set "NODE_BIN=%ProgramFiles(x86)%\nodejs\node.exe"
  goto :found
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  goto :found
)

REM 2.3 版本管理器常见位置
if exist "%USERPROFILE%\.nvm\versions\node" (
  for /d %%d in ("%USERPROFILE%\.nvm\versions\node\*") do (
    if exist "%%d\node.exe" (
      set "NODE_BIN=%%d\node.exe"
      goto :found
    )
  )
)
if exist "%USERPROFILE%\.fnm\node-versions" (
  for /d %%d in ("%USERPROFILE%\.fnm\node-versions\*") do (
    if exist "%%d\installation\node.exe" (
      set "NODE_BIN=%%d\installation\node.exe"
      goto :found
    )
  )
)
if exist "%LOCALAPPDATA%\fnm_multishells" (
  for /d %%d in ("%LOCALAPPDATA%\fnm_multishells\*") do (
    if exist "%%d\node.exe" (
      set "NODE_BIN=%%d\node.exe"
      goto :found
    )
  )
)
if exist "%USERPROFILE%\.volta" (
  if exist "%USERPROFILE%\.volta\tools\image\node" (
    for /d %%d in ("%USERPROFILE%\.volta\tools\image\node\*") do (
      if exist "%%d\node.exe" (
        set "NODE_BIN=%%d\node.exe"
        goto :found
      )
    )
  )
)
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions" (
  for /d %%d in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%d\node.exe" (
      set "NODE_BIN=%%d\node.exe"
      goto :found
    )
  )
)

REM 2.4 IDE / 沙箱内置 Node.js（Doubao / 豆包）
if exist "%LOCALAPPDATA%\Doubao\User Data\Default\sandbox_envs_dir\envs" (
  for /d %%d in ("%LOCALAPPDATA%\Doubao\User Data\Default\sandbox_envs_dir\envs\*") do (
    if exist "%%d\node\node.exe" (
      set "NODE_BIN=%%d\node\node.exe"
      goto :found
    )
  )
)

REM 2.5 还是没找到
set "DOCS=https://nodejs.org"
echo.
echo [ERROR] 未找到可用的 node.exe。
echo.
echo 可能原因：
echo   1. 本机没有安装 Node.js；
echo   2. Node.js 安装在非常规位置，启动器未覆盖；
echo   3. 环境变量 PATH 被其他软件破坏（这也是你看到 DOSKEY 报错的常见原因）。
echo.
echo 解决方案（任选一种）：
echo   A. 下载并安装 Node.js LTS：%DOCS%
echo   B. 在当前窗口设置环境变量后重新运行：
echo        set NODE_PATH=C:\你\的\node.exe 完整路径
echo        run-demo-adapted.cmd
echo   C. 在系统设置里把 C:\Windows\System32 加回 PATH，然后重新打开 cmd。
echo.
pause
exit /b 1

:found
echo [INFO] 已定位 Node.js: %NODE_BIN%
for /f "delims=" %%v in ('"%NODE_BIN%" --version') do echo [INFO] Node.js 版本: %%v
echo.

REM ---------- 3. 运行项目 ----------
"%NODE_BIN%" "%~dp0run-demo.js" %*
if errorlevel 1 (
  echo.
  echo [ERROR] 启动失败，请查看上方错误信息或 output/run-demo.log。
  pause
)
