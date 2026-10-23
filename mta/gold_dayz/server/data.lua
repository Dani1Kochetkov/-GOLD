--[[
  server/data.lua — загрузка и проверка data/*.json.

  Если данные битые, ресурс не стартует и пишет причину в консоль — лучше
  упасть сразу, чем раздавать игрокам пустой лут и невидимых зомби.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Data = DZ.Data or {}
local Data = DZ.Data

local function readJSON(relative)
  local file = fileOpen(relative, true)
  if not file then return nil, "не найден " .. relative end
  local size = fileGetSize(file)
  local raw = fileRead(file, size)
  fileClose(file)
  if not raw or #raw == 0 then return nil, "пустой " .. relative end
  local parsed = fromJSON(raw)
  if not parsed then return nil, "невалидный JSON: " .. relative end
  return parsed
end

local function isNum(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function pointErrors(errors, list, label)
  if type(list) ~= "table" then
    errors[#errors + 1] = label .. ": нет массива"
    return
  end
  for i = 1, #list do
    local zone = list[i]
    local prefix = label .. "[" .. tostring(i) .. "]"
    if type(zone) ~= "table" then
      errors[#errors + 1] = prefix .. ": не таблица"
    else
      if type(zone.id) ~= "string" or zone.id == "" then errors[#errors + 1] = prefix .. ": нет id" end
      if not isNum(zone.x) or not isNum(zone.y) or not isNum(zone.z) then
        errors[#errors + 1] = prefix .. ": кривые координаты"
      end
    end
  end
end

function Data.load()
  local errors = {}

  local config, err = readJSON("data/config.json")
  if not config then error("GOLD DAYZ: " .. tostring(err), 0) end

  local itemsJson = readJSON("data/items.json")
  local lootJson = readJSON("data/loot.json")
  local zombiesJson = readJSON("data/zombies.json")
  local mapJson = readJSON("data/map.json")
  local vehiclesJson = readJSON("data/vehicles.json")
  local tradersJson = readJSON("data/traders.json")
  local recipesJson = readJSON("data/recipes.json")
  if not itemsJson then error("GOLD DAYZ: data/items.json не загружен", 0) end
  if not lootJson then error("GOLD DAYZ: data/loot.json не загружен", 0) end
  if not zombiesJson then error("GOLD DAYZ: data/zombies.json не загружен", 0) end
  if not mapJson then error("GOLD DAYZ: data/map.json не загружен", 0) end
  if not vehiclesJson then error("GOLD DAYZ: data/vehicles.json не загружен", 0) end
  if not tradersJson then error("GOLD DAYZ: data/traders.json не загружен", 0) end
  if not recipesJson then error("GOLD DAYZ: data/recipes.json не загружен", 0) end

  Data.config = config

  -- ---------------------------------------------------------------- items
  local items, itemsList = {}, {}
  local itemRows = itemsJson.items or {}
  for i = 1, #itemRows do
    local def = itemRows[i]
    local prefix = "items[" .. tostring(i) .. "]"
    if type(def) ~= "table" or type(def.id) ~= "string" then
      errors[#errors + 1] = prefix .. ": нет id"
    elseif items[def.id] then
      errors[#errors + 1] = prefix .. ": дубль id " .. def.id
    else
      if type(def.name) ~= "string" then errors[#errors + 1] = prefix .. ": нет name" end
      if not isNum(def.weight) or def.weight < 0 then errors[#errors + 1] = prefix .. ": weight" end
      if def.stack ~= nil and (not isNum(def.stack) or def.stack < 1) then errors[#errors + 1] = prefix .. ": stack" end
      if def.rarity and not DZ.RARITY[def.rarity] then errors[#errors + 1] = prefix .. ": rarity " .. tostring(def.rarity) end
      if def.slot and not (def.slot == "weapon" or def.slot == "backpack" or def.slot == "armor" or def.slot == "mask") then
        errors[#errors + 1] = prefix .. ": slot " .. tostring(def.slot)
      end
      if def.weapon ~= nil and (not isNum(def.weapon) or def.weapon < 0 or def.weapon > 46) then
        errors[#errors + 1] = prefix .. ": weapon id"
      end
      items[def.id] = def
      itemsList[#itemsList + 1] = def
    end
  end
  Data.items = items
  Data.itemsList = itemsList

  -- ----------------------------------------------------------------- loot
  local tables = {}
  local lootTables = (lootJson.tables or {})
  for tableName, entries in pairs(lootTables) do
    if type(entries) ~= "table" or #entries == 0 then
      errors[#errors + 1] = "loot." .. tableName .. ": пустая таблица"
    else
      local normalized = {}
      for i = 1, #entries do
        local entry = entries[i]
        if type(entry) ~= "table" or not items[entry.item] then
          errors[#errors + 1] = "loot." .. tableName .. "[" .. tostring(i) .. "]: нет предмета " .. tostring(entry and entry.item)
        else
          local weight = tonumber(entry.weight) or 0
          if weight <= 0 then
            errors[#errors + 1] = "loot." .. tableName .. "[" .. tostring(i) .. "]: weight <= 0"
          else
            normalized[#normalized + 1] = {
              item = entry.item,
              weight = weight,
              min = math.max(1, math.floor(tonumber(entry.min) or 1)),
              max = math.max(1, math.floor(tonumber(entry.max) or tonumber(entry.min) or 1))
            }
          end
        end
      end
      tables[tableName] = normalized
    end
  end
  Data.loot = tables

  -- -------------------------------------------------------------- zombies
  local zombieTypes, zombieList = {}, {}
  local zRows = zombiesJson.types or {}
  for i = 1, #zRows do
    local def = zRows[i]
    local prefix = "zombies[" .. tostring(i) .. "]"
    if type(def) ~= "table" or type(def.id) ~= "string" then
      errors[#errors + 1] = prefix .. ": нет id"
    else
      if type(def.name) ~= "string" then errors[#errors + 1] = prefix .. ": нет name" end
      if not isNum(def.health) or def.health <= 0 then errors[#errors + 1] = prefix .. ": health" end
      if not isNum(def.speed) or def.speed <= 0 then errors[#errors + 1] = prefix .. ": speed" end
      if type(def.skins) ~= "table" or #def.skins == 0 then errors[#errors + 1] = prefix .. ": skins" end
      if def.lootTable and not tables[def.lootTable] then errors[#errors + 1] = prefix .. ": lootTable " .. tostring(def.lootTable) end
      zombieTypes[def.id] = def
      zombieList[#zombieList + 1] = def
    end
  end
  Data.zombieTypes = zombieTypes
  Data.zombieList = zombieList

  -- ------------------------------------------------------------------ map
  local map = mapJson
  Data.map = map
  Data.world = map.world or {}
  Data.spawns = map.spawns or {}
  Data.lootZones = map.lootZones or {}
  Data.zombieZones = map.zombieZones or {}
  Data.safeZones = map.safeZones or {}
  Data.radiationZones = map.radiationZones or {}
  Data.bases = map.bases or {}

  pointErrors(errors, Data.spawns, "spawns")
  pointErrors(errors, Data.lootZones, "lootZones")
  pointErrors(errors, Data.zombieZones, "zombieZones")
  pointErrors(errors, Data.safeZones, "safeZones")
  pointErrors(errors, Data.radiationZones, "radiationZones")
  pointErrors(errors, Data.bases, "bases")

  local spawnIds = {}
  for i = 1, #Data.spawns do spawnIds[Data.spawns[i].id] = true end
  if #Data.spawns == 0 then errors[#errors + 1] = "spawns: пусто" end

  for i = 1, #Data.lootZones do
    local zone = Data.lootZones[i]
    zone.tables = zone.tables or { "civilian" }
    for j = 1, #zone.tables do
      if not tables[zone.tables[j]] then
        errors[#errors + 1] = "lootZones[" .. tostring(i) .. "]: нет таблицы " .. tostring(zone.tables[j])
      end
    end
    if not isNum(zone.radius) or zone.radius <= 0 then errors[#errors + 1] = "lootZones[" .. tostring(i) .. "]: radius" end
    if not isNum(zone.count) or zone.count <= 0 then errors[#errors + 1] = "lootZones[" .. tostring(i) .. "]: count" end
  end

  for i = 1, #Data.zombieZones do
    local zone = Data.zombieZones[i]
    if not isNum(zone.max) or zone.max < 0 then errors[#errors + 1] = "zombieZones[" .. tostring(i) .. "]: max" end
    if not isNum(zone.radius) or zone.radius <= 0 then errors[#errors + 1] = "zombieZones[" .. tostring(i) .. "]: radius" end
    if zone.types then
      for typeId in pairs(zone.types) do
        if not zombieTypes[typeId] then
          errors[#errors + 1] = "zombieZones[" .. tostring(i) .. "]: нет типа " .. tostring(typeId)
        end
      end
    end
  end

  -- ------------------------------------------------------------- vehicles
  Data.vehicleSpawns = vehiclesJson.spawns or {}
  for i = 1, #Data.vehicleSpawns do
    local spot = Data.vehicleSpawns[i]
    if not isNum(spot.x) or not isNum(spot.y) or not isNum(spot.z) then
      errors[#errors + 1] = "vehicles[" .. tostring(i) .. "]: координаты"
    end
    if type(spot.models) ~= "table" or #spot.models == 0 then
      errors[#errors + 1] = "vehicles[" .. tostring(i) .. "]: models"
    else
      for j = 1, #spot.models do
        local model = spot.models[j]
        if not isNum(model) or model < 400 or model > 611 then
          errors[#errors + 1] = "vehicles[" .. tostring(i) .. "]: модель " .. tostring(model)
        end
      end
    end
  end

  -- -------------------------------------------------------------- traders
  Data.traders = tradersJson.traders or {}
  Data.sellMultiplier = tonumber(tradersJson.sellMultiplier) or 0.45
  for i = 1, #Data.traders do
    local trader = Data.traders[i]
    if not isNum(trader.x) or not isNum(trader.y) or not isNum(trader.z) then
      errors[#errors + 1] = "traders[" .. tostring(i) .. "]: координаты"
    end
    if type(trader.stock) ~= "table" then
      errors[#errors + 1] = "traders[" .. tostring(i) .. "]: stock"
    else
      for j = 1, #trader.stock do
        local row = trader.stock[j]
        if not row or not items[row.item] then
          errors[#errors + 1] = "traders[" .. tostring(i) .. "]." .. tostring(j) .. ": предмет"
        elseif not isNum(row.price) or row.price <= 0 then
          errors[#errors + 1] = "traders[" .. tostring(i) .. "]." .. tostring(j) .. ": price"
        end
      end
    end
  end

  -- -------------------------------------------------------------- recipes
  Data.recipes = recipesJson.recipes or {}
  for i = 1, #Data.recipes do
    local recipe = Data.recipes[i]
    if not recipe.out or not items[recipe.out] then
      errors[#errors + 1] = "recipes[" .. tostring(i) .. "]: out"
    end
    if type(recipe["in"]) ~= "table" then
      errors[#errors + 1] = "recipes[" .. tostring(i) .. "]: нет ингредиентов"
    else
      for j = 1, #recipe["in"] do
        local need = recipe["in"][j]
        if not need or not items[need.item] then
          errors[#errors + 1] = "recipes[" .. tostring(i) .. "]: ингредиент " .. tostring(need and need.item)
        end
      end
    end
  end

  -- ------------------------------------------------------------- settings
  Data.config.server = Data.config.server or {}
  Data.config.spawn = Data.config.spawn or {}
  Data.config.zombies = Data.config.zombies or {}
  Data.config.loot = Data.config.loot or {}
  Data.config.vehicles = Data.config.vehicles or {}
  Data.config.bases = Data.config.bases or {}
  Data.config.traders = Data.config.traders or {}
  Data.config.auth = Data.config.auth or {}
  Data.config.admin = Data.config.admin or {}

  if #errors > 0 then
    local text = "GOLD DAYZ: ошибки данных:\n  " .. table.concat(errors, "\n  ")
    outputServerLog(text)
    error(text, 0)
  end

  outputServerLog(string.format(
    "[GOLD DAYZ] data: %d предметов, %d таблиц лута, %d типов зомби, %d лут-зон, %d зон зомби",
    #itemsList, DZ.Util.count(tables), #zombieList, #Data.lootZones, #Data.zombieZones
  ))
  return true
end

--- Каталог для CEF. Отдаём только нужные поля, без служебной шелухи.
function Data.itemsForUI()
  local out = {}
  for i = 1, #Data.itemsList do
    local def = Data.itemsList[i]
    out[#out + 1] = {
      id = def.id, name = def.name, desc = def.desc, kind = def.kind,
      weight = def.weight, stack = def.stack, rarity = def.rarity, icon = def.icon,
      value = def.value, slot = def.slot, weapon = def.weapon, ammoKind = def.ammoKind,
      ammoCount = def.ammoCount, startAmmo = def.startAmmo, storage = def.storage,
      capacity = def.capacity, armor = def.armor, radProtection = def.radProtection,
      fuel = def.fuel, tool = def.tool, use = def.use
    }
  end
  return out
end

function Data.mapForUI()
  local zones = {}
  local function add(list, kind)
    for i = 1, #list do
      local zone = list[i]
      zones[#zones + 1] = {
        id = zone.id, name = zone.name, kind = kind,
        x = zone.x, y = zone.y, z = zone.z, radius = zone.radius,
        tier = zone.tier, max = zone.max
      }
    end
  end
  add(Data.lootZones, "loot")
  add(Data.zombieZones, "zombie")
  add(Data.safeZones, "safe")
  add(Data.radiationZones, "radiation")
  add(Data.bases, "base")
  for i = 1, #Data.traders do
    local t = Data.traders[i]
    zones[#zones + 1] = { id = t.id, name = t.name, kind = "trader", x = t.x, y = t.y, z = t.z, radius = 6 }
  end
  for i = 1, #Data.vehicleSpawns do
    local v = Data.vehicleSpawns[i]
    zones[#zones + 1] = { id = v.id, name = "Авто", kind = "vehicle", x = v.x, y = v.y, z = v.z, radius = 5 }
  end
  local spawns = {}
  for i = 1, #Data.spawns do
    local s = Data.spawns[i]
    spawns[#spawns + 1] = { id = s.id, name = s.name, x = s.x, y = s.y, z = s.z }
  end
  return { zones = zones, spawns = spawns }
end

function Data.zoneNameAt(x, y)
  local best, bestName = nil, nil
  for i = 1, #Data.safeZones do
    local z = Data.safeZones[i]
    local d = DZ.Util.dist2d(x, y, z.x, z.y)
    if d <= (z.radius or 25) and (not best or d < best) then best, bestName = d, z.name end
  end
  for i = 1, #Data.lootZones do
    local z = Data.lootZones[i]
    local d = DZ.Util.dist2d(x, y, z.x, z.y)
    if d <= (z.radius or 25) and (not best or d < best) then best, bestName = d, z.name end
  end
  for i = 1, #Data.zombieZones do
    local z = Data.zombieZones[i]
    local d = DZ.Util.dist2d(x, y, z.x, z.y)
    if d <= (z.radius or 25) and (not best or d < best) then best, bestName = d, z.name end
  end
  return bestName or "Пустошь"
end

return DZ
