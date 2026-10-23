--[[
  server/loot.lua — лут на земле, зоны, трупы.

  Лут — серверные маркеры-цилиндры с element data (имя, редкость, иконка).
  Подбор — по E: клиент просит сервер, сервер проверяет дистанцию и вес.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Loot = DZ.Loot or {}
local L = DZ.Loot

L.ground = L.ground or {}
L.byId = L.byId or {}
L.corpses = L.corpses or {}
L.nextGroundId = L.nextGroundId or 1
L.nextCorpseId = L.nextCorpseId or 1
L.startedAt = 0

local function cfg()
  return DZ.Data.config
end

local function catalog()
  return DZ.Data.items
end

local function rarityColor(rarity)
  local data = DZ.RARITY[rarity or "common"] or DZ.RARITY.common
  return data.color[1], data.color[2], data.color[3]
end

local function round(value)
  return math.floor(value * 100 + 0.5) / 100
end

local function freeGround()
  return DZ.Util.count(L.ground) < (tonumber(cfg().loot.groundCap) or DZ.LIMITS.MAX_GROUND_ITEMS)
end

local function oldestZoneItem()
  local best, bestTime = nil, nil
  for _, item in pairs(L.ground) do
    if item.source == "zone" then
      if not bestTime or item.createdAt < bestTime then best, bestTime = item, item.createdAt end
    end
  end
  return best
end

--- Создать предмет на земле. Возвращает запись или nil.
function L.spawnGround(itemId, count, meta, x, y, z, zoneId, source)
  local def = catalog()[itemId]
  if not def then return nil end
  count = math.max(1, math.floor(tonumber(count) or 1))
  if not freeGround() then
    local oldest = oldestZoneItem()
    if oldest then L.removeGround(oldest.id) else return nil end
  end
  local id = L.nextGroundId
  L.nextGroundId = L.nextGroundId + 1

  local r, g, b = rarityColor(def.rarity)
  local marker = createMarker(round(x), round(y), round(z) + 0.05, "cylinder", 0.55, r, g, b, 150)
  if not marker then return nil end
  local record = {
    id = id, item = itemId, count = count, meta = meta or nil,
    x = round(x), y = round(y), z = round(z),
    zoneId = zoneId or nil, marker = marker, createdAt = getTickCount(),
    source = source or "zone"
  }
  setElementData(marker, "dz:loot", id)
  setElementData(marker, "dz:name", def.name)
  setElementData(marker, "dz:icon", def.icon or "?")
  setElementData(marker, "dz:rarity", def.rarity or "common")
  setElementData(marker, "dz:count", count)
  L.ground[id] = record
  L.byId[id] = record
  return record
end

function L.removeGround(id)
  local record = L.byId[id]
  if not record then return end
  if isElement(record.marker) then destroyElement(record.marker) end
  L.byId[id] = nil
  L.ground[id] = nil
end

function L.getGround(id)
  return L.byId[tonumber(id) or -1]
end

--- Сколько предметов зоны лежит сейчас.
function L.countZone(zoneId)
  local n = 0
  for _, item in pairs(L.ground) do
    if item.zoneId == zoneId then n = n + 1 end
  end
  return n
end

local function rollMeta(def, rng)
  if def.weapon and def.ammoKind then
    local start = tonumber(def.startAmmo) or 0
    return { ammo = rng:int(math.floor(start * 0.35), start) }
  end
  return nil
end

--- Спавн одного предмета из таблиц лут-зоны.
function L.spawnLootInZone(zone, rng)
  local tableName = zone.tables[rng:int(1, #zone.tables)]
  local entries = DZ.Data.loot[tableName]
  if not entries then return nil end
  local itemId, count = DZ.Loot.roll(entries, rng)
  if not itemId then return nil end
  local def = catalog()[itemId]
  local angle = rng:float(0, math.pi * 2)
  local distance = rng:float(2, math.max(3, (tonumber(zone.radius) or 20) * 0.9))
  local x = zone.x + math.cos(angle) * distance
  local y = zone.y + math.sin(angle) * distance
  local z = zone.z + rng:float(-0.4, 0.4)
  return L.spawnGround(itemId, count, rollMeta(def, rng), x, y, z, zone.id, "zone")
end

function L.initZones()
  if not DZ.rng then DZ.rng = DZ.Rng.new(getTickCount()) end
  for i = 1, #DZ.Data.lootZones do
    local zone = DZ.Data.lootZones[i]
    local target = math.floor((tonumber(zone.count) or 6) * 0.8)
    for _ = 1, target do
      L.spawnLootInZone(zone, DZ.rng)
    end
  end
  L.startedAt = getTickCount()
  DZ.UI.log("лут: " .. tostring(DZ.Util.count(L.ground)) .. " предметов в " .. tostring(#DZ.Data.lootZones) .. " зонах")
end

local function playersNear(x, y, radius)
  local players = getElementsByType("player")
  for i = 1, #players do
    local player = players[i]
    if isElement(player) and getElementHealth(player) > 0 then
      local px, py = getElementPosition(player)
      if DZ.Util.dist2d(px, py, x, y) <= radius then return true end
    end
  end
  return false
end

function L.topUp()
  local now = getTickCount()
  for i = 1, #DZ.Data.lootZones do
    local zone = DZ.Data.lootZones[i]
    if playersNear(zone.x, zone.y, 320) then
      local missing = (tonumber(zone.count) or 0) - L.countZone(zone.id)
      for _ = 1, math.min(2, missing) do
        if freeGround() then L.spawnLootInZone(zone, DZ.rng) end
      end
    end
  end
  -- Убираем старый лут, выброшенный игроками, и пустые трупы.
  for id, item in pairs(L.ground) do
    if now - item.createdAt > (tonumber(cfg().loot.despawnMs) or 900000) then
      L.removeGround(id)
    end
  end
  for id, corpse in pairs(L.corpses) do
    if now - corpse.createdAt > 600000 then
      if isElement(corpse.marker) then destroyElement(corpse.marker) end
      L.corpses[id] = nil
    end
  end
end

--- Проверка дистанции до маркера.
local function nearMarker(player, record, range)
  if not isElement(record.marker) then return false end
  local x, y, z = getElementPosition(player)
  return DZ.Util.dist3d(x, y, z, record.x, record.y, record.z) <= (range or ((tonumber(cfg().loot.pickupRange) or 3.5) + 2))
end

function L.pickup(player, groundId)
  local state = DZ.Players.get(player)
  if not state or not state.spawned or not state.alive then return end
  local record = L.getGround(groundId)
  if not record then return end
  if not nearMarker(player, record, tonumber(cfg().loot.pickupRange) + 2) then return end
  local added = DZ.IS.addItem(player, record.item, record.count, record.meta, true)
  if added <= 0 then
    DZ.UI.toast(player, "Нет места или перегруз", "warn")
    return
  end
  record.count = record.count - added
  local def = catalog()[record.item]
  if record.count <= 0 then
    L.removeGround(record.id)
  else
    if isElement(record.marker) then setElementData(record.marker, "dz:count", record.count) end
  end
  DZ.UI.toast(player, (def and def.name or record.item) .. " x" .. tostring(added) .. " — подобрано", "loot")
  state.dirty = true
  DZ.IS.sync(player)
end

--- Выброс предмета игроком или дроп зомби.
function L.dropItem(itemId, count, meta, x, y, z, source)
  return L.spawnGround(itemId, count, meta, x, y, z, nil, source or "drop")
end

------------------------------------------------------------------- corpses

local function corpseItemName(entry)
  local def = catalog()[entry.item]
  return def and def.name or entry.item
end

function L.addCorpse(state, x, y, z)
  local catalogRef = catalog()
  local data = DZ.Inv.toData(state.inv)
  data.equip = {}
  local inv = DZ.Inv.fromData("corpse", data)
  local hasItems = false
  for i = 1, DZ.Inv.slotCount(inv, catalogRef) do
    if inv.slots[i] then hasItems = true break end
  end
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = state.inv.equip[slot]
    if entry then
      DZ.Inv.add(inv, catalogRef, entry.item, entry.count or 1, entry.meta, nil)
      hasItems = true
    end
  end
  if not hasItems then return nil end

  local id = L.nextCorpseId
  L.nextCorpseId = L.nextCorpseId + 1
  local marker = createMarker(round(x), round(y), round(z) + 0.05, "cylinder", 0.8, 190, 70, 55, 170)
  if not marker then return nil end
  setElementData(marker, "dz:corpse", id)
  setElementData(marker, "dz:name", "Тело: " .. tostring(state.displayName or state.name or "выживший"))
  local corpse = {
    id = id,
    name = tostring(state.displayName or state.name or "выживший"),
    inv = inv,
    x = round(x), y = round(y), z = round(z),
    marker = marker,
    createdAt = getTickCount()
  }
  L.corpses[id] = corpse
  return corpse
end

function L.getCorpse(id)
  return L.corpses[tonumber(id) or -1]
end

function L.openCorpse(player, id)
  local state = DZ.Players.get(player)
  local corpse = L.getCorpse(id)
  if not state or not corpse then return end
  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, corpse.x, corpse.y, corpse.z) > 6 then
    DZ.UI.toast(player, "Слишком далеко", "warn")
    return
  end
  state.panel = "corpse"
  state.openCorpse = corpse.id
  DZ.UI.panel(player, "corpse", {
    id = corpse.id,
    name = corpse.name,
    slots = DZ.Inv.toArray(corpse.inv, catalog()),
    slotsTotal = DZ.Inv.slotCount(corpse.inv, catalog())
  })
end

local function corpseSync(player, corpse)
  if not player or not corpse then return end
  DZ.UI.panel(player, "corpse", {
    id = corpse.id,
    name = corpse.name,
    slots = DZ.Inv.toArray(corpse.inv, catalog()),
    slotsTotal = DZ.Inv.slotCount(corpse.inv, catalog())
  })
end

local function corpseEmpty(corpse)
  for i = 1, DZ.Inv.slotCount(corpse.inv, catalog()) do
    if corpse.inv.slots[i] then return false end
  end
  return true
end

local function removeCorpse(corpse)
  if isElement(corpse.marker) then destroyElement(corpse.marker) end
  L.corpses[corpse.id] = nil
end

function L.takeFromCorpse(player, id, index, count)
  local state = DZ.Players.get(player)
  local corpse = L.getCorpse(id)
  if not state or not corpse then return end
  if state.openCorpse ~= corpse.id then return end
  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, corpse.x, corpse.y, corpse.z) > 6 then
    DZ.UI.toast(player, "Слишком далеко", "warn")
    return
  end
  index = math.floor(tonumber(index) or 0)
  local entry = DZ.Inv.get(corpse.inv, index)
  if not entry then return end
  local want = math.max(1, math.floor(tonumber(count) or entry.count or 1))
  want = math.min(want, entry.count or 1)
  local added = DZ.IS.addItem(player, entry.item, want, entry.meta, true)
  if added <= 0 then
    DZ.UI.toast(player, "Нет места", "warn")
    return
  end
  DZ.Inv.removeAt(corpse.inv, index, added)
  DZ.UI.toast(player, corpseItemName(entry) .. " x" .. tostring(added) .. " взято", "loot")
  state.dirty = true
  if corpseEmpty(corpse) then
    removeCorpse(corpse)
    state.panel = nil
    state.openCorpse = nil
    DZ.UI.close(player, "corpse")
  else
    corpseSync(player, corpse)
  end
  DZ.IS.sync(player)
end

function L.takeAllFromCorpse(player, id)
  local state = DZ.Players.get(player)
  local corpse = L.getCorpse(id)
  if not state or not corpse or state.openCorpse ~= corpse.id then return end
  local limit = DZ.Inv.slotCount(corpse.inv, catalog())
  local moved = 0
  for i = 1, limit do
    local entry = corpse.inv.slots[i]
    if entry then
      local added = DZ.IS.addItem(player, entry.item, entry.count or 1, entry.meta, true)
      if added > 0 then
        DZ.Inv.removeAt(corpse.inv, i, added)
        moved = moved + added
      end
    end
  end
  if moved > 0 then
    DZ.UI.toast(player, "Забрано: " .. tostring(moved), "loot")
    state.dirty = true
  else
    DZ.UI.toast(player, "Нет места", "warn")
  end
  if corpseEmpty(corpse) then
    removeCorpse(corpse)
    state.panel = nil
    state.openCorpse = nil
    DZ.UI.close(player, "corpse")
  else
    corpseSync(player, corpse)
  end
  DZ.IS.sync(player)
end

return DZ
