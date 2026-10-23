#!/bin/sh
# Generates a RAGE:MP conf.json from environment variables.
#
# Inside the container the environment comes from docker compose (.env).
# On the host the script also works if jq is installed and .env sits next to
# docker-compose.yml — handy for previewing the result before a restart:
#
#   ./scripts/gen-conf.sh
#
# Values that contain spaces must be quoted in .env, e.g.
#   RAGE_NAME="GOLD [RU] Roleplay"

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

DEFAULTS="${RAGE_CONF_DEFAULTS:-$APP_DIR/config/conf.defaults.json}"
PROGRAM="${RAGE_CONF_PROGRAM:-$APP_DIR/config/conf.jq}"
ENV_FILE="${RAGE_ENV_FILE:-$APP_DIR/.env}"

if ! command -v jq >/dev/null 2>&1; then
    echo "gen-conf: jq is required" >&2
    exit 1
fi

if [ ! -f "$DEFAULTS" ] || [ ! -f "$PROGRAM" ]; then
    echo "gen-conf: missing $DEFAULTS or $PROGRAM" >&2
    exit 1
fi

# Load .env for host-side usage. Inside the container the file does not exist
# and variables are already exported by docker compose.
if [ -f "$ENV_FILE" ] && [ "${RAGE_ENV_LOADED:-}" != "1" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
fi

jq -n --slurpfile defaults "$DEFAULTS" -f "$PROGRAM"
