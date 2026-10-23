--[[
  shared/survival.lua — DayZ-выживание: голод, жажда, кровь, кровотечение,
  радиация, температура, инфекция, стамина.

  Здоровье в игре хранится в нативном HP игрока (getElementHealth), а модуль
  только считает, сколько урона нужно применить за тик. Поэтому логику
  удобно тестировать без MTA.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Survival = DZ.Survival or {}
local S = DZ.Survival
local C = DZ.SURVIVAL
local clamp = DZ.Util.clamp

local function num(value, fallback)
  value = tonumber(value)
  if not value or value ~= value then return fallback or 0 end
  return value
end

function S.new(overrides)
  local stats = {
    health = C.MAX_HEALTH,
    blood = C.MAX_BLOOD,
    hunger = C.MAX_HUNGER,
    thirst = C.MAX_THIRST,
    stamina = C.MAX_STAMINA,
    temperature = C.NORMAL_TEMP,
    radiation = 0,
    bleeding = 0,
    infection = 0,
    alive = true,
    deathCause = nil,
    survived = 0,
    -- служебные флаги, чтобы сервер не спамил сообщениями
    warnStarve = false,
    warnThirst = false,
    warnCold = false,
    warnRad = false,
    warnInfection = false
  }
  if type(overrides) == "table" then
    for key, value in pairs(overrides) do
      if type(value) == "number" and stats[key] ~= nil then
        stats[key] = value
      elseif type(value) == "boolean" and stats[key] ~= nil then
        stats[key] = value
      end
    end
  end
  return stats
end

function S.clamp(stats)
  stats.health = clamp(num(stats.health), 0, C.MAX_HEALTH)
  stats.blood = clamp(num(stats.blood), 0, C.MAX_BLOOD)
  stats.hunger = clamp(num(stats.hunger), 0, C.MAX_HUNGER)
  stats.thirst = clamp(num(stats.thirst), 0, C.MAX_THIRST)
  stats.stamina = clamp(num(stats.stamina), 0, C.MAX_STAMINA)
  stats.radiation = clamp(num(stats.radiation), 0, C.MAX_RADIATION)
  stats.temperature = clamp(num(stats.temperature, C.NORMAL_TEMP), 30, 43)
  stats.bleeding = clamp(math.floor(num(stats.bleeding)), 0, C.BLEED_MAX)
  stats.infection = clamp(num(stats.infection), 0, 100)
  return stats
end

--- Наносит урон в «сыром» виде (зомби, падение, пуля).
--- @return table {dead=bool, bleeding=bool, cause=string|nil}
function S.applyDamage(stats, amount, options)
  local opts = options or {}
  if not stats.alive then return { dead = true, bleeding = false, cause = stats.deathCause } end
  local damage = math.max(0, num(amount))
  if damage <= 0 then return { dead = false, bleeding = false } end

  stats.health = stats.health - damage
  local rng = opts.rng
  local bleeding = false
  local chance = num(opts.bleedingChance)
  if chance > 0 and stats.bleeding < C.BLEED_MAX and rng and rng:chance(chance) then
    stats.bleeding = stats.bleeding + 1
    bleeding = true
  end

  local dead = false
  if stats.health <= 0 or stats.blood <= 0 then
    stats.health = 0
    stats.alive = false
    stats.deathCause = opts.cause or "damage"
    dead = true
  end
  S.clamp(stats)
  return { dead = dead, bleeding = bleeding, cause = stats.deathCause }
end

function S.addBleeding(stats, amount)
  if not stats.alive then return 0 end
  stats.bleeding = clamp(math.floor(num(stats.bleeding) + (amount or 1)), 0, C.BLEED_MAX)
  return stats.bleeding
end

function S.addInfection(stats, amount)
  if not stats.alive then return 0 end
  stats.infection = clamp(num(stats.infection) + (amount or 1), 0, 100)
  return stats.infection
end

--- Медицина: effect = {health, blood, bleeding, radiation, infection, cure}.
function S.heal(stats, effect)
  if not stats.alive or type(effect) ~= "table" then return false end
  local changed = false
  if num(effect.health) > 0 then
    stats.health = clamp(stats.health + num(effect.health), 0, C.MAX_HEALTH)
    changed = true
  end
  if num(effect.blood) > 0 then
    stats.blood = clamp(stats.blood + num(effect.blood), 0, C.MAX_BLOOD)
    changed = true
  end
  if num(effect.bleeding) > 0 then
    stats.bleeding = clamp(stats.bleeding - num(effect.bleeding), 0, C.BLEED_MAX)
    changed = true
  end
  if num(effect.radiation) > 0 then
    stats.radiation = clamp(stats.radiation - num(effect.radiation), 0, C.MAX_RADIATION)
    changed = true
  end
  if num(effect.infection) > 0 then
    stats.infection = clamp(stats.infection - num(effect.infection), 0, 100)
    changed = true
  end
  if effect.cure then
    stats.infection = 0
    changed = true
  end
  return changed
end

--- Еда/питьё: effect = {hunger, thirst, health, blood, radiation}.
function S.consume(stats, effect)
  if not stats.alive or type(effect) ~= "table" then return false end
  if num(effect.hunger) ~= 0 then
    stats.hunger = clamp(stats.hunger + num(effect.hunger), 0, C.MAX_HUNGER)
  end
  if num(effect.thirst) ~= 0 then
    stats.thirst = clamp(stats.thirst + num(effect.thirst), 0, C.MAX_THIRST)
  end
  if num(effect.health) > 0 then
    stats.health = clamp(stats.health + num(effect.health), 0, C.MAX_HEALTH)
  end
  if num(effect.blood) > 0 then
    stats.blood = clamp(stats.blood + num(effect.blood), 0, C.MAX_BLOOD)
  end
  if num(effect.radiation) ~= 0 then
    stats.radiation = clamp(stats.radiation + num(effect.radiation), 0, C.MAX_RADIATION)
  end
  return true
end

--- Один тик. dt — секунды. Возвращает:
--- { damage, dead, cause, events = { "starving", "bleeding", ... } }
function S.tick(stats, ctx, dt, rng)
  local context = ctx or {}
  dt = clamp(num(dt), 0, 5)
  local result = { damage = 0, dead = not stats.alive, cause = stats.deathCause, events = {} }
  if not stats.alive or dt <= 0 then return result end

  local events = result.events
  stats.survived = num(stats.survived) + dt

  stats.hunger = stats.hunger - C.HUNGER_DRAIN * dt
  stats.thirst = stats.thirst - C.THIRST_DRAIN * dt

  local damage = 0

  if stats.hunger <= 0 then
    stats.hunger = 0
    damage = damage + C.STARVE_DPS * dt
    if not stats.warnStarve then
      stats.warnStarve = true
      events[#events + 1] = "starving"
    end
  elseif stats.hunger > 20 then
    stats.warnStarve = false
  end

  if stats.thirst <= 0 then
    stats.thirst = 0
    damage = damage + C.DEHYDRATE_DPS * dt
    if not stats.warnThirst then
      stats.warnThirst = true
      events[#events + 1] = "dehydrated"
    end
  elseif stats.thirst > 20 then
    stats.warnThirst = false
  end

  if stats.bleeding > 0 then
    local severity = stats.bleeding
    stats.blood = stats.blood - C.BLEED_BLOOD_DPS * severity * dt
    damage = damage + C.BLEED_DPS * severity * dt
    if not stats.warnBleeding then
      stats.warnBleeding = true
      events[#events + 1] = "bleeding"
    end
  else
    stats.warnBleeding = false
  end

  -- Кровь медленно восстанавливается, если нет кровотечения.
  if stats.bleeding <= 0 and stats.blood < C.MAX_BLOOD then
    stats.blood = math.min(C.MAX_BLOOD, stats.blood + C.BLOOD_REGEN * dt)
  end

  -- Радиация: в зоне накапливается, без маски быстрее.
  local radZone = context.radiation
  if radZone == true then radZone = 1 end
  if num(radZone) > 0 then
    local intensity = clamp(num(radZone), 0, 3)
    if context.mask then
      stats.radiation = stats.radiation - 1.2 * dt
    else
      stats.radiation = stats.radiation + C.RAD_GAIN_DPS * intensity * dt
    end
  else
    stats.radiation = stats.radiation - 0.35 * dt
  end
  stats.radiation = clamp(stats.radiation, 0, C.MAX_RADIATION)
  if stats.radiation > 5 then
    damage = damage + (stats.radiation / C.MAX_RADIATION) * C.RAD_DPS * dt
    if stats.radiation > 20 and not stats.warnRad then
      stats.warnRad = true
      events[#events + 1] = "radiation"
    end
  elseif stats.radiation <= 1 then
    stats.warnRad = false
  end

  -- Температура.
  local ambient = num(context.ambient, 20)
  local target = C.NORMAL_TEMP + (ambient - 20) * 0.030
  if context.inWater then target = target - 1.2 end
  if context.night then target = target - 0.4 end
  if context.nearFire then target = target + 0.9 end
  stats.temperature = stats.temperature + (target - stats.temperature) * 0.025 * dt
  if stats.temperature < 35.0 then
    damage = damage + C.COLD_DPS * dt
    if not stats.warnCold then
      stats.warnCold = true
      events[#events + 1] = "cold"
    end
  elseif stats.temperature > 35.8 then
    stats.warnCold = false
  end

  -- Инфекция.
  if stats.infection > 0 then
    damage = damage + (stats.infection / 100) * C.INFECTION_DPS * dt
    stats.infection = math.max(0, stats.infection - 0.02 * dt)
    if not stats.warnInfection then
      stats.warnInfection = true
      events[#events + 1] = "infection"
    end
  else
    stats.warnInfection = false
  end

  -- Стамина.
  local weightRatio = clamp(num(context.weightRatio), 0, 3)
  if context.sprinting and context.moving then
    stats.stamina = stats.stamina - C.STAMINA_SPRINT_DRAIN * (1 + weightRatio * 0.7) * dt
  elseif context.moving then
    stats.stamina = stats.stamina + C.STAMINA_MOVE_REGEN * dt
  else
    stats.stamina = stats.stamina + C.STAMINA_REGEN * (1 - math.min(0.5, weightRatio * 0.35)) * dt
  end
  if weightRatio > 1 then
    stats.stamina = math.min(stats.stamina, C.OVERWEIGHT_STAMINA_CAP)
  end

  stats.health = stats.health - damage
  result.damage = math.max(0, damage)

  if stats.health <= 0 or stats.blood <= 0 then
    stats.health = 0
    stats.alive = false
    stats.deathCause = stats.blood <= 0 and "blood" or "survival"
    result.dead = true
    result.cause = stats.deathCause
  end

  if rng and stats.alive and stats.infection > 60 and rng:chance(0.0005 * dt) then
    -- запущенная инфекция изредка простреливает здоровье
    result.damage = result.damage + 2
    stats.health = math.max(0, stats.health - 2)
  end

  S.clamp(stats)
  return result
end

function S.toData(stats)
  return {
    health = stats.health,
    blood = stats.blood,
    hunger = stats.hunger,
    thirst = stats.thirst,
    stamina = stats.stamina,
    temperature = stats.temperature,
    radiation = stats.radiation,
    bleeding = stats.bleeding,
    infection = stats.infection,
    alive = stats.alive,
    deathCause = stats.deathCause,
    survived = stats.survived
  }
end

function S.fromData(data)
  local stats = S.new()
  if type(data) ~= "table" then return stats end
  for key, value in pairs(data) do
    if type(value) == "number" and stats[key] ~= nil then
      stats[key] = value
    elseif type(value) == "boolean" and stats[key] ~= nil then
      stats[key] = value
    elseif type(value) == "string" and key == "deathCause" then
      stats.deathCause = value
    end
  end
  return S.clamp(stats)
end

return DZ
