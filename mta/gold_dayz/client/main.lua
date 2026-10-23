--[[
  client/main.lua — вход в игру: клавиши, взаимодействие, шум, события UI.

  Клиент намеренно «тонкий»: он не считает урон и не двигает зомби, а только
  просит сервер о действиях и рисует то, что сервер прислал.
]]

DZ = DZ or {}
local DZ = DZ
DZ.registerEvents()

DZ.CLIENT = DZ.CLIENT or { spawned = false, dead = true, panel = nil }

local function send(payload)
  local ok, json = pcall(toJSON, payload)
  if ok and json then
    triggerServerEvent(DZ.EVENTS.UI, localPlayer, json)
  end
end

DZ.sendUI = send

local function panelOpen(name)
  send({ a = "open", panel = name })
end

local function closePanel()
  send({ a = "close" })
  DZ.CEF.hide()
end

local function togglePanel(name)
  if DZ.CEF.isVisible() then
    closePanel()
  else
    panelOpen(name)
  end
end

------------------------------------------------------------------ interaction

local function markerDistance(marker)
  local x, y, z = getElementPosition(localPlayer)
  local mx, my, mz = getElementPosition(marker)
  return getDistanceBetweenPoints3D(x, y, z, mx, my, mz)
end

local function nearestByData(key, range)
  local best, bestDist = nil, nil
  local list = getElementsByType("marker")
  for i = 1, #list do
    local marker = list[i]
    local value = getElementData(marker, key)
    if value ~= false and value ~= nil then
      local dist = markerDistance(marker)
      if dist <= range and (not bestDist or dist < bestDist) then
        best, bestDist = { kind = key, id = value, element = marker, name = getElementData(marker, "dz:name") }, dist
      end
    end
  end
  return best, bestDist
end

local function nearestTrader(range)
  local best, bestDist = nil, nil
  local peds = getElementsByType("ped")
  for i = 1, #peds do
    local ped = peds[i]
    local id = getElementData(ped, "dz:trader")
    if id ~= false and id ~= nil then
      local dist = markerDistance(ped)
      if dist <= range and (not bestDist or dist < bestDist) then
        best, bestDist = { kind = "trader", id = id, element = ped, name = getElementData(ped, "dz:name") }, dist
      end
    end
  end
  return best, bestDist
end

local function nearestBase(range)
  local best, bestDist = nil, nil
  local list = getElementsByType("marker")
  for i = 1, #list do
    local marker = list[i]
    local id = getElementData(marker, "dz:base")
    if id ~= false and id ~= nil then
      local dist = markerDistance(marker)
      if dist <= range and (not bestDist or dist < bestDist) then
        best, bestDist = { kind = "base", id = id, element = marker, name = getElementData(marker, "dz:name") }, dist
      end
    end
  end
  return best, bestDist
end

local function findInteraction()
  local corpse, corpseDist = nearestByData("dz:corpse", 3.4)
  if corpse then return corpse, corpseDist end
  local loot, lootDist = nearestByData("dz:loot", 3.0)
  if loot then return loot, lootDist end
  local trader, traderDist = nearestTrader(3.6)
  if trader then return trader, traderDist end
  local base, baseDist = nearestBase(6.0)
  if base then return base, baseDist end
  return nil
end

local labels = {
  ["dz:corpse"] = "обыскать тело",
  ["dz:loot"] = "подобрать",
  trader = "торговать",
  base = "убежище"
}

local promptTimer = setTimer(function()
  if not DZ.CLIENT.spawned or DZ.CEF.isVisible() then
    DZ.HUD.prompt = nil
    return
  end
  local found = findInteraction()
  if found then
    local label = labels[found.kind] or "взаимодействовать"
    DZ.HUD.prompt = string.format("E — %s%s", label, found.name and (" · " .. tostring(found.name)) or "")
    DZ.HUD.promptId = found.id
    DZ.HUD.promptKind = found.kind
  else
    DZ.HUD.prompt = nil
    DZ.HUD.promptId = nil
    DZ.HUD.promptKind = nil
  end
end, 300, 0)

local function interact()
  if not DZ.CLIENT.spawned or DZ.CEF.isVisible() then return end
  local found = findInteraction()
  if not found then return end
  if found.kind == "dz:loot" then
    send({ a = "loot", id = found.id })
  elseif found.kind == "dz:corpse" then
    send({ a = "corpse", op = "open", id = found.id })
  elseif found.kind == "trader" then
    send({ a = "trade", op = "open", id = found.id })
  elseif found.kind == "base" then
    send({ a = "base", op = "open", id = found.id })
  end
end

----------------------------------------------------------------------- keys

local keys = {
  ["i"] = function() togglePanel("inventory") end,
  ["m"] = function() togglePanel("map") end,
  ["c"] = function() togglePanel("craft") end,
  ["f1"] = function() togglePanel("help") end,
  ["e"] = interact
}

local function bindActionKey(name, handler)
  bindKey(name, "down", function()
    if isChatBoxInputActive() or isConsoleActive() then return end
    if DZ.CEF and DZ.CEF.isVisible and DZ.CEF.isVisible() then return end
    handler()
  end)
end

addEventHandler("onClientResourceStart", resourceRoot, function()
  for name, handler in pairs(keys) do bindActionKey(name, handler) end

  setPlayerHudComponentVisible("radar", false)
  setPlayerHudComponentVisible("area_name", false)
  setPlayerHudComponentVisible("vehicle_name", false)
  setPlayerHudComponentVisible("health", false)
  setPlayerHudComponentVisible("armour", false)
  setPlayerHudComponentVisible("weapon", false)
  setPlayerHudComponentVisible("ammo", false)
  setPlayerHudComponentVisible("money", false)
  setPlayerHudComponentVisible("clock", false)
  setPlayerHudComponentVisible("breath", false)
  setPlayerHudComponentVisible("crosshair", true)

  showChat(true)
  DZ.HUD.init()
end)

addEventHandler("onClientResourceStop", resourceRoot, function()
  if promptTimer then killTimer(promptTimer) end
  if isElement(DZ.CEF.browser) then destroyElement(DZ.CEF.browser) end
  for _, ped in pairs(DZ.ZC.peds or {}) do
    if isElement(ped.element) then destroyElement(ped.element) end
  end
  showCursor(false)
end)

------------------------------------------------------------------- UI events

addEventHandler(DZ.EVENTS.UI_PUSH, root, function(json)
  if source ~= localPlayer and source ~= root then return end
  if type(json) ~= "string" then return end
  local payload = fromJSON(json)
  if type(payload) ~= "table" then return end
  local kind = payload.t
  local data = payload.d or {}

  if kind == "hud" then
    DZ.HUD.data = data
    DZ.CLIENT.spawned = true
    DZ.CLIENT.dead = false
    return
  end

  if kind == "login" or kind == "loginError" or kind == "char" or kind == "death" or kind == "panel"
    or kind == "help" or kind == "loginOk" then
    if kind == "panel" then DZ.CLIENT.panel = data.panel else DZ.CLIENT.panel = nil end
    if kind == "death" then
      DZ.CLIENT.dead = true
      DZ.CLIENT.spawned = false
      DZ.HUD.data = nil
    end
    DZ.CEF.show()
    DZ.CEF.push(json)
    return
  end

  if kind == "close" or kind == "welcome" or kind == "spawned" then
    if kind == "welcome" or kind == "spawned" then
      DZ.CLIENT.spawned = true
      DZ.CLIENT.dead = false
      DZ.HUD.hintUntil = getTickCount() + 25000
      if kind == "welcome" and type(data.world) == "table" then
        if data.world.fog and setFogDistance then setFogDistance(data.world.fog) end
        if data.world.farClip and setFarClipDistance then setFarClipDistance(data.world.farClip) end
      end
    end
    DZ.CLIENT.panel = nil
    DZ.CEF.push(json)
    DZ.CEF.hide()
    return
  end

  if kind == "toast" then
    DZ.HUD.toast(data.text, data.kind)
    DZ.CEF.push(json)
    return
  end
  if kind == "kill" or kind == "killfeed" then
    DZ.HUD.killfeed(json)
    DZ.CEF.push(json)
    return
  end
  if kind == "bossSpawn" then
    DZ.HUD.toast("Исполин: " .. tostring(data.name or "пустошь"), "danger")
    DZ.CEF.push(json)
    return
  end
  if kind == "mapPos" then
    DZ.CEF.push(json)
    return
  end
  if kind == "hit" then
    DZ.HUD.hitmarker(data)
    return
  end
  if kind == "bite" then
    DZ.HUD.flash(data and data.damage or 10)
    return
  end

  DZ.CEF.push(json)
end)

--------------------------------------------------------------------- noise

local lastNoiseAt = 0
addEventHandler("onClientPlayerWeaponFire", localPlayer, function(weapon, ammo, ammoInClip, hitX, hitY, hitZ)
  local now = getTickCount()
  if now - lastNoiseAt < 800 then return end
  lastNoiseAt = now
  local x, y, z = getElementPosition(localPlayer)
  local radius = 70
  if weapon >= 33 then radius = 130 elseif weapon >= 25 then radius = 100 elseif weapon >= 22 then radius = 80 end
  triggerServerEvent(DZ.EVENTS.NOISE, localPlayer, x, y, z, radius)
end)

local lastStepAt = 0
addEventHandler("onClientRender", root, function()
  local now = getTickCount()
  if now - lastStepAt < 1400 then return end
  lastStepAt = now
  if not DZ.CLIENT.spawned or not isElement(localPlayer) or getElementHealth(localPlayer) <= 0 then return end
  local vx, vy, vz = getElementVelocity(localPlayer)
  if vx * vx + vy * vy + vz * vz > 1.0 and not isPedInVehicle(localPlayer) then
    local x, y, z = getElementPosition(localPlayer)
    triggerServerEvent(DZ.EVENTS.NOISE, localPlayer, x, y, z, 14)
  end
end)

--- Клиентское закрытие панели по Esc.
bindKey("escape", "down", function()
  if DZ.CEF.isVisible() and DZ.CLIENT.panel then
    closePanel()
  end
end)

return DZ
