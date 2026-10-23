--[[
  client/zombies.lua — локальные педы зомби.

  Сервер присылает снапшот массивами [id,x,y,z,rot,state,hp,maxHp,skin,type,boss].
  Клиент держит по педу на id и плавно подтягивает его к серверной позиции.
  Урон считается только на сервере: клиент лишь сообщает о попадании.
]]

DZ = DZ or {}
local DZ = DZ
DZ.ZC = DZ.ZC or {}
local ZC = DZ.ZC

ZC.peds = ZC.peds or {}
ZC.byElement = ZC.byElement or {}
ZC.lastSnapshotAt = 0

local function pedAnim(record)
  local moving = record.moving == true
  local running = moving and record.state == 1
  local key = moving and (running and "run" or "walk") or "idle"
  if record.animState == key then return end
  record.animState = key
  pcall(function()
    if moving then
      setPedAnimation(record.element, "ped", running and "RUN_civi" or "WALK_civi", -1, true, false, false, false)
    else
      setPedAnimation(record.element, "ped", "IDLE_stance", -1, true, false, false, false)
    end
  end)
end

local function createZombiePed(entry)
  local id = entry[1]
  local skin = tonumber(entry[9]) or 12
  local x, y, z = entry[2], entry[3], entry[4]
  local ped = createPed(skin, x, y, z)
  if not ped then return nil end
  setElementFrozen(ped, true)
  setElementData(ped, "dz:zombie", id)
  if entry[11] == 1 then
    setElementAlpha(ped, 240)
  end
  local record = {
    id = id,
    element = ped,
    x = x, y = y, z = z,
    rot = tonumber(entry[5]) or 0,
    state = tonumber(entry[6]) or 0,
    hp = tonumber(entry[7]) or 100,
    maxHp = tonumber(entry[8]) or 100,
    type = entry[10] or "walker",
    boss = entry[11] == 1,
    lastSeen = 0,
    moving = false,
    lastX = x, lastY = y
  }
  ZC.peds[id] = record
  ZC.byElement[ped] = record
  return record
end

local function destroyRecord(record)
  if not record then return end
  if isElement(record.element) then destroyElement(record.element) end
  ZC.peds[record.id] = nil
  ZC.byElement[record.element] = nil
end

--- Обработка снапшота от сервера.
addEventHandler(DZ.EVENTS.ZOMBIES, root, function(json)
  if source ~= localPlayer then return end
  local payload = fromJSON(json)
  if type(payload) ~= "table" or type(payload.z) ~= "table" then return end
  local now = getTickCount()
  ZC.lastSnapshotAt = now
  local seen = {}

  for i = 1, #payload.z do
    local entry = payload.z[i]
    if type(entry) == "table" and entry[1] then
      local id = entry[1]
      seen[id] = true
      local record = ZC.peds[id]
      if not record then
        record = createZombiePed(entry)
      end
      if record then
        record.tx, record.ty, record.tz = entry[2], entry[3], entry[4]
        record.rot = tonumber(entry[5]) or record.rot
        record.state = tonumber(entry[6]) or 0
        record.hp = tonumber(entry[7]) or record.hp
        record.maxHp = tonumber(entry[8]) or record.maxHp
        record.lastSeen = now
      end
    end
  end

  -- Убираем тех, кого сервер больше не присылает.
  for id, record in pairs(ZC.peds) do
    if not seen[id] and now - (record.lastSeen or 0) > 1800 then
      destroyRecord(record)
    end
  end
end)

--- Попадание игрока по зомби: сообщаем серверу, локально только эффекты.
addEventHandler("onClientPedDamage", root, function(attacker, weapon, bodypart, loss)
  local ped = source
  if getElementData(ped, "dz:trader") then cancelEvent() return end
  local record = ZC.byElement[ped]
  if not record then return end
  cancelEvent()
  if attacker ~= localPlayer then return end
  if not DZ.CLIENT.spawned or DZ.CLIENT.dead then return end

  local px, py, pz = getElementPosition(ped)
  pcall(fxAddBlood, px, py, pz + 0.6, 2, 0, 0)
  triggerServerEvent(DZ.EVENTS.ZOMBIE_DAMAGE, localPlayer, record.id, tonumber(weapon) or 0, tonumber(bodypart) or 3)

  -- Лёгкий «толчок», чтобы попадания ощущались.
  if record.moving == false then
    record.state = 2
  end
end)

addEventHandler(DZ.EVENTS.ZOMBIE_DEAD, root, function(json)
  local payload = fromJSON(json)
  if type(payload) ~= "table" then return end
  local record = ZC.peds[payload.id]
  if record and isElement(record.element) then
    local x, y, z = getElementPosition(record.element)
    pcall(fxAddBlood, x, y, z + 0.7, 5, 0, 0)
    if payload.boss then
      pcall(fxAddTankFire, x, y, z, 0, 0, 0)
    end
    destroyRecord(record)
  end
  if payload.boss then
    playSoundFrontEnd(45)
  end
end)

------------------------------------------------------------------ rendering

local function update(dt)
  local now = getTickCount()
  for id, record in pairs(ZC.peds) do
    if not isElement(record.element) then
      ZC.peds[id] = nil
      ZC.byElement[record.element] = nil
    elseif record.tx then
      local x, y, z = getElementPosition(record.element)
      local dx, dy, dz = record.tx - x, record.ty - y, (record.tz or z) - z
      local distance = math.sqrt(dx * dx + dy * dy + dz * dz)
      if distance > 0.05 then
        local step = math.min(distance, 9.5 * dt)
        local nx = x + (dx / distance) * step
        local ny = y + (dy / distance) * step
        local nz = z + (dz / distance) * step
        setElementPosition(record.element, nx, ny, nz)
        record.moving = true
        if record.rot then setElementRotation(record.element, 0, 0, record.rot) end
      else
        record.moving = false
      end
      pedAnim(record)
    elseif now - (record.lastSeen or 0) > 3000 then
      destroyRecord(record)
    end
  end
end

local lastFrame = nil
addEventHandler("onClientRender", root, function()
  local now = getTickCount()
  local dt = lastFrame and math.min(0.2, (now - lastFrame) / 1000) or 0.05
  lastFrame = now
  if DZ.CLIENT.spawned then update(dt) end
end)

addEventHandler("onClientResourceStop", resourceRoot, function()
  for _, record in pairs(ZC.peds) do
    if isElement(record.element) then destroyElement(record.element) end
  end
  ZC.peds = {}
  ZC.byElement = {}
end)

return DZ
