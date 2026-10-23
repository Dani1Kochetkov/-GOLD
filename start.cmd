@echo off
rem GOLD DAYZ launcher (Windows). Works from any drive/folder: e.g. D:\gold-dayz\
rem Messages are ASCII on purpose: cmd.exe codepage differs between locales.
rem Human-readable Russian instructions: START.txt
cd /d "%~dp0"

set "MISSING="
if not exist "conf.json" set "MISSING=%MISSING% conf.json"
if not exist "packages\gold\index.js" set "MISSING=%MISSING% packages\gold\index.js"
if not exist "client_packages\index.js" set "MISSING=%MISSING% client_packages\index.js"
if not exist "client_packages\gold\goldclient.js" set "MISSING=%MISSING% client_packages\gold\goldclient.js"
if not exist "data\items.json" set "MISSING=%MISSING% data\items.json"

if defined MISSING (
  echo.
  echo  [GOLD DAYZ] Files are missing in: %cd%
  echo  Missing:%MISSING%
  echo.
  echo  Copy the contents of gold-dayz-^<version^>\ into this folder
  echo  ^(next to ragemp-server.exe^), then run start.cmd again.
  echo  Details: START.txt
  echo.
  pause
  exit /b 1
)

if exist "ragemp-server.exe" goto run

echo.
echo  [GOLD DAYZ] ragemp-server.exe not found in: %cd%
echo.
echo  1. Download RAGE Multiplayer server-files: https://rage.mp
echo  2. Unpack them into THIS folder ^(D:\, E:\ - any drive^).
echo  3. Run start.cmd again.
echo.
echo  Server files are already here: conf.json, packages\, client_packages\, server\, shared\, data\
echo  Details: START.txt
echo.
pause
exit /b 1

:run
echo.
echo  [GOLD DAYZ] starting from %cd%
echo  Client: RAGE Multiplayer -^> Direct Connect -^> 127.0.0.1:22005
echo.
ragemp-server.exe
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo  [GOLD DAYZ] server exited with code %CODE%
  pause
)
exit /b %CODE%
