--[[ server/crafting.lua — крафт по рецептам из data/recipes.json. ]]

DZ = DZ or {}
local DZ = DZ
DZ.Craft = DZ.Craft or {}
local C = DZ.Craft

local function catalog()
  return DZ.Data.items
end

function C.nearBench(player)
  local x, y, z = getElementPosition(player)
  for i = 1, #DZ.Data.safeZones do
    local zone = DZ.Data.safeZones[i]
    if DZ.Util.dist3d(x, y, z, zone.x, zone.y, zone.z) <= (zone.radius or 25) + 5 then
      return true, zone.name
    end
  end
  for i = 1, #DZ.Data.bases do
    local base = DZ.Data.bases[i]
    if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) <= (base.radius or 28) + 5 then
      return true, base.name
    end
  end
  return false
end

local function recipeState(state, recipe)
  local can = true
  local missing = {}
  local rows = {}
  for i = 1, #(recipe["in"] or {}) do
    local need = recipe["in"][i]
    local def = catalog()[need.item]
    local have = DZ.Inv.count(state.inv, need.item)
    local enough = have >= (need.count or 1)
    if not enough then can = false end
    rows[#rows + 1] = {
      item = need.item, name = def and def.name or need.item,
      count = need.count or 1, have = have, enough = enough
    }
    if not enough then missing[#missing + 1] = (def and def.name or need.item) end
  end
  local outDef = catalog()[recipe.out]
  return {
    id = recipe.id, name = recipe.name,
    out = recipe.out, outName = outDef and outDef.name or recipe.out,
    outIcon = outDef and outDef.icon or "?",
    count = recipe.count or 1,
    bench = recipe.bench == true,
    items = rows,
    can = can,
    missing = missing
  }
end

function C.buildPanel(player)
  local state = DZ.Players.get(player)
  if not state then return nil end
  local recipes = {}
  for i = 1, #DZ.Data.recipes do
    recipes[#recipes + 1] = recipeState(state, DZ.Data.recipes[i])
  end
  local bench, place = C.nearBench(player)
  return { recipes = recipes, nearBench = bench, place = place }
end

function C.open(player)
  local state = DZ.Players.get(player)
  if not state or not state.spawned then return end
  state.panel = "craft"
  DZ.UI.panel(player, "craft", C.buildPanel(player))
end

function C.craft(player, recipeId)
  local state = DZ.Players.get(player)
  if not state or not state.spawned or not state.alive then return end
  local now = getTickCount()
  if now < (state.craftReadyAt or 0) then return end
  local recipe
  for i = 1, #DZ.Data.recipes do
    if DZ.Data.recipes[i].id == recipeId then recipe = DZ.Data.recipes[i] break end
  end
  if not recipe then return end

  if recipe.bench == true and not C.nearBench(player) then
    DZ.UI.toast(player, "Нужен верстак в лагере или на базе", "warn")
    return
  end
  local check = recipeState(state, recipe)
  if not check.can then
    DZ.UI.toast(player, "Не хватает: " .. table.concat(check.missing, ", "), "warn")
    return
  end

  local canAdd = DZ.Inv.canAdd(state.inv, catalog(), recipe.out, recipe.count or 1, nil, DZ.IS.capacity(player))
  if not canAdd then
    DZ.UI.toast(player, "Нет места для результата", "warn")
    return
  end

  for i = 1, #(recipe["in"] or {}) do
    local need = recipe["in"][i]
    DZ.Inv.remove(state.inv, catalog(), need.item, need.count or 1)
  end
  DZ.Inv.add(state.inv, catalog(), recipe.out, recipe.count or 1, nil, DZ.IS.capacity(player))
  state.craftReadyAt = now + 1500
  state.dirty = true
  DZ.UI.toast(player, "Создано: " .. (check.outName or recipe.out), "ok")
  DZ.IS.sync(player)
  if state.panel == "craft" then
    DZ.UI.panel(player, "craft", C.buildPanel(player))
  end
end

function C.handle(player, action)
  if action and action.op == "craft" then
    C.craft(player, tostring(action.id or ""))
  end
end

return DZ
