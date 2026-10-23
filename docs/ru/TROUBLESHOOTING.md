# Проблемы и решения

Сначала — три команды, которые отвечают на 80% вопросов:

```bash
make status                      # контейнер, порты, доступность извне, диск, ошибки
make logs                        # что говорит сам сервер
make conf                        # какой conf.json реально получился из .env
```

---

## Сервер не стартует

### `No usable version of libssl was found` / `Aborted (core dumped)`

Серверная сборка RAGE:MP собрана под конкретную версию OpenSSL. На Debian 12
(наш образ) стоит `libssl3`; если бинарник требует `libssl1.1`, он падает именно так.

Проверьте зависимости бинарника:

```bash
docker compose run --rm --no-deps --entrypoint bash ragemp -lc \
  'ldd /opt/ragemp/server/ragemp-server | grep -i "not found"'
```

Если чего-то не хватает — добавьте в `Dockerfile` (в блок `apt-get install`) нужный пакет.
Для `libssl1.1` на Debian 12:

```dockerfile
RUN echo "deb http://security.debian.org/debian-security bullseye-security main" \
      > /etc/apt/sources.list.d/bullseye-security.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libssl1.1 \
    && rm -rf /var/lib/apt/lists/*
```

После правки: `docker compose build --no-cache && make update`.

### `ragemp-server: not found` или пустой `server-data`

Бинарники копируются в `./server-data` при первом старте. Если каталог не записывается:

```bash
ls -la server-data
id -u; id -g                    # должны совпадать с RAGEMP_UID/RAGEMP_GID
sudo chown -R "$(id -u):$(id -g)" server-data
make restart
```

Ошибка `permission denied` в логах entrypoint — всегда про владельца каталога.

### Контейнер перезапускается по кругу

```bash
docker compose ps               # статус Restarting
docker compose logs --tail=200 ragemp
docker inspect ragemp --format '{{.State.ExitCode}} {{.State.Error}}'
```

Частые причины: неверный `.env` (незакавыченное значение с пробелом или `[]`),
занятый порт (`ss -lunp | grep 22005`), отсутствие прав на `server-data`.

## Сервер не видно в списке серверов

1. `RAGE_ANNOUNCE=true` в `.env`? После правки — `make restart` (не просто `restart` контейнера).
2. `bind` в `server-data/conf.json` равен `0.0.0.0`? (`make conf | grep bind`).
3. Порты открыты **и** в `ufw`, **и** в панели провайдера. Проверка с другой машины:
   ```bash
   nc -vz YOUR_SERVER_IP 22005     # TCP
   curl -I http://YOUR_SERVER_IP:22006/
   ```
4. Подождите 5–10 минут: мастер-лист обновляется не мгновенно.
5. Проверьте карточку на [rage.mp/masterlist](https://rage.mp/masterlist).
6. Если сервер за NAT/прокси — публикация не заработает без проброса портов.

## Игроки подключаются, но застревают на загрузке

Почти всегда это HTTP-порт клиентских пакетов (`RAGE_PORT + 1`).

```bash
make conf | grep -E '"port"'
ss -ltnp | grep 22006
curl -I http://YOUR_SERVER_IP:22006/
```

- `RAGE_HTTP_PORT` должен быть ровно `RAGE_PORT + 1`. Entrypoint пишет WARN, если это не так.
- Порт `22006/tcp` должен быть опубликован в `docker-compose.yml` и открыт в firewall.
- `RAGE_ENABLE_HTTP_SECURITY=true` ломает первичную загрузку — держите `false`.
- После правок в `client_packages` перезапустите сервер: старые пакеты кэшируются клиентом.

## Клиент падает / чёрный экран / скрипты не работают

- Откройте консоль клиента (F1) и посмотрите красные строки — ошибка почти всегда в
  `client_packages`.
- Проверьте синтаксис: `for f in $(find server-data -name '*.js'); do node --check "$f"; done`
- Для отладки CEF временно: `RAGE_ALLOW_CEF_DEBUGGING=true` и `make restart`
  (в проде выключайте обратно).
- Убедитесь, что `client_packages/index.js` действительно подключает ваши файлы через `require`.

## Высокая нагрузка / лаги / рассинхрон

| Симптом | Что проверить |
| --- | --- |
| CPU 100% на одном ядре | основной поток RAGE; уменьшите `RAGE_STREAM_DISTANCE`, число сущностей/пешеходов |
| Рассинхрон машин | `RAGE_SYNC_RATE` 40 (25 обновлений/с); ниже 30 — дорого и нестабильно |
| Лаги при подключении | тяжёлые `client_packages`; включите FastDL |
| Провалы при 50+ онлайне | БД в том же контейнере хоста, медленные запросы, `htop` + `mariadb` slow log |
| Память растёт | утечка в гейммоде; ограничьте heap `RAGE_NODE_COMMANDLINE_FLAGS=--max-old-space-size=2048` |

Мониторинг в одну строку:

```bash
docker stats --no-stream
```

## OOM: контейнер убит (`exited with code 137`)

```bash
free -h; dmesg -T | tail -20 | grep -i -E 'oom|killed'
```

Добавьте swap (см. [SETUP.md](SETUP.md#2-базовая-подготовка-сервера)), уменьшите
`RAGE_MAXPLAYERS`, ограничьте heap Node.js, проверьте утечки в скриптах.

## MariaDB не поднимается

```bash
docker compose --profile db ps
docker compose --profile db logs mariadb | tail -50
```

- `Access denied` — пароль в `.env` изменён после первого запуска; том `mariadb-data`
  хранит старый. Либо верните пароль, либо удалите том (данные пропадут!).
- `Permission denied` на `/var/lib/mysql` — том создан другим пользователем; пересоздайте.
- Healthcheck `healthcheck.sh` требует MariaDB 10.4+; на старых тегах замените на
  `mysqladmin ping -h 127.0.0.1 -u root -p"$$MARIADB_ROOT_PASSWORD"`.

## Сборка образа падает на скачивании серверных файлов

```bash
curl -I https://cdn.rage.mp/updater/prerelease/server-files/linux_x64.tar.gz
```

Если CDN недоступен из вашей сети — соберите образ на другой машине или укажите
зеркало через `.env`:

```dotenv
RAGEMP_SERVER_URL=https://ваше-зеркало/linux_x64.tar.gz
RAGEMP_ARCHIVE_SHA256=<sha256 архива>
```

`RAGEMP_ARCHIVE_SHA256` дополнительно защищает от подмены архива — проверяйте его при
использовании зеркал.

## `docker compose` не поддерживается / `docker-compose: command not found`

Нужен Compose v2 (плагин). Установите: `sudo apt install docker-compose-plugin`,
команда — `docker compose` (с пробелом). Версия v1 не подходит.

## Полезные ссылки

- [RAGE:MP wiki](https://wiki.rage.mp/wiki/Main_Page) — настройки, события, API.
- [Форум RAGE:MP](https://rage.mp/forums) — проблемы платформы.
- [Наш SETUP](SETUP.md) и [OPERATIONS](OPERATIONS.md) — если что-то не сходится на этапе установки.
