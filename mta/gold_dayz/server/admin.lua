--[[
  admin.lua — административные команды GOLD DAYZ.

  Доступ проверяется через ACL: право admin (или resource.*), плюс
  необязательный список ников в data/config.json -> admin.players.
]]

local Admin = {}
DZ.Admin = Admin

local function cfg()
  return (DZ.Data and DZ.Data.config) or DZ.config or {}
end

local function hasAdmin(player)
  if not isElement(player) then return false end
  if hasObjectPermissionTo(player, "command.admin", false) then return true end
  if hasObjectPermissionTo(player, "function.kickPlayer", false) then return true end
  local adminCfg = cfg().admin or {}
  local allowed = adminCfg.accounts or {}
  local name = getPlayerName(player)
  for i = 1, #allowed do
    if allowed[i] == name then return true end
  end
  return false
end

local function refuse(player)
  DZ.UI.toast(player, "Недостаточно прав", "danger")
end

local function argString(value)
  return tostring(value or ""):gsub("%s+$", "")
end

local function getPlayerFromNamePart(part)
  part = tostring(part or ""):lower()
  if part == "" then return nil end
  for _, player in ipairs(getElementsByType("player")) do
    local name = getPlayerName(player):lower()
    if name == part or name:sub(1, #part) == part then return player end
  end
  return nil
end

local function handle(from, command, func)
  addCommandHandler(command, function(player, _, a1, a2, a3)
    if not hasAdmin(player) then
      refuse(player)
      return
    end
    local ok, message = pcall(func, player, a1, a2, a3)
    if not ok then
      DZ.UI.chat(player, "Ошибка: " .. tostring(message), DZ.UI.HEX.red)
      outputServerLog("[GOLD DAYZ] admin " .. command .. " -> " .. tostring(message))
    elseif message then
      DZ.UI.chat(player, tostring(message), DZ.UI.HEX.gold)
    end
  end)
  outputDebugString("[GOLD DAYZ] админ-команда /" .. command)
end

-------------------------------------------------------------------- команды

handle(nil, "dzhelp", function(player)
  return "Команды: /dzgive <ник> <id> [кол-во], /dzmoney <ник> <сумма>, /dzheal <ник>, "
    .. "/dzarmor <ник>, /dzstats, /dzfree, /dzspawn <x> <y> <z>, /dzspawnzombies <n>, "
    .. "/dzcars <id>, /dzsettime <час> [мин], /dzsetweather <id>, /dzsave, /dzreloaddata, "
    .. "/dzkick <ник> [причина]"
end)

handle(nil, "dzgive", function(player, a1, a2, a3)
  local target, itemId, count
  if DZ.Data.items[argString(a1)] then
    target, itemId, count = player, a1, a2
  else
    target, itemId, count = getPlayerFromNamePart(a1), a2, a3
  end
  if not target then return "Игрок не найден" end
  if not itemId or not DZ.Data.items[argString(itemId)] then return "Неизвестный предмет" end
  local amount = math.max(1, math.min(200, math.floor(tonumber(count) or 1)))
  local added, leftover, reason = DZ.Inv.add(DZ.Players.get(target).inv, DZ.Data.items, argString(itemId), amount,
    nil, DZ.LIMITS.weightKg)
  if added <= 0 then return "Не влезло: " .. tostring(reason) end
  DZ.Players.syncInv(target)
  return string.format("%s получил %s x%d%s", getPlayerName(target), argString(itemId), added,
    leftover > 0 and " (остаток " .. leftover .. ")" or "")
end)

handle(nil, "dzmoney", function(player, a1, a2)
  local target = player
  local amount = tonumber(a1)
  local name = nil
  if not amount then
    target = getPlayerFromNamePart(a1) or player
    amount = tonumber(a2)
    name = a1
  end
  if not amount or amount == 0 then return "Укажите сумму" end
  local state = DZ.Players.get(target)
  if not state then return "Игрок не найден" end
  state.money = math.max(0, math.floor((state.money or 0) + amount))
  DZ.Players.syncStats(target)
  return string.format("%s: баланс %d", getPlayerName(target), state.money)
end)

handle(nil, "dzheal", function(player, a1)
  local target = getPlayerFromNamePart(a1) or player
  local state = DZ.Players.get(target)
  if not state then return "Игрок не найден" end
  state.stats.health = DZ.SURVIVAL.MAX_HEALTH
  state.stats.blood = DZ.SURVIVAL.MAX_BLOOD
  state.stats.hunger = DZ.SURVIVAL.MAX_HUNGER
  state.stats.thirst = DZ.SURVIVAL.MAX_THIRST
  state.stats.temperature = 36.6
  state.stats.bleeding = 0
  state.stats.infection = 0
  state.stats.radiation = 0
  setElementHealth(target, 100)
  DZ.Players.syncStats(target)
  return getPlayerName(target) .. " вылечен"
end)

handle(nil, "dzarmor", function(player, a1)
  local target = getPlayerFromNamePart(a1) or player
  local state = DZ.Players.get(target)
  if not state then return "Игрок не найден" end
  DZ.IS.addItem(target, "armor_heavy", 1, nil, true)
  return "Выдан тяжёлый бронежилет"
end)

handle(nil, "dzstats", function(player)
  local state = DZ.Players.get(player)
  if not state then return "Нет состояния" end
  local lines = {
    string.format("онлайн: %d, зомби: %d, лут: %d, машины: %d",
      #getElementsByType("player"), #DZ.Zombies.list, DZ.Util.count(DZ.Loot.ground),
      DZ.Util.count(DZ.Vehicles.byVehicle)),
    string.format("аккаунт: %s, деньги: %d, убийств: %d, смертей: %d",
      tostring(state.account), state.money or 0, state.kills or 0, state.deaths or 0),
    string.format("позиция: %.1f %.1f %.1f", getElementPosition(player))
  }
  for _, line in ipairs(lines) do DZ.UI.chat(player, line, DZ.UI.HEX.white) end
  return nil
end)

handle(nil, "dzfree", function(player)
  local state = DZ.Players.get(player)
  if not state then return "Нет состояния" end
  if not state.spawned then return "Сначала заспавнитесь" end
  DZ.Players.closePanels(player)
  DZ.Players.respawn(player, { spawn = state.spawnId or "ls_grove" })
  return "Респавн по административной команде"
end)

handle(nil, "dzspawn", function(player, a1, a2, a3)
  local x, y, z = tonumber(a1), tonumber(a2), tonumber(a3)
  if not x or not y then return "Формат: /dzspawn <x> <y> [z]" end
  local state = DZ.Players.get(player)
  if not state or not state.spawned then return "Сначала заспавнитесь" end
  DZ.Players.closePanels(player)
  setElementPosition(player, x, y, z or 20.0)
  return string.format("Перемещён в %.1f %.1f %.1f", x, y, tonumber(z) or 20.0)
end)

handle(nil, "dzspawnzombies", function(player, a1)
  local before = #DZ.Zombies.list
  local tries = math.max(1, math.min(10, math.floor(tonumber(a1) or 3)))
  for _ = 1, tries do DZ.Zombies.spawnCheck() end
  return string.format("Создано зомби: %d (всего %d)", #DZ.Zombies.list - before, #DZ.Zombies.list)
end)

handle(nil, "dzcars", function(player)
  local lines = { "Машины в мире:" }
  for vehicle, record in pairs(DZ.Vehicles.byVehicle) do
    local vx, vy = getElementPosition(vehicle)
    lines[#lines + 1] = string.format("· %s (#%s) %.0f %.0f", record.def.name, tostring(record.def.model), vx, vy)
  end
  for i = 1, math.min(#lines, 14) do DZ.UI.chat(player, lines[i], DZ.UI.HEX.white) end
  return nil
end)

handle(nil, "dzsettime", function(player, a1, a2)
  local hour = tonumber(a1)
  if not hour then return "Формат: /dzsettime <0-23> [0-59]" end
  hour = math.floor(hour) % 24
  local minute = math.max(0, math.min(59, math.floor(tonumber(a2) or 0)))
  DZ.setWorldTime(hour, minute)
  return string.format("Время сервера: %02d:%02d", hour, minute)
end)

handle(nil, "dzsetweather", function(player, a1)
  local weather = tonumber(a1)
  if not weather or weather < 0 or weather > 255 then return "Погода: 0–255" end
  DZ.setWorldWeather(weather)
  return "Погода установлена: " .. math.floor(weather)
end)

handle(nil, "dzsave", function(player)
  local saved = DZ.Players.saveAll()
  DZ.DB.saveAll(DZ.Bases.byId)
  return string.format("Профилей сохранено: %d, баз: %d", saved or 0, DZ.Util.count(DZ.Bases.byId))
end)

handle(nil, "dzreloaddata", function(player)
  local ok, err = pcall(DZ.Data.load)
  if not ok then return "Ошибка данных: " .. tostring(err) end
  return string.format("Данные перечитаны: %d предметов, %d зон", #DZ.Data.itemsList, #DZ.Data.lootZones)
end)

handle(nil, "dzkick", function(player, a1, a2)
  local target = getPlayerFromNamePart(a1)
  if not target then return "Игрок не найден" end
  if target == player then return "Себя нельзя" end
  local reason = a2 and argString(a2) or "Кик администратором"
  DZ.Players.save(target)
  kickPlayer(target, player, reason)
  return getPlayerName(target) .. " кикнут: " .. reason
end)

-- Запрет стандартных читерских команд и открытых админ-команд ресурса.
addEventHandler("onPlayerCommand", root, function(command)
  local lowered = tostring(command):lower()
  if lowered == "setweather" or lowered == "settime" then
    if not hasAdmin(source) then cancelEvent() end
  end
end)

outputDebugString("[GOLD DAYZ] админ-модуль готов")
