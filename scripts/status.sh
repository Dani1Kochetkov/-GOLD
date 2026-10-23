#!/bin/sh
# One-screen health report: containers, ports, config, disk, recent errors.
#
#   ./scripts/status.sh

set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DATA_DIR="$APP_DIR/server-data"

section() { printf '\n=== %s ===\n' "$*"; }

cd "$APP_DIR" || exit 1

section "containers"
docker compose ps 2>/dev/null || echo "docker compose is not available"

section "server config"
if [ -f "$DATA_DIR/conf.json" ]; then
    jq -r '"name:        \(.name)\ngamemode:    \(.gamemode)\nmaxplayers:  \(.maxplayers)\nport:        \(.port) (HTTP \(.port + 1))\nannounce:    \(.announce)\nstream-dist: \(."stream-distance")"' "$DATA_DIR/conf.json" 2>/dev/null \
        || cat "$DATA_DIR/conf.json"
else
    echo "server-data/conf.json not found — has the server ever started?"
fi

section "network"
if command -v ss >/dev/null 2>&1; then
    ss -lunp 2>/dev/null | grep -E ':(22005|22006)\b' || echo "no UDP socket on 22005 (server down or different port)"
    ss -ltnp 2>/dev/null | grep -E ':(22005|22006)\b' || echo "no TCP socket on 22005/22006"
else
    echo "ss not available"
fi
if command -v ufw >/dev/null 2>&1; then
    ufw status 2>/dev/null | head -n 20
fi

section "public reachability"
PORT=$(jq -r '.port // 22005' "$DATA_DIR/conf.json" 2>/dev/null || echo 22005)
HTTP_PORT=$((PORT + 1))
if command -v curl >/dev/null 2>&1; then
    # 404/403 still proves the HTTP package server is up; a timeout does not.
    if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$HTTP_PORT/" 2>/dev/null; then
        echo "local HTTP $HTTP_PORT: responding"
    elif curl -sS -o /dev/null --max-time 5 "http://127.0.0.1:$HTTP_PORT/" 2>/dev/null; then
        echo "local HTTP $HTTP_PORT: responding"
    else
        echo "local HTTP $HTTP_PORT: no response (clients cannot download packages)"
    fi
    PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
    if [ -n "${PUBLIC_IP:-}" ]; then
        echo "public IP:     $PUBLIC_IP"
        if curl -fsS -o /dev/null --max-time 5 "http://$PUBLIC_IP:$HTTP_PORT/" 2>/dev/null \
            || curl -sS -o /dev/null --max-time 5 "http://$PUBLIC_IP:$HTTP_PORT/" 2>/dev/null; then
            echo "public HTTP $HTTP_PORT: responding"
        else
            echo "public HTTP $HTTP_PORT: NOT reachable — check firewall/security group"
        fi
    fi
fi

section "disk"
df -h "$APP_DIR" "$DATA_DIR" 2>/dev/null | awk 'NR==1 || !seen[$0]++'
du -sh "$DATA_DIR" 2>/dev/null || true
du -sh "$APP_DIR/backups" 2>/dev/null || true

section "recent errors"
docker compose logs --tail=400 ragemp 2>/dev/null | grep -iE 'error|crash|fatal|exception' | tail -n 20 \
    || echo "no error lines in the last 400 log lines"

section "binary version"
if [ -f "$DATA_DIR/.server-version" ]; then
    cat "$DATA_DIR/.server-version"
else
    echo "not installed yet"
fi
