--[[
  shared/zombie_ai.lua — детерминированный ИИ зомби.

  Модуль не знает про MTA: сервер двигает зомби по x/y, рассылает снапшоты,
  клиент создаёт локальных педов и интерполирует позиции. Благодаря этому
  логику можно прогнать в тестах (fengari) и в headless-симуляции.
]]

DZ = DZ or {}
local DZ = DZ
DZ.ZA = DZ.ZA or {}
local ZA = DZ.ZA
local clamp = DZ.Util.clamp
local dist2d = DZ.Util.dist2d

local function num(value, fallback)
  value = tonumber(value)
  if not value or value ~= value then return fallback or 0 end
  return value
end

--- spec — запись из data/zombies.json. pos/home — {x,y,z}.
function ZA.new(id, spec, pos, home, rng)
  spec = spec or {}
  local x, y, z = pos.x, pos.y, pos.z
  local skin = spec.skin
  if not skin and type(spec.skins) == "table" and #spec.skins > 0 then
    skin = spec.skins[rng and rng:int(1, #spec.skins) or 1]
  end
  return {
    id = id,
    type = spec.id or "walker",
    name = spec.name or "Зомби",
    skin = math.floor(num(skin, 12)),
    boss = spec.boss == true,
    x = x, y = y, z = z,
    homeX = (home and home.x) or x,
    homeY = (home and home.y) or y,
    homeZ = (home and home.z) or z,
    hp = num(spec.health, 100),
    maxHp = num(spec.health, 100),
    speed = num(spec.speed, 2.5),
    damage = num(spec.damage, 10),
    attackRange = num(spec.attackRange, 1.9),
    attackInterval = num(spec.attackInterval, 1500),
    detectRange = num(spec.detectRange, 40),
    chaseRange = num(spec.chaseRange, 90),
    leash = num(spec.leash, 130),
    lootTable = spec.lootTable or "zombie_common",
    state = "idle",
    targetId = nil,
    lastSeenX = nil, lastSeenY = nil, lastSeenZ = nil,
    lostTargetAt = 0,
    investigateX = nil, investigateY = nil, investigateZ = nil,
    investigateUntil = 0,
    wanderX = nil, wanderY = nil, wanderZ = nil,
    nextWanderAt = 0,
    attackReadyAt = 0,
    lastAttackAt = 0,
    spawnedAt = 0,
    lastMoveAt = 0,
    rot = 0,
    alive = true,
    rng = rng
  }
end

function ZA.stateCode(state)
  if state == "chase" or state == "investigate" then return 1 end
  if state == "attack" then return 2 end
  if state == "dead" then return 3 end
  return 0
end

local function setState(z, state)
  if z.state ~= state then
    z.state = state
  end
end

local function moveToward(z, tx, ty, tz, dt)
  local dx, dy = tx - z.x, ty - z.y
  local distance = math.sqrt(dx * dx + dy * dy)
  if distance < 0.05 then return distance end
  local step = math.min(distance, z.speed * dt)
  z.x = z.x + (dx / distance) * step
  z.y = z.y + (dy / distance) * step
  if tz then z.z = z.z + (tz - z.z) * math.min(1, 2.0 * dt) end
  z.rot = DZ.Util.angleTo(z.x, z.y, tx, ty)
  return distance
end

local function pickWander(z, now)
  if not z.rng then return end
  local radius = 18
  local angle = z.rng:float(0, math.pi * 2)
  local distance = z.rng:float(3, radius)
  z.wanderX = z.homeX + math.cos(angle) * distance
  z.wanderY = z.homeY + math.sin(angle) * distance
  z.wanderZ = z.homeZ
  z.nextWanderAt = now + z.rng:int(3500, 8000)
end

local function nearestTarget(z, players)
  local range = z.targetId and z.chaseRange or z.detectRange
  local best, bestDist = nil, nil
  for i = 1, #players do
    local player = players[i]
    if player.alive and not player.safe and not player.invulnerable then
      local distance = dist2d(z.x, z.y, player.x, player.y)
      if distance <= range and (not bestDist or distance < bestDist) then
        best, bestDist = player, distance
      end
    end
  end
  return best, bestDist
end

--- Один «мозг» зомби. dt в секундах, now в миллисекундах.
--- @return table events: { {type="attack", targetId=...}, {type="lost", targetId=...} }
function ZA.think(z, players, now, dt)
  local events = {}
  if not z.alive then return events end
  dt = clamp(num(dt, 0.2), 0.01, 1.0)

  local target, distance = nearestTarget(z, players)
  if target then
    z.targetId = target.id
    z.lastSeenX, z.lastSeenY, z.lastSeenZ = target.x, target.y, target.z
    z.lostTargetAt = now + 6000
    setState(z, distance <= z.attackRange and "attack" or "chase")
    if distance <= z.attackRange then
      if now >= z.attackReadyAt then
        z.attackReadyAt = now + z.attackInterval
        z.lastAttackAt = now
        events[#events + 1] = { type = "attack", targetId = target.id }
      end
      -- Держим дистанцию атаки, но не влезаем в игрока.
      if distance > z.attackRange * 0.7 then
        moveToward(z, target.x, target.y, target.z, dt * 0.4)
      end
    else
      moveToward(z, target.x, target.y, target.z, dt)
    end
  elseif z.targetId and now < z.lostTargetAt and z.lastSeenX then
    setState(z, "investigate")
    z.investigateX, z.investigateY, z.investigateZ = z.lastSeenX, z.lastSeenY, z.lastSeenZ
    z.investigateUntil = z.lostTargetAt
    moveToward(z, z.investigateX, z.investigateY, z.investigateZ, dt * 0.85)
    if dist2d(z.x, z.y, z.investigateX, z.investigateY) < 1.2 then
      z.targetId = nil
    end
  elseif z.investigateX and now < z.investigateUntil then
    setState(z, "investigate")
    moveToward(z, z.investigateX, z.investigateY, z.investigateZ, dt)
    if dist2d(z.x, z.y, z.investigateX, z.investigateY) < 1.2 then
      z.investigateX = nil
      z.targetId = nil
    end
  else
    if z.targetId then
      events[#events + 1] = { type = "lost", targetId = z.targetId }
      z.targetId = nil
    end
    local homeDistance = dist2d(z.x, z.y, z.homeX, z.homeY)
    if homeDistance > z.leash then
      setState(z, "return")
      moveToward(z, z.homeX, z.homeY, z.homeZ, dt)
    elseif homeDistance > 2 and z.state == "return" then
      setState(z, "return")
      moveToward(z, z.homeX, z.homeY, z.homeZ, dt)
    else
      if now >= z.nextWanderAt or not z.wanderX then
        pickWander(z, now)
      end
      if z.wanderX then
        local wanderDistance = dist2d(z.x, z.y, z.wanderX, z.wanderY)
        if wanderDistance > 1.0 then
          setState(z, "wander")
          moveToward(z, z.wanderX, z.wanderY, z.wanderZ, dt * 0.45)
        else
          setState(z, "idle")
        end
      else
        setState(z, "idle")
      end
    end
  end

  -- Не даём уйти за лиш зоны.
  if dist2d(z.x, z.y, z.homeX, z.homeY) > z.leash then
    local dx, dy = z.x - z.homeX, z.y - z.homeY
    local len = math.sqrt(dx * dx + dy * dy) or 1
    z.x = z.homeX + (dx / len) * z.leash
    z.y = z.homeY + (dy / len) * z.leash
  end

  z.lastMoveAt = now
  return events
end

--- Шум (выстрел, взрыв). Возвращает true, если зомби заинтересовался.
function ZA.hearNoise(z, x, y, zz, radius, now)
  if not z.alive then return false end
  if z.targetId then return false end
  if dist2d(z.x, z.y, x, y) > (radius or 80) then return false end
  z.investigateX, z.investigateY, z.investigateZ = x, y, zz
  z.investigateUntil = now + 7000
  z.state = "investigate"
  return true
end

--- Урон. @return dead, actualDamage
function ZA.damage(z, amount)
  if not z.alive then return false, 0 end
  local damage = math.max(0, num(amount))
  z.hp = z.hp - damage
  if z.hp <= 0 then
    z.hp = 0
    z.alive = false
    z.state = "dead"
    return true, damage
  end
  return false, damage
end

function ZA.snapshot(z)
  local state = ZA.stateCode(z.state)
  return {
    z.id,
    DZ.Util.roundForNet(z.x),
    DZ.Util.roundForNet(z.y),
    DZ.Util.roundForNet(z.z),
    math.floor(z.rot or 0),
    state,
    math.floor(z.hp),
    math.floor(z.maxHp),
    z.skin,
    z.type,
    z.boss and 1 or 0
  }
end

function ZA.isBoss(z)
  return z.boss == true
end

return DZ
