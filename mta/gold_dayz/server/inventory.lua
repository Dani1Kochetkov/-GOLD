--[[
  server/inventory.lua — действия инвентаря, экипировка, патроны, инструменты.

  Нативное оружие MTA используется как есть: надел ствол — giveWeapon,
  снял — takeAllWeapons и остаток патронов ушёл в meta.ammo предмета.
]]

DZ = DZ or {}
local DZ = DZ
DZ.IS = DZ.IS or {}
local IS = DZ.IS

local function stateOf(player)
  return DZ.Players and DZ.Players.get and DZ.Players.get(player) or nil
end

local function catalog()
  return DZ.Data.items
end

local function defOf(itemId)
  return DZ.Data.items[itemId]
end

function IS.capacity(player)
  local state = stateOf(player)
  if not state then return DZ.INVENTORY.BASE_CAPACITY end
  return DZ.Inv.capacity(state.inv, catalog())
end

function IS.weight(player)
  local state = stateOf(player)
  if not state then return 0 end
  return DZ.Inv.weight(state.inv, catalog())
end

--- Остаток патронов из нативного оружия в meta предмета.
function IS.captureAmmo(player)
  local state = stateOf(player)
  if not state or not state.weaponId then return end
  if not state.weaponEntry or not state.weaponDef then return end
  -- getPedTotalAmmo уже включает патроны в магазине; отдельно клип не плюсуем.
  local total = 0
  if getPedTotalAmmo then total = getPedTotalAmmo(player) or 0 end
  state.weaponEntry.meta = state.weaponEntry.meta or {}
  state.weaponEntry.meta.ammo = math.max(0, math.floor(total))
end

--- Выдать нативное оружие по предмету. meta.ammo — патроны.
function IS.giveWeaponItem(player, entry, def)
  if not entry or not def or not def.weapon then return end
  local ammo = 1
  if def.ammoKind then
    ammo = tonumber(entry.meta and entry.meta.ammo) or tonumber(def.startAmmo) or 0
    ammo = math.max(0, math.floor(ammo))
  end
  giveWeapon(player, def.weapon, ammo, true)
end

function IS.takeAllWeapons(player)
  if takeAllWeapons then takeAllWeapons(player) end
  local state = stateOf(player)
  if state then
    state.weaponId = nil
    state.weaponDef = nil
    state.weaponEntry = nil
  end
end

--- Синхронизировать HUD/панель после изменения инвентаря.
function IS.sync(player, reason)
  local state = stateOf(player)
  if not state then return end
  if DZ.Players and DZ.Players.pushHud then DZ.Players.pushHud(player) end
  if state.panel == "inventory" then
    IS.sendPanel(player)
  end
  if reason then DZ.Players.markDirty(player) end
end

function IS.sendPanel(player)
  local state = stateOf(player)
  if not state then return end
  local data = DZ.Inv.serialize(state.inv, catalog())
  data.name = state.displayName or state.name or "Выживший"
  data.money = state.money or 0
  DZ.UI.panel(player, "inventory", data)
end

function IS.addItem(player, itemId, count, meta, silent)
  local state = stateOf(player)
  local def = defOf(itemId)
  if not state or not def then return 0 end
  local maxKg = IS.capacity(player)
  local added, leftover, reason = DZ.Inv.add(state.inv, catalog(), itemId, count, meta, maxKg)
  if added > 0 and not silent then
    local suffix = leftover > 0 and (" (+" .. tostring(leftover) .. " не влезло)") or ""
    DZ.UI.toast(player, def.name .. " x" .. tostring(added) .. suffix, "loot")
  end
  if added < (tonumber(count) or 0) and not silent then
    local message = "Нет места"
    if reason == "overweight" then message = "Перегруз" elseif reason == "no-space" then message = "Нет свободных слотов" end
    DZ.UI.toast(player, message, "warn")
  end
  if added > 0 then state.dirty = true end
  return added
end

function IS.removeItem(player, itemId, count)
  local state = stateOf(player)
  if not state then return 0 end
  local removed = DZ.Inv.remove(state.inv, catalog(), itemId, count)
  if removed > 0 then state.dirty = true end
  return removed
end

function IS.findItem(player, itemId)
  local state = stateOf(player)
  if not state then return false end
  return DZ.Inv.count(state.inv, itemId) > 0
end

local function nearestVehicle(player, range)
  local x, y, z = getElementPosition(player)
  local best, bestDist = nil, nil
  local vehicles = getElementsByType("vehicle")
  for i = 1, #vehicles do
    local vehicle = vehicles[i]
    if isElement(vehicle) then
      local vx, vy, vz = getElementPosition(vehicle)
      local distance = DZ.Util.dist3d(x, y, z, vx, vy, vz)
      if distance <= (range or 8) and (not bestDist or distance < bestDist) then
        best, bestDist = vehicle, distance
      end
    end
  end
  return best, bestDist
end

local function useTool(player, state, index, entry, def)
  if def.tool == "repair" then
    local vehicle = nearestVehicle(player, 8)
    if not vehicle then DZ.UI.toast(player, "Рядом нет машины", "warn"); return false end
    fixVehicle(vehicle)
    DZ.UI.toast(player, "Машина отремонтирована", "ok")
  elseif def.tool == "refuel" then
    local vehicle = nearestVehicle(player, 8)
    if not vehicle then DZ.UI.toast(player, "Рядом нет машины", "warn"); return false end
    local fuel = tonumber(getElementData(vehicle, "dz:fuel")) or 0
    local maxFuel = tonumber(DZ.Data.config.vehicles.fuelMax) or 100
    local add = tonumber(def.fuel) or tonumber(DZ.Data.config.vehicles.refuel) or 35
    setElementData(vehicle, "dz:fuel", math.min(maxFuel, fuel + add))
    DZ.UI.toast(player, "Заправлено +" .. tostring(math.floor(add)) .. "%", "ok")
  else
    return false
  end
  DZ.Inv.removeAt(state.inv, index, 1)
  state.dirty = true
  return true
end

--- Использование предмета из слота.
function IS.use(player, index)
  local state = stateOf(player)
  if not state or not state.alive then return end
  local now = getTickCount()
  if now < (state.useReadyAt or 0) then
    DZ.UI.toast(player, "Подождите...", "warn")
    return
  end
  local entry = DZ.Inv.get(state.inv, index)
  if not entry then return end
  local def = defOf(entry.item)
  if not def then return end

  if def.use then
    local cooldown = tonumber(def.use.time) or 1500
    if def.kind == "medical" then
      DZ.Survival.heal(state.stats, def.use)
      setElementHealth(player, DZ.Util.clamp(state.stats.health, 1, 100))
      DZ.UI.toast(player, def.name .. " использован", "ok")
    elseif def.kind == "food" or def.kind == "drink" then
      DZ.Survival.consume(state.stats, def.use)
      DZ.UI.toast(player, def.name .. " использован", "ok")
    else
      DZ.Survival.consume(state.stats, def.use)
    end
    if tonumber(def.use.bleeding) and tonumber(def.use.bleeding) > 0 then
      DZ.UI.toast(player, "Кровотечение остановлено", "ok")
    end
    DZ.Inv.removeAt(state.inv, index, 1)
    state.useReadyAt = now + cooldown
    state.dirty = true
    IS.sync(player)
    return
  end

  if def.kind == "ammo" then
    if not state.weaponId or not state.weaponDef or state.weaponDef.ammoKind ~= def.ammoKind then
      DZ.UI.toast(player, "Нет подходящего оружия в руках", "warn")
      return
    end
    local total = getPedTotalAmmo and (getPedTotalAmmo(player) or 0) or 0
    local add = tonumber(def.ammoCount) or 0
    giveWeapon(player, state.weaponId, total + add, false)
    DZ.Inv.removeAt(state.inv, index, 1)
    state.useReadyAt = now + 700
    state.dirty = true
    DZ.UI.toast(player, "+" .. tostring(add) .. " патронов", "ok")
    IS.sync(player)
    return
  end

  if def.kind == "tool" and def.tool then
    if useTool(player, state, index, entry, def) then
      state.useReadyAt = now + 900
      IS.sync(player)
    end
    return
  end

  if def.kind == "gear" and entry.item == "map" then
    if DZ.Players and DZ.Players.openPanel then DZ.Players.openPanel(player, "map") end
    return
  end

  if def.slot then
    IS.equip(player, index)
    return
  end

  if def.kind == "valuable" then
    DZ.UI.toast(player, "Продайте это торговцу", "info")
    return
  end
  DZ.UI.toast(player, "С этим нельзя ничего сделать", "warn")
end

function IS.equip(player, index)
  local state = stateOf(player)
  if not state then return end
  local entry = DZ.Inv.get(state.inv, index)
  if not entry then return end
  local def = defOf(entry.item)
  if not def or not def.slot then
    DZ.UI.toast(player, "Нельзя надеть", "warn")
    return
  end

  if def.slot == "weapon" then
    IS.captureAmmo(player)
    local ok, slot, equipped = DZ.Inv.equip(state.inv, catalog(), index)
    if not ok then
      DZ.UI.toast(player, "Не получилось надеть", "warn")
      return
    end
    if takeAllWeapons then takeAllWeapons(player) end
    local equippedDef = defOf(equipped.item)
    state.weaponId = equippedDef.weapon
    state.weaponDef = equippedDef
    state.weaponEntry = equipped
    IS.giveWeaponItem(player, equipped, equippedDef)
    DZ.UI.toast(player, (equippedDef.name or "Оружие") .. " в руках", "ok")
  elseif def.slot == "armor" then
    local armor = tonumber(entry.meta and entry.meta.armor) or tonumber(def.armor) or 0
    local ok = DZ.Inv.equip(state.inv, catalog(), index)
    if not ok then return end
    setPedArmor(player, armor)
    DZ.UI.toast(player, "Броня: " .. tostring(math.floor(armor)), "ok")
  else
    local ok, _, equipped = DZ.Inv.equip(state.inv, catalog(), index)
    if not ok then
      local message = "Нет места"
      if def.slot == "backpack" then message = "Освободите слоты под рюкзаком" end
      DZ.UI.toast(player, message, "warn")
      return
    end
    if def.slot == "backpack" then
      DZ.UI.toast(player, "Рюкзак надет", "ok")
    elseif def.slot == "mask" then
      DZ.UI.toast(player, "Противогаз надет", "ok")
    end
  end
  state.dirty = true
  IS.sync(player)
end

function IS.unequip(player, slot)
  local state = stateOf(player)
  if not state or not slot then return end
  local entry = DZ.Inv.equipped(state.inv, slot)
  if not entry then return end
  local def = defOf(entry.item)

  if slot == "weapon" then
    IS.captureAmmo(player)
    if takeAllWeapons then takeAllWeapons(player) end
    state.weaponId = nil
    state.weaponDef = nil
    state.weaponEntry = nil
  elseif slot == "armor" then
    entry.meta = entry.meta or {}
    entry.meta.armor = math.floor(getPedArmor(player) or 0)
    setPedArmor(player, 0)
  end

  local ok, index = DZ.Inv.unequip(state.inv, catalog(), slot)
  if not ok then
    if slot == "weapon" then
      -- вернуть оружие в руки, если снять не удалось
      state.weaponId = def.weapon
      state.weaponDef = def
      state.weaponEntry = entry
      IS.giveWeaponItem(player, entry, def)
    end
    DZ.UI.toast(player, "Нет места в инвентаре", "warn")
    return
  end
  state.dirty = true
  IS.sync(player)
end

function IS.drop(player, index, count)
  local state = stateOf(player)
  if not state then return end
  local entry, removed = DZ.Inv.removeAt(state.inv, index, count or 1)
  if not entry or removed <= 0 then return end
  local def = defOf(entry.item)
  local x, y, z = getElementPosition(player)
  if DZ.Loot and DZ.Loot.dropItem then
    DZ.Loot.dropItem(entry.item, removed, entry.meta, x, y, z, "drop")
  end
  DZ.UI.toast(player, (def and def.name or entry.item) .. " выброшено", "info")
  state.dirty = true
  IS.sync(player)
end

function IS.handle(player, action)
  if not action or not action.op then return end
  local state = stateOf(player)
  if not state or not state.spawned then return end
  local op = tostring(action.op)
  if op == "use" then
    IS.use(player, tonumber(action.index))
  elseif op == "equip" then
    IS.equip(player, tonumber(action.index))
  elseif op == "unequip" then
    IS.unequip(player, tostring(action.slot or ""))
  elseif op == "drop" then
    IS.drop(player, tonumber(action.index), tonumber(action.count) or 1)
  elseif op == "move" then
    local ok = DZ.Inv.move(state.inv, catalog(), tonumber(action.from), tonumber(action.to))
    if ok then
      state.dirty = true
      IS.sync(player)
    else
      IS.sync(player)
    end
  end
end

function IS.giveStarter(player)
  local state = stateOf(player)
  if not state then return end
  local starter = DZ.Data.config.spawn.starter or {}
  for i = 1, #starter do
    local row = starter[i]
    if row and row.item then
      DZ.Inv.add(state.inv, catalog(), row.item, tonumber(row.count) or 1, nil, IS.capacity(player))
    end
  end
end

--- Проверка «оружие в руках соответствует предмету» после респавна.
function IS.restoreWeapon(player)
  local state = stateOf(player)
  if not state then return end
  local entry = DZ.Inv.equipped(state.inv, "weapon")
  if entry then
    local def = defOf(entry.item)
    if def then
      state.weaponId = def.weapon
      state.weaponDef = def
      state.weaponEntry = entry
      IS.giveWeaponItem(player, entry, def)
    end
  end
  local armor = DZ.Inv.equipped(state.inv, "armor")
  if armor then
    local def = defOf(armor.item)
    if def then setPedArmor(player, tonumber(armor.meta and armor.meta.armor) or tonumber(def.armor) or 0) end
  end
end

return DZ
