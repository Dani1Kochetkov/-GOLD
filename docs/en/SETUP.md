# Setting up a GTA V (RAGE:MP) server on a VPS

From a blank VPS to a server listed in the RAGE:MP browser. Expect 30–60 minutes,
most of it waiting for downloads.

---

## 1. Choosing a VPS

RAGE:MP is largely single-threaded: **clock speed matters more than core count**.
RAM is consumed by the game mode (Node.js) and the database; disk by server files
(~0.5 GB) plus client packages.

| Player count | vCPU | RAM | Disk | Network | Note |
| --- | --- | --- | --- | --- | --- |
| up to 20 | 2 | 4 GB | 40 GB NVMe | 100 Mbit/s | testing, friends, small RP |
| 20–60 | 4 | 8 GB | 60–80 GB NVMe | 200–500 Mbit/s | the sweet spot |
| 60–150 | 6–8 | 16 GB | 100 GB NVMe | 1 Gbit/s | RP with a database, heavy downloads |

Platform requirement: **glibc ≥ 2.28** (Debian 10+, Ubuntu 18.10+). This project runs
Debian 12 inside the container, so the host only needs Docker.

Price ballpark (October 2026, subject to change): 4 vCPU / 8 GB is roughly €6–9 or
700–1800 RUB per month depending on the provider and region. Optimise for **DDoS
protection**, a location close to your players, NVMe and a decent uplink, not for the
lowest sticker price.

Hosting options that work well: Hetzner, Netcup (EU); Timeweb Cloud, VDSina, Aeza,
FirstVDS, RUVDS (RU/CIS). "Game server panels" also work, but you lose control of the
system — this repo assumes a plain VPS.

> **Windows hosting is unnecessary.** The RAGE:MP *server* is native Linux; only the
> player client is Windows.

## 2. Preparing the host

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone UTC          # or your region
sudo apt install -y curl git ufw htop jq unzip

# 2 GB swap as an OOM cushion
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Key-only SSH (mandatory for a public server):**

```bash
ssh-keygen -t ed25519 -C "gold-vps"
ssh-copy-id user@YOUR_SERVER_IP
```

On the server, set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`
in `/etc/ssh/sshd_config`, then `sudo systemctl restart ssh`. Keep the current session open
until you have verified the new login in a second terminal.

## 3. Installing Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

sudo usermod -aG docker "$USER"
newgrp docker

docker --version
docker compose version      # v2 plugin required, not docker-compose v1
```

Missing the plugin? `sudo apt install -y docker-compose-plugin`.

## 4. Deploying the project

```bash
git clone <REPO-URL> ~/gold
cd ~/gold

cp .env.example .env
id -u; id -g          # note these, they belong in RAGEMP_UID / RAGEMP_GID
nano .env
```

Minimum to set:

```dotenv
RAGE_NAME="GOLD [EU] Freeroam"   # quote values containing spaces
RAGE_LANGUAGE=en
RAGE_MAXPLAYERS=32
RAGE_ANNOUNCE=false              # flip to true once ports are open
RAGE_PORT=22005
RAGE_HTTP_PORT=22006             # ALWAYS RAGE_PORT + 1
RAGEMP_UID=1000                  # owner of ./server-data
RAGEMP_GID=1000
TZ=UTC
```

Full variable reference: [OPERATIONS.md](OPERATIONS.md#env-variables).

## 5. Firewall

Three rules are required. UDP carries the game protocol, TCP the same port plus HTTP.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 22005/udp
sudo ufw allow 22005/tcp
sudo ufw allow 22006/tcp
sudo ufw enable
sudo ufw status verbose
```

**Also check your provider's firewall** (security groups / cloud firewall). Host rules and
panel rules are independent, and the panel is the one people forget.

Never expose MariaDB publicly: its port is bound to `127.0.0.1` in `docker-compose.yml`,
which is enough (use an SSH tunnel).

## 6. First start

```bash
make up          # docker compose up -d --build
make ps
make logs
```

Expected log lines:

```text
[entrypoint] installing server files into /data
[entrypoint] rendering conf.json from environment (RAGE_CONF_MODE=generate)
[entrypoint] name:        GOLD [EU] Freeroam
[entrypoint] listen:      0.0.0.0:22005 (UDP+TCP), HTTP 22006
...
[SERVER] RAGE:MP server is up and running
```

External checks:

```bash
make status
curl -I http://YOUR_SERVER_IP:22006/    # any response means the package server is alive
ss -lunp | grep 22005                    # UDP socket
```

A 404 from `curl` is fine — the response itself is what matters.

## 7. Connecting and publishing

1. Install the [RAGE:MP client](https://rage.mp) on a Windows machine with a legit GTA V.
2. Start the launcher and connect directly to `YOUR_SERVER_IP:22005` (or use the browser).
3. Verify the example game mode: `/help`, `/veh sultan`, `/pos` in chat.
4. Publish the server: set `RAGE_ANNOUNCE=true`, then `make restart`. It appears in the
   browser within minutes (sometimes up to ten).
5. Check [rage.mp/masterlist](https://rage.mp/masterlist) for the correct name and flag.

Planning to migrate hosts later? Set `RAGE_FQDN=game.example.com` now (an A record pointing
at the server) so players never notice the IP change.

## 8. Updating server files

```bash
make backup      # always first
make update      # rebuild the image from the official CDN and replace binaries
```

Game mode, maps and config are untouched: they live in `./server-data`, not in the image.
Roll back with `make restore FILE=backups/ragemp-....tar.gz`.

## 9. Next steps

- [Operations](OPERATIONS.md): every variable, backups, database, FastDL, game mode development.
- [Troubleshooting](TROUBLESHOOTING.md): not listed, players stuck downloading, OOM,
  "No usable version of libssl" and more.
- `extras/systemd`: boot-time start and a daily backup timer.
