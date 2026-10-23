# Troubleshooting

Start with the three commands that answer 80% of questions:

```bash
make status                      # container, ports, external reachability, disk, errors
make logs                        # what the server itself says
make conf                        # the conf.json actually produced from .env
```

---

## The server does not start

### `No usable version of libssl was found` / `Aborted (core dumped)`

The RAGE:MP Linux build links against a specific OpenSSL version. Debian 12 (this image)
ships `libssl3`; if the binary wants `libssl1.1`, it dies exactly like this.

Check the binary's dependencies:

```bash
docker compose run --rm --no-deps --entrypoint bash ragemp -lc \
  'ldd /opt/ragemp/server/ragemp-server | grep -i "not found"'
```

Add any missing package to the `apt-get install` block in the `Dockerfile`. For `libssl1.1`
on Debian 12:

```dockerfile
RUN echo "deb http://security.debian.org/debian-security bullseye-security main" \
      > /etc/apt/sources.list.d/bullseye-security.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libssl1.1 \
    && rm -rf /var/lib/apt/lists/*
```

Then rebuild: `docker compose build --no-cache && make update`.

### `ragemp-server: not found` or an empty `server-data`

Binaries are copied into `./server-data` on first start. If the directory is not writable:

```bash
ls -la server-data
id -u; id -g                    # must match RAGEMP_UID / RAGEMP_GID
sudo chown -R "$(id -u):$(id -g)" server-data
make restart
```

A `permission denied` in the entrypoint log is always about the directory owner.

### The container restarts in a loop

```bash
docker compose ps               # Restarting
docker compose logs --tail=200 ragemp
docker inspect ragemp --format '{{.State.ExitCode}} {{.State.Error}}'
```

Common causes: an invalid `.env` (unquoted value with a space or `[]`), a busy port
(`ss -lunp | grep 22005`), or wrong permissions on `server-data`.

## The server is not listed in the browser

1. Is `RAGE_ANNOUNCE=true` in `.env`? Did you run `make restart` (not just restart the container)?
2. Is `bind` in `server-data/conf.json` equal to `0.0.0.0`? (`make conf | grep bind`)
3. Are ports open **both** in `ufw` **and** in your provider panel? Test from another machine:
   ```bash
   nc -vz YOUR_SERVER_IP 22005     # TCP
   curl -I http://YOUR_SERVER_IP:22006/
   ```
4. Wait 5–10 minutes; the master list is not instant.
5. Check your card at [rage.mp/masterlist](https://rage.mp/masterlist).
6. Behind NAT or a proxy? Announcement requires inbound port forwarding.

## Players connect but hang on loading

Almost always the client package HTTP port (`RAGE_PORT + 1`).

```bash
make conf | grep -E '"port"'
ss -ltnp | grep 22006
curl -I http://YOUR_SERVER_IP:22006/
```

- `RAGE_HTTP_PORT` must be exactly `RAGE_PORT + 1`; the entrypoint warns otherwise.
- `22006/tcp` must be published in `docker-compose.yml` and open in the firewall.
- `RAGE_ENABLE_HTTP_SECURITY=true` breaks the initial download — keep it `false`.
- After changing `client_packages`, restart the server: clients cache old packages.

## Client crashes / black screen / scripts do nothing

- Open the client console (F1); red lines almost always point into `client_packages`.
- Syntax-check everything: `for f in $(find server-data -name '*.js'); do node --check "$f"; done`
- For CEF debugging temporarily set `RAGE_ALLOW_CEF_DEBUGGING=true` and `make restart`
  (turn it back off in production).
- Make sure `client_packages/index.js` actually `require`s your files.

## High load, lag, desync

| Symptom | What to check |
| --- | --- |
| One core pegged at 100% | the RAGE main thread; reduce `RAGE_STREAM_DISTANCE` and entity counts |
| Vehicle desync | `RAGE_SYNC_RATE` 40 (25 updates/s); below 30 is expensive and unstable |
| Lag spikes on join | heavy `client_packages`; enable FastDL |
| Dips above 50 players | database on the same host, slow queries — `htop` plus the MariaDB slow log |
| Memory grows | a leak in the game mode; cap the heap with `RAGE_NODE_COMMANDLINE_FLAGS=--max-old-space-size=2048` |

One-line monitoring: `docker stats --no-stream`.

## OOM: the container was killed (`exit code 137`)

```bash
free -h; dmesg -T | tail -20 | grep -i -E 'oom|killed'
```

Add swap ([SETUP.md](SETUP.md#2-preparing-the-host)), lower `RAGE_MAXPLAYERS`, cap the
Node.js heap, and look for leaks in your scripts.

## MariaDB will not start

```bash
docker compose --profile db ps
docker compose --profile db logs mariadb | tail -50
```

- `Access denied` — the `.env` password changed after the first run while the
  `mariadb-data` volume kept the old one. Restore the password or recreate the volume
  (data loss!).
- `Permission denied` on `/var/lib/mysql` — the volume was created by another user; recreate it.
- The `healthcheck.sh` probe needs MariaDB 10.4+; on older tags use
  `mysqladmin ping -h 127.0.0.1 -u root -p"$$MARIADB_ROOT_PASSWORD"`.

## The image build fails while downloading server files

```bash
curl -I https://cdn.rage.mp/updater/prerelease/server-files/linux_x64.tar.gz
```

If the CDN is unreachable from your network, build elsewhere or point the build at a mirror:

```dotenv
RAGEMP_SERVER_URL=https://your-mirror/linux_x64.tar.gz
RAGEMP_ARCHIVE_SHA256=<sha256 of the archive>
```

Always pin `RAGEMP_ARCHIVE_SHA256` when using mirrors — that is your tamper protection.

## `docker compose` unsupported / `docker-compose: command not found`

You need Compose v2 (a plugin): `sudo apt install docker-compose-plugin`, and the command
is `docker compose` (with a space). v1 is not supported.

## Useful links

- [RAGE:MP wiki](https://wiki.rage.mp/wiki/Main_Page) — settings, events, API.
- [RAGE:MP forums](https://rage.mp/forums) — platform-level issues.
- Our [SETUP](SETUP.md) and [OPERATIONS](OPERATIONS.md) if something fails during install.
