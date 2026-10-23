#!/bin/sh
# Container entrypoint for the RAGE:MP server.
#
# Responsibilities:
#   1. keep the server binaries in sync with the image (stored in the data dir,
#      so the bind-mounted ./server-data stays self-contained and backup-able);
#   2. make sure the expected directory layout exists;
#   3. render conf.json from environment variables (or keep a hand-written one);
#   4. exec ragemp-server so it receives signals (SIGTERM on `docker stop`).
#
# Extra modes:
#   --update-server-files   copy fresh binaries from the image and exit
#   --print-conf            print the rendered conf.json and exit
#   --shell                 drop into a shell in the data directory
#   <command>               run any binary available in the image (e.g. bash)

set -eu

APP_DIR="${RAGE_APP_DIR:-/opt/ragemp}"
DATA_DIR="${RAGE_DATA_DIR:-/data}"
SERVER_SRC="$APP_DIR/server"
VERSION_FILE=".server-version"

log()  { printf '[entrypoint] %s\n' "$*"; }
warn() { printf '[entrypoint] WARN: %s\n' "$*" >&2; }
die()  { printf '[entrypoint] ERROR: %s\n' "$*" >&2; exit 1; }

require_data_dir() {
    [ -d "$DATA_DIR" ] || die "data directory $DATA_DIR does not exist (check the volume mount)"
    [ -w "$DATA_DIR" ] || die "$DATA_DIR is not writable by uid $(id -u):$(id -g).
    Fix ownership on the host, e.g.:
        sudo chown -R $(id -u):$(id -g) ./server-data
    or set RAGEMP_UID / RAGEMP_GID in .env to the owner of ./server-data."
}

install_server_files() {
    [ -x "$SERVER_SRC/ragemp-server" ] || die "server binaries are missing in the image ($SERVER_SRC)"
    log "installing server files into $DATA_DIR"
    rm -rf "$DATA_DIR/bin" "$DATA_DIR/dotnet" "$DATA_DIR/ragemp-server"
    cp -a "$SERVER_SRC/ragemp-server" "$DATA_DIR/ragemp-server"
    if [ -d "$SERVER_SRC/bin" ]; then
        cp -a "$SERVER_SRC/bin" "$DATA_DIR/bin"
    fi
    if [ -d "$SERVER_SRC/dotnet" ]; then
        cp -a "$SERVER_SRC/dotnet" "$DATA_DIR/dotnet"
    fi
    chmod +x "$DATA_DIR/ragemp-server"
    if [ -f "$SERVER_SRC/$VERSION_FILE" ]; then
        cp -a "$SERVER_SRC/$VERSION_FILE" "$DATA_DIR/$VERSION_FILE"
    fi
}

ensure_layout() {
    for dir in packages client_packages maps plugins logs; do
        mkdir -p "$DATA_DIR/$dir"
    done
}

sync_binaries() {
    local_image_version=""
    local_data_version=""
    if [ -f "$SERVER_SRC/$VERSION_FILE" ]; then
        local_image_version=$(cat "$SERVER_SRC/$VERSION_FILE")
    fi
    if [ -f "$DATA_DIR/$VERSION_FILE" ]; then
        local_data_version=$(cat "$DATA_DIR/$VERSION_FILE")
    fi

    if [ ! -x "$DATA_DIR/ragemp-server" ] || [ "$local_image_version" != "$local_data_version" ]; then
        install_server_files
    else
        log "server files already up to date (${local_data_version:-unknown})"
    fi
}

render_conf() {
    mode="${RAGE_CONF_MODE:-generate}"
    case "$mode" in
        generate)
            log "rendering conf.json from environment (RAGE_CONF_MODE=generate)"
            tmp="$DATA_DIR/.conf.json.tmp"
            "$APP_DIR/scripts/gen-conf.sh" > "$tmp" || die "conf generation failed"
            jq empty "$tmp" || die "generated conf.json is not valid JSON"
            # Conf is regenerated on every start; it is fully derived from .env.
            mv "$tmp" "$DATA_DIR/conf.json"
            chmod 0644 "$DATA_DIR/conf.json"
            ;;
        keep)
            if [ -f "$DATA_DIR/conf.json" ]; then
                log "keeping existing conf.json (RAGE_CONF_MODE=keep)"
            else
                render_conf_default
            fi
            ;;
        *)
            die "unknown RAGE_CONF_MODE: $mode (expected generate or keep)"
            ;;
    esac
}

render_conf_default() {
    warn "no conf.json found, generating one from environment"
    tmp="$DATA_DIR/.conf.json.tmp"
    "$APP_DIR/scripts/gen-conf.sh" > "$tmp" || die "conf generation failed"
    mv "$tmp" "$DATA_DIR/conf.json"
}

print_summary() {
    conf="$DATA_DIR/conf.json"
    [ -f "$conf" ] || return 0
    log "name:        $(jq -r '.name // "-"' "$conf")"
    log "gamemode:    $(jq -r '.gamemode // "-"' "$conf")"
    log "maxplayers:  $(jq -r '.maxplayers // "-"' "$conf")"
    log "listen:      $(jq -r '.bind // "-"' "$conf"):$(jq -r '.port // "-"' "$conf") (UDP+TCP), HTTP $(jq -r '(.port // 22005) + 1' "$conf")"
    log "announce:    $(jq -r '.announce // false' "$conf")"

    # The HTTP port for client packages is always game port + 1. docker-compose
    # publishes ${RAGE_HTTP_PORT}; a mismatch means players cannot download
    # client packages, so warn loudly instead of failing silently.
    game_port=$(jq -r '.port // 22005' "$conf")
    expected_http=$((game_port + 1))
    published_http="${RAGE_HTTP_PORT:-}"
    if [ -n "$published_http" ] && [ "$published_http" != "$expected_http" ]; then
        warn "RAGE_HTTP_PORT=$published_http but the server serves client packages on $expected_http (port+1)."
        warn "Set RAGE_HTTP_PORT=$expected_http in .env, otherwise players cannot download client packages."
    fi
}

# --- modes -------------------------------------------------------------------
case "${1:-}" in
    --update-server-files)
        require_data_dir
        install_server_files
        log "server files refreshed"
        exit 0
        ;;
    --print-conf)
        "$APP_DIR/scripts/gen-conf.sh"
        exit 0
        ;;
    --shell)
        require_data_dir
        ensure_layout
        cd "$DATA_DIR"
        exec "${SHELL:-/bin/sh}"
        ;;
    --help|-h)
        sed -n '2,20p' "$0"
        exit 0
        ;;
    -*)
        die "unknown option: $1"
        ;;
    "")
        ;;
    *)
        # Allow `docker compose run --rm ragemp bash` and friends.
        if command -v "$1" >/dev/null 2>&1; then
            exec "$@"
        fi
        die "unknown command: $1"
        ;;
esac

# --- normal startup ----------------------------------------------------------
require_data_dir
ensure_layout
sync_binaries
render_conf
print_summary

log "starting RAGE:MP server (data dir: $DATA_DIR)"
cd "$DATA_DIR"
exec "$DATA_DIR/ragemp-server" "$@"
