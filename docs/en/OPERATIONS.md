# Operations

Everything after the first start: variables, commands, backups, the database, FastDL,
game mode development and security.

---

## Commands

| Command | What it does |
| --- | --- |
| `make up` | build the image and start the server in the background |
| `make down` | stop and remove containers (data in `./server-data` stays) |
| `make restart` | restart after editing `.env` |
| `make logs` | follow server logs |
| `make conf` | print the `conf.json` generated from the current `.env` |
| `make shell` | shell inside the container (as `1000:1000`) |
| `make backup` | archive `./server-data` and dump MariaDB into `./backups` |
| `make restore FILE=...` | restore an archive |
| `make update` | fetch fresh RAGE:MP server files |
| `make db` | server + MariaDB |
| `make admin` | MariaDB + Adminer on `127.0.0.1:8080` |
| `make status` | containers, ports, public reachability, disk, recent errors |
| `make lint` | validate shell scripts, JSON and the config generator |

## `.env` variables

`conf.json` is generated entirely from `.env`. An empty value omits the key, and RAGE:MP
falls back to its own default. Official reference:
[wiki.rage.mp/wiki/Server_settings](https://wiki.rage.mp/wiki/Server_settings).

| Variable | Default | Meaning |
| --- | --- | --- |
| `RAGE_NAME` | `GOLD [RU] Freeroam` | browser name, tags in `[]` |
| `RAGE_LANGUAGE` | `ru` | flag shown next to the name (`us`, `en`, `de`, …) |
| `RAGE_URL` | — | project website in the server card |
| `RAGE_FQDN` | — | domain instead of a bare IP (survives migration) |
| `RAGE_ANNOUNCE` | `false` | publish to the master list |
| `RAGE_GAMEMODE` | `freeroam` | game mode label in the browser |
| `RAGE_PORT` | `22005` | game port (UDP **and** TCP) |
| `RAGE_HTTP_PORT` | `22006` | HTTP for client packages, must be `RAGE_PORT + 1` |
| `RAGE_BIND` | `0.0.0.0` | listen address (keep as is in Docker) |
| `RAGE_MAXPLAYERS` | `32` | slot limit (platform default cap: 100) |
| `RAGE_STREAM_DISTANCE` | `500` | entity streaming radius in metres |
| `RAGE_SYNC_RATE` | `40` | sync interval in ms (lower = smoother, costlier) |
| `RAGE_VOICE_CHAT` | `true` | voice chat |
| `RAGE_VOICE_CHAT_SAMPLE_RATE` | `24000` | 8000 / 16000 / 24000 / 48000 |
| `RAGE_MAX_PING` | `200` | kick threshold for ping |
| `RAGE_MAX_PACKET_LOSS` | — | kick threshold for packet loss (e.g. `0.1`) |
| `RAGE_MIN_FPS` | — | minimum client FPS |
| `RAGE_SERVER_SIDE_WEAPONS_ONLY_MODE` | `true` | sync only server-granted weapons |
| `RAGE_DISALLOW_MULTIPLE_CONNECTIONS_PER_IP` | `false` | block multiple players per IP |
| `RAGE_ENABLE_NODEJS` | `true` | server-side Node.js scripts |
| `RAGE_CSHARP` | `disabled` | `enabled` only with the C# bridge |
| `RAGE_HTTP_THREADS` | — | concurrent HTTP connections for packages |
| `RAGE_RESOURCES_COMPRESSION_LEVEL` | — | client resource compression |
| `RAGE_ALLOW_CEF_DEBUGGING` | — | CEF debugging (off in production) |
| `RAGE_FASTDL_HOST` | — | external URL serving client packages |
| `RAGE_CREATE_FASTDL_SNAPSHOT` | — | generate the FastDL snapshot |
| `RAGE_CLIENT_PACKAGES_SHARED_FOLDER` | — | share packages between servers |
| `RAGE_NODE_COMMANDLINE_FLAGS` | — | Node.js flags (e.g. `--max-old-space-size=2048`) |
| `RAGEMP_UID` / `RAGEMP_GID` | `1000` | owner of `./server-data` inside the container |
| `RAGE_CONF_MODE` | `generate` | `generate` from `.env`, or `keep` a hand-written file |
| `TZ` | `Europe/Moscow` | container timezone |

Database profile only: `MARIADB_DATABASE`, `MARIADB_USER`, `MARIADB_PASSWORD`,
`MARIADB_ROOT_PASSWORD`, `MARIADB_PORT`, `ADMINER_PORT`.

`enable-http-security` is deliberately absent from `.env.example`: per the
[wiki note](https://wiki.rage.mp/wiki/Server_settings) it breaks the first client package
download (players must connect twice).

## `server-data` layout

```text
server-data/
├── packages/            # server-side Node.js scripts
│   ├── index.js         # entry point, requires modules
│   └── core/            # example freeroam game mode
├── client_packages/     # client scripts and UI (downloaded by players)
│   ├── index.js
│   └── core/
├── maps/                # maps (.json)
├── plugins/             # .so/.dll plugins (e.g. C# bridge)
├── fastdl/              # generated package snapshot, not in git
├── logs/                # game mode logs
├── conf.json            # generated from .env
└── ragemp-server, bin/, dotnet/   # binaries (copied from the image, not in git)
```

## Backups

```bash
make backup                              # manual
BACKUP_KEEP=30 ./scripts/backup.sh       # keep 30 archives
./scripts/restore.sh backups/ragemp-20261023-042000.tar.gz
```

Included: game mode, client packages, maps, plugins, `conf.json`.
Excluded: binaries, logs, the FastDL snapshot — all reproducible.

Automation: `extras/systemd/ragemp-backup.timer` (daily at 04:20).

Rules that save projects:

1. **A backup on the same disk is not a backup.** Copy `./backups` off the machine daily:
   ```bash
   rsync -avz --delete ~/gold/backups/ backup@other-host:/srv/gold-backups/
   ```
2. Test a restore on a staging box once a month.
3. Database dumps are restored separately:
   ```bash
   gunzip -c backups/ragemp-db-20261023-042000.sql.gz | \
     docker compose exec -T mariadb sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
   ```

## Database

```bash
make db        # server + MariaDB (profile db)
```

Server-side scripts reach it at host `mariadb`, port `3306`, credentials from `.env`.
It is intentionally not exposed:

```bash
make admin
ssh -L 8080:127.0.0.1:8080 user@YOUR_SERVER_IP
# then http://127.0.0.1:8080, server: mariadb
```

`docker compose restart mariadb` keeps data (named volume `mariadb-data`);
`docker compose down -v` destroys it.

## FastDL (nginx package delivery)

With hundreds of megabytes of client files, the game server's HTTP port becomes a
bottleneck. FastDL moves delivery to nginx.

1. In `.env`: `RAGE_CREATE_FASTDL_SNAPSHOT=true`, then `make restart` — `server-data/fastdl` appears.
2. Start nginx: `cd extras/fastdl && docker compose up -d`.
3. Open port `22007/tcp`.
4. In `.env`: `RAGE_FASTDL_HOST=http://YOUR_SERVER_IP:22007`, then `make restart`.
5. Restart the server after every `client_packages` change so the snapshot matches what
   players are told to download.

For a domain and HTTPS, put FastDL behind a reverse proxy (Caddy/Traefik/Cloudflare).
Cloudflare can front your website and FastDL only — game UDP traffic does not pass through it.

## Game mode development

```bash
make shell                 # or edit files on the host directly
nano server-data/packages/core/commands.js
make restart
make logs
```

- Server side is Node.js: `mp.events.add`, `mp.players`, `mp.vehicles`, `mp.events.addCommand`.
- Client side: `mp.gui.chat`, `mp.events.callRemote`, CEF browsers.
- `client_packages` changes reach players on their next connection; keep a second test
  server on another port for iteration.
- Before shipping: `node --check` every file and run it on the test server.
- Take third-party scripts only from sources you trust: **a server-side script is arbitrary
  code on your machine.** Read what you install, especially anything in `plugins/*`.

References: [development](https://wiki.rage.mp/wiki/Getting_Started_with_Development),
[server functions](https://wiki.rage.mp/wiki/Server-side_functions),
[client functions](https://wiki.rage.mp/wiki/Client-side_functions).

## Boot and restarts

- Containers use `restart: unless-stopped`, so they come back after a host reboot as long
  as Docker is enabled (`sudo systemctl enable docker`).
- `extras/systemd/ragemp.service` binds the stack to a systemd unit (useful when you need
  `--profile db` at boot).
- After a reboot, check `make status`.

## Security

| Area | Measure |
| --- | --- |
| SSH | keys only, no root login, ideally a non-standard port + fail2ban |
| Ports | expose only `22`, `22005/udp+tcp`, `22006` (`22007` with FastDL) |
| Database | never publish it; use an SSH tunnel |
| Updates | `apt upgrade` weekly, `make update` when new RAGE files ship |
| Scripts | no unvetted resources; inspect `plugins/` and `node_modules` |
| Secrets | only `.env`; backups contain passwords — encrypt them at rest |
| DDoS | pick a provider with protection and enable it for game ports |
| Privileges | container runs as UID 1000, no `--privileged`, `no-new-privileges` |

RAGE servers get attacked regularly: UDP floods, connection spam, crash packets.
`RAGE_MAX_PING`, `RAGE_MAX_PACKET_LOSS`, `limit-time-of-connections-per-ip` and
`disallow-multiple-connections-per-ip` help with some of it; volumetric floods are only
solvable at the provider level.

## Scaling

- **More players**: single-core speed first, then `RAGE_SYNC_RATE` (40 ms is the sweet spot),
  `RAGE_STREAM_DISTANCE` (500 in a city, 300–400 for RP), and the number of entities your
  game mode creates.
- **Heavy game mode**: Node.js defaults to a ~2 GB heap in the container. Raise it with
  `RAGE_NODE_COMMANDLINE_FLAGS=--max-old-space-size=4096`.
- **Several servers** (main + staging): separate directories and ports
  (`RAGE_PORT=22105`, `RAGE_HTTP_PORT=22106`), plus
  `RAGE_CLIENT_PACKAGES_SHARED_FOLDER` to share package downloads.
