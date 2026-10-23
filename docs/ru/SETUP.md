# Установка сервера GTA V (RAGE:MP) на VPS

Пошагово: от пустого VPS до сервера, который видно в списке RAGE:MP.
Время — 30–60 минут, из них большая часть уйдёт на скачивание.

---

## 1. Выбор VPS

RAGE:MP — однопоточный по основному циклу: **частота ядра важнее количества ядер**.
Память съедают гейммод (Node.js) и БД, диск — серверные файлы (~0.5 ГБ) и клиентские пакеты.

| Онлайн | vCPU | RAM | Диск | Канал | Комментарий |
| --- | --- | --- | --- | --- | --- |
| до 20 | 2 | 4 ГБ | 40 ГБ NVMe | 100 Мбит/с | тест, друзья, small-RP |
| 20–60 | 4 | 8 ГБ | 60–80 ГБ NVMe | 200–500 Мбит/с | рабочая конфигурация |
| 60–150 | 6–8 | 16 ГБ | 100 ГБ NVMe | 1 Гбит/с | RP с БД, много трафика пакетов |

Требования платформы: **glibc ≥ 2.28**, то есть Debian 10+/Ubuntu 18.10+.
В этом проекте используется Debian 12 внутри контейнера — от хоста нужен только Docker.

Ориентиры по цене (октябрь 2026, могут меняться): 4 vCPU / 8 ГБ — примерно
700–1800 ₽/мес у российских провайдеров, 6–9 € у европейских. Смотрите не на цену,
а на: **защиту от DDoS**, локейшн рядом с игроками (Москва/СПб — для RU-аудитории),
NVMe и вменяемый аплинк.

Практические варианты: Timeweb Cloud, VDSina, Aeza, FirstVDS, Reg.ru, RUVDS (RU/СНГ);
Hetzner, Netcup (EU — дешевле, но выше пинг и сложнее оплата).
Готовые «игровые хостинги» тоже работают, но там вы почти не управляете системой —
этот репозиторий рассчитан на свой VPS.

> **Windows-хостинг не нужен.** Сервер RAGE:MP нативно работает на Linux; клиент у
> игроков при этом всё равно Windows.

## 2. Базовая подготовка сервера

Подключитесь по SSH (для Ubuntu это `root`, для Debian-образов некоторых провайдеров — свой пользователь).

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Часовой пояс (влияет на время в логах и бэкапах)
sudo timedatectl set-timezone Europe/Moscow

# Пакеты для диагностики
sudo apt install -y curl git ufw htop jq unzip

# Swap 2 ГБ — страховка от OOM при пиках гейммода
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Доступ по ключам (обязательно для публичного сервера):**

```bash
# На локальной машине:
ssh-keygen -t ed25519 -C "gold-vps"
ssh-copy-id user@YOUR_SERVER_IP
```

Затем на сервере в `/etc/ssh/sshd_config`: `PasswordAuthentication no`,
`PermitRootLogin prohibit-password`, и `sudo systemctl restart ssh`.
Проверьте новый вход в отдельном терминале, прежде чем закрывать текущую сессию.

## 3. Установка Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# Работа без sudo
sudo usermod -aG docker "$USER"
newgrp docker           # или перелогиньтесь

docker --version
docker compose version  # нужен v2 (плагин), не docker-compose v1
```

Если `docker compose version` не работает — установите плагин:
`sudo apt install -y docker-compose-plugin`.

## 4. Развёртывание проекта

```bash
git clone <URL-репозитория> ~/gold
cd ~/gold

cp .env.example .env
id -u; id -g          # запомните UID/GID — впишите их в RAGEMP_UID/RAGEMP_GID
nano .env
```

Минимум, что стоит заполнить сразу:

```dotenv
RAGE_NAME="GOLD [RU] Freeroam"   # кавычки обязательны, если есть пробелы
RAGE_LANGUAGE=ru
RAGE_MAXPLAYERS=32
RAGE_ANNOUNCE=false              # включите, когда порты открыты и сервер стабилен
RAGE_PORT=22005
RAGE_HTTP_PORT=22006             # ВСЕГДА RAGE_PORT + 1
RAGEMP_UID=1000                  # владелец каталога ./server-data
RAGEMP_GID=1000
TZ=Europe/Moscow
```

Полный список переменных — в [OPERATIONS.md](OPERATIONS.md#переменные-env).

## 5. Firewall

Нужны три правила. UDP — игровой протокол, TCP — он же плюс HTTP для пакетов.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp                   # SSH, не закройте себя
sudo ufw allow 22005/udp
sudo ufw allow 22005/tcp
sudo ufw allow 22006/tcp
sudo ufw enable
sudo ufw status verbose
```

**Отдельно проверьте firewall провайдера** (Security Group / «облачный файрвол»):
правила в панели и в `ufw` — две независимые вещи, и чаще всего забывают именно панель.

MariaDB наружу не выставляйте: в `docker-compose.yml` её порт привязан к `127.0.0.1`,
и этого достаточно (доступ через SSH-туннель).

## 6. Первый запуск

```bash
make up          # docker compose up -d --build
make ps
make logs
```

Что должно быть в логах:

```text
[entrypoint] installing server files into /data
[entrypoint] rendering conf.json from environment (RAGE_CONF_MODE=generate)
[entrypoint] name:        GOLD [RU] Freeroam
[entrypoint] listen:      0.0.0.0:22005 (UDP+TCP), HTTP 22006
...
[SERVER] RAGE:MP server is up and running
```

Проверка «снаружи»:

```bash
make status
# или вручную:
curl -I http://YOUR_SERVER_IP:22006/    # любой ответ = HTTP-сервер пакетов жив
ss -lunp | grep 22005                    # UDP-сокет
```

`curl` может вернуть 404 — это нормально: важен сам ответ, а не код.
Если ответа нет — смотрите firewall и `make logs`.

## 7. Подключение и публикация

1. Установите [клиент RAGE:MP](https://rage.mp) на Windows-машину с лицензионной GTA V.
2. Запустите лаунчер, нажмите F1 (консоль) или используйте поиск серверов;
   подключение напрямую — `YOUR_SERVER_IP:22005`.
3. Убедитесь, что работает заготовка: в чате `/help`, `/veh sultan`, `/pos`.
4. Включите публикацию в списке серверов: `RAGE_ANNOUNCE=true` в `.env`, затем `make restart`.
   Сервер появится в браузере RAGE:MP в течение нескольких минут (иногда до 10).
5. Зайдите на [rage.mp/masterlist](https://rage.mp/masterlist) и проверьте, что имя и
   язык отображаются правильно.

Если планируете переезжать на другой хост — заранее задайте `RAGE_FQDN=game.вашдомен.ру`
(поддомен, направленный A-записью на IP). Тогда игроки не заметят смены адреса.

## 8. Обновление серверных файлов

```bash
make backup      # всегда сначала
make update      # пересобирает образ с официального CDN и подменяет бинарники
```

Гейммод, карты и конфиг при обновлении не затрагиваются: они лежат в `./server-data`,
а не в образе. Откат — `make restore FILE=backups/ragemp-....tar.gz`.

## 9. Что дальше

- [Эксплуатация](OPERATIONS.md): все переменные, бэкапы, БД, FastDL, разработка гейммода.
- [Проблемы и решения](TROUBLESHOOTING.md): сервер не видно в списке, игроки не могут
  скачать пакеты, OOM, «No usable version of libssl» и т. п.
- `extras/systemd` — автозапуск стека после ребута и ежедневный бэкап по таймеру.
