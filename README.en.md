# GOLD — a GTA V (RAGE:MP) server on a Linux VPS

A ready-to-run **GTA V / RAGE:MP** server in Docker: the config is generated from a single
`.env`, an example game mode ships in the repo, and backups, updates and diagnostics are
scripted. Tested on Debian 12 and Ubuntu 22.04/24.04.

**Docs:** [Setup](docs/en/SETUP.md) · [Operations](docs/en/OPERATIONS.md) ·
[Troubleshooting](docs/en/TROUBLESHOOTING.md) · [Русская документация](../README.md)

---

## What is inside

| Path | Purpose |
| --- | --- |
| `Dockerfile` | Debian 12 image + official RAGE:MP server files + jq/tini |
| `docker-compose.yml` | Server, optionally MariaDB (`--profile db`) and Adminer (`--profile admin`) |
| `.env.example` | Every server setting: name, ports, limits, voice chat |
| `config/conf.jq` | Turns environment variables into `conf.json` |
| `entrypoint.sh` | Installs binaries into `./server-data`, renders config, starts the server |
| `server-data/` | Live server files (bind mount): `packages`, `client_packages`, `maps`, `plugins` |
| `server-data/packages/core` | Example freeroam game mode with `/help`, `/veh`, `/tp`, `/pos` |
| `scripts/` | `backup.sh`, `restore.sh`, `update.sh`, `status.sh`, `gen-conf.sh` |
| `extras/fastdl` | nginx-based FastDL for client packages |
| `extras/systemd` | Boot-time stack start and a daily backup timer |
| `docs/` | Step-by-step guides in Russian and English |

## Quick start

You need a VPS running Ubuntu 22.04/24.04 or Debian 12: **2–4 vCPU, 4–8 GB RAM, 40+ GB NVMe**
(see [sizing](docs/en/SETUP.md#1-choosing-a-vps)).

```bash
# 1. Docker (official script, then re-login)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

# 2. Code
git clone <THIS-REPO-URL> ~/gold && cd ~/gold

# 3. Config
cp .env.example .env
nano .env          # RAGE_NAME, RAGE_MAXPLAYERS, RAGE_ANNOUNCE, RAGEMP_UID/GID

# 4. Start (downloads the RAGE:MP server files from the official CDN)
make up            # = docker compose up -d --build

# 5. Verify
make status        # container, ports, public reachability, disk
make logs
```

Next: open `22005/udp`, `22005/tcp`, `22006/tcp` in both `ufw` and your provider firewall,
set `RAGE_ANNOUNCE=true`, run `make restart` — the server shows up in the RAGE:MP browser.
Connect with the RAGE:MP launcher using `YOUR_IP:22005`.

> **Note:** `22006` is always `RAGE_PORT + 1`; it serves client packages. If you change
> `RAGE_PORT`, change `RAGE_HTTP_PORT` too.

## Everyday commands

```bash
make logs       # server logs
make restart    # after editing .env
make conf       # print the conf.json that would be generated
make shell      # shell inside the container
make backup     # archive ./server-data + DB dump into ./backups
make update     # fetch fresh RAGE:MP server files
make db         # server + MariaDB
```

## How it works

- **RAGE:MP binaries are never committed.** The image downloads them from the official CDN at
  build time and copies them into `./server-data` on first start, so game mode and binaries
  are backed up together.
- **`conf.json` is derived from `.env`.** It is regenerated on every start
  (`RAGE_CONF_MODE=generate`). Prefer a hand-written file? Set `keep` and edit
  `server-data/conf.json`.
- **The game mode is plain files in git.** Edits under `server-data/packages` and
  `server-data/client_packages` apply after `make restart` — no image rebuild.
- **Secrets live in `.env`** (git-ignored). Only `.env.example` is tracked.

## Requirements and legal notes

- Players need a legit Windows copy of GTA V plus the [RAGE:MP](https://rage.mp) client.
  The server runs on Linux; the client is Windows-only. Piracy is not supported.
- RAGE:MP itself is free; the server binaries belong to the platform developers.
- Do not redistribute other projects' `plugins/` or client packages — that violates their licences.

## Licence

Glue code (Docker, scripts, docs) is MIT. RAGE:MP server files and GTA V keep their own terms.
