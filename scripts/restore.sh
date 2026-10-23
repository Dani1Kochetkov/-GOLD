#!/bin/sh
# Restores server-data from an archive produced by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/ragemp-20261023-031500.tar.gz
#
# The current server-data is moved aside (not deleted) so a bad restore can be
# rolled back by hand. Stop the server first: `make stop`.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DATA_DIR="${RAGE_DATA_DIR:-$APP_DIR/server-data}"
ARCHIVE="${1:-}"

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || die "usage: $0 <archive.tar.gz>"
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
ARCHIVE=$(CDPATH= cd -- "$(dirname -- "$ARCHIVE")" && pwd)/$(basename -- "$ARCHIVE")

if (cd "$APP_DIR" && docker compose ps --status running --services 2>/dev/null | grep -qx ragemp); then
    die "server is running — stop it first: make stop"
fi

STAMP=$(date +%Y%m%d-%H%M%S)
if [ -d "$DATA_DIR" ] && [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
    BACKUP="$DATA_DIR.before-restore-$STAMP"
    log "moving current server-data to $BACKUP"
    mv "$DATA_DIR" "$BACKUP"
fi
mkdir -p "$DATA_DIR"

log "extracting $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$DATA_DIR"
log "done — start the server with: make up"

# Databases are restored manually to avoid overwriting a newer schema by
# accident. The dump sits next to the archive:
#   gunzip -c backups/ragemp-db-....sql.gz | docker compose exec -T mariadb \
#     sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
