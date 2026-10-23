#!/bin/sh
# Backs up the server: game mode files, plugins, maps and (optionally) MariaDB.
#
#   ./scripts/backup.sh              # files + database (if running)
#   BACKUP_KEEP=30 ./scripts/backup.sh
#
# Archives are written to ./backups. Binaries (bin/, dotnet/), logs and the
# FastDL snapshot are skipped: they are big and reproducible.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DATA_DIR="${RAGE_DATA_DIR:-$APP_DIR/server-data}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/ragemp-$STAMP.tar.gz"

COMPOSE="docker compose"
if [ -f "$APP_DIR/.env" ]; then
    COMPOSE="docker compose --env-file $APP_DIR/.env"
fi

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$DATA_DIR" ] || die "$DATA_DIR not found"
mkdir -p "$BACKUP_DIR"

log "archiving $DATA_DIR -> $ARCHIVE"
tar -czf "$ARCHIVE" \
    --warning=no-file-changed \
    --exclude='./ragemp-server' \
    --exclude='./bin' \
    --exclude='./dotnet' \
    --exclude='./logs' \
    --exclude='./fastdl' \
    --exclude='./.server-version' \
    --exclude='./crashdumps' \
    -C "$DATA_DIR" . 2>/dev/null || {
        status=$?
        # tar exits 1 when files change while reading (live server) — usable.
        [ "$status" -eq 1 ] || die "tar failed with status $status"
    }

log "archive size: $(du -h "$ARCHIVE" | cut -f1)"

# Database dump — only when the optional MariaDB profile is running.
if (cd "$APP_DIR" && $COMPOSE ps --status running --services 2>/dev/null | grep -qx mariadb); then
    DUMP="$BACKUP_DIR/ragemp-db-$STAMP.sql.gz"
    log "dumping MariaDB -> $DUMP"
    if (cd "$APP_DIR" && $COMPOSE exec -T mariadb sh -c \
            'exec mariadb-dump --single-transaction --quick --routines --events \
             -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' \
            | gzip -c > "$DUMP"); then
        log "database dump size: $(du -h "$DUMP" | cut -f1)"
    else
        rm -f "$DUMP"
        log "WARN: database dump failed (is MariaDB healthy?)"
    fi
else
    log "MariaDB is not running — skipping database dump"
fi

# Retention.
if [ "$KEEP" -gt 0 ]; then
    for pattern in "ragemp-*.tar.gz" "ragemp-db-*.sql.gz"; do
        # shellcheck disable=SC2012
        ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
            log "removing old backup $old"
            rm -f "$old"
        done
    done
fi

log "done"
