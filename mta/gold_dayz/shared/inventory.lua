--[[
  shared/inventory.lua — чистая модель инвентаря (без API MTA).

  Контейнер:
    { id = "player", base = 18,
      slots = { [1] = { item = "bandage", count = 2, meta = nil }, ... },
      equip = { weapon = entry|false, backpack = entry|false, armor = false, mask = false } }

  Слоты не обязаны быть плотным массивом — для UI они сериализуются
  через toArray() в плотный список, чтобы JSON не терял дырки.
]]

DZ = DZ or {}
local DZ = DZ
local INV = DZ.Inventory or {}
DZ.Inventory = INV
DZ.Inv = DZ.Inv or {}
local Inv = DZ.Inv

local function maxn(tbl)
  local n = 0
  for key in pairs(tbl or {}) do
    if type(key) == "number" and key > n then n = key end
  end
  return n
end

local function defOf(catalog, itemId)
  if not catalog or not itemId then return nil end
  return catalog[itemId]
end

local function stackOf(def)
  if not def then return 1 end
  return math.max(1, math.floor(tonumber(def.stack) or 1))
end

local function isFirearm(def)
  return def and def.weapon and def.ammoKind ~= nil
end

local function normalizeMeta(def, meta)
  if type(meta) ~= "table" then meta = nil end
  if isFirearm(def) then
    local ammo = tonumber(meta and meta.ammo) or tonumber(def.startAmmo) or 0
    ammo = math.max(0, math.min(9999, math.floor(ammo)))
    return { ammo = ammo }
  end
  if meta then
    local copy = {}
    if meta.ammo ~= nil then
      copy.ammo = math.max(0, math.min(9999, math.floor(tonumber(meta.ammo) or 0)))
    end
    if next(copy) == nil then return nil end
    return copy
  end
  return nil
end

local function entryWeight(def, count)
  if not def then return 0 end
  return (tonumber(def.weight) or 0) * math.max(1, math.floor(tonumber(count) or 1))
end

function Inv.new(id, base)
  local slots = {}
  local equip = { weapon = false, backpack = false, armor = false, mask = false }
  return {
    id = id or "player",
    base = math.max(1, math.floor(tonumber(base) or DZ.INVENTORY.BASE_SLOTS)),
    slots = slots,
    equip = equip
  }
end

function Inv.defOf(catalog, entry)
  if not entry or not entry.item then return nil end
  return defOf(catalog, entry.item)
end

function Inv.slotCount(inv, catalog)
  local count = math.max(1, math.floor(tonumber(inv.base) or DZ.INVENTORY.BASE_SLOTS))
  local backpack = inv.equip and inv.equip.backpack
  if backpack then
    local def = defOf(catalog, backpack.item)
    if def then count = count + math.max(0, math.floor(tonumber(def.storage) or 0)) end
  end
  return math.min(DZ.INVENTORY.MAX_SLOTS, count)
end

function Inv.capacity(inv, catalog)
  local base = DZ.INVENTORY.BASE_CAPACITY
  local backpack = inv.equip and inv.equip.backpack
  if backpack then
    local def = defOf(catalog, backpack.item)
    if def then base = base + (tonumber(def.capacity) or 0) end
  end
  return base
end

function Inv.weight(inv, catalog)
  local total = 0
  local slots = inv.slots or {}
  for i = 1, maxn(slots) do
    local entry = slots[i]
    if entry then total = total + entryWeight(defOf(catalog, entry.item), entry.count) end
  end
  local equip = inv.equip or {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = equip[slot]
    if entry then total = total + entryWeight(defOf(catalog, entry.item), entry.count or 1) end
  end
  return math.floor(total * 100 + 0.5) / 100
end

function Inv.count(inv, itemId)
  local total = 0
  local slots = inv.slots or {}
  for i = 1, maxn(slots) do
    local entry = slots[i]
    if entry and entry.item == itemId then total = total + (entry.count or 1) end
  end
  local equip = inv.equip or {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = equip[slot]
    if entry and entry.item == itemId then total = total + (entry.count or 1) end
  end
  return total
end

function Inv.find(inv, itemId)
  local slots = inv.slots or {}
  for i = 1, maxn(slots) do
    local entry = slots[i]
    if entry and entry.item == itemId then return i end
  end
  return nil
end

function Inv.get(inv, index)
  if type(index) ~= "number" then return nil end
  return (inv.slots or {})[math.floor(index)]
end

function Inv.set(inv, index, entry)
  if type(index) ~= "number" then return false end
  inv.slots[math.floor(index)] = entry
  return true
end

--- Добавляет предметы. maxKg — текущий лимит веса (например, capacity).
--- @return added, leftover, reason
function Inv.add(inv, catalog, itemId, count, meta, maxKg)
  local def = defOf(catalog, itemId)
  count = math.floor(tonumber(count) or 0)
  if not def or count <= 0 then return 0, math.max(0, count), not def and "unknown" or "bad-count" end

  local budget = count
  local overweight = false
  if maxKg and tonumber(maxKg) then
    local unit = tonumber(def.weight) or 0
    if unit > 0 then
      local free = math.max(0, tonumber(maxKg) - Inv.weight(inv, catalog))
      local allowed = math.floor((free + 1e-9) / unit)
      if allowed < budget then
        budget = allowed
        overweight = true
      end
    end
  end
  if budget <= 0 then return 0, count, "overweight" end
  local remaining = budget

  local normalizedMeta = normalizeMeta(def, meta)
  local maxStack = stackOf(def)
  local limit = Inv.slotCount(inv, catalog)
  local added = 0

  -- Сначала доливаем существующие стаки (только одинаковые по meta).
  if maxStack > 1 and not normalizedMeta then
    for i = 1, limit do
      local entry = inv.slots[i]
      if entry and entry.item == itemId and not entry.meta then
        local space = maxStack - (entry.count or 0)
        if space > 0 then
          local put = math.min(space, remaining)
          entry.count = (entry.count or 0) + put
          remaining = remaining - put
          added = added + put
        end
        if remaining <= 0 then break end
      end
    end
  end

  -- Затем в свободные слоты.
  if remaining > 0 then
    for i = 1, limit do
      if not inv.slots[i] then
        local put = math.min(maxStack, remaining)
        inv.slots[i] = { item = itemId, count = put, meta = normalizedMeta }
        remaining = remaining - put
        added = added + put
      end
      if remaining <= 0 then break end
    end
  end

  local leftover = count - added
  local reason = nil
  if added <= 0 then
    reason = overweight and "overweight" or "no-space"
  elseif leftover > 0 then
    if overweight then
      reason = "overweight"
    elseif remaining > 0 then
      reason = "partial"
    else
      reason = "no-space"
    end
  end
  return added, leftover, reason
end

--- Проверка «влезет ли» без изменения инвентаря. Возвращает true/false, reason.
function Inv.canAdd(inv, catalog, itemId, count, meta, maxKg)
  local probe = Inv.fromData(inv.id, Inv.toData(inv))
  local added = Inv.add(probe, catalog, itemId, count, meta, maxKg)
  return added >= math.floor(tonumber(count) or 0), added
end

--- Удаляет предметы, начиная с последних слотов.
function Inv.remove(inv, catalog, itemId, count)
  local remaining = math.max(0, math.floor(tonumber(count) or 0))
  local removed = 0
  if remaining <= 0 then return 0 end
  local limit = maxn(inv.slots or {})
  for i = limit, 1, -1 do
    local entry = inv.slots[i]
    if entry and entry.item == itemId then
      local take = math.min(entry.count or 1, remaining)
      entry.count = (entry.count or 1) - take
      remaining = remaining - take
      removed = removed + take
      if entry.count <= 0 then inv.slots[i] = nil end
    end
    if remaining <= 0 then break end
  end
  return removed
end

--- Удаляет count из конкретного слота. Возвращает entry, removed.
function Inv.removeAt(inv, index, count)
  local entry = Inv.get(inv, index)
  if not entry then return nil, 0 end
  count = math.max(1, math.floor(tonumber(count) or 1))
  local take = math.min(entry.count or 1, count)
  entry.count = (entry.count or 1) - take
  if entry.count <= 0 then inv.slots[math.floor(index)] = nil end
  return entry, take
end

function Inv.move(inv, catalog, from, to)
  from, to = math.floor(tonumber(from) or 0), math.floor(tonumber(to) or 0)
  local limit = Inv.slotCount(inv, catalog)
  if from < 1 or to < 1 or from > limit or to > limit then return false, "bad-slot" end
  if from == to then return true end
  local a, b = inv.slots[from], inv.slots[to]
  if not a then return false, "empty" end
  if b and b.item == a.item and not a.meta and not b.meta then
    local def = defOf(catalog, a.item)
    local maxStack = stackOf(def)
    local space = maxStack - (b.count or 0)
    if space > 0 then
      local put = math.min(space, a.count or 1)
      b.count = (b.count or 0) + put
      a.count = (a.count or 1) - put
      if a.count <= 0 then inv.slots[from] = nil end
      return true
    end
  end
  inv.slots[from], inv.slots[to] = b, a
  return true
end

local function findEmpty(inv, catalog, ignoreIndex)
  local limit = Inv.slotCount(inv, catalog)
  for i = 1, limit do
    if not inv.slots[i] then return i end
  end
  if ignoreIndex and ignoreIndex <= limit and not inv.slots[ignoreIndex] then
    return ignoreIndex
  end
  return nil
end

--- Надевает предмет из слота index в экипировку. Старый предмет возвращается
--- в тот же слот инвентаря.
function Inv.equip(inv, catalog, index)
  index = math.floor(tonumber(index) or 0)
  local entry = Inv.get(inv, index)
  if not entry then return false, "empty" end
  local def = defOf(catalog, entry.item)
  if not def or not def.slot then return false, "not-equipment" end
  local slot = def.slot
  if slot ~= "weapon" and slot ~= "backpack" and slot ~= "armor" and slot ~= "mask" then
    return false, "bad-slot"
  end
  local old = inv.equip[slot]
  inv.equip[slot] = entry
  inv.slots[index] = old or nil
  return true, slot, entry
end

--- Снимает экипировку в первый свободный слот.
function Inv.unequip(inv, catalog, slot)
  local entry = inv.equip and inv.equip[slot]
  if not entry then return false, "empty" end

  -- Снятие рюкзака уменьшает число слотов: нельзя оставить предметы «за» ним.
  if slot == "backpack" then
    local base = math.max(1, math.floor(inv.base or DZ.INVENTORY.BASE_SLOTS))
    for i = maxn(inv.slots or {}), base + 1, -1 do
      if inv.slots[i] then return false, "backpack-full" end
    end
  end

  local index = findEmpty(inv, catalog)
  if not index then return false, "no-space" end
  inv.slots[index] = entry
  inv.equip[slot] = false
  return true, index, entry
end

function Inv.equipped(inv, slot)
  return inv.equip and inv.equip[slot] or false
end

--- Плотный массив для UI/JSON.
function Inv.toArray(inv, catalog)
  local limit = Inv.slotCount(inv, catalog)
  local out = {}
  for i = 1, limit do
    local entry = inv.slots[i]
    if entry then
      out[i] = { item = entry.item, count = entry.count or 1, meta = entry.meta or false }
    else
      out[i] = { empty = true }
    end
  end
  return out
end

function Inv.serialize(inv, catalog)
  local equip = {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = inv.equip[slot]
    if entry then
      equip[slot] = { item = entry.item, count = entry.count or 1, meta = entry.meta or false }
    else
      equip[slot] = false
    end
  end
  return {
    slots = Inv.toArray(inv, catalog),
    equip = equip,
    weight = Inv.weight(inv, catalog),
    capacity = Inv.capacity(inv, catalog),
    slotsTotal = Inv.slotCount(inv, catalog),
    base = inv.base
  }
end

--- Сохранение в БД: список без дырок.
function Inv.toData(inv)
  local slots = {}
  for i = 1, maxn(inv.slots or {}) do
    local entry = inv.slots[i]
    if entry then
      slots[#slots + 1] = {
        index = i,
        item = entry.item,
        count = entry.count or 1,
        meta = entry.meta or false
      }
    end
  end
  local equip = {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = inv.equip[slot]
    if entry then
      equip[slot] = { item = entry.item, count = entry.count or 1, meta = entry.meta or false }
    end
  end
  return { id = inv.id, base = inv.base, slots = slots, equip = equip }
end

function Inv.fromData(id, data)
  local inv = Inv.new(id or (data and data.id) or "player", data and data.base or DZ.INVENTORY.BASE_SLOTS)
  if type(data) ~= "table" then return inv end
  local slots = data.slots or {}
  for i = 1, #slots do
    local entry = slots[i]
    if type(entry) == "table" and entry.item then
      local index = math.max(1, math.floor(tonumber(entry.index) or i))
      inv.slots[index] = {
        item = entry.item,
        count = math.max(1, math.floor(tonumber(entry.count) or 1)),
        meta = (type(entry.meta) == "table") and entry.meta or nil
      }
    end
  end
  local equip = data.equip or {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do
    local entry = equip[slot]
    if type(entry) == "table" and entry.item then
      inv.equip[slot] = {
        item = entry.item,
        count = math.max(1, math.floor(tonumber(entry.count) or 1)),
        meta = (type(entry.meta) == "table") and entry.meta or nil
      }
    end
  end
  return inv
end

function Inv.clear(inv)
  inv.slots = {}
  for _, slot in ipairs(DZ.ITEM_SLOTS) do inv.equip[slot] = false end
end

return DZ
