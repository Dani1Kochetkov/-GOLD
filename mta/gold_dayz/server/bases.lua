--[[
  server/bases.lua — убежища: занятие, PIN-код, склад.

  Базовые зоны всегда безопасны (нет PvP и зомби): это убежище, а не
  рейдуемая крепость. Склад защищён PIN-кодом и сохраняется в SQLite.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Bases = DZ.Bases or {}
local B = DZ.Bases

B.list = B.list or {}
B.byId = B.byId or {}

local function catalog()
  return DZ.Data.items
end

local function cfg()
  return DZ.Data.config.bases
end

local function stashSlots()
  return tonumber(cfg().stashSlots) or 40
end

local function validCode(code)
  return type(code) == "string" and code:match("^%d%d%d%d?%d?%d?%d?%d?$") ~= nil
end

local function paintMarker(base)
  if not isElement(base.marker) then return end
  local r, g, b = 170, 170, 160
  if base.owner then r, g, b = 122, 168, 96 end
  if setMarkerColor then setMarkerColor(base.marker, r, g, b, 140) end
  setElementData(base.marker, "dz:owner", base.owner or "")
end

local function persist(base)
  DZ.DB.saveBase(base.id, base.owner, base.code, DZ.Inv.toData(base.stash))
end

function B.init()
  local rows = DZ.DB.loadBaseRows() or {}
  local stored = {}
  for i = 1, #rows do stored[rows[i].id] = rows[i] end

  for i = 1, #DZ.Data.bases do
    local def = DZ.Data.bases[i]
    local row = stored[def.id]
    local stash = DZ.Inv.new("stash_" .. def.id, stashSlots())
    if row and row.stash then
      local decoded = fromJSON(row.stash)
      if type(decoded) == "table" then
        stash = DZ.Inv.fromData("stash_" .. def.id, decoded)
        stash.base = stashSlots()
      end
    end
    local marker = createMarker(def.x, def.y, def.z + 0.05, "cylinder", (def.radius or 28) * 0.12, 170, 170, 160, 140)
    if marker then
      setElementData(marker, "dz:base", def.id)
      setElementData(marker, "dz:name", def.name)
    end
    local base = {
      id = def.id, name = def.name, x = def.x, y = def.y, z = def.z,
      radius = def.radius or (tonumber(cfg().safeRadius) or 28),
      owner = row and row.owner or nil,
      code = row and row.code or nil,
      stash = stash,
      marker = marker
    }
    B.list[#B.list + 1] = base
    B.byId[def.id] = base
    paintMarker(base)
  end
  DZ.UI.log("базы: " .. tostring(#B.list))
end

function B.get(id)
  return B.byId[tostring(id or "")]
end

local function nearest(player)
  local x, y, z = getElementPosition(player)
  local best, bestDist = nil, nil
  for i = 1, #B.list do
    local base = B.list[i]
    local distance = DZ.Util.dist3d(x, y, z, base.x, base.y, base.z)
    if distance <= (tonumber(cfg().interactRange) or 6) + 3 and (not bestDist or distance < bestDist) then
      best, bestDist = base, distance
    end
  end
  return best
end

local function hasAccess(player, state, base)
  if not base.owner then return false end
  if base.owner == state.account then return true end
  return state.baseAccess and state.baseAccess[base.id] == true
end

local function bagOf(state)
  local totals = {}
  for i = 1, DZ.Inv.slotCount(state.inv, catalog()) do
    local entry = state.inv.slots[i]
    if entry then
      local def = catalog()[entry.item]
      if def then
        local row = totals[entry.item]
        if not row then
          row = { item = entry.item, name = def.name, icon = def.icon, rarity = def.rarity, count = 0 }
          totals[entry.item] = row
        end
        row.count = row.count + (entry.count or 1)
      end
    end
  end
  local list = {}
  for _, row in pairs(totals) do list[#list + 1] = row end
  table.sort(list, function(a, b) return a.name < b.name end)
  return list
end

local function buildPanel(player, base)
  local state = DZ.Players.get(player)
  local access = hasAccess(player, state, base)
  local data = {
    base = {
      id = base.id, name = base.name, x = base.x, y = base.y, z = base.z,
      radius = base.radius, owner = base.owner, codeSet = base.code ~= nil
    },
    access = access,
    canClaim = base.owner == nil,
    bag = bagOf(state),
    stashTotal = DZ.Inv.slotCount(base.stash, catalog())
  }
  if access then
    data.stash = DZ.Inv.toArray(base.stash, catalog())
    data.stashWeight = DZ.Inv.weight(base.stash, catalog())
  end
  return data
end

function B.open(player, id)
  local state = DZ.Players.get(player)
  local base = B.get(id) or nearest(player)
  if not state or not state.spawned or not base then return end
  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) > (tonumber(cfg().interactRange) or 6) + 4 then
    DZ.UI.toast(player, "Подойдите к базе", "warn")
    return
  end
  state.panel = "base"
  state.baseId = base.id
  DZ.UI.panel(player, "base", buildPanel(player, base))
end

local function resync(player, base)
  local state = DZ.Players.get(player)
  if state and state.panel == "base" then
    DZ.UI.panel(player, "base", buildPanel(player, base))
  end
end

local function ownsAnother(player, state, base)
  for i = 1, #B.list do
    local other = B.list[i]
    if other ~= base and other.owner == state.account then return true end
  end
  return false
end

function B.claim(player, id, code)
  local state = DZ.Players.get(player)
  local base = B.get(id)
  if not state or not base or base.owner then
    DZ.UI.toast(player, "База уже занята", "warn")
    return
  end
  if ownsAnother(player, state, base) then
    DZ.UI.toast(player, "У вас уже есть база", "warn")
    return
  end
  code = tostring(code or "1234")
  if not validCode(code) then
    DZ.UI.toast(player, "PIN: 3–8 цифр", "warn")
    return
  end
  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) > (tonumber(cfg().interactRange) or 6) + 4 then return end
  base.owner = state.account
  base.code = code
  state.baseAccess[base.id] = true
  paintMarker(base)
  persist(base)
  DZ.UI.toast(player, "База занята. PIN сохранён.", "ok")
  DZ.UI.broadcast((state.displayName or state.name or "выживший") .. " занял убежище: " .. base.name, DZ.UI.HEX.green)
  resync(player, base)
end

function B.code(player, id, code)
  local state = DZ.Players.get(player)
  local base = B.get(id)
  if not state or not base then return end
  code = tostring(code or "")
  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) > (tonumber(cfg().interactRange) or 6) + 4 then return end

  if base.owner == state.account then
    if not validCode(code) then
      DZ.UI.toast(player, "PIN: 3–8 цифр", "warn")
      return
    end
    base.code = code
    persist(base)
    DZ.UI.toast(player, "PIN обновлён", "ok")
    resync(player, base)
    return
  end
  if base.code and code == base.code then
    state.baseAccess[base.id] = true
    DZ.UI.toast(player, "Доступ к складу открыт", "ok")
    resync(player, base)
  else
    DZ.UI.toast(player, "Неверный PIN", "danger")
  end
end

function B.store(player, id, itemId, count)
  local state = DZ.Players.get(player)
  local base = B.get(id)
  if not state or not base or not hasAccess(player, state, base) then
    DZ.UI.toast(player, "Нет доступа к складу", "warn")
    return
  end
  local available = DZ.Inv.count(state.inv, itemId)
  count = math.max(1, math.floor(tonumber(count) or 1))
  if available <= 0 then return end
  count = math.min(count, available)
  local added = DZ.Inv.add(base.stash, catalog(), itemId, count, nil, nil)
  if added <= 0 then
    DZ.UI.toast(player, "Склад переполнен", "warn")
    return
  end
  DZ.Inv.remove(state.inv, catalog(), itemId, added)
  state.dirty = true
  persist(base)
  DZ.Players.markDirty(player)
  DZ.IS.sync(player)
  resync(player, base)
end

function B.take(player, id, index, count)
  local state = DZ.Players.get(player)
  local base = B.get(id)
  if not state or not base or not hasAccess(player, state, base) then return end
  local entry = DZ.Inv.get(base.stash, tonumber(index))
  if not entry then return end
  local want = math.max(1, math.floor(tonumber(count) or entry.count or 1))
  want = math.min(want, entry.count or 1)
  local added = DZ.IS.addItem(player, entry.item, want, entry.meta, true)
  if added <= 0 then
    DZ.UI.toast(player, "Нет места", "warn")
    return
  end
  DZ.Inv.removeAt(base.stash, index, added)
  DZ.UI.toast(player, "Взято со склада: " .. tostring(added), "loot")
  state.dirty = true
  persist(base)
  DZ.Players.markDirty(player)
  DZ.IS.sync(player)
  resync(player, base)
end

function B.unclaim(player, id)
  local state = DZ.Players.get(player)
  local base = B.get(id)
  if not state or not base or base.owner ~= state.account then
    DZ.UI.toast(player, "Это не ваша база", "warn")
    return
  end
  for i = 1, DZ.Inv.slotCount(base.stash, catalog()) do
    if base.stash.slots[i] then
      DZ.UI.toast(player, "Опустошите склад перед снятием базы", "warn")
      return
    end
  end
  base.owner = nil
  base.code = nil
  state.baseAccess[base.id] = nil
  paintMarker(base)
  persist(base)
  DZ.UI.toast(player, "База освобождена", "info")
  resync(player, base)
end

function B.handle(player, action)
  if not action then return end
  local state = DZ.Players.get(player)
  if not state then return end
  if action.op == "claim" then
    B.claim(player, action.id, action.code)
  elseif action.op == "code" then
    B.code(player, action.id, action.code)
  elseif action.op == "store" then
    B.store(player, action.id, tostring(action.item or ""), tonumber(action.count) or 1)
  elseif action.op == "take" then
    B.take(player, action.id, tonumber(action.index), tonumber(action.count) or 1)
  elseif action.op == "unclaim" then
    B.unclaim(player, action.id)
  end
end

return DZ
