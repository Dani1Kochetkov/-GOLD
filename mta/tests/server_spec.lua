--[[
  server_spec.lua — сценарный тест серверной логики на mta_mock.

  Запускается tools/simulate.js: сначала поднимается ресурс (DZ.start),
  потом проигрывается путь игрока.
]]

SERVER_REPORT = { passed = 0, failed = 0, errors = {} }

local function ok(condition, name)
  if condition then
    SERVER_REPORT.passed = SERVER_REPORT.passed + 1
  else
    SERVER_REPORT.failed = SERVER_REPORT.failed + 1
    SERVER_REPORT.errors[#SERVER_REPORT.errors + 1] = name
  end
end

local function eq(got, want, name)
  ok(got == want, name .. " (получено " .. tostring(got) .. ", ожидалось " .. tostring(want) .. ")")
end

local function fail(name)
  SERVER_REPORT.failed = SERVER_REPORT.failed + 1
  SERVER_REPORT.errors[#SERVER_REPORT.errors + 1] = name
end

------------------------------------------------------------------- старт

local started, startError = pcall(DZ.start)
ok(started, "DZ.start без ошибок: " .. tostring(startError))
if not started then
  SERVER_REPORT.errors[#SERVER_REPORT.errors + 1] = tostring(startError)
else
  eq(DZ.VERSION, "1.0.0", "версия")
  ok(#DZ.Data.itemsList >= 50, "каталог предметов загружен")
  eq(DZ.Util.count(DZ.Data.loot), 10, "10 таблиц лута")
  eq(#DZ.Data.spawns, 10, "10 точек спавна")
  eq(DZ.Util.count(DZ.Traders.byId), 4, "4 торговца")
  eq(DZ.Util.count(DZ.Bases.byId), 4, "4 базы")
  ok(DZ.Util.count(DZ.Vehicles.byVehicle) >= 10, "транспорт заспавнен")
  ok(#DZ.Zombies.list > 0, "зомби заспавнены при старте")
  ok(DZ.Util.count(DZ.Loot.ground) > 0, "лут заспавнен при старте")
end

------------------------------------------------------------------- игрок

local player = MOCK.newPlayer("Tester")
triggerEvent("onPlayerJoin", player)
local state = DZ.Players.get(player)
ok(state ~= nil, "состояние игрока создано")
if not state then
  SERVER_REPORT.summary = "нет состояния игрока"
  return
end
eq(state.spawned, false, "до спавна игрок не в мире")

DZ.Players.onClientReady(player)
ok(state.uiReady, "клиент готов")
eq(state.logged, false, "до логина не авторизован")

DZ.Players.login(player, { user = "Tester", pass = "1234", register = true })
ok(state.logged, "регистрация и вход")
eq(state.account, "Tester", "аккаунт сохранён")

DZ.Players.spawnFromChar(player, { spawn = "ls_grove", skin = 7 })
ok(state.spawned, "игрок заспавнен")
ok(state.alive, "игрок жив")
eq(getElementDimension(player), 0, "измерение 0")
eq(getElementHealth(player), 100, "100 HP")
eq(state.skin, 7, "скин из выбора")
ok(DZ.Inv.count(state.inv, "knife") == 1, "стартовый нож")
ok(DZ.Inv.count(state.inv, "map") == 1, "стартовая карта")

-- Надеть нож и проверить нативное оружие.
local knifeIndex = DZ.Inv.find(state.inv, "knife")
DZ.IS.equip(player, knifeIndex)
eq(getPedWeapon(player), 4, "нож в руках (weapon 4)")
ok(DZ.Inv.equipped(state.inv, "weapon") and DZ.Inv.equipped(state.inv, "weapon").item == "knife", "нож в слоте оружия")

-- Еда и вода.
local sodaIndex = DZ.Inv.find(state.inv, "soda")
state.stats.thirst = 40
DZ.IS.use(player, sodaIndex)
ok(state.stats.thirst > 40, "газировка утоляет жажду")
eq(DZ.Inv.count(state.inv, "soda"), 0, "бутылка исчезла")

------------------------------------------------------------------- зомби

DZ.Zombies.spawnCheck()
ok(#DZ.Zombies.list > 0, "спавн-чек добавляет зомби")

local zombie = DZ.Zombies.list[1]
state.invulnUntil = 0
setElementHealth(player, 100)
setElementPosition(player, zombie.x + 1.0, zombie.y, zombie.z)

local healthBefore = getElementHealth(player)
DZ.Zombies.tick()
ok(getElementHealth(player) <= healthBefore, "тик зомби не лечит игрока")
ok(state.lastZombieHitAt ~= nil or getElementHealth(player) == healthBefore, "контакт обработан")

zombie.hp = 10
zombie.maxHp = math.max(zombie.maxHp or 10, 10)
local zombieHp = zombie.hp
DZ.Zombies.damage(player, zombie.id, 4, 9)
ok(zombie.hp < zombieHp or not zombie.alive, "урон по зомби прошёл")
ok(zombie.alive == false, "зомби убит")
ok((state.zombieKills or 0) >= 1, "счётчик убитых зомби")

-- Событие урона от клиента (тот самый путь, которым бьёт игрок).
ok(#(MOCK.handlers[DZ.EVENTS.ZOMBIE_DAMAGE] or {}) > 0, "зарегистрирован обработчик урона зомби")
ok(#(MOCK.handlers[DZ.EVENTS.NOISE] or {}) > 0, "зарегистрирован обработчик шума")

DZ.Zombies.spawnCheck()
local remoteTarget
for i = 1, #DZ.Zombies.list do
  if DZ.Zombies.list[i].alive then remoteTarget = DZ.Zombies.list[i] break end
end
ok(remoteTarget ~= nil, "есть живой зомби для удалённого урона")
if remoteTarget then
  remoteTarget.hp = 10
  setElementPosition(player, remoteTarget.x + 1, remoteTarget.y, remoteTarget.z)
  state.hitWindow = 0
  state.hitCount = 0
  MOCK.triggerRemote(DZ.EVENTS.ZOMBIE_DAMAGE, player, remoteTarget.id, 4, 9)
  eq(remoteTarget.alive, false, "урон из сетевого события убивает зомби")
end

-- Шум: зомби рядом переходит в режим проверки.
local listener
for i = 1, #DZ.Zombies.list do
  if DZ.Zombies.list[i].alive then listener = DZ.Zombies.list[i] break end
end
if listener then
  setElementPosition(player, listener.x + 1, listener.y, listener.z)
  listener.state = "idle"
  state.noiseWindow = 0
  state.noiseCount = 0
  local nx, ny, nz = getElementPosition(player)
  MOCK.triggerRemote(DZ.EVENTS.NOISE, player, nx, ny, nz, 100)
  eq(listener.state, "investigate", "шум поднимает зомби по тревоге")
end

-------------------------------------------------------------------- лут

local lootRecord = nil
for _, record in pairs(DZ.Loot.ground) do
  local def = DZ.Data.items[record.item]
  if def and (tonumber(def.weight) or 1) <= 4 then
    lootRecord = record
    break
  end
end
ok(lootRecord ~= nil, "на земле есть лёгкий лут")
if lootRecord then
  setElementPosition(player, lootRecord.x, lootRecord.y, lootRecord.z)
  local before = DZ.Inv.count(state.inv, lootRecord.item)
  DZ.Loot.pickup(player, lootRecord.id)
  ok(DZ.Inv.count(state.inv, lootRecord.item) > before, "предмет поднят с земли")
end

----------------------------------------------------------------- торговец

local traderDef = DZ.Data.traders[1]
setElementPosition(player, traderDef.x, traderDef.y, traderDef.z)
DZ.Traders.open(player, traderDef.id)
eq(state.panel, "trade", "панель торговца открыта")

local moneyBefore = state.money
local bandageBefore = DZ.Inv.count(state.inv, "bandage")
DZ.Traders.buy(player, "bandage", 2)
ok(state.money < moneyBefore, "деньги списаны")
ok(DZ.Inv.count(state.inv, "bandage") >= bandageBefore + 2, "бинты куплены")

local moneyAfterBuy = state.money
DZ.Traders.sell(player, "bandage", 1)
ok(state.money > moneyAfterBuy, "продажа вернула деньги")

----------------------------------------------------------------- транспорт

local vehicle = next(DZ.Vehicles.byVehicle)
ok(vehicle ~= nil, "транспорт создан")
if vehicle then
  local vx, vy, vz = getElementPosition(vehicle)
  setElementPosition(player, vx, vy, vz)
  state.vehicle = vehicle
  player.vehicle = vehicle
  setVehicleEngineState(vehicle, true)
  setElementData(vehicle, "dz:fuel", 100)
  DZ.Vehicles.fuelTick()
  local fuelAfter = tonumber(getElementData(vehicle, "dz:fuel")) or 100
  ok(fuelAfter < 100, "топливо расходуется при езде")

  local hudVehicle = DZ.Vehicles.forHud(player)
  ok(hudVehicle ~= nil and hudVehicle.maxFuel == 100, "HUD получает данные машины")

  DZ.IS.addItem(player, "repair_kit", 1, nil, true)
  local repairIndex = DZ.Inv.find(state.inv, "repair_kit")
  ok(repairIndex ~= nil, "ремкомплект в инвентаре")
  if repairIndex then
    state.useReadyAt = 0
    DZ.IS.use(player, repairIndex)
    eq(DZ.Inv.count(state.inv, "repair_kit"), 0, "ремкомплект израсходован")
  end

  DZ.IS.addItem(player, "jerrycan", 1, nil, true)
  local jerryIndex = DZ.Inv.find(state.inv, "jerrycan")
  if jerryIndex then
    setElementData(vehicle, "dz:fuel", 10)
    state.useReadyAt = 0
    DZ.IS.use(player, jerryIndex)
    ok((tonumber(getElementData(vehicle, "dz:fuel")) or 0) > 10, "канистра заправляет машину")
  end

  setElementData(vehicle, "dz:fuel", 0)
  setVehicleEngineState(vehicle, false)
  DZ.Vehicles.toggleEngine(player)
  eq(getVehicleEngineState(vehicle), false, "без топлива двигатель не заводится")
  player.vehicle = nil
  state.vehicle = nil
end

------------------------------------------------------------------ крафт

DZ.IS.addItem(player, "rags", 5, nil, true)
local ragsBefore = DZ.Inv.count(state.inv, "rags")
local bandsBefore = DZ.Inv.count(state.inv, "bandage")
DZ.Craft.craft(player, "craft_bandage")
eq(DZ.Inv.count(state.inv, "rags"), ragsBefore - 3, "крафт съел 3 тряпки")
eq(DZ.Inv.count(state.inv, "bandage"), bandsBefore + 1, "крафт дал бинт")

-------------------------------------------------------------------- база

local base = DZ.Data.bases[1]
setElementPosition(player, base.x, base.y, base.z)
DZ.Bases.open(player, base.id)
local baseRecord = DZ.Bases.get(base.id)
DZ.Bases.claim(player, base.id, "1234")
eq(baseRecord.owner, "Tester", "база занята игроком")
eq(baseRecord.code, "1234", "PIN установлен")

local storeBefore = DZ.Inv.count(state.inv, "bandage")
DZ.Bases.store(player, base.id, "bandage", 1)
eq(DZ.Inv.count(state.inv, "bandage"), storeBefore - 1, "бинт ушёл на склад")
ok(DZ.Inv.count(baseRecord.stash, "bandage") >= 1, "бинт на складе")

local stashIndex = DZ.Inv.find(baseRecord.stash, "bandage")
DZ.Bases.take(player, base.id, stashIndex, 1)
eq(DZ.Inv.count(state.inv, "bandage"), storeBefore, "бинт возвращён со склада")

if DZ.Inv.count(baseRecord.stash, "bandage") == 0 then
  DZ.Bases.unclaim(player, base.id)
  eq(baseRecord.owner, nil, "база освобождена")
end

----------------------------------------------------- база: доступ и PIN

DZ.Bases.claim(player, base.id, "4321")
eq(baseRecord.owner, "Tester", "база снова занята для проверки PIN")

local player2 = MOCK.newPlayer("Guest")
triggerEvent("onPlayerJoin", player2)
DZ.Players.onClientReady(player2)
DZ.Players.login(player2, { user = "Guest", pass = "4321", register = true })
DZ.Players.spawnFromChar(player2, { spawn = "ls_grove", skin = 7 })
local state2 = DZ.Players.get(player2)
ok(state2 and state2.spawned, "второй игрок в мире")

setElementPosition(player2, base.x, base.y, base.z)
DZ.Bases.open(player2, base.id)
DZ.Bases.code(player2, base.id, "0000")
ok(not state2.baseAccess[base.id], "неверный PIN не даёт доступ")
DZ.Bases.code(player2, base.id, "4321")
eq(state2.baseAccess[base.id], true, "верный PIN открывает склад")

DZ.IS.addItem(player2, "bandage", 2, nil, true)
DZ.Bases.store(player2, base.id, "bandage", 1)
ok(DZ.Inv.count(baseRecord.stash, "bandage") >= 1, "второй игрок положил предмет на склад")
local stashIndex2 = DZ.Inv.find(baseRecord.stash, "bandage")
DZ.Bases.take(player2, base.id, stashIndex2, 1)
eq(DZ.Inv.count(baseRecord.stash, "bandage"), 0, "второй игрок забрал предмет")

DZ.Players.closePanels(player2)
DZ.Players.save(player2)
DZ.Players.onQuit(player2)

------------------------------------------------------------ лут: дроп/подбор

local px, py, pz = getElementPosition(player)
local dropped = DZ.Loot.dropItem("bandage", 2, nil, px + 1.0, py, pz, "test")
ok(dropped ~= nil, "предмет выброшен на землю")
local bandageBeforeDrop = DZ.Inv.count(state.inv, "bandage")
DZ.Loot.pickup(player, dropped.id)
eq(DZ.Inv.count(state.inv, "bandage"), bandageBeforeDrop + 2, "выброшенное подобрано обратно")

------------------------------------------------------------------- смерть

DZ.Loot.dropItem("bandage", 2, nil, base.x, base.y, base.z, "test")
local groundBeforeDeath = DZ.Util.count(DZ.Loot.ground)
local corpsesBefore = DZ.Util.count(DZ.Loot.corpses)

DZ.IS.equip(player, DZ.Inv.find(state.inv, "bandage") or 1)
DZ.Players.finishDeath(player, nil, 0, "тест смерти")
eq(state.alive, false, "игрок мёртв")
eq(state.dead, true, "флаг смерти")
eq(DZ.Util.count(DZ.Loot.corpses), corpsesBefore + 1, "труп создан")
ok(DZ.Inv.count(state.inv, "bandage") == 0, "инвентарь очищен после смерти")

state.deathAt = getTickCount() - 20000
DZ.Players.respawn(player, { spawn = "ls_grove" })
ok(state.alive, "игрок возрождён")
ok(state.spawned, "игрок снова в мире")
eq(getElementHealth(player), 100, "HP после возрождения")
ok(DZ.Inv.count(state.inv, "knife") == 1, "стартовый набор после возрождения")

---------------------------------------------------------------------- админ

local adminBefore = DZ.Inv.count(state.inv, "bandage")
MOCK.allowAdmin = false
MOCK.commands.dzgive(player, "", "bandage", "2")
eq(DZ.Inv.count(state.inv, "bandage"), adminBefore, "без ACL выдача запрещена")

MOCK.allowAdmin = true
MOCK.commands.dzgive(player, "", "bandage", "2")
eq(DZ.Inv.count(state.inv, "bandage"), adminBefore + 2, "админ выдал предметы")

local adminMoney = state.money or 0
MOCK.commands.dzmoney(player, "", "1000")
eq(state.money, adminMoney + 1000, "админ начислил деньги")

setElementHealth(player, 25)
state.stats.health = 25
MOCK.commands.dzheal(player)
eq(getElementHealth(player), 100, "админ вылечил игрока")

local reloadOk = pcall(MOCK.commands.dzreloaddata, player, "", nil)
ok(reloadOk, "перезагрузка данных не падает")
eq(#DZ.Data.itemsList, 56, "после перезагрузки 56 предметов")
MOCK.allowAdmin = false

------------------------------------------------------------------- сохранение

local saveOk = pcall(function()
  DZ.Players.save(player)
  DZ.Players.saveAll()
  DZ.DB.saveAll({})
end)
ok(saveOk, "сохранение профилей без ошибок")

DZ.Players.onQuit(player)
eq(DZ.Players.get(player), nil, "состояние удалено при выходе")

-------------------------------------------------- сохранение и загрузка профиля

local savedMoney = DZ.Util.count(DZ.DB.loadBaseRows()) >= 0 and MOCK.db.players["tester"] ~= nil
ok(savedMoney, "профиль записан в базу")

local player3 = MOCK.newPlayer("Tester")
triggerEvent("onPlayerJoin", player3)
DZ.Players.onClientReady(player3)
DZ.Players.login(player3, { user = "Tester", pass = "wrong-pass", register = false })
eq(DZ.Players.get(player3).logged, false, "неверный пароль отклонён")
DZ.Players.login(player3, { user = "tester", pass = "1234", register = false })
local reloaded = DZ.Players.get(player3)
eq(reloaded.logged, true, "вход по логину в другом регистре")
eq(reloaded.hasProfile, true, "профиль загружен из базы")
ok((reloaded.money or 0) >= 1000, "деньги пережили перезаход")
ok((reloaded.zombieKills or 0) >= 1, "убийства зомби пережили перезаход")
ok(DZ.Inv.count(reloaded.inv, "knife") >= 1, "стартовый нож на месте")

local rows = DZ.DB.loadBaseRows()
ok(#rows >= 1, "склад базы сохранён в базе")

DZ.Players.onQuit(player3)

local savedAll = DZ.Players.saveAll()
eq(savedAll, 0, "после выхода некого сохранять")

SERVER_REPORT.summary = string.format("%d passed, %d failed", SERVER_REPORT.passed, SERVER_REPORT.failed)
if SERVER_REPORT.failed > 0 then
  error("СЕРВЕРНЫЕ ТЕСТЫ ПРОВАЛЕНЫ: " .. table.concat(SERVER_REPORT.errors, " | "), 0)
end
