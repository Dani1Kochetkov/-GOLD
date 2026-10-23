--[[ shared/loot.lua — взвешенные таблицы лута. ]]

DZ = DZ or {}
local DZ = DZ
DZ.Loot = DZ.Loot or {}
local L = DZ.Loot

--- table: { {item="bandage", weight=10, min=1, max=2}, ... }
--- @return itemId, count, entry
function L.roll(entries, rng)
  if type(entries) ~= "table" or #entries == 0 or not rng then return nil end
  local entry = rng:weighted(entries)
  if not entry or not entry.item then return nil end
  local minC = math.max(1, math.floor(tonumber(entry.min) or 1))
  local maxC = math.max(minC, math.floor(tonumber(entry.max) or minC))
  local count = rng:int(minC, maxC)
  return entry.item, count, entry
end

--- Несколько независимых роллов.
function L.rollMany(entries, rng, count)
  local result = {}
  if type(entries) ~= "table" or #entries == 0 or not rng then return result end
  for _ = 1, math.max(0, math.floor(tonumber(count) or 0)) do
    local item, amount, entry = L.roll(entries, rng)
    if item then result[#result + 1] = { item = item, count = amount, entry = entry } end
  end
  return result
end

--- Цена продажи: явная value, иначе вес * 8.
function L.value(def)
  if not def then return 0 end
  if tonumber(def.value) then return math.max(1, math.floor(tonumber(def.value))) end
  return math.max(1, math.floor((tonumber(def.weight) or 0.1) * 8))
end

return DZ
