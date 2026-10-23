--[[
  mta_mock.lua — минимальная имитация MTA-сервера для тестов в fengari.

  Здесь нет GTA: только элементы, события, маркеры, педы, транспорт, SQLite
  и таймеры — ровно столько, сколько нужно серверным модулям, чтобы пройти
  полный цикл «вход -> спавн -> лут -> торговец -> крафт -> база -> смерть».
]]

MOCK = {
  elements = {},
  players = {},
  handlers = {},
  packets = {},
  logs = {},
  timers = {},
  commands = {},
  nextId = 0
}

local function newElement(kind, x, y, z)
  MOCK.nextId = MOCK.nextId + 1
  local element = {
    __element = true,
    kind = kind,
    id = MOCK.nextId,
    x = x or 0, y = y or 0, z = z or 0,
    data = {},
    dimension = 0,
    health = 100
  }
  MOCK.elements[#MOCK.elements + 1] = element
  if kind == "player" then MOCK.players[#MOCK.players + 1] = element end
  return element
end

MOCK.newElement = newElement

function MOCK.newPlayer(name)
  local player = newElement("player", 0, 0, 3)
  player.name = name or "Tester"
  player.serial = "MOCK-SERIAL"
  player.skin = 7
  player.weapon = 0
  player.ammo = 0
  player.armor = 0
  player.vehicle = nil
  return player
end

function MOCK.log(message)
  MOCK.logs[#MOCK.logs + 1] = tostring(message)
end

----------------------------------------------------------------- elements

function isElement(element)
  return type(element) == "table" and element.__element == true and not element.__dead
end

function getElementType(element)
  if not isElement(element) then return false end
  return element.kind
end

function destroyElement(element)
  if isElement(element) then element.__dead = true end
  return true
end

function getElementPosition(element)
  if not isElement(element) then return 0, 0, 0 end
  return element.x, element.y, element.z
end

function setElementPosition(element, x, y, z)
  if not isElement(element) then return false end
  element.x, element.y, element.z = x, y, z
  return true
end

function getElementRotation(element)
  if not isElement(element) then return 0, 0, 0 end
  return 0, 0, element.rot or 0
end

function setElementRotation(element, rx, ry, rz)
  if isElement(element) then element.rot = rz end
  return true
end

function setElementFrozen(element, frozen)
  if isElement(element) then element.frozen = frozen == true end
  return true
end

function isElementFrozen(element)
  return isElement(element) and element.frozen == true
end

function setElementDimension(element, dimension)
  if isElement(element) then element.dimension = dimension end
  return true
end

function getElementDimension(element)
  return isElement(element) and element.dimension or 0
end

function setElementInterior(element, interior)
  if isElement(element) then element.interior = interior end
  return true
end

function setElementData(element, key, value)
  if not isElement(element) then return false end
  element.data[key] = value
  return true
end

function getElementData(element, key)
  if not isElement(element) then return false end
  return element.data[key]
end

function getElementHealth(element)
  if not isElement(element) then return 0 end
  return element.health or 100
end

function setElementHealth(element, health)
  if not isElement(element) then return false end
  element.health = health
  return true
end

function getElementModel(element)
  return isElement(element) and element.model or 0
end

function getElementVelocity()
  return 0, 0, 0
end

function isElementInWater()
  return false
end

function getElementsByType(kind, startAt)
  local result = {}
  for i = 1, #MOCK.elements do
    local element = MOCK.elements[i]
    if element.kind == kind and not element.__dead then result[#result + 1] = element end
  end
  if startAt then
    local filtered = {}
    for i = 1, #result do
      if result[i] ~= startAt then filtered[#filtered + 1] = result[i] end
    end
    return filtered
  end
  return result
end

--------------------------------------------------------------- ped/player

function getPlayerName(player)
  return isElement(player) and player.name or "?"
end

function getPlayerSerial(player)
  return isElement(player) and player.serial or "?"
end

function getPlayerAccount(player)
  if not isElement(player) then return false end
  return { __element = true, kind = "account", name = player.name }
end

function isGuestAccount(account)
  return account == false or account == nil
end

function getAccountName(account)
  if type(account) ~= "table" then return "" end
  return account.name or ""
end

function aclGetGroup()
  return nil
end

function isObjectInACLGroup()
  return false
end

function setPedArmor(player, armor)
  if isElement(player) then player.armor = armor end
  return true
end

function getPedOccupiedVehicle(ped)
  if not isElement(ped) then return false end
  return ped.vehicle or false
end

function getPedArmor(player)
  return isElement(player) and player.armor or 0
end

function setPedRotation(element, rotation)
  if isElement(element) then element.rot = rotation end
  return true
end

function giveWeapon(player, weapon, ammo, current)
  if not isElement(player) then return false end
  player.weapon = weapon
  player.ammo = ammo or 0
  return true
end

function takeAllWeapons(player)
  if isElement(player) then
    player.weapon = 0
    player.ammo = 0
  end
  return true
end

function getPedWeapon(player)
  return isElement(player) and player.weapon or 0
end

function getPedAmmoInClip(player)
  return isElement(player) and math.floor((player.ammo or 0) / 2) or 0
end

function getPedTotalAmmo(player)
  return isElement(player) and math.floor((player.ammo or 0) / 2) or 0
end

getPlayerAmmoInClip = getPedAmmoInClip
getPlayerTotalAmmo = getPedTotalAmmo

function spawnPlayer(player, x, y, z, rotation, skin, interior, dimension)
  if not isElement(player) then return false end
  player.x, player.y, player.z = x, y, z
  player.rot = rotation or 0
  player.skin = skin or 0
  player.health = 100
  player.dimension = dimension or 0
  player.spawned = true
  return true
end

function fadeCamera() return true end
function setCameraTarget() return true end

function setElementAlpha() return true end

--------------------------------------------------------------- markers

function createMarker(x, y, z, shape, radius, r, g, b, alpha)
  local marker = newElement("marker", x, y, z)
  marker.shape = shape or "cylinder"
  marker.radius = radius or 1
  marker.color = { r or 255, g or 255, b or 255, alpha or 150 }
  return marker
end

function setMarkerColor(marker, r, g, b, a)
  if isElement(marker) then marker.color = { r, g, b, a } end
  return true
end

function createPed(skin, x, y, z, rotation)
  local ped = newElement("ped", x, y, z)
  ped.model = skin
  ped.skin = skin
  ped.rot = rotation or 0
  return ped
end

function createBlip() return newElement("blip") end

---------------------------------------------------------------- vehicles

function createVehicle(model, x, y, z, rx, ry, rz, plate)
  local vehicle = newElement("vehicle", x, y, z)
  vehicle.model = model
  vehicle.rot = rz or 0
  vehicle.plate = plate
  vehicle.engine = true
  vehicle.fuel = nil
  return vehicle
end

function getVehicleOccupant(vehicle, seat)
  if not isElement(vehicle) then return false end
  for i = 1, #MOCK.players do
    if MOCK.players[i].vehicle == vehicle then return MOCK.players[i] end
  end
  return false
end

function getVehicleEngineState(vehicle)
  return isElement(vehicle) and vehicle.engine ~= false or false
end

function setVehicleEngineState(vehicle, state)
  if isElement(vehicle) then vehicle.engine = state == true end
  return true
end

function setVehicleLocked(vehicle, locked)
  if isElement(vehicle) then vehicle.locked = locked == true end
  return true
end

function setVehicleDamageProof(vehicle, proof)
  if isElement(vehicle) then vehicle.damageProof = proof == true end
  return true
end

function fixVehicle(vehicle)
  if isElement(vehicle) then vehicle.health = 1000 end
  return true
end

------------------------------------------------------------------- world

function getTime()
  return 8, 0
end

function setTime() return true end
function setWeather() return true end
function setMinuteDuration() return true end
function setGameSpeed() return true end
function setFarClipDistance() return true end
function setFogDistance() return true end

MOCK.tick = 1000000

-- Виртуальные часы: детерминированно двигаются на 100 мс за вызов.
-- Так кулдауны (бинты, ремонт) проверяются без реальных пауз.
function getTickCount()
  MOCK.tick = MOCK.tick + 100
  return MOCK.tick
end

function getRealTime()
  return { timestamp = os.time and os.time() or 0, hour = 8, minute = 0, second = 0 }
end

------------------------------------------------------------------ events

function addEvent(name, remote)
  MOCK.handlers[name] = MOCK.handlers[name] or {}
  return true
end

function removeEvent() return true end

function addEventHandler(name, element, handler)
  MOCK.handlers[name] = MOCK.handlers[name] or {}
  table.insert(MOCK.handlers[name], handler)
  return true
end

function removeEventHandler() return true end

function triggerEvent(name, sourceElement, ...)
  _G.source = sourceElement
  local handlers = MOCK.handlers[name] or {}
  for i = 1, #handlers do
    handlers[i](...)
  end
  return true
end

--- Событие «от клиента»: MTA выставляет и source, и неявный client.
function MOCK.triggerRemote(name, player, ...)
  _G.client = player
  local result = triggerEvent(name, player, ...)
  _G.client = nil
  return result
end

function triggerClientEvent(target, name, sourceElement, ...)
  MOCK.packets[#MOCK.packets + 1] = { target = target, name = name, source = sourceElement, args = { ... } }
  return true
end

function triggerServerEvent() return true end

MOCK.cancelled = false
function cancelEvent() MOCK.cancelled = true end

function addCommandHandler(name, handler)
  MOCK.commands[name] = handler
end

function outputChatBox() return true end

function hasObjectPermissionTo(player, right, default)
  return MOCK.allowAdmin == true
end

function kickPlayer(player, by, reason)
  player.kicked = reason
  return true
end

function outputServerLog(message)
  MOCK.log(message)
end

function outputDebugString(message)
  MOCK.log(message)
end

----------------------------------------------------------------- timers

function setTimer(callback, interval, times, ...)
  local timer = { __timer = true, callback = callback, interval = interval or 1000, times = times or 1, args = { ... }, alive = true }
  MOCK.timers[#MOCK.timers + 1] = timer
  return timer
end

function killTimer(timer)
  if type(timer) == "table" then timer.alive = false end
  return true
end

function isTimer(timer)
  return type(timer) == "table" and timer.__timer == true
end

function setElementTimer() return true end

------------------------------------------------------------------- files

function fileOpen(filePath)
  local file = newElement("file")
  file.path = filePath
  return file
end

function fileGetSize() return 1 end
function fileClose() return true end
function fileRead(file) return file and file.path or "" end

------------------------------------------------------------------- mysql

-- Простейшая in-memory SQLite: достаточно для проверки SQL-запросов ресурса.
MOCK.db = { accounts = {}, players = {}, bases = {} }

function dbConnect(dbType, host)
  local connection = newElement("db")
  connection.dbType = dbType
  connection.host = host
  return connection
end

local function lower(value)
  return type(value) == "string" and value:lower() or value
end

function dbQuery(connection, query, ...)
  local args = { ... }
  local handle = newElement("query")
  local q = tostring(query):lower()
  handle.rows = {}
  if q:find("from accounts", 1, true) then
    local row = MOCK.db.accounts[lower(args[1])]
    if row then handle.rows = { { name = row.name, salt = row.salt, hash = row.hash } } end
  elseif q:find("from players", 1, true) then
    local row = MOCK.db.players[lower(args[1])]
    if row then handle.rows = { { data = row.data } } end
  elseif q:find("from bases", 1, true) then
    local list = {}
    for _, row in pairs(MOCK.db.bases) do
      list[#list + 1] = { id = row.id, owner = row.owner, code = row.code, stash = row.stash }
    end
    table.sort(list, function(a, b) return tostring(a.id) < tostring(b.id) end)
    handle.rows = list
  end
  return handle
end

function dbPoll(handle)
  return handle and handle.rows or {}
end

function dbFree() return true end

function dbExec(connection, query, ...)
  local args = { ... }
  local q = tostring(query):lower()
  if q:find("into accounts", 1, true) then
    MOCK.db.accounts[lower(args[1])] = { name = args[1], salt = args[2], hash = args[3], created = args[4] }
  elseif q:find("into players", 1, true) then
    MOCK.db.players[lower(args[1])] = { name = args[1], data = args[2], updated = args[3] }
  elseif q:find("into bases", 1, true) then
    MOCK.db.bases[args[1]] = { id = args[1], owner = args[2], code = args[3], stash = args[4], updated = args[5] }
  end
  return true
end

function dbPrepareString(connection, query)
  return query
end

--- Детерминированный 64-символьный хеш (для тестов хватает, не для продакшена).
function hash(algorithm, data)
  data = tostring(data)
  local h1, h2 = 5381, 52711
  local mod = 4294967296
  for i = 1, #data do
    local byte = data:byte(i)
    h1 = (h1 * 33 + byte) % mod
    h2 = (h2 * 31 + byte) % mod
  end
  local parts = {}
  for i = 1, 16 do
    h1 = (h1 * 33 + i * 7) % mod
    h2 = (h2 * 31 + i * 13) % mod
    parts[i] = string.format("%04x", (h1 + h2) % 65536)
  end
  return table.concat(parts)
end

-------------------------------------------------------------------- json

local function escapeJson(text)
  local map = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
  return '"' .. text:gsub('[%z\1-\31"\\]', function(char)
    return map[char] or string.format("\\u%04x", char:byte())
  end) .. '"'
end

local function isArray(value)
  local count, max = 0, 0
  for key in pairs(value) do
    if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then return false end
    count = count + 1
    if key > max then max = key end
  end
  return count > 0 and count == max, max
end

local function encodeJson(value)
  local kind = type(value)
  if value == nil then return "null" end
  if kind == "boolean" then return value and "true" or "false" end
  if kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge then return "0" end
    return tostring(value)
  end
  if kind == "string" then return escapeJson(value) end
  if kind ~= "table" then return "null" end

  local array, length = isArray(value)
  if array then
    local parts = {}
    for i = 1, length do parts[i] = encodeJson(value[i]) end
    return "[" .. table.concat(parts, ",") .. "]"
  end

  local keys = {}
  for key in pairs(value) do
    if type(key) == "string" or type(key) == "number" then keys[#keys + 1] = tostring(key) end
  end
  table.sort(keys)
  local parts = {}
  for i = 1, #keys do
    parts[i] = escapeJson(keys[i]) .. ":" .. encodeJson(value[keys[i]])
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

function toJSON(value)
  return encodeJson(value)
end

local function decodeError(text, position)
  error("JSON: ошибка на позиции " .. tostring(position) .. ": " .. text:sub(position, position + 20), 0)
end

local function skipSpace(text, position)
  local _, finish = text:find("^[ \t\r\n]*", position)
  return (finish or position - 1) + 1
end

local decodeValue

local function decodeString(text, position)
  local out = {}
  position = position + 1
  while true do
    local char = text:sub(position, position)
    if char == "" then decodeError(text, position) end
    if char == '"' then return table.concat(out), position + 1 end
    if char == "\\" then
      local nextChar = text:sub(position + 1, position + 1)
      local simple = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
      if simple[nextChar] then
        out[#out + 1] = simple[nextChar]
        position = position + 2
      elseif nextChar == "u" then
        local hex = text:sub(position + 2, position + 5)
        local code = tonumber(hex, 16) or 63
        if code < 128 then
          out[#out + 1] = string.char(code)
        else
          -- UTF-8 для BMP (суррогаты в данных ресурса не встречаются)
          local first = 0xC0 + math.floor(code / 0x40)
          local second = 0x80 + (code % 0x40)
          out[#out + 1] = string.char(first, second)
        end
        position = position + 6
      else
        decodeError(text, position)
      end
    else
      out[#out + 1] = char
      position = position + 1
    end
  end
end

local function decodeNumber(text, position)
  local literal = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", position)
  if not literal or literal == "" then decodeError(text, position) end
  return tonumber(literal) or 0, position + #literal
end

decodeValue = function(text, position)
  position = skipSpace(text, position)
  local char = text:sub(position, position)
  if char == "{" then
    local result = {}
    position = skipSpace(text, position + 1)
    if text:sub(position, position) == "}" then return result, position + 1 end
    while true do
      local key
      key, position = decodeString(text, position)
      position = skipSpace(text, position)
      if text:sub(position, position) ~= ":" then decodeError(text, position) end
      local value
      value, position = decodeValue(text, position + 1)
      result[key] = value
      position = skipSpace(text, position)
      local sep = text:sub(position, position)
      if sep == "}" then return result, position + 1 end
      if sep ~= "," then decodeError(text, position) end
      position = skipSpace(text, position + 1)
    end
  elseif char == "[" then
    local result = {}
    position = skipSpace(text, position + 1)
    if text:sub(position, position) == "]" then return result, position + 1 end
    while true do
      local value
      value, position = decodeValue(text, position)
      result[#result + 1] = value
      position = skipSpace(text, position)
      local sep = text:sub(position, position)
      if sep == "]" then return result, position + 1 end
      if sep ~= "," then decodeError(text, position) end
      position = skipSpace(text, position + 1)
    end
  elseif char == '"' then
    return decodeString(text, position)
  elseif text:sub(position, position + 3) == "true" then
    return true, position + 4
  elseif text:sub(position, position + 4) == "false" then
    return false, position + 5
  elseif text:sub(position, position + 3) == "null" then
    return nil, position + 4
  end
  return decodeNumber(text, position)
end

function fromJSON(text)
  if type(text) ~= "string" or text == "" then return nil end
  if MOCK_JSON and MOCK_JSON[text] then return MOCK_JSON[text] end
  local ok, value = pcall(function()
    local parsed, position = decodeValue(text, 1)
    position = skipSpace(text, position)
    if position <= #text then error("лишние данные", 0) end
    return parsed
  end)
  if not ok then return nil end
  return value
end

function encodeJSON(value)
  return toJSON(value)
end

function decodeJSON(text)
  return fromJSON(text)
end

------------------------------------------------------------------- root

root = newElement("root")
resourceRoot = newElement("resource")
resource = { name = "gold_dayz" }
