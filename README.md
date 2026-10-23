# GOLD DAYZ

Локальный тест-сервер **GTA 5 DayZ-мода на RAGE Multiplayer** — атмосфера хардкорного MTA DayZ (TOP-GTA.RU) на современном стеке:

- **Сервер** — Node.js (ресурс RAGE MP)
- **Клиент** — JavaScript
- **UI** — CEF (HTML/CSS)
- **БД** — MySQL / MariaDB

## Быстрый старт

1. Распакуйте архив RAGE MP Server, скопируйте поверх его содержимое этого репозитория (`conf.json`, `packages/`, `client_packages/`).
2. `CREATE DATABASE gold_dayz CHARACTER SET utf8mb4;` и пропишите доступы в `packages/gold-dayz/config.js`.
3. `cd packages/gold-dayz && npm install`
4. Запустите `ragemp-server.exe`, подключитесь клиентом к **127.0.0.1**.
5. `/register player password` — и можно тестировать.

**Полная пошаговая инструкция: [docs/GUIDE.md](docs/GUIDE.md)**

## Управление

| Клавиша/команда | Действие |
|---|---|
| `J` | инвентарь (левая панель — земля/багажник, правая — рюкзак) |
| `E` | авто-вкладка: машина рядом → багажник, иначе лут с земли |
| `ESC` | закрыть инвентарь |
| `/register`, `/login` | аккаунт и сохранение персонажа |
| `/zmode slow` | Медленные зомби / светлая ночь |
| `/zmode fast` | Быстрые зомби / тёмная ночь |
| `/pos` | координаты (для маппинга) |

## Событийный флоу (сервер ⇄ клиент ⇄ CEF)

| Направление | Событие | Назначение |
|---|---|---|
| S→C | `hud:stats` (JSON) | все статусы раз в секунду (кровь ровно 12000 …) |
| S→C | `inv:open` (JSON) | полный панельный payload инвентаря |
| S→C | `world:mode` | режим ночи: `slow` / `fast` |
| S→C | `zombie:groundZ` | запрос Z грунта для спавна зомби |
| S→C | `veh:refresh` | перерисовать разбитость машины после установки деталей |
| S→C | `medical:morphine` | снять режим ползания |
| C→S | `zombie:spawnResult` | ответ с координатами грунта |
| C→S | `zombie:died` | зомби умер (сервер дропает лут) |
| C→S | `hud:clientStats` | шум и видимость игрока |
| C→S | `noise:shot` | выстрел — пульс агро зомби |
| C→S | `inv:open` / `inv:action` | открыть панель / take·drop·use·vehicle… |
| CEF→C | `ui:invAction` | кнопки инвентаря (mp.trigger) |
| CEF←C | `updateStats`, `renderInventory` | отрисовка HUD/панелей (browser.call) |

## Состав

```
conf.json                     — bind 127.0.0.1, порт 22005, enable-nodejs
packages/gold-dayz/           — сервер: stats, inventory, loot, zombies, vehicles, world, auth, db
client_packages/gold-dayz/    — клиент: hud, medical, inventory, vehicles, zombies, world
client_packages/gold-dayz/cef — HUD (6 иконок справа) + двухпанельный инвентарь
docs/GUIDE.md                 — подробный гайд на русском
```

## Ключевые константы

- Кровь: **12000** (классика MTA DayZ), ч/б экран при **< 4000**
- Зомби: `mp.peds.new`, **25 на игрока**, стрим-кольцо 45–130 м, укус **220** крови
- Инвентарь: **J**, вес **30 кг**, слоты по категориям
- Машина: без `engine` + `wheels` + канистры — **не заведётся**
- Режимы: `/zmode slow|fast` — «Медленные/светлая ночь» ↔ «Быстрые/тёмная ночь»
