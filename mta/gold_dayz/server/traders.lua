--[[ server/traders.lua — торговцы в безопасных лагерях. ]]

DZ = DZ or {}
local DZ = DZ
DZ.Traders = DZ.Traders or {}
local T = DZ.Traders

T.list = T.list or {}
T.byId = T.byId or {}

local function catalog()
  return DZ.Data.items
end

local function cfg()
  return DZ.Data.config.traders
end

local function sellMultiplier()
  return tonumber(DZ.Data.sellMultiplier) or tonumber(cfg().sellMultiplier) or 0.45
end

local function stockCopy(trader)
  local rows = {}
  for i = 1, #(trader.stock or {}) do
    local row = trader.stock[i]
    rows[#rows + 1] = { item = row.item, price = row.price, left = tonumber(row.stock) or 0 }
  end
  return rows
end

function T.init()
  for i = 1, #DZ.Data.traders do
    local def = DZ.Data.traders[i]
    local ped = createPed(tonumber(def.skin) or 147, def.x, def.y, def.z, def.rot or 0)
    local marker = createMarker(def.x, def.y, def.z + 0.05, "cylinder", 1.2, 201, 162, 75, 130)
    if ped then
      setElementFrozen(ped, true)
      setElementData(ped, "dz:trader", def.id)
      setElementData(ped, "dz:name", def.name)
    end
    if marker then
      setElementData(marker, "dz:trader", def.id)
      setElementData(marker, "dz:name", def.name)
    end
    local record = {
      def = def,
      name = def.name,
      ped = ped,
      marker = marker,
      stock = stockCopy(def)
    }
    T.list[#T.list + 1] = record
    T.byId[def.id] = record
  end
  setTimer(T.restock, tonumber(cfg().restockMs) or 600000, 0)
  DZ.UI.log("торговцы: " .. tostring(#T.list))
end

function T.restock()
  for i = 1, #T.list do
    T.list[i].stock = stockCopy(T.list[i].def)
  end
end

function T.get(id)
  return T.byId[id]
end

local function near(player, trader)
  local x, y, z = getElementPosition(player)
  return DZ.Util.dist3d(x, y, z, trader.def.x, trader.def.y, trader.def.z) <= (tonumber(cfg().interactRange) or 4) + 3
end

local function buildPanel(player, trader)
  local state = DZ.Players.get(player)
  local stock = {}
  for i = 1, #trader.stock do
    local row = trader.stock[i]
    local def = catalog()[row.item]
    if def and row.left > 0 then
      stock[#stock + 1] = {
        item = row.item, price = row.price, left = row.left,
        name = def.name, icon = def.icon, rarity = def.rarity, weight = def.weight
      }
    end
  end

  local totals = {}
  for i = 1, DZ.Inv.slotCount(state.inv, catalog()) do
    local entry = state.inv.slots[i]
    if entry then
      local def = catalog()[entry.item]
      if def then
        local price = math.max(1, math.floor(DZ.Loot.value(def) * sellMultiplier()))
        local row = totals[entry.item]
        if not row then
          row = {
            item = entry.item, name = def.name, icon = def.icon, rarity = def.rarity,
            count = 0, price = price
          }
          totals[entry.item] = row
        end
        row.count = row.count + (entry.count or 1)
      end
    end
  end
  local sell = {}
  for _, row in pairs(totals) do sell[#sell + 1] = row end
  table.sort(sell, function(a, b)
    if a.price == b.price then return a.item < b.item end
    return a.price > b.price
  end)

  return {
    trader = { id = trader.def.id, name = trader.name },
    money = state.money or 0,
    stock = stock,
    sell = sell
  }
end

function T.open(player, id)
  local state = DZ.Players.get(player)
  local trader = T.get(tostring(id or ""))
  if not state or not state.spawned or not trader then return end
  if not near(player, trader) then
    DZ.UI.toast(player, "Подойдите к торговцу", "warn")
    return
  end
  state.panel = "trade"
  state.traderId = trader.def.id
  DZ.UI.panel(player, "trade", buildPanel(player, trader))
end

local function resync(player, trader)
  local state = DZ.Players.get(player)
  if state and state.panel == "trade" then
    DZ.UI.panel(player, "trade", buildPanel(player, trader))
  end
end

function T.buy(player, itemId, count)
  local state = DZ.Players.get(player)
  local trader = T.byId[state and state.traderId or ""]
  if not state or not trader or not near(player, trader) then return end
  count = math.max(1, math.floor(tonumber(count) or 1))
  local row
  for i = 1, #trader.stock do
    if trader.stock[i].item == itemId then row = trader.stock[i] break end
  end
  if not row or row.left <= 0 then
    DZ.UI.toast(player, "Нет в наличии", "warn")
    return
  end
  count = math.min(count, row.left)
  local price = row.price * count
  if (state.money or 0) < price then
    DZ.UI.toast(player, "Не хватает денег", "warn")
    return
  end
  local added = DZ.Inv.add(state.inv, catalog(), itemId, count, nil, DZ.IS.capacity(player))
  if added <= 0 then
    DZ.UI.toast(player, "Нет места в инвентаре", "warn")
    return
  end
  state.money = state.money - row.price * added
  row.left = row.left - added
  state.dirty = true
  DZ.UI.toast(player, "Куплено: " .. tostring(added) .. " за $" .. tostring(row.price * added), "ok")
  DZ.Players.markDirty(player)
  DZ.IS.sync(player)
  resync(player, trader)
end

function T.sell(player, itemId, count)
  local state = DZ.Players.get(player)
  local trader = T.byId[state and state.traderId or ""]
  if not state or not trader or not near(player, trader) then return end
  local def = catalog()[itemId]
  if not def then return end
  local available = DZ.Inv.count(state.inv, itemId)
  count = math.max(1, math.floor(tonumber(count) or 1))
  if available <= 0 then
    DZ.UI.toast(player, "Нет предмета", "warn")
    return
  end
  count = math.min(count, available)
  local removed = DZ.Inv.remove(state.inv, catalog(), itemId, count)
  if removed <= 0 then return end
  local unit = math.max(1, math.floor(DZ.Loot.value(def) * sellMultiplier()))
  local money = unit * removed
  state.money = (state.money or 0) + money
  state.dirty = true
  DZ.UI.toast(player, "Продано за $" .. tostring(money), "ok")
  DZ.Players.markDirty(player)
  DZ.IS.sync(player)
  resync(player, trader)
end

function T.handle(player, action)
  if not action then return end
  if action.op == "buy" then
    T.buy(player, tostring(action.item or ""), tonumber(action.count) or 1)
  elseif action.op == "sell" then
    T.sell(player, tostring(action.item or ""), tonumber(action.count) or 1)
  end
end

return DZ
