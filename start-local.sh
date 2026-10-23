#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if [ ! -x ./ragemp-server ]; then
  echo '[GOLD DAYZ] ./ragemp-server not found or not executable.' >&2
  echo 'Install the official RAGE Multiplayer server files into this folder first.' >&2
  exit 1
fi
exec ./ragemp-server
