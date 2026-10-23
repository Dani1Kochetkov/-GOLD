@echo off
setlocal
cd /d "%~dp0"
if not exist "ragemp-server.exe" (
  echo [GOLD DAYZ] ragemp-server.exe not found.
  echo Install the official RAGE Multiplayer server files into this folder first.
  pause
  exit /b 1
)
"ragemp-server.exe"
endlocal
