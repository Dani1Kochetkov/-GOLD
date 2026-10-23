# GOLD — сервер GTA V (RAGE:MP) на Linux VPS

Готовый к запуску сервер **GTA V / RAGE:MP** в Docker: конфиг генерируется из одного
`.env`, гейммод-заготовка уже в репозитории, бэкапы/обновление/диагностика — в скриптах.
Проверялось под Debian 12 и Ubuntu 22.04/24.04.

**Документация:** [RU: установка](docs/ru/SETUP.md) · [RU: эксплуатация](docs/ru/OPERATIONS.md) ·
[RU: проблемы](docs/ru/TROUBLESHOOTING.md) · [English docs](README.en.md)

---

## Что внутри

| Путь | Назначение |
| --- | --- |
| `Dockerfile` | Образ Debian 12 + официальные серверные файлы RAGE:MP + jq/tini |
| `docker-compose.yml` | Сервер, опционально MariaDB (`--profile db`) и Adminer (`--profile admin`) |
| `.env.example` | Все настройки сервера: имя, порты, лимиты, голосовой чат |
| `config/conf.jq` | Генератор `conf.json` из переменных окружения |
| `entrypoint.sh` | Ставит бинарники в `./server-data`, рендерит конфиг, запускает сервер |
| `server-data/` | Живые файлы сервера (bind-mount): `packages`, `client_packages`, `maps`, `plugins` |
| `server-data/packages/core` | Пример freeroam-гейммода с командами `/help`, `/veh`, `/tp`, `/pos` |
| `scripts/` | `backup.sh`, `restore.sh`, `update.sh`, `status.sh`, `gen-conf.sh` |
| `extras/fastdl` | Раздача клиентских пакетов через nginx (FastDL) |
| `extras/systemd` | Автозапуск стека и ежедневный бэкап по таймеру |
| `docs/` | Пошаговые инструкции на русском и английском |

## Быстрый старт

Нужен VPS с Ubuntu 22.04/24.04 или Debian 12: **2–4 vCPU, 4–8 ГБ RAM, 40+ ГБ NVMe**
(подробнее — [выбор сервера](docs/ru/SETUP.md#1-выбор-vps)).

```bash
# 1. Docker (официальный скрипт, затем перелогиньтесь)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

# 2. Код
git clone <URL-этого-репозитория> ~/gold && cd ~/gold

# 3. Конфиг
cp .env.example .env
nano .env          # RAGE_NAME, RAGE_MAXPLAYERS, RAGE_ANNOUNCE, RAGEMP_UID/GID

# 4. Запуск (скачает серверные файлы RAGE:MP с официального CDN)
make up            # = docker compose up -d --build

# 5. Проверка
make status        # контейнер, порты, доступность HTTP-порта, диск
make logs
```

Дальше: откройте порты `22005/udp`, `22005/tcp`, `22006/tcp` (и в `ufw`, и в firewall
провайдера), поставьте `RAGE_ANNOUNCE=true`, выполните `make restart` — сервер появится
в списке RAGE:MP. Подключение: лаунчер RAGE:MP → подключение по `IP:22005`.

> **Важно:** `22006` — это `RAGE_PORT + 1`, по нему игроки скачивают клиентские пакеты.
> Если поменяли `RAGE_PORT`, поменяйте и `RAGE_HTTP_PORT`.

## Повседневные команды

```bash
make logs       # логи сервера
make restart    # после правки .env
make conf       # показать conf.json, который будет сгенерирован
make shell      # шелл внутри контейнера
make backup     # архив ./server-data + дамп БД в ./backups
make update     # свежие серверные файлы RAGE:MP
make db         # сервер + MariaDB
```

## Как это устроено

- **Бинарники RAGE:MP не лежат в git.** Образ скачивает их с официального CDN при сборке
  и копирует в `./server-data` при первом старте — вместе с гейммодом они попадают в бэкап.
- **`conf.json` — производная от `.env`.** Он перегенерируется при каждом старте
  (`RAGE_CONF_MODE=generate`). Нужен ручной конфиг — поставьте `keep` и правьте
  `server-data/conf.json`.
- **Гейммод — обычные файлы в git.** Правки в `server-data/packages` и
  `server-data/client_packages` подхватываются после `make restart`, пересборка образа не нужна.
- **Секреты — только в `.env`** (он в `.gitignore`). В репозитории лежит `.env.example`.

## Требования и правовая рамка

- У играющих — лицензионная GTA V для Windows и клиент [RAGE:MP](https://rage.mp).
  Сервер работает на Linux, клиент — только Windows; пиратские копии и «крэки» не поддерживаются.
- RAGE:MP бесплатен; серверные файлы — собственность разработчиков платформы.
- Не выкладывайте в публичный доступ `plugins/` и клиентские пакеты чужих проектов —
  это нарушает их лицензии.

## Лицензия

Код обвязки (Docker, скрипты, документация) — MIT. Серверные файлы RAGE:MP и GTA V
распространяются по своим лицензиям.
