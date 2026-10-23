#!/usr/bin/env sh
# Запуск GOLD DAYZ на Linux. Server-files RAGE (ragemp-server) кладутся рядом.
cd "$(dirname "$0")" || exit 1

if [ -x ./ragemp-server ]; then
  echo "Запуск GOLD DAYZ…"
  exec ./ragemp-server
fi

echo ""
echo "  Не найден ./ragemp-server"
echo "  Скачайте server-files RAGE Multiplayer с https://rage.mp"
echo "  и распакуйте их в эту папку: $(pwd)"
echo ""
echo "  Файлы сервера уже на месте:"
echo "    conf.json, packages/, client_packages/, server/, shared/, data/"
echo ""
exit 1
