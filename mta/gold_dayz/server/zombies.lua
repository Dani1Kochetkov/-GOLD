--[[
  server/zombies.lua — авторитетный серверный ИИ зомби.

  Клиент не двигает зомби сам: сервер считает позиции, рассылает снапшоты,
  а клиент только интерполирует педов и присылает события попаданий.
  Урон пересчитывается на сервере по серверной таблице оружия.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Zombies = DZ.Zombies or {}
local Z = DZ.Zombies
local ZA = DZ.ZA

Z.list = Z.list or {}
Z.byId = Z.byId or {}
Z.nextId = Z.nextId or 1
Z.bossNextAt = Z.bossNextAt or {}
Z.lastSnapshot = Z.lastSnapshot or {}

local function cfg()
  return DZ.Data.config
end

local function inSafeZone(x, y, z)
  if DZ.Data.config.safeZones == false then return false end
  for i = 1, #DZ.Data.safeZones do
    local zone = DZ.Data.safeZones[i]
    if DZ.Util.dist3d(x, y, z, zone.x, zone.y, zone.z) <= (zone.radius or 25) then return true end
  end
  if DZ.Data.config.bases.enabled ~= false then
    for i = 1, #DZ.Data.bases do
      local base = DZ.Data.bases[i]
      if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) <= (base.radius or 28) then return true end
    end
  end
  return false
end
DZ.Zombies.isInSafeZone = inSafeZone

function Z.count()
  return #Z.list
end

function Z.countZone(zoneId)
  local n = 0
  for i = 1, #Z.list do
    if Z.list[i].zoneId == zoneId then n = n + 1 end
  end
  return n
end

local function typeOptions(zone)
  local options = {}
  if type(zone.types) == "table" then
    for typeId, weight in pairs(zone.types) do
      local spec = DZ.Data.zombieTypes[typeId]
      if spec and tonumber(weight) and tonumber(weight) > 0 then
        options[#options + 1] = { weight = tonumber(weight), spec = spec }
      end
    end
  end
  if #options == 0 then
    for i = 1, #DZ.Data.zombieList do
      local spec = DZ.Data.zombieList[i]
      if not spec.boss then
        options[#options + 1] = { weight = tonumber(spec.weight) or 1, spec = spec }
      end
    end
  end
  return options
end

local function pickType(zone)
  local options = typeOptions(zone)
  local choice = DZ.rng:weighted(options)
  return choice and choice.spec or DZ.Data.zombieTypes.walker
end

local function addZombie(zone, spec, x, y, zPos)
  if #Z.list >= (tonumber(cfg().zombies.globalCap) or 90) then return nil end
  local id = Z.nextId
  Z.nextId = Z.nextId + 1
  local zombie = ZA.new(id, spec, { x = x, y = y, z = zPos }, { x = zone.x, y = zone.y, z = zone.z }, DZ.rng)
  zombie.zoneId = zone.id
  zombie.index = #Z.list + 1
  Z.list[#Z.list + 1] = zombie
  Z.byId[id] = zombie
  return zombie
end

local function removeZombie(zombie)
  local index = zombie.index
  if not index or Z.list[index] ~= zombie then
    for i = 1, #Z.list do
      if Z.list[i] == zombie then index = i break end
    end
  end
  if not index then return end
  local last = Z.list[#Z.list]
  Z.list[index] = last
  last.index = index
  Z.list[#Z.list] = nil
  Z.byId[zombie.id] = nil
  zombie.index = nil
end

local function randomPointAround(x, y, minD, maxD)
  local angle = DZ.rng:float(0, math.pi * 2)
  local distance = DZ.rng:float(minD, maxD)
  return x + math.cos(angle) * distance, y + math.sin(angle) * distance
end

local function spawnInZone(zone, nearPlayer)
  local x, y
  local px, py = nil, nil
  if isElement(nearPlayer) then
    px, py = getElementPosition(nearPlayer)
  elseif type(nearPlayer) == "table" then
    px, py = nearPlayer.x, nearPlayer.y
  end
  if px and py then
    x, y = randomPointAround(px, py,
      tonumber(cfg().zombies.minDistance) or 25,
      tonumber(cfg().zombies.maxDistance) or 150)
    if DZ.Util.dist2d(x, y, zone.x, zone.y) > (zone.radius or 60) + 100 then
      x, y = randomPointAround(zone.x, zone.y, 5, (zone.radius or 60) * 0.8)
    end
  else
    x, y = randomPointAround(zone.x, zone.y, 5, (zone.radius or 60) * 0.8)
  end
  if inSafeZone(x, y, zone.z) then return nil end
  local spec = pickType(zone)
  return addZombie(zone, spec, x, y, zone.z + DZ.rng:float(0, 1.5))
end

local function spawnBoss(zone)
  local spec = DZ.Data.zombieTypes.boss
  if not spec then return nil end
  local x, y = randomPointAround(zone.x, zone.y, 6, math.max(10, (zone.radius or 60) * 0.5))
  if inSafeZone(x, y, zone.z) then return nil end
  local boss = addZombie(zone, spec, x, y, zone.z + 1.0)
  if boss then
    DZ.UI.broadcast("Исполин появился: " .. tostring(zone.name) .. ". Он не любит гостей.", DZ.UI.HEX.red)
    DZ.UI.pushAll("bossSpawn", { name = zone.name, x = zone.x, y = zone.y })
    Z.bossNextAt[zone.id] = getTickCount() + (tonumber(cfg().zombies.bossRespawnMs) or 900000)
  end
  return boss
end

local function playersNearZone(zone, range)
  local result = {}
  for player, state in pairs(DZ.Players.states) do
    if state.spawned and state.alive and isElement(player) and getElementHealth(player) > 0 then
      local x, y = getElementPosition(player)
      if DZ.Util.dist2d(x, y, zone.x, zone.y) <= range then
        result[#result + 1] = player
      end
    end
  end
  return result
end

function Z.init()
  if not DZ.rng then DZ.rng = DZ.Rng.new(getTickCount()) end
  local fill = tonumber(cfg().zombies.initialFill) or 0.6
  for i = 1, #DZ.Data.zombieZones do
    local zone = DZ.Data.zombieZones[i]
    local amount = math.floor((tonumber(zone.max) or 0) * fill)
    for _ = 1, amount do
      spawnInZone(zone, nil)
    end
    Z.bossNextAt[zone.id] = 0
  end
  DZ.UI.log("зомби: стартовое заполнение " .. tostring(#Z.list))
  setTimer(Z.spawnCheck, tonumber(cfg().zombies.spawnCheckMs) or 3000, 0)
  setTimer(Z.tick, tonumber(cfg().server.tickMs) or 250, 0)
  setTimer(Z.snapshot, tonumber(cfg().zombies.snapshotMs) or 200, 0)
end

function Z.spawnCheck()
  local cap = tonumber(cfg().zombies.globalCap) or 90
  local online = 0
  for _, state in pairs(DZ.Players.states) do
    if state.spawned and state.alive then online = online + 1 end
  end
  local perPlayer = tonumber(cfg().zombies.perPlayerCap)
  if perPlayer and online > 0 then
    cap = math.min(cap, math.max(20, online * perPlayer))
  end
  if #Z.list >= cap then return end
  for i = 1, #DZ.Data.zombieZones do
    local zone = DZ.Data.zombieZones[i]
    local near = playersNearZone(zone, 330)
    if #near > 0 then
      local missing = (tonumber(zone.max) or 0) - Z.countZone(zone.id)
      for _ = 1, math.min(2, missing) do
        if #Z.list < cap then
          spawnInZone(zone, near[DZ.rng:int(1, #near)])
        end
      end
      if zone.boss and not Z.bossNextAt[zone.id] then
        Z.bossNextAt[zone.id] = 0
      end
      if zone.boss then
        local hasBoss = false
        for j = 1, #Z.list do
          if Z.list[j].zoneId == zone.id and Z.list[j].boss and Z.list[j].alive then hasBoss = true break end
        end
        if not hasBoss and getTickCount() >= (Z.bossNextAt[zone.id] or 0) and #near > 0 then
          spawnBoss(zone)
        end
      end
    end
  end
end

local function playerCombatList(now)
  local players = {}
  for player, state in pairs(DZ.Players.states) do
    if state.spawned and state.alive and isElement(player) and getElementHealth(player) > 0 then
      local x, y, z = getElementPosition(player)
      local safe = inSafeZone(x, y, z)
      players[#players + 1] = {
        id = player,
        x = x, y = y, z = z,
        alive = true,
        safe = safe,
        invulnerable = state.invulnUntil and now < state.invulnUntil or false
      }
    end
  end
  return players
end

local function hitPlayer(player, zombie)
  local state = DZ.Players.get(player)
  if not state or not state.spawned or not state.alive then return end
  state.lastZombieHitAt = getTickCount()
  if state.invulnUntil and getTickCount() < state.invulnUntil then return end
  local x, y, z = getElementPosition(player)
  if inSafeZone(x, y, z) then return end

  local damage = tonumber(zombie.damage) or 10
  local armor = getPedArmor(player) or 0
  if armor > 0 then
    local absorbed = math.min(armor, damage * 0.55)
    setPedArmor(player, math.max(0, armor - absorbed))
    damage = damage - absorbed
  end
  local health = getElementHealth(player) or 0
  setElementHealth(player, math.max(0, health - damage))
  triggerClientEvent(player, DZ.EVENTS.ZOMBIE_BITE, player, damage, zombie.type)
  DZ.UI.send(player, "bite", { damage = math.floor(damage), boss = zombie.boss == true })

  if DZ.rng:chance(tonumber(cfg().survival.bleedingChanceZombie) or DZ.SURVIVAL.BLEED_CHANCE_ZOMBIE) then
    DZ.Survival.addBleeding(state.stats, 1)
    DZ.UI.toast(player, "Кровотечение!", "danger")
  end
  local mask = DZ.Inv.equipped(state.inv, "mask")
  if not mask and DZ.rng:chance(tonumber(cfg().survival.infectionChanceZombie) or DZ.SURVIVAL.INFECT_CHANCE_ZOMBIE) then
    DZ.Survival.addInfection(state.stats, DZ.rng:int(8, 18))
    DZ.UI.toast(player, "Заражение! Нужны антибиотики", "danger")
  end
  state.stats.health = getElementHealth(player)
  state.dirty = true
end

function Z.tick()
  local now = getTickCount()
  local dt = (tonumber(cfg().server.tickMs) or 250) / 1000
  local players = playerCombatList(now)
  local despawnMs = tonumber(cfg().zombies.despawnIdleMs) or 60000
  local despawnDistance = DZ.LIMITS.ZOMBIE_DESPAWN_DISTANCE

  for i = #Z.list, 1, -1 do
    local zombie = Z.list[i]
    local events = ZA.think(zombie, players, now, dt)
    for j = 1, #events do
      local event = events[j]
      if event.type == "attack" and event.targetId then
        local target = event.targetId
        if isElement(target) and getElementHealth(target) > 0 then
          local x, y, z = getElementPosition(target)
          if DZ.Util.dist3d(x, y, z, zombie.x, zombie.y, zombie.z) <= zombie.attackRange + 1.6 then
            hitPlayer(target, zombie)
          end
        end
      end
    end

    -- Дешёвая проверка «рядом есть игрок» для деспавна.
    local nearest = nil
    for j = 1, #players do
      local distance = DZ.Util.dist2d(players[j].x, players[j].y, zombie.x, zombie.y)
      if not nearest or distance < nearest then nearest = distance end
    end
    if nearest and nearest <= despawnDistance then
      zombie.lastNearAt = now
    elseif zombie.lastNearAt and now - zombie.lastNearAt > despawnMs then
      removeZombie(zombie)
    elseif not zombie.lastNearAt then
      zombie.lastNearAt = now
    end
  end

  -- Расталкивание, чтобы толпа не стояла в одной точке.
  for i = 1, #Z.list do
    local a = Z.list[i]
    for j = i + 1, #Z.list do
      local b = Z.list[j]
      local dx, dy = b.x - a.x, b.y - a.y
      local d2 = dx * dx + dy * dy
      if d2 > 0.0001 and d2 < 1.21 then
        local d = math.sqrt(d2)
        local push = (1.1 - d) * 0.5
        local nx, ny = dx / d, dy / d
        a.x = a.x - nx * push
        a.y = a.y - ny * push
        b.x = b.x + nx * push
        b.y = b.y + ny * push
      end
    end
  end
end

function Z.snapshot()
  local radius = DZ.LIMITS.ZOMBIE_SNAPSHOT_RADIUS
  for player, state in pairs(DZ.Players.states) do
    if state.spawned and state.alive and isElement(player) then
      local px, py, pz = getElementPosition(player)
      local entries = {}
      for i = 1, #Z.list do
        local zombie = Z.list[i]
        if zombie.alive then
          local dx = zombie.x - px
          local dy = zombie.y - py
          if dx * dx + dy * dy <= radius * radius then
            entries[#entries + 1] = { dist = dx * dx + dy * dy, zombie = zombie }
          end
        end
      end
      table.sort(entries, function(a, b) return a.dist < b.dist end)
      local out = {}
      for i = 1, math.min(#entries, 80) do
        out[#out + 1] = ZA.snapshot(entries[i].zombie)
      end
      local json = toJSON({ z = out })
      if json then
        triggerClientEvent(player, DZ.EVENTS.ZOMBIES, player, json)
      end
    end
  end
end

function Z.nearestBoss(player)
  if not isElement(player) then return nil end
  local px, py, pz = getElementPosition(player)
  local best, bestDist = nil, nil
  for i = 1, #Z.list do
    local zombie = Z.list[i]
    if zombie.boss and zombie.alive then
      local distance = DZ.Util.dist3d(px, py, pz, zombie.x, zombie.y, zombie.z)
      if distance <= 160 and (not bestDist or distance < bestDist) then
        best, bestDist = {
          id = zombie.id, name = zombie.name, type = zombie.type,
          hp = math.floor(zombie.hp), maxHp = math.floor(zombie.maxHp),
          boss = true
        }, distance
      end
    end
  end
  if not best then return nil end
  return {
    name = best.name,
    hp = math.floor(best.hp),
    maxHp = math.floor(best.maxHp),
    distance = math.floor(bestDist)
  }
end

local function dropZombieLoot(zombie)
  local entries = DZ.Data.loot[zombie.lootTable]
  if not entries then return end
  local rolls = zombie.boss and DZ.rng:int(4, 6) or DZ.rng:int(0, 2)
  for _ = 1, rolls do
    local itemId, count = DZ.Loot.roll(entries, DZ.rng)
    if itemId then
      local x = zombie.x + DZ.rng:float(-1.2, 1.2)
      local y = zombie.y + DZ.rng:float(-1.2, 1.2)
      DZ.Loot.dropItem(itemId, count, nil, x, y, zombie.z + 0.2, "zombie")
    end
  end
end

local function killZombie(zombie, killer)
  dropZombieLoot(zombie)
  triggerClientEvent(root, DZ.EVENTS.ZOMBIE_DEAD, root, toJSON({
    id = zombie.id,
    x = DZ.Util.roundForNet(zombie.x),
    y = DZ.Util.roundForNet(zombie.y),
    z = DZ.Util.roundForNet(zombie.z),
    boss = zombie.boss == true
  }))
  if zombie.boss then
    DZ.UI.broadcast("Исполин мёртв. Добыча ждёт смельчаков.", DZ.UI.HEX.green)
    local zone = nil
    for i = 1, #DZ.Data.zombieZones do
      if DZ.Data.zombieZones[i].id == zombie.zoneId then zone = DZ.Data.zombieZones[i] break end
    end
    if zone then Z.bossNextAt[zone.id] = getTickCount() + (tonumber(cfg().zombies.bossRespawnMs) or 900000) end
  end
  removeZombie(zombie)
  if killer and isElement(killer) then
    local state = DZ.Players.get(killer)
    if state then
      state.zombieKills = (state.zombieKills or 0) + 1
      state.dirty = true
    end
  end
end

function Z.damage(player, zombieId, weapon, bodypart)
  local state = DZ.Players.get(player)
  if not state or not state.spawned or not state.alive then return end
  local zombie = Z.byId[tonumber(zombieId) or -1]
  if not zombie or not zombie.alive then return end
  local now = getTickCount()
  if now - (state.hitWindow or 0) > 1000 then
    state.hitWindow = now
    state.hitCount = 0
  end
  state.hitCount = (state.hitCount or 0) + 1
  if state.hitCount > DZ.LIMITS.ZOMBIE_HITS_PER_SEC then return end

  local x, y, z = getElementPosition(player)
  if DZ.Util.dist3d(x, y, z, zombie.x, zombie.y, zombie.z) > 160 then return end

  -- Не доверяем оружию из пакета: берём то, что реально в руках.
  local actualWeapon = getPedWeapon(player)
  local weaponId = tonumber(actualWeapon) or tonumber(weapon) or 0
  if weaponId == 0 then weaponId = 0 end
  local damage = DZ.WEAPON_DAMAGE[weaponId] or 10
  bodypart = math.floor(tonumber(bodypart) or 3)
  if bodypart < 0 or bodypart > 9 then bodypart = 3 end
  if bodypart == 9 then
    damage = damage * DZ.HEADSHOT_MULTIPLIER
  elseif bodypart >= 5 and bodypart <= 8 then
    damage = damage * DZ.LIMB_MULTIPLIER
  end
  local dead = ZA.damage(zombie, damage)
  DZ.UI.send(player, "hit", { kill = dead, damage = math.floor(damage), head = bodypart == 9 })
  if dead then
    killZombie(zombie, player)
  end
end

function Z.noise(x, y, z, radius)
  for i = 1, #Z.list do
    local zombie = Z.list[i]
    if zombie.alive then
      ZA.hearNoise(zombie, x, y, z, radius, getTickCount())
    end
  end
end

--- Событие попадания от клиента. Приходит отдельным сетевым событием.
function Z.bindEvents()
  addEventHandler(DZ.EVENTS.ZOMBIE_DAMAGE, root, function(zombieId, weapon, bodypart)
    local player = client
    if player and getElementType(player) == "player" then
      Z.damage(player, zombieId, weapon, bodypart)
    end
  end)
  addEventHandler(DZ.EVENTS.NOISE, root, function(x, y, z, radius)
    local player = client
    if not player or getElementType(player) ~= "player" then return end
    if type(x) ~= "number" or type(y) ~= "number" or type(z) ~= "number" then return end
    local px, py, pz = getElementPosition(player)
    if DZ.Util.dist3d(px, py, pz, x, y, z) > 5 then return end
    local state = DZ.Players.get(player)
    if not state then return end
    local now = getTickCount()
    if now - (state.noiseWindow or 0) > 1000 then
      state.noiseWindow = now
      state.noiseCount = 0
    end
    state.noiseCount = (state.noiseCount or 0) + 1
    if state.noiseCount > DZ.LIMITS.NOISE_PER_SEC then return end
    Z.noise(x, y, z, math.min(140, tonumber(radius) or 90))
  end)
end

return DZ
