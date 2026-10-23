# Эксплуатация сервера

Всё, что нужно после первого запуска: переменные, команды, бэкапы, база, FastDL,
разработка гейммода и безопасность.

---

## Команды

| Команда | Что делает |
| --- | --- |
| `make up` | собрать образ и поднять сервер в фоне |
| `make down` | остановить и удалить контейнеры (данные в `./server-data` остаются) |
| `make restart` | перезапуск после правки `.env` |
| `make logs` | логи сервера в реальном времени |
| `make conf` | напечатать `conf.json`, который получится из текущего `.env` |
| `make shell` | шелл внутри контейнера (от пользователя `1000:1000`) |
| `make backup` | архив `./server-data` + дамп MariaDB в `./backups` |
| `make restore FILE=...` | восстановить архив |
| `make update` | обновить серверные файлы RAGE:MP |
| `make db` | поднять сервер вместе с MariaDB |
| `make admin` | MariaDB + Adminer на `127.0.0.1:8080` |
| `make status` | контейнеры, порты, публичная доступность, диск, ошибки |
| `make lint` | проверить shell-скрипты, JSON и генератор конфига |

## Переменные `.env`

`conf.json` целиком собирается из `.env`. Таблица ниже — поддерживаемые ключи
(пустое значение = ключ не попадает в конфиг, RAGE:MP использует своё умолчание).
Официальный справочник по настройкам: [wiki.rage.mp/wiki/Server_settings](https://wiki.rage.mp/wiki/Server_settings).

| Переменная | По умолчанию | Что задаёт |
| --- | --- | --- |
| `RAGE_NAME` | `GOLD [RU] Freeroam` | имя в списке серверов, теги в `[]` |
| `RAGE_LANGUAGE` | `ru` | флаг рядом с именем (`us`, `ru`, `de`, …) |
| `RAGE_URL` | — | сайт проекта в карточке сервера |
| `RAGE_FQDN` | — | домен вместо IP (не меняется при переезде) |
| `RAGE_ANNOUNCE` | `false` | публикация в мастер-листе |
| `RAGE_GAMEMODE` | `freeroam` | имя режима в браузере серверов |
| `RAGE_PORT` | `22005` | игровой порт (UDP **и** TCP) |
| `RAGE_HTTP_PORT` | `22006` | HTTP для пакетов, обязан быть `RAGE_PORT + 1` |
| `RAGE_BIND` | `0.0.0.0` | адрес прослушивания (в контейнере не менять) |
| `RAGE_MAXPLAYERS` | `32` | лимит игроков (платформа: до 100 на сервер) |
| `RAGE_STREAM_DISTANCE` | `500` | радиус стриминга сущностей, метры |
| `RAGE_SYNC_RATE` | `40` | интервал синхронизации, мс (меньше — плавнее и дороже) |
| `RAGE_VOICE_CHAT` | `true` | голосовой чат |
| `RAGE_VOICE_CHAT_SAMPLE_RATE` | `24000` | 8000 / 16000 / 24000 / 48000 |
| `RAGE_MAX_PING` | `200` | кик при высоком пинге |
| `RAGE_MAX_PACKET_LOSS` | — | кик при потерях пакетов (например `0.1`) |
| `RAGE_MIN_FPS` | — | минимальный FPS у клиента |
| `RAGE_SERVER_SIDE_WEAPONS_ONLY_MODE` | `true` | синхронизировать только оружие, выданное сервером |
| `RAGE_DISALLOW_MULTIPLE_CONNECTIONS_PER_IP` | `false` | запрет нескольких игроков с одного IP |
| `RAGE_ENABLE_NODEJS` | `true` | серверные скрипты на Node.js |
| `RAGE_CSHARP` | `disabled` | `enabled` только с C#-мостом |
| `RAGE_HTTP_THREADS` | — | одновременных HTTP-соединений для пакетов |
| `RAGE_RESOURCES_COMPRESSION_LEVEL` | — | сжатие клиентских ресурсов |
| `RAGE_ALLOW_CEF_DEBUGGING` | — | отладка CEF (в проде выключено) |
| `RAGE_FASTDL_HOST` | — | внешний URL раздачи клиентских пакетов |
| `RAGE_CREATE_FASTDL_SNAPSHOT` | — | генерировать снимок пакетов для FastDL |
| `RAGE_CLIENT_PACKAGES_SHARED_FOLDER` | — | общий каталог пакетов для нескольких серверов |
| `RAGE_NODE_COMMANDLINE_FLAGS` | — | флаги Node.js (например `--max-old-space-size=2048`) |
| `RAGEMP_UID` / `RAGEMP_GID` | `1000` | владелец `./server-data` внутри контейнера |
| `RAGE_CONF_MODE` | `generate` | `generate` — из `.env`, `keep` — ручной `conf.json` |
| `TZ` | `Europe/Moscow` | часовой пояс контейнера |

Дополнительно, только для профиля `db`: `MARIADB_DATABASE`, `MARIADB_USER`,
`MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `MARIADB_PORT`, `ADMINER_PORT`.

Флаги `enable-http-security` в `.env` нет намеренно: по [примечанию в вики](https://wiki.rage.mp/wiki/Server_settings)
он ломает первичную загрузку пакетов клиентом (клиент вынужден подключаться дважды).

## Структура `server-data`

```text
server-data/
├── packages/            # серверные скрипты (Node.js)
│   ├── index.js         # точка входа, подключает модули
│   └── core/            # пример freeroam-гейммода
├── client_packages/     # клиентские скрипты и UI (скачиваются игроками)
│   ├── index.js
│   └── core/
├── maps/                # карты (.json)
├── plugins/             # .so/.dll плагины (например C#-мост)
├── fastdl/              # снимок пакетов для FastDL (генерируется, в git не идёт)
├── logs/                # логи, если гейммод их пишет
├── conf.json            # генерируется из .env
└── ragemp-server, bin/, dotnet/   # бинарники (копируются из образа, в git не идут)
```

## Бэкапы

```bash
make backup                              # вручную
BACKUP_KEEP=30 ./scripts/backup.sh       # хранить 30 архивов
./scripts/restore.sh backups/ragemp-20261023-042000.tar.gz
```

Что попадает в архив: гейммод, клиентские пакеты, карты, плагины, `conf.json`.
Что не попадает: бинарники, логи, снимок FastDL — их можно пересоздать.

Автоматизация: `extras/systemd/ragemp-backup.timer` (ежедневно в 04:20).

Правила, которые спасают:

1. **Бэкап на том же диске — не бэкап.** Раз в сутки копируйте `./backups` на другой хост:
   ```bash
   rsync -avz --delete ~/gold/backups/ backup@other-host:/srv/gold-backups/
   ```
2. Раз в месяц проверяйте восстановление на тестовом стенде.
3. Дамп БД восстанавливается отдельно:
   ```bash
   gunzip -c backups/ragemp-db-20261023-042000.sql.gz | \
     docker compose exec -T mariadb sh -c 'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
   ```

## База данных

```bash
make db        # сервер + MariaDB (profile db)
```

Из серверных скриптов БД доступна по хосту `mariadb`, порт `3306`,
логин/пароль/база — из `.env`. Внешний доступ намеренно закрыт:

```bash
# Посмотреть БД через Adminer локально
make admin
ssh -L 8080:127.0.0.1:8080 user@YOUR_SERVER_IP
# затем http://127.0.0.1:8080, сервер: mariadb
```

Важно: `docker compose restart mariadb` не пересоздаёт данные — они в томе
`mariadb-data`. Удаление тома (`docker compose down -v`) уничтожит БД.

## FastDL (раздача пакетов через nginx)

Когда клиентских файлов много (сотни мегабайт), HTTP-порт самого сервера становится узким
местом. FastDL выносит раздачу на отдельный nginx.

1. В `.env`: `RAGE_CREATE_FASTDL_SNAPSHOT=true`, затем `make restart` — появится `server-data/fastdl`.
2. Запустите nginx:
   ```bash
   cd extras/fastdl && docker compose up -d
   ```
3. Откройте порт `22007/tcp`.
4. В `.env`: `RAGE_FASTDL_HOST=http://YOUR_SERVER_IP:22007` и `make restart`.
5. После каждого изменения `client_packages` перезапускайте сервер — снимок должен
   совпадать с тем, что скачивают игроки.

Для домена и HTTPS поставьте FastDL за обратный прокси (Caddy/Traefik/Cloudflare).
Cloudflare можно использовать только для сайта и FastDL; игровой UDP-трафик через него не пойдёт.

## Разработка гейммода

```bash
make shell                 # или правьте файлы прямо на хосте
nano server-data/packages/core/commands.js
make restart               # подхватить изменения
make logs
```

- Серверные скрипты — Node.js: `mp.events.add`, `mp.players`, `mp.vehicles`, `mp.events.addCommand`.
- Клиентские — `mp.gui.chat`, `mp.events.callRemote`, CEF-браузеры.
- Изменения в `client_packages` игроки получают при следующем подключении;
  для проверки удобно держать второй тестовый сервер на другом порту.
- Перед выкладкой: `node --check` по каждому файлу и прогон на тестовом сервере.
- Готовые скрипты берите только из проверенных источников: **серверный скрипт — это
  произвольный код на вашей машине.** Смотрите, что подключаете, особенно `plugins/*`.

Полезные ссылки: [разработка на RAGE:MP](https://wiki.rage.mp/wiki/Getting_Started_with_Development),
[серверные функции](https://wiki.rage.mp/wiki/Server-side_functions),
[клиентские функции](https://wiki.rage.mp/wiki/Client-side_functions).

## Автозапуск и перезагрузка

- Контейнеры уже имеют `restart: unless-stopped` — после ребута хоста они поднимутся сами,
  если служба Docker включена (`sudo systemctl enable docker`).
- `extras/systemd/ragemp.service` — если хотите привязать стек к systemd-юниту
  (полезно, когда compose-файл требует `--profile db`).
- Проверка после ребута: `make status`.

## Безопасность

| Что | Как |
| --- | --- |
| SSH | только ключи, без root-логина, желательно нестандартный порт + fail2ban |
| Порты | наружу только `22`, `22005/udp+tcp`, `22006` (`22007` при FastDL) |
| БД | никогда не публиковать; доступ через SSH-туннель |
| Обновления | `apt upgrade` раз в неделю, `make update` при выходе новых файлов RAGE |
| Скрипты | не ставить непроверенные ресурсы; проверять `plugins/` и `node_modules` |
| Секреты | только `.env`; бэкапы тоже содержат пароли — храните их зашифрованными |
| DDoS | выбирайте провайдера с защитой; включайте её на игровые порты |
| Права | контейнер работает от UID 1000, без `--privileged`, с `no-new-privileges` |

RAGE-серверы регулярно атакуют: UDP-флуд, спам-подключения, краш-пакеты.
`RAGE_MAX_PING`, `RAGE_MAX_PACKET_LOSS`, `limit-time-of-connections-per-ip` и
`disallow-multiple-connections-per-ip` снижают часть атак, но от объёмного флуда
спасает только провайдер.

## Масштабирование

- **Больше игроков**: сначала частота CPU, потом `RAGE_SYNC_RATE` (40 мс — оптимум),
  `RAGE_STREAM_DISTANCE` (500 в городе, 300–400 на RP), число сущностей в гейммоде.
- **Тяжёлый гейммод**: Node.js в контейнере по умолчанию берёт ~2 ГБ heap.
  Меняйте через `RAGE_NODE_COMMANDLINE_FLAGS=--max-old-space-size=4096`.
- **Несколько серверов** (основной + тестовый) — отдельные каталоги и порты
  (`RAGE_PORT=22105`, `RAGE_HTTP_PORT=22106`), общий `RAGE_CLIENT_PACKAGES_SHARED_FOLDER`
  экономит трафик на загрузке пакетов.
