#!/bin/sh
# Updates the RAGE:MP server binaries and moves them into ./server-data.
#
#   ./scripts/update.sh
#
# Game mode files, maps and config stay untouched: the image only ships the
# server itself. A backup is taken before the update.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$APP_DIR"

log() { printf '[update] %s\n' "$*"; }
die() { printf '[update] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f .env ] || die ".env is missing — run: make init"
command -v docker >/dev/null 2>&1 || die "docker is not installed"

log "backup before update"
./scripts/backup.sh || log "WARN: backup failed, continuing anyway"

log "rebuilding image with fresh server files (no cache for the download layer)"
docker compose build --no-cache ragemp || die "image build failed"

log "copying new binaries into ./server-data"
docker compose run --rm --no-deps -T ragemp --update-server-files || die "binary refresh failed"

log "restarting the server"
docker compose up -d --force-recreate ragemp

log "recent logs:"
sleep 3
docker compose logs --tail=40 ragemp || true
log "done — verify in game and in the RAGE:MP server browser"
