@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist ragemp-server.exe (
  echo Запуск GOLD DAYZ...
  ragemp-server.exe
  exit /b %errorlevel%
)

echo.
echo  Не найден ragemp-server.exe.
echo  Скачайте server-files RAGE Multiplayer с https://rage.mp
echo  и распакуйте их в эту папку: %cd%
echo.
echo  Файлы сервера уже на месте:
echo    conf.json, packages\, client_packages\, server\, shared\, data\
echo.
pause
exit /b 1
