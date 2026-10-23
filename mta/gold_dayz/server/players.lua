--[[
  server/players.lua — аккаунты, персонажи, спавн, выживание, HUD, смерть.

  Порядок: onPlayerJoin -> экран логина (CEF) -> выбор спавна и скина ->
  spawnPlayer -> welcome (каталог + карта) -> игра.
]]

DZ = DZ or {}
local DZ = DZ
DZ.Players = DZ.Players or {}
local P = DZ.Players
P.states = P.states or {}
P.authCounter = P.authCounter or 0

local function cfg()
  return DZ.Data.config
end

local function catalog()
  return DZ.Data.items
end

local function now()
  return getTickCount()
end

function P.get(player)
  return P.states[player]
end

function P.markDirty(player)
  local state = P.states[player]
  if state then state.dirty = true end
end

function P.isSafeAt(x, y, z)
  if cfg().safeZones == false then return false end
  for i = 1, #DZ.Data.safeZones do
    local zone = DZ.Data.safeZones[i]
    if DZ.Util.dist3d(x, y, z, zone.x, zone.y, zone.z) <= (zone.radius or 25) then return true end
  end
  if cfg().bases.enabled ~= false then
    for i = 1, #DZ.Data.bases do
      local base = DZ.Data.bases[i]
      if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) <= (base.radius or 28) then return true end
    end
  end
  return false
end

local function isSafePlayer(player)
  local x, y, z = getElementPosition(player)
  return P.isSafeAt(x, y, z)
end

local function baseNameAt(x, y, z)
  for i = 1, #DZ.Data.bases do
    local base = DZ.Data.bases[i]
    if DZ.Util.dist3d(x, y, z, base.x, base.y, base.z) <= (base.radius or 28) then return base.name end
  end
  return nil
end

local function clockString()
  local hour, minute = getTime()
  return string.format("%02d:%02d", hour or 0, minute or 0)
end

--------------------------------------------------------------------- onboarding

local function sendLogin(player)
  DZ.UI.send(player, "login", {
    allowRegister = cfg().auth.allowRegister ~= false,
    minPassword = tonumber(cfg().auth.minPassword) or 4,
    name = DZ.Util.cleanName(getPlayerName(player), tonumber(cfg().auth.maxNameBytes) or 24) or "",
    version = DZ.VERSION
  })
end

local function spawnList()
  local out = {}
  for i = 1, #DZ.Data.spawns do
    local spawn = DZ.Data.spawns[i]
    out[#out + 1] = { id = spawn.id, name = spawn.name, x = spawn.x, y = spawn.y }
  end
  return out
end

local function sendChar(player, state)
  DZ.UI.send(player, "char", {
    name = state.displayName or state.account or "Выживший",
    spawns = spawnList(),
    skins = cfg().spawn.skins or { 7, 12, 14, 29, 31 },
    savedSkin = state.skin or (cfg().spawn.skins and cfg().spawn.skins[1]) or 29,
    hasProfile = state.hasProfile == true
  })
end

local function profileToState(state, profile)
  if type(profile) ~= "table" then return false end
  state.money = tonumber(profile.money) or (tonumber(cfg().spawn.money) or 500)
  state.kills = math.max(0, math.floor(tonumber(profile.kills) or 0))
  state.deaths = math.max(0, math.floor(tonumber(profile.deaths) or 0))
  state.zombieKills = math.max(0, math.floor(tonumber(profile.zombieKills) or 0))
  state.skin = tonumber(profile.skin) or state.skin
  if type(profile.inv) == "table" then
    state.inv = DZ.Inv.fromData("player", profile.inv)
    local hasItem = false
    for i = 1, DZ.Inv.slotCount(state.inv, catalog()) do
      if state.inv.slots[i] then hasItem = true break end
    end
    if not hasItem then state.needStarter = true end
  end
  if type(profile.stats) == "table" then
    state.stats = DZ.Survival.fromData(profile.stats)
    if state.stats.alive == false or state.stats.health <= 0 then
      state.stats = DZ.Survival.new()
      state.needStarter = true
    end
  end
  state.hasProfile = true
  return true
end

local function guestAuth(player, state)
  state.account = "guest_" .. tostring(state.authId)
  state.displayName = DZ.Util.cleanName(getPlayerName(player), 24) or ("Выживший " .. tostring(state.authId))
  state.logged = true
  state.guest = true
  state.hasProfile = false
  state.needStarter = true
  sendChar(player, state)
end

function P.onJoin(player)
  if P.states[player] then return end
  P.authCounter = P.authCounter + 1
  local state = {
    authId = P.authCounter,
    authDim = 1000 + (P.authCounter % 500),
    account = nil,
    displayName = nil,
    logged = false,
    guest = false,
    uiReady = false,
    spawned = false,
    alive = true,
    dead = false,
    skin = (cfg().spawn.skins and cfg().spawn.skins[1]) or 29,
    inv = DZ.Inv.new("player"),
    stats = DZ.Survival.new(),
    money = tonumber(cfg().spawn.money) or 500,
    kills = 0, deaths = 0, zombieKills = 0,
    baseAccess = {},
    panel = nil,
    dirty = false,
    invulnUntil = 0,
    loginAttempts = 0,
    loginLockedUntil = 0,
    uiWindow = 0, uiCount = 0,
    hitWindow = 0, hitCount = 0,
    noiseWindow = 0, noiseCount = 0,
    hasProfile = false,
    needStarter = true
  }
  P.states[player] = state

  setElementDimension(player, state.authDim)
  setElementFrozen(player, true)
  setElementData(player, "dz:name", DZ.Util.cleanName(getPlayerName(player), 24) or "Выживший")
  setElementData(player, "dz:auth", true)
  DZ.UI.chat(player, "Добро пожаловать. Введите логин и пароль в окне входа.", DZ.UI.HEX.muted)
end

function P.onQuit(player)
  local state = P.states[player]
  if state then
    P.save(player)
    P.states[player] = nil
  end
end

function P.onClientReady(player)
  local state = P.states[player]
  if not state then return end
  state.uiReady = true
  if not state.logged then
    if cfg().auth.enabled == false then
      guestAuth(player, state)
    else
      sendLogin(player)
    end
  elseif not state.spawned then
    sendChar(player, state)
  else
    P.sendWelcome(player)
  end
end

---------------------------------------------------------------------- auth

local function loginFail(player, state, text)
  state.loginAttempts = (state.loginAttempts or 0) + 1
  local max = tonumber(cfg().auth.maxAttempts) or 5
  if state.loginAttempts >= max then
    state.loginAttempts = 0
    state.loginLockedUntil = now() + (tonumber(cfg().auth.lockoutMs) or 30000)
    DZ.UI.error(player, "Слишком много попыток. Подождите " .. tostring(math.floor((tonumber(cfg().auth.lockoutMs) or 30000) / 1000)) .. " с.")
  else
    DZ.UI.error(player, text)
  end
end

function P.login(player, action)
  local state = P.states[player]
  if not state or state.logged then return end
  local current = now()
  if current < (state.loginLockedUntil or 0) then
    DZ.UI.error(player, "Вход временно заблокирован после неудачных попыток.")
    return
  end
  local name = DZ.Util.cleanName(tostring(action.user or ""), tonumber(cfg().auth.maxNameBytes) or 24)
  local password = tostring(action.pass or "")
  if not name then
    DZ.UI.error(player, "Ник: 3–24 символа, без спецсимволов.")
    return
  end
  if #password < (tonumber(cfg().auth.minPassword) or 4) then
    DZ.UI.error(player, "Пароль слишком короткий.")
    return
  end
  if #password > 72 then
    DZ.UI.error(player, "Слишком длинный пароль.")
    return
  end

  local register = action.register == true
  if register then
    if cfg().auth.allowRegister == false then
      DZ.UI.error(player, "Регистрация закрыта.")
      return
    end
    if DZ.DB.getAccount(name) then
      DZ.UI.error(player, "Аккаунт уже существует.")
      return
    end
    if not DZ.DB.register(name, password) then
      DZ.UI.error(player, "Ошибка базы данных. Попробуйте позже.")
      return
    end
  else
    local ok = DZ.DB.verify(name, password)
    if not ok then
      local exists = DZ.DB.getAccount(name)
      loginFail(player, state, exists and "Неверный пароль." or "Аккаунт не найден. Нажмите «Регистрация».")
      return
    end
  end

  state.account = name
  state.displayName = name
  state.logged = true
  state.guest = false
  state.loginAttempts = 0
  state.loginLockedUntil = 0
  setElementData(player, "dz:auth", false)
  local profile = DZ.DB.loadPlayer(name)
  if profile then profileToState(state, profile) end
  DZ.UI.send(player, "loginOk", { name = name })
  sendChar(player, state)
  DZ.UI.log("вход: " .. name .. " (" .. getPlayerSerial(player) .. ")")
end

----------------------------------------------------------------------- spawn

function P.giveStarter(player, state)
  if not state.needStarter then return end
  state.inv = DZ.Inv.new("player")
  DZ.IS.giveStarter(player)
  state.needStarter = false
end

function P.place(player, spawn, skin, isFirst, isRespawn)
  local state = P.states[player]
  if not state or not spawn then return false end
  local ok = spawnPlayer(player, spawn.x, spawn.y, (spawn.z or 20) + 0.7, spawn.rot or 0, skin, 0, 0)
  if ok == false then
    DZ.UI.toast(player, "Не удалось заспавниться, попробуйте другую точку", "warn")
    return false
  end
  setElementDimension(player, 0)
  setElementFrozen(player, false)
  setElementData(player, "dz:auth", false)
  fadeCamera(player, true, 1.0)
  setCameraTarget(player, player)

  state.skin = skin
  state.stats.health = DZ.Util.clamp(tonumber(state.stats.health) or 100, 25, 100)
  setElementHealth(player, state.stats.health)
  setPedArmor(player, 0)
  state.spawned = true
  state.alive = true
  state.dead = false
  state.deathAt = 0
  state.panel = nil
  DZ.IS.takeAllWeapons(player)
  DZ.IS.restoreWeapon(player)

  local invuln = tonumber(cfg().spawn.invulnMs) or 6000
  state.invulnUntil = now() + invuln
  setElementData(player, "dz:invuln", true)
  setTimer(function()
    if isElement(player) then setElementData(player, "dz:invuln", false) end
  end, invuln, 1)

  if isFirst then
    P.sendWelcome(player)
  else
    DZ.UI.send(player, "spawned", { name = state.displayName or state.account })
    P.pushHud(player)
  end
  DZ.UI.chat(player, (isRespawn and "Вы снова в мире. " or "Добро пожаловать в пустошь. ") ..
    "E — взаимодействие, I — инвентарь, M — карта, C — крафт.", DZ.UI.HEX.green)
  state.dirty = true
  P.save(player)
  return true
end

function P.spawnFromChar(player, action)
  local state = P.states[player]
  if not state or not state.logged or state.spawned then return end
  local spawn
  for i = 1, #DZ.Data.spawns do
    if DZ.Data.spawns[i].id == tostring(action.spawn or "") then spawn = DZ.Data.spawns[i] break end
  end
  if not spawn then spawn = DZ.Data.spawns[1] end
  local skin = tonumber(action.skin) or state.skin or 29
  local allowed = false
  local skins = cfg().spawn.skins or {}
  for i = 1, #skins do if tonumber(skins[i]) == skin then allowed = true break end end
  if not allowed then skin = tonumber(skins[1]) or 29 end

  P.giveStarter(player, state)
  if not state.hasProfile then
    state.money = tonumber(cfg().spawn.money) or 500
    state.hasProfile = true
  end
  state.stats.alive = true
  if state.stats.health <= 0 then state.stats.health = 100 end
  P.place(player, spawn, skin, true, false)
end

--------------------------------------------------------------------- welcome

function P.welcomeData(player)
  local state = P.states[player]
  return {
    version = DZ.VERSION,
    items = DZ.Data.itemsForUI(),
    map = DZ.Data.mapForUI(),
    config = {
      pvp = cfg().pvp ~= false,
      safeZones = cfg().safeZones ~= false,
      pickupRange = tonumber(cfg().loot.pickupRange) or 3.5,
      interactRange = tonumber(cfg().loot.interactRange) or 4
    },
    world = {
      fog = tonumber(DZ.Data.world and DZ.Data.world.fogDistance) or nil,
      farClip = tonumber(DZ.Data.world and DZ.Data.world.farClip) or nil
    },
    player = {
      name = state.displayName or state.account,
      money = state.money or 0,
      kills = state.kills or 0,
      deaths = state.deaths or 0,
      skin = state.skin,
      weight = DZ.Inv.weight(state.inv, catalog()),
      capacity = DZ.Inv.capacity(state.inv, catalog())
    }
  }
end

function P.sendWelcome(player)
  DZ.UI.send(player, "welcome", P.welcomeData(player))
  P.pushHud(player)
end

-------------------------------------------------------------------- panels

function P.openPanel(player, panel)
  local state = P.states[player]
  if not state or not state.spawned or not state.alive then return end
  panel = tostring(panel or "")
  if panel == "inventory" then
    state.panel = "inventory"
    DZ.IS.sendPanel(player)
  elseif panel == "map" then
    local data = DZ.Data.mapForUI()
    local x, y, z = getElementPosition(player)
    data.player = { x = x, y = y, z = z }
    state.panel = "map"
    DZ.UI.panel(player, "map", data)
  elseif panel == "craft" then
    DZ.Craft.open(player)
  elseif panel == "help" then
    state.panel = "help"
    DZ.UI.send(player, "help", {})
  end
end

----------------------------------------------------------------------- HUD

function P.weaponHud(player, state)
  local name = state.weaponDef and state.weaponDef.name or "Без оружия"
  local clip, total = 0, 0
  if state.weaponId then
    if getPedAmmoInClip then clip = getPedAmmoInClip(player) or 0 end
    if getPedTotalAmmo then total = getPedTotalAmmo(player) or 0 end
  end
  return { name = name, clip = clip, total = total, icon = state.weaponDef and state.weaponDef.icon or nil }
end

function P.pushHud(player)
  local state = P.states[player]
  if not state or not state.spawned or not state.alive or not isElement(player) then return end
  local x, y, z = getElementPosition(player)
  local stats = state.stats
  local armor = getPedArmor(player) or 0
  local online = 0
  for _, other in pairs(P.states) do
    if other.spawned then online = online + 1 end
  end
  DZ.UI.send(player, "hud", {
    hp = math.floor(getElementHealth(player) or 0),
    armor = math.floor(armor),
    blood = math.floor(stats.blood),
    hunger = math.floor(stats.hunger),
    thirst = math.floor(stats.thirst),
    stamina = math.floor(stats.stamina),
    temp = DZ.Util.round(stats.temperature, 1),
    rad = math.floor(stats.radiation),
    bleed = stats.bleeding,
    infection = math.floor(stats.infection),
    money = state.money or 0,
    kills = state.kills or 0,
    deaths = state.deaths or 0,
    zk = state.zombieKills or 0,
    online = online,
    zombies = DZ.Zombies and DZ.Zombies.count() or 0,
    clock = clockString(),
    safe = isSafePlayer(player),
    zone = DZ.Data.zoneNameAt(x, y),
    base = baseNameAt(x, y, z),
    pos = { x = DZ.Util.roundForNet(x), y = DZ.Util.roundForNet(y), z = DZ.Util.roundForNet(z) },
    survived = math.floor(stats.survived),
    weight = DZ.Inv.weight(state.inv, catalog()),
    capacity = DZ.Inv.capacity(state.inv, catalog()),
    weapon = P.weaponHud(player, state),
    vehicle = DZ.Vehicles and DZ.Vehicles.forHud(player) or nil,
    boss = DZ.Zombies and DZ.Zombies.nearestBoss(player) or nil
  })
  if state.panel == "map" then
    DZ.UI.send(player, "mapPos", {
      x = DZ.Util.roundForNet(x),
      y = DZ.Util.roundForNet(y),
      z = DZ.Util.roundForNet(z)
    })
  end
end

--- Принудительно обновить нативное здоровье и HUD после админских действий.
function P.syncStats(player)
  local state = P.states[player]
  if not state then return end
  if isElement(player) and state.spawned and state.alive then
    setElementHealth(player, DZ.Util.clamp(state.stats.health or 0, 0, 100))
  end
  P.pushHud(player)
end

--- Обновить открытую панель инвентаря и HUD после выдачи/изъятия предметов.
function P.syncInv(player)
  local state = P.states[player]
  if not state then return end
  if state.panel == "inventory" then DZ.IS.sendPanel(player) end
  P.pushHud(player)
end

--- Закрыть любую открытую CEF-панель и сбросить связанные ссылки.
function P.closePanels(player)
  local state = P.states[player]
  if not state then return end
  state.panel = nil
  state.traderId = nil
  state.baseId = nil
  state.openCorpse = nil
  DZ.UI.send(player, "close", {})
end

function P.hudTick()
  for player, state in pairs(P.states) do
    if state.spawned and state.alive then P.pushHud(player) end
  end
end

------------------------------------------------------------------- survival

local function warning(player, code)
  local messages = {
    starving = { "Голод! Съешьте что-нибудь.", "danger" },
    dehydrated = { "Жажда! Найдите воду.", "danger" },
    bleeding = { "Кровотечение. Нужен бинт.", "danger" },
    radiation = { "Радиация! Нужен противогаз или антирад.", "danger" },
    cold = { "Переохлаждение. Найдите укрытие.", "warn" },
    infection = { "Инфекция. Нужны антибиотики.", "danger" }
  }
  local row = messages[code]
  if row then DZ.UI.toast(player, row[1], row[2]) end
end

local function breakArmor(player, state)
  if getPedArmor(player) > 0 then return end
  local entry = DZ.Inv.equipped(state.inv, "armor")
  if not entry then return end
  state.inv.equip.armor = false
  state.dirty = true
  DZ.UI.toast(player, "Броня разрушена", "warn")
end

function P.survivalTick()
  if cfg().survival.enabled == false then return end
  local hour = getTime() or 12
  local night = hour < 6 or hour >= 21
  for player, state in pairs(P.states) do
    if state.spawned and state.alive and isElement(player) and getElementHealth(player) > 0 then
      local vx, vy, vz = getElementVelocity(player)
      local speed = math.sqrt(vx * vx + vy * vy + vz * vz) * 180
      local inVehicle = getPedOccupiedVehicle(player) and true or false
      local moving = speed > 1.5
      local sprinting = speed > 18 and not inVehicle
      local weight = DZ.Inv.weight(state.inv, catalog())
      local capacity = DZ.Inv.capacity(state.inv, catalog())
      local weightRatio = capacity > 0 and (weight / capacity) or 0

      local radiation = 0
      local px, py, pz = getElementPosition(player)
      for i = 1, #DZ.Data.radiationZones do
        local zone = DZ.Data.radiationZones[i]
        if DZ.Util.dist3d(px, py, pz, zone.x, zone.y, zone.z) <= (zone.radius or 60) then
          radiation = math.max(radiation, tonumber(zone.intensity) or 1)
        end
      end
      local inWater = false
      if isElementInWater then
        local ok, result = pcall(isElementInWater, player)
        if ok then inWater = result == true end
      end
      local mask = DZ.Inv.equipped(state.inv, "mask") ~= false

      local mult = tonumber(cfg().survival.hungerDrainMultiplier) or 1
      local result = DZ.Survival.tick(state.stats, {
        moving = moving,
        sprinting = sprinting,
        weightRatio = weightRatio,
        inWater = inWater,
        night = night,
        radiation = radiation,
        mask = mask,
        ambient = 18
      }, 1 * mult, DZ.rng)

      if result.damage and result.damage > 0 then
        local health = getElementHealth(player) or 0
        setElementHealth(player, math.max(0, health - result.damage))
      end
      state.stats.health = getElementHealth(player) or 0
      for i = 1, #(result.events or {}) do warning(player, result.events[i]) end
      breakArmor(player, state)

      if (getElementHealth(player) or 0) <= 0 and state.alive then
        P.finishDeath(player, nil, 0, "Истощение")
      end
    end
  end
end

---------------------------------------------------------------------- damage

function P.onPlayerDamage(attacker, weapon, bodypart, loss)
  local player = source
  local state = P.states[player]
  if not state or not state.spawned or not state.alive then return end

  -- PvP: выключен в конфиге, в безопасных зонах и в первые секунды после спавна.
  if cfg().pvp == false then cancelEvent() return end
  if state.invulnUntil and now() < state.invulnUntil then cancelEvent() return end
  local px, py, pz = getElementPosition(player)
  if P.isSafeAt(px, py, pz) then cancelEvent() return end
  if attacker and isElement(attacker) and getElementType(attacker) == "player" then
    local ax, ay, az = getElementPosition(attacker)
    if P.isSafeAt(ax, ay, az) then cancelEvent() return end
  end

  if tonumber(loss) and tonumber(loss) >= 3 then
    if DZ.rng:chance(tonumber(cfg().survival.bleedingChanceBullet) or DZ.SURVIVAL.BLEED_CHANCE_BULLET) then
      DZ.Survival.addBleeding(state.stats, 1)
      DZ.UI.toast(player, "Кровотечение!", "danger")
    end
  end
  state.stats.health = getElementHealth(player) or state.stats.health
  state.dirty = true
end

function P.finishDeath(player, killer, weapon, causeOverride)
  local state = P.states[player]
  if not state or not state.spawned or not state.alive then return end
  local x, y, z = getElementPosition(player)
  state.alive = false
  state.spawned = false
  state.dead = true
  state.deathAt = now()
  state.stats.alive = false
  state.panel = nil
  state.traderId = nil
  state.baseId = nil
  state.openCorpse = nil
  state.stats.health = getElementHealth(player) or 0

  if killer and isElement(killer) and getElementType(killer) == "player" and killer ~= player then
    local killerState = P.states[killer]
    if killerState then
      killerState.kills = (killerState.kills or 0) + 1
      killerState.dirty = true
    end
  end
  state.deaths = (state.deaths or 0) + 1

  local weaponId = tonumber(weapon) or 0
  local weaponName = DZ.WEAPON_NAMES[weaponId] or (weaponId > 0 and ("оружие #" .. tostring(weaponId))) or "окружение"
  local killerName = nil
  if killer and isElement(killer) and getElementType(killer) == "player" then
    local killerState = P.states[killer]
    killerName = killerState and (killerState.displayName or killerState.account) or getPlayerName(killer)
  end
  local cause = causeOverride
  if not cause then
    if killerName then
      cause = "Убит: " .. tostring(killerName)
    elseif state.lastZombieHitAt and now() - state.lastZombieHitAt < 12000 then
      cause = "Растерзан зомби"
    elseif weaponId > 0 then
      cause = "Погиб: " .. weaponName
    else
      cause = "Несчастный случай"
    end
  end

  DZ.IS.captureAmmo(player)
  DZ.Loot.addCorpse(state, x, y, z)

  local victimName = state.displayName or state.account or "выживший"
  DZ.Inv.clear(state.inv)
  DZ.IS.takeAllWeapons(player)
  setPedArmor(player, 0)
  state.stats.alive = false
  state.dirty = true

  local line
  if killerName then
    line = tostring(killerName) .. " убил " .. tostring(victimName) .. " (" .. weaponName .. ")"
  elseif state.lastZombieHitAt and now() - state.lastZombieHitAt < 12000 then
    line = tostring(victimName) .. " растерзан зомби"
  else
    line = tostring(victimName) .. " погиб (" .. cause .. ")"
  end
  DZ.UI.pushAll("kill", { line = line, killer = killerName, victim = victimName, weapon = weaponName })

  DZ.UI.send(player, "death", {
    killer = killerName,
    weapon = weaponName,
    cause = cause,
    survived = math.floor(state.stats.survived),
    kills = state.kills or 0,
    deaths = state.deaths or 0,
    zk = state.zombieKills or 0,
    respawnDelay = math.floor((tonumber(cfg().spawn.respawnDelayMs) or 8000) / 1000),
    respawns = spawnList()
  })
  P.save(player)
end

function P.onPlayerWasted(a, b, c, d)
  local player = source
  local killer, weapon, bodypart
  -- MTA 1.6: (totalAmmo, killer, killerWeapon, bodypart, ...)
  -- MTA 1.5: (killer, weapon, bodypart, loss)
  if type(a) == "number" then
    killer, weapon, bodypart = isElement(b) and b or nil, c, d
  else
    killer, weapon, bodypart = isElement(a) and a or nil, b, c
  end
  P.finishDeath(player, killer, weapon, nil)
end

function P.respawn(player, action)
  local state = P.states[player]
  if not state or not state.logged or not state.dead then return end
  local delay = tonumber(cfg().spawn.respawnDelayMs) or 8000
  if now() - (state.deathAt or 0) < delay then
    DZ.UI.toast(player, "Рано. Подождите ещё немного.", "warn")
    return
  end
  local spawn
  local wanted = tostring((action and action.spawn) or "")
  for i = 1, #DZ.Data.spawns do
    if DZ.Data.spawns[i].id == wanted then spawn = DZ.Data.spawns[i] break end
  end
  if not spawn then spawn = DZ.Data.spawns[DZ.rng:int(1, #DZ.Data.spawns)] end

  state.stats = DZ.Survival.new()
  state.inv = DZ.Inv.new("player")
  state.needStarter = true
  P.giveStarter(player, state)
  state.dead = false
  state.weaponId = nil
  state.weaponDef = nil
  state.weaponEntry = nil
  P.place(player, spawn, state.skin or 29, false, true)
end

------------------------------------------------------------------------ save

local function profileOf(state, player)
  local profile = {
    skin = state.skin,
    money = state.money or 0,
    kills = state.kills or 0,
    deaths = state.deaths or 0,
    zombieKills = state.zombieKills or 0,
    inv = DZ.Inv.toData(state.inv),
    stats = DZ.Survival.toData(state.stats),
    survived = math.floor(state.stats.survived or 0),
    savedAt = os.time and os.time() or 0
  }
  if state.spawned and isElement(player) then
    local x, y, z = getElementPosition(player)
    profile.pos = { x = DZ.Util.roundForNet(x), y = DZ.Util.roundForNet(y), z = DZ.Util.roundForNet(z) }
    profile.stats.health = getElementHealth(player) or profile.stats.health
  end
  return profile
end

function P.save(player)
  local state = P.states[player]
  if not state or not state.logged or state.guest or not state.account then return end
  if state.weaponId then DZ.IS.captureAmmo(player) end
  DZ.DB.savePlayer(state.account, profileOf(state, player))
  state.dirty = false
end

function P.saveAll()
  local saved = 0
  for player, state in pairs(P.states) do
    if state.logged and not state.guest then
      P.save(player)
      saved = saved + 1
    end
  end
  return saved
end

------------------------------------------------------------------ UI actions

local function handleCorpseAction(player, action)
  if action.op == "open" then
    DZ.Loot.openCorpse(player, action.id)
  elseif action.op == "take" then
    DZ.Loot.takeFromCorpse(player, action.id, action.index, action.count)
  elseif action.op == "takeAll" then
    DZ.Loot.takeAllFromCorpse(player, action.id)
  end
end

local function handleBaseAction(player, action)
  if action.op == "open" then
    DZ.Bases.open(player, action.id)
  else
    DZ.Bases.handle(player, action)
  end
end

local function handleTradeAction(player, action)
  if action.op == "open" then
    DZ.Traders.open(player, action.id)
  else
    DZ.Traders.handle(player, action)
  end
end

function P.handleUI(player, json)
  local state = P.states[player]
  if not state then return end
  if type(json) ~= "string" or #json > DZ.LIMITS.MAX_UI_JSON * 8 then return end
  local action = fromJSON(json)
  if type(action) ~= "table" then return end
  local current = now()
  if current - (state.uiWindow or 0) > 1000 then
    state.uiWindow = current
    state.uiCount = 0
  end
  state.uiCount = (state.uiCount or 0) + 1
  if state.uiCount > DZ.LIMITS.UI_ACTIONS_PER_SEC then return end

  local a = tostring(action.a or "")
  if a == "login" then
    P.login(player, action)
  elseif a == "spawn" then
    P.spawnFromChar(player, action)
  elseif a == "respawn" then
    P.respawn(player, action)
  elseif a == "open" then
    P.openPanel(player, action.panel)
  elseif a == "close" then
    if state.panel == "trade" then state.traderId = nil end
    if state.panel == "base" then state.baseId = nil end
    if state.panel == "corpse" then state.openCorpse = nil end
    state.panel = nil
  elseif a == "inv" then
    DZ.IS.handle(player, action)
  elseif a == "loot" then
    DZ.Loot.pickup(player, action.id)
  elseif a == "corpse" then
    handleCorpseAction(player, action)
  elseif a == "trade" then
    handleTradeAction(player, action)
  elseif a == "base" then
    handleBaseAction(player, action)
  elseif a == "craft" then
    DZ.Craft.handle(player, action)
  elseif a == "suicide" and state.spawned and state.alive then
    setElementHealth(player, 0)
    if state.alive then P.finishDeath(player, nil, 0, "Самоубийство") end
  end
end

function P.bindEvents()
  addEventHandler(DZ.EVENTS.UI, root, function(json)
    local player = client
    if player and getElementType(player) == "player" then
      P.handleUI(player, json)
    end
  end)
  addEventHandler(DZ.EVENTS.CLIENT_READY, root, function()
    local player = client
    if player and getElementType(player) == "player" then P.onClientReady(player) end
  end)
  addEventHandler("onPlayerJoin", root, function()
    P.onJoin(source)
  end)
  addEventHandler("onPlayerQuit", root, function()
    P.onQuit(source)
  end)
  addEventHandler("onPlayerWasted", root, P.onPlayerWasted)
  addEventHandler("onPlayerDamage", root, P.onPlayerDamage)

  -- Резервный вход через чат, если CEF не загрузился.
  addCommandHandler("dzlogin", function(player, _, user, pass)
    P.login(player, { user = tostring(user or ""), pass = tostring(pass or ""), register = false })
  end)
  addCommandHandler("dzreg", function(player, _, user, pass)
    P.login(player, { user = tostring(user or ""), pass = tostring(pass or ""), register = true })
  end)
  addCommandHandler("dzplay", function(player)
    local state = P.states[player]
    if not state or not state.logged or state.spawned then return end
    local spawn = DZ.Data.spawns[DZ.rng:int(1, #DZ.Data.spawns)]
    local skins = cfg().spawn.skins or { 29 }
    P.spawnFromChar(player, { spawn = spawn.id, skin = skins[DZ.rng:int(1, #skins)] })
  end)
  addCommandHandler("dayz", function(player)
    DZ.UI.chat(player, "/dzreg логин пароль — регистрация, /dzlogin логин пароль — вход, /dzplay — спавн", DZ.UI.HEX.gold)
  end)
end

function P.init()
  P.bindEvents()
  for _, player in ipairs(getElementsByType("player")) do
    P.onJoin(player)
  end
  setTimer(P.survivalTick, 1000, 0)
  setTimer(P.hudTick, tonumber(cfg().server.hudMs) or 500, 0)
  setTimer(P.saveAll, tonumber(cfg().server.saveMs) or 90000, 0)
  addEventHandler("onResourceStop", resourceRoot, function()
    P.saveAll()
  end)
  DZ.UI.log("игроки: сервис запущен")
end

return DZ
