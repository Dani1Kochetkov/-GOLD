# Перенос GOLD DAYZ на VDS и публичный запуск

Инструкция для Linux (Ubuntu 22.04/24.04) и Windows. Схема: dev на домашнем ПК (`127.0.0.1`) → VDS (`0.0.0.0`) → мастер-лист RAGE.

---

## 0. Что должно работать до переезда

* `npm run verify` — зелёный (build + check + test + sim).
* В игре пройден раздел «Требует проверки в GTA» из [CHECKLIST.md](CHECKLIST.md).
* Нет ошибок в `logs/gold-dayz.log` при 10–15 минутах игры с зомби и лутом.

---

## 1. Требования к VDS

| Ресурс | Минимум | Комфортно |
|---|---|---|
| CPU | 2 vCPU (высокая частота важнее ядер) | 4 vCPU |
| RAM | 2 ГБ + 250 МБ на ~50 игроков | 4–8 ГБ |
| Диск | 20 ГБ SSD | 40 ГБ SSD |
| Сеть | 100 Мбит/с, пинг RU/EU | 1 Гбит/с |
| ОС | Ubuntu 22.04 / Windows Server 2019+ | Ubuntu 24.04 |

Локация: ближе к игрокам (Москва/СПб/Финляндия). Игровой сервер RAGE однопоточный по логике мира — не гонитесь за 32 ядрами, берите частоту.

Порты:

| Порт | Протокол | Назначение |
|---|---|---|
| `22005` | TCP + UDP | игровой трафик |
| `22006` | TCP | HTTP-раздача клиентских пакетов |

---

## 2. Подготовка файлов

На домашнем ПК:

```bash
npm run release         # verify + готовый release/gold-dayz-<версия>.zip
```

Архив уже содержит собранный клиентский бандл и CEF-UI — на VDS Node.js нужен только если хотите пересобирать (`npm run build`) или гонять проверки (`npm run check`, `npm test`).

На VDS положите в `/home/gold/dayz/`:

```
ragemp-server           # Linux-бинарник с rage.mp (или ragemp-server.exe на Windows)
conf.json               # из conf.production.example.json
packages/gold/index.js
client_packages/index.js
client_packages/gold/…  # из сборки
server/  shared/  client/  data/  tools/  tests/  docs/  package.json
```

Распаковать: `unzip gold-dayz-<версия>.zip` и скопировать содержимое `gold-dayz-<версия>/` в папку с server-files.

Каталог `server/`, `shared/`, `data/` обязателен: `packages/gold/index.js` подключает `../../server/index.js`, иначе gamemode не загрузится. `client/`, `tools/`, `tests/`, `docs/` на проде не нужны, но и не мешают (client/ не грузится RAGE, он только источник для сборки).

### conf.json для продакшена

```bash
cp conf.production.example.json conf.json
```

Ключевое отличие от dev:

| Параметр | Dev | Prod | Зачем |
|---|---|---|---|
| `bind` | `127.0.0.1` | `0.0.0.0` | слушать внешний интерфейс |
| `announce` | `false` | `true` | попасть в мастер-лист |
| `maxplayers` | 32 | 100 (по ресурсам) | слоты |
| `allow-cef-debugging` | `true` | `false` | не давать игрокам DevTools UI |
| `resources-compression-level` | 0 | 6 | экономия трафика на раздаче пакетов |
| `stream-distance` | 300 | 400 | видимость мира |
| `max-ping` / `min-fps` / `max-packet-loss` | — | 350 / 20 / 20 | отсечь неиграбельные подключения |

Проверьте `url` и `language` (`"ru"` даёт флаг в мастер-листе). Имя сервера — в `name`; теги в квадратных скобках, например `GOLD DAYZ [RU] [DayZ] [PVP]`.

---

## 3. Linux: установка

```bash
sudo apt update && sudo apt install -y curl unzip ufw

# Node.js нужен только для tools (build/check). Сам RAGE несёт свой рантайм.
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd -r -m -d /home/gold -s /bin/bash gold || true
sudo mkdir -p /home/gold/dayz && sudo chown -R gold:gold /home/gold/dayz
```

Распакуйте server-files RAGE (Linux) в `/home/gold/dayz/`, затем положите файлы проекта и соберите бандл:

```bash
cd /home/gold/dayz
sudo -u gold npm run build
sudo -u gold npm run check
```

### systemd-юнит

`/etc/systemd/system/gold-dayz.service`:

```ini
[Unit]
Description=GOLD DAYZ (RAGE Multiplayer)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gold
WorkingDirectory=/home/gold/dayz
ExecStart=/home/gold/dayz/ragemp-server
Restart=on-failure
RestartSec=5
LimitNOFILE=65535
Environment=GOLD_LOG_LEVEL=info
# профили и логи должны переживать рестарт
ReadWritePaths=/home/gold/dayz/storage /home/gold/dayz/logs

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod +x /home/gold/dayz/ragemp-server
sudo systemctl daemon-reload
sudo systemctl enable --now gold-dayz
sudo journalctl -u gold-dayz -f
```

Логи приложения дублируются в `/home/gold/dayz/logs/gold-dayz.log`.

### Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 22005/tcp
sudo ufw allow 22005/udp
sudo ufw allow 22006/tcp
sudo ufw enable
sudo ufw status verbose
```

Если у провайдера есть внешний файрвол — откройте те же порты и там.

---

## 4. Windows Server

1. Распакуйте Windows server-files в папку на нужном диске, например `D:\gold-dayz\`, файлы проекта — туда же.
2. `npm run build` и `npm run check`.
3. `conf.json` — из `conf.production.example.json`.
4. Брандмауэр:

```powershell
New-NetFirewallRule -DisplayName "GOLD DAYZ game TCP" -Direction Inbound -Protocol TCP -LocalPort 22005 -Action Allow
New-NetFirewallRule -DisplayName "GOLD DAYZ game UDP" -Direction Inbound -Protocol UDP -LocalPort 22005 -Action Allow
New-NetFirewallRule -DisplayName "GOLD DAYZ packages" -Direction Inbound -Protocol TCP -LocalPort 22006 -Action Allow
```

5. Автозапуск — «Планировщик заданий» с триггером «При запуске системы», действие `D:\gold-dayz\ragemp-server.exe`, рабочая папка `D:\gold-dayz`.
6. Держите включённым `Отключить sleep` в схеме электропитания — иначе сервер уснёт.

---

## 5. Проверка после запуска

```bash
ss -lntup | grep -E '22005|22006'
curl -I http://127.0.0.1:22006/    # должен ответить HTTP-сервер пакетов
tail -f logs/gold-dayz.log         # "GOLD DAYZ готов", метрики раз в 30 с
```

Снаружи: подключитесь клиентом RAGE по `IP:22005`. Если висит на загрузке пакетов — закрыт `22006`.

Через 5 минут на сервере:

* `/metrics` в консоли или лог: `tickAvgMs` < 3, `tickMaxMs` < 15 при 30 игроках;
* `snapshotAvgBytes` < 1500;
* `players` соответствует онлайну.

---

## 6. Мастер-лист

1. `announce: true`, `bind: 0.0.0.0`, `port: 22005` — открыты в файрволе.
2. Сервер должен отработать 10–15 минут: RAGE публикует сервер в мастер-листе не мгновенно.
3. `name` — уникальное, с тегами; `language: "ru"`; `url` — ваш сайт/Discord (до 20 символов видно в веб-листе).
4. Проверьте, что сервер виден на https://rage.mp/masterlist по имени.

---

## 7. Обновления и бэкапы

### Обновление кода

```bash
sudo systemctl stop gold-dayz
cd /home/gold/dayz
git pull                     # или распакуйте архив
npm run build && npm run check
sudo systemctl start gold-dayz
```

Бандл клиента изменился — игроки при следующем подключении скачают новый пакет. Предупредите в Discord/чате о коротком рестарте.

### Бэкап

```bash
crontab -e
# каждый час, 7 копий
0 * * * * cd /home/gold/dayz && tar czf /home/gold/backup-$(date +\%H).tgz storage/ data/ conf.json >> logs/backup.log 2>&1
```

`storage/players/*.json` — это персонажи игроков (инвентарь, статы, позиция). Потеря = вайп прогресса.

### Откат

```bash
sudo systemctl stop gold-dayz
cd /home/gold/dayz && git checkout <предыдущий-коммит>
npm run build && sudo systemctl start gold-dayz
```

---

## 8. Настройка под онлайн

| Онлайн | `sync-rate` | `zombies.snapshotRadius` | `world.zombieGlobalCap` | Прочее |
|---|---|---|---|---|
| до 15 | 40 | 320 | 120 | dev-настройки |
| 15–50 | 40 | 300 | 100 | `snapshotInterval` 100 мс включается сам |
| 50–100 | 40 | 250 | 80 | следите за `snapshotAvgBytes` и CPU |

* `resources-compression-level: 6` — раздача клиентских пакетов легче.
* FastDL (`fastdl-host`, `create-fastdl-snapshot`) — только если раздача с VDS становится узким местом; для 100 игроков обычно хватает `http-threads: 50`.
* `debug.logSnapshots: false`, `chatFeedback: true` — не засоряйте лог.
* Не ставьте `world.tickMs` меньше 100 без замера: ИИ и выживание на 20 Гц нагружают CPU без видимой пользы.

---

## 9. Безопасность перед публичным открытием

- [ ] `admin.commandsFromLocalhostOnly: true` **и** список `admin.names` для доверенных лиц.
- [ ] Решено, нужен ли вайтлист (`access.whitelistEnabled`): пароля на входе у RAGE нет, вход по нику.
- [ ] Ники админов не совпадают с никами игроков (проверка по имени — слабое место; для серьёзного продакшена добавьте ACL по RAGE-ID/IP).
- [ ] `allow-cef-debugging: false`.
- [ ] `announce: true` только когда готовы к игрокам.
- [ ] Логи с `report` просматриваются, `logs/` ротируется (logrotate).
- [ ] Пароль RCON не используется (RAGE его не требует), SSH — только по ключу.
- [ ] `disallow-multiple-connections-per-ip` оставьте `false` (в RU-сегменте часто NAT), но следите за мультиклиентами через логи.

---

## 10. Чек-лист запуска

- [ ] `npm run verify` зелёный на VDS.
- [ ] `bind 0.0.0.0`, `announce true`, порты 22005/tcp+udp и 22006/tcp открыты.
- [ ] systemd/Планировщик поднимает сервер после перезагрузки.
- [ ] Клиент подключается снаружи, HUD/инвентарь/карта работают.
- [ ] Зомби спавнятся, лут пополняется, смерть/респавн работают.
- [ ] `/metrics` в норме 10 минут под нагрузкой 5–10 игроков.
- [ ] Бэкап `storage/` настроен и проверен восстановлением.
- [ ] Discord/сайт с правилами и контактом админа готовы.
