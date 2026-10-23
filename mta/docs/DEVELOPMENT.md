# GOLD DAYZ · разработка

## 1. Общая схема

```text
                    ┌───────────────────────────┐
   CEF (ui/*)  ◄────┤ client/ui.lua             │
   JS mta.triggerEvent│  браузер, ввод, очередь   │
        │           └───────────┬───────────────┘
        │ dz:ui                 │ dz:uiPush (JSON)
        ▼                       ▼
   client/main.lua  ───────►  server/players.lua  ───► server/* (лут, зомби, базы…)
        │  клавиши, шум,            handleUI                │
        │  взаимодействие           auth/death/save         │
        ▼                                                    ▼
   client/zombies.lua  ◄──── dz:zombies (снапшоты) ─── server/zombies.lua
   client/hud.lua      ◄──── hud/toast/kill/hit      ─── server/ui.lua
```

* **Сервер авторитетен** для инвентаря, урона по зомби, спавна, торговли, баз, денег.
* **Клиент тонкий**: рисует HUD/CEF, двигает локальных педов, присылает намерения
  (`dz:zombieDamage`, `dz:noise`, `dz:ui`).
* **Shared-код** (`shared/*.lua`) не вызывает MTA-API на этапе загрузки. Он используется
  сервером, клиентом и тестами в Node/fengari.
* Все сетевые имена — в `DZ.EVENTS` (`shared/core.lua`), регистрируются один раз
  (`DZ.registerEvents()` на сервере в `DZ.start`, на клиенте — при загрузке `client/main.lua`).

## 2. События

| Событие | Направление | Аргументы | Назначение |
|---|---|---|---|
| `dz:uiPush` | s → c | JSON `{t, d}` | пакеты интерфейса, HUD, тосты |
| `dz:zombies` | s → c | JSON `{z = {[id,x,y,z,rot,state,hp,maxHp,skin,type,boss]}}` | снапшот зомби |
| `dz:zombieDead` | s → c | JSON `{id,x,y,z,boss}` | смерть зомби |
| `dz:zombieHit` | s → c | JSON | хитмаркер (сейчас используется `hit` в UI-пакете) |
| `dz:zombieBite` | s → c | damage, type | укус (красная вспышка) |
| `dz:lootSound` | s → c | — | звук подбора (резерв) |
| `dz:ui` | c → s | JSON действие | логин, спавн, панели, инвентарь, лут, торговля, база, крафт, суицид |
| `dz:clientReady` | c → s | — | CEF загружен, можно присылать окно входа |
| `dz:zombieDamage` | c → s | zombieId, weapon, bodypart | попадание игрока по зомби |
| `dz:noise` | c → s | x, y, z, radius | выстрел/шаги |

> `dz:zombieHit` и `dz:lootSound` зарезервированы: сервер сейчас отправляет хитмаркер
> через `dz:uiPush` (`t = "hit"`), а звук подбора не проигрывается. Если будете
> добавлять — зарегистрируйте обработчики на клиенте.

### Пакеты CEF (`t`)

`login`, `loginError`, `loginOk`, `char`, `death`, `welcome`, `spawned`, `hud`, `panel`,
`close`, `help`, `toast`, `kill`, `killfeed`, `hit`, `bite`, `mapPos`, `bossSpawn`.

Панели (`panel.d.panel`): `inventory`, `trade`, `corpse`, `base`, `craft`, `map`, `help`.

## 3. Модули

### shared/core.lua

Константы версии, слоты (`DZ.ITEM_SLOTS`), `DZ.SURVIVAL`, `DZ.WEAPON_DAMAGE`,
`DZ.INVENTORY`, `DZ.LIMITS`, RNG (LCG), `DZ.Util` (clamp, round, dist, cleanName, …),
`DZ.RARITY`, `DZ.WEAPON_NAMES`, регистрация событий.

### shared/inventory.lua

Чистая модель: `inv = { id, base, slots, equip }`. Никаких MTA-вызовов.

```lua
local added, leftover, reason = DZ.Inv.add(inv, catalog, "bandage", 5, nil, 30)
DZ.Inv.equip(inv, catalog, index)      --> ok, slot, entry
DZ.Inv.unequip(inv, catalog, "weapon") --> ok, index, entry
DZ.Inv.serialize(inv, catalog)         --> данные для CEF
```

Слоты могут быть разреженными; для JSON используйте `toArray`/`toData`.

### shared/survival.lua

`DZ.Survival.tick(stats, ctx, dt, rng)` возвращает `{ damage, dead, cause, events }`.
`ctx`: `moving`, `sprinting`, `weightRatio`, `inWater`, `night`, `radiation` (0–3),
`mask`, `ambient`, `nearFire`. Медицина — `heal`, еда — `consume`, кровь — `addBleeding`,
инфекция — `addInfection`.

### shared/zombie_ai.lua

`ZA.new(id, spec, pos, home, rng)`, `ZA.think(z, players, now, dt)`,
`ZA.hearNoise`, `ZA.damage`, `ZA.snapshot`. ИИ не знает о MTA и легко тестируется.
Состояния: `idle`, `wander`, `return`, `chase`, `attack`, `investigate`, `dead`.

### server/data.lua

Читает JSON через `fileOpen`/`fileRead` (серверные файлы не обязаны быть в `meta.xml`).
Валидирует обязательные поля и падает с понятной ошибкой, если данные битые.
`Data.load()` можно вызывать повторно (`/dzreloaddata`).

### server/players.lua

Самый большой модуль: вход, профиль, спавн, HUD, выживание, урон, смерть, сохранение,
разбор UI-действий, rate-limit. Здесь же `closePanels`, `syncInv`, `syncStats`.

### server/zombies.lua

Спавн по зонам (`spawnCheck`), тик (`tick`), снапшоты, урон, дроп, боссы. Зомби —
не серверные педы: клиент создаёт их локально, поэтому сервер не тратит элементы.

### server/loot.lua

Маркеры на земле + element data (`dz:loot`, `dz:name`, `dz:icon`, `dz:rarity`,
`dz:count`) для клиента. Трупы — отдельные маркеры с инвентарём.

### server/inventory.lua

Нативное оружие: `giveWeapon` при экипировке, `takeAllWeapons` при снятии,
остаток патронов сохраняется в `meta.ammo`. `getPedTotalAmmo` уже включает магазин —
**не прибавляйте `getPedAmmoInClip`**.

### server/db.lua

SQLite через `dbConnect`/`dbQuery`/`dbPoll`/`dbExec`. Все запросы — с `?`-параметрами.
`dbConnect("sqlite", "gold_dayz.db")` создаёт файл в папке ресурса.

## 4. Как добавить контент

### Предмет

1. Добавьте объект в `data/items.json` (уникальный `id`, `name`, `kind`, `weight`, `stack`,
   `rarity`, `icon`-эмодзи, при необходимости `use`, `slot`, `weapon`, `armor`, `tool`).
2. Добавьте его в таблицы `data/loot.json` и/или `data/traders.json`, при желании — в
   `data/recipes.json` и стартовый набор `config.spawn.starter`.
3. `node tools/luacheck.js` — проверит ссылки и поля.

### Рецепт

`recipes.json`: `id`, `name`, `out`, `count`, `in = [{item, count}]`, `bench` (true — нужен
лагерь/база). Кулдаун 1.5 с зашит в `server/crafting.lua`.

### Тип зомби

`zombies.json → types`: `id`, `name`, `health`, `speed`, `damage`, `attackRange`,
`attackInterval`, `detectRange`, `chaseRange`, `leash`, `skins`, `lootTable`, `boss`.
Ссылка из зон: `map.json → zombieZones[].types = { "walker": 60, "runner": 30 }`.

### Зона

`map.json`: координаты (`x, y, z`), `radius`, `max`, `types` у зомби-зон; `tier`,
`count`, `respawn`, `tables` у лут-зон. Координаты — в метрах GTA: SA, `z` — высота
земли в этой точке (подбирается в игре/редакторе).

### Модели зомби

Скины — стандартные ID GTA: SA. Для своих моделей: добавьте `.dff/.txd` в ресурс,
пропишите `<file>` в `meta.xml`, замените `createPed` на `engineLoadDFF`/`engineReplaceModel`
в `client/zombies.lua` (или используйте `setElementModel`). Учтите права на ассеты.

## 5. Тесты и инструменты

```bash
cd mta
npm install
npm run check        # luacheck: JSON + синтаксис + 98 shared-тестов + meta + UI
npm run sim          # серверный сценарий на mock-MTA: 92 шага
npm run ui           # 21 проверка CEF-интерфейса в jsdom
```

`npm run verify` запускает все три.

* `tools/luacheck.js` — JSON-валидация (ссылки предметов, зоны, скины, модели, рецепты),
  разбор всех `.lua` через `luaparse` (Lua 5.1), исполнение shared-кода в **fengari**,
  сверка `meta.xml`, проверка `ui/app.js` через `node --check`, поиск вызовов
  `DZ.X.y(...)`, которых нет в коде.
* `tools/simulate.js` — грузит `tests/mta_mock.lua`, реальные `server/*.lua` и `data/*.json`,
  проигрывает сценарий из `tests/server_spec.lua`. Мок включает: элементы, игроков, педов,
  маркеры, транспорт, события, таймеры, SQLite в памяти, JSON-кодек и виртуальные часы
  (детерминированные кулдауны).
* `tests/shared_spec.lua` — 98 проверок: инвентарь, стек/вес, экипировка, рюкзак,
  сохранение, выживание, радиация/температура/инфекция, лут, ИИ зомби.
* `tools/ui-smoke.js` — поднимает временный статический сервер над `gold_dayz/ui`,
  открывает страницу в jsdom и проходит демо-режим: девять экранов, Esc, отправка
  пакетов `login`/`spawn` в перехваченный `mta.triggerEvent`, устойчивость к битому JSON.
  Зависимость `jsdom` нужна только для разработки, в сборку не попадает.
* `tests/server_spec.lua` — 92 проверки: старт, вход/регистрация (в т.ч. неверный пароль),
  спавн, экипировка, еда, урон зомби (включая сетевое событие), шум, лут, торговцы,
  крафт, база и PIN, транспорт/топливо/ремонт, смерть/труп/возрождение, админ-команды,
  сохранение и загрузка профиля в новом подключении.

Когда меняете серверную логику — добавляйте шаг в `server_spec.lua`; когда меняете
чистые формулы — в `shared_spec.lua`. Тесты не требуют GTA и запускаются в CI.

## 6. Грабли MTA, на которые уже наступили

* **`getGroundPosition` только на клиенте.** Сервер не знает коллизий; высоты зон — из
  `map.json`.
* **`getPedTotalAmmo` включает патроны в магазине.** Резерв = total − clip.
* **`getPlayerAmmoInClip`/`getPlayerTotalAmmo` устарели** — используйте `getPedAmmoInClip`
  и `getPedTotalAmmo` без weaponId (текущий слот).
* **MTA не респавнит игрока после смерти** — нужен `spawnPlayer` (у нас `P.place`).
* **`getPedOccupiedVehicle` возвращает `false`, а не `nil`.**
* **`setWeather` принимает 0–255**; больше — false. Для плавности — `setWeatherBlended`.
* **Серверное чтение файлов** работает без записи в `meta.xml`; клиентские файлы — только
  через `<file>`/`<html>`. CEF грузит локальные файлы с `http://mta/local/...`.
* **CEF-ввод** требует `showCursor`, `focusBrowser` и инъекции мыши
  (`injectBrowserMouseMove/Down/Up`) — иначе клики не доходят до страницы.
* **`cache="false"` меняет порядок клиентских скриптов** — все клиентские файлы помечены
  одинаково, порядок сохранён в `meta.xml`.
* **События надо регистрировать до `addEventHandler`** — `addEvent` один раз, иначе
  «event not added».
* **Lua 5.1**: нет `table.maxn`, `goto`, `//`, `utf8`; в shared используется локальный
  `maxn` и совместимый синтаксис.

## 7. Расширение БД

`server/db.lua` изолирует SQL. Для MySQL:

1. `dbConnect("mysql", "dbname=gold;host=127.0.0.1;port=3306", user, pass, "share=0")`.
2. Замените `INSERT OR REPLACE` на `REPLACE INTO`/`ON DUPLICATE KEY UPDATE`.
3. `COLLATE NOCASE` → `COLLATE utf8mb4_general_ci`.
4. `AUTOINCREMENT` не нужен — ключи текстовые.

Асинхронность `dbExec`/`dbQuery` не меняется. На остановке ресурса `P.saveAll` успевает
отправить запросы; не вызывайте `DB.close()` сразу после сохранения (сейчас соединение
закрывается самим MTA при выгрузке ресурса).

## 8. Стиль

* Русские комментарии и пользовательские строки, английские идентификаторы.
* `DZ = DZ or {}` в каждом файле, локальный алиас (`local P = DZ.Players`).
* Никаких глобальных переменных, кроме `DZ` и тестовых `MOCK_*`.
* Деньги и количества — целые; сетевые координаты — `DZ.Util.roundForNet` (2 знака).
* Новые UI-пакеты: добавить `t` в `client/main.lua` и `ui/app.js`, не забыть `CEF.push`
  для видимых панелей.
