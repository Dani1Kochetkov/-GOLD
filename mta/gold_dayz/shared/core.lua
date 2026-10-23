--[[
  GOLD DAYZ for Multi Theft Auto: San Andreas
  shared/core.lua — базовые константы, утилиты, RNG и протокол.

  Файл не вызывает серверные/клиентские функции MTA на этапе загрузки
  (кроме DZ.registerEvents, которая вызывается осознанно), поэтому его
  можно прогонять в обычном Lua/fengari — на этом построены тесты.
]]

DZ = DZ or {}
local DZ = DZ

DZ.VERSION = "1.0.0"
DZ.NAME = "GOLD DAYZ"
DZ.TAG = "[GOLD]"

--------------------------------------------------------------------- events

DZ.EVENTS = {
  -- server -> client
  UI_PUSH      = "dz:uiPush",
  ZOMBIES      = "dz:zombies",
  ZOMBIE_DEAD  = "dz:zombieDead",
  ZOMBIE_HIT   = "dz:zombieHit",
  ZOMBIE_BITE  = "dz:zombieBite",
  LOOT_SOUND   = "dz:lootSound",
  -- client -> server
  UI           = "dz:ui",
  CLIENT_READY = "dz:clientReady",
  ZOMBIE_DAMAGE= "dz:zombieDamage",
  NOISE        = "dz:noise"
}

--- Регистрирует все сетевые события на текущей стороне (server или client).
function DZ.registerEvents()
  if not addEvent then return end
  for _, name in pairs(DZ.EVENTS) do
    addEvent(name, true)
  end
end

--------------------------------------------------------------------- colors

-- Цвета для outputChatBox / dxDrawText (R, G, B).
DZ.COLORS = {
  gold    = { 201, 162, 75 },
  green   = { 148, 179, 106 },
  red     = { 190, 70, 52 },
  blue    = { 109, 155, 181 },
  purple  = { 154, 122, 184 },
  white   = { 225, 230, 215 },
  muted   = { 138, 147, 124 },
  orange  = { 207, 122, 62 },
  dark    = { 12, 15, 11 }
}

DZ.RARITY = {
  common    = { name = "Обычный",      color = { 158, 160, 145 }, hex = "#9ea091" },
  uncommon  = { name = "Необычный",    color = { 122, 168, 96  }, hex = "#7aa860" },
  rare      = { name = "Редкий",       color = { 96, 150, 196  }, hex = "#6096c4" },
  epic      = { name = "Эпический",    color = { 160, 116, 200 }, hex = "#a074c8" },
  legendary = { name = "Легендарный",  color = { 214, 164, 62  }, hex = "#d6a43e" }
}

DZ.RARITY_ORDER = { "common", "uncommon", "rare", "epic", "legendary" }

------------------------------------------------------------------- inventory

DZ.ITEM_SLOTS = { "weapon", "backpack", "armor", "mask" }

DZ.SLOT_LABELS = {
  weapon   = "Оружие",
  backpack = "Рюкзак",
  armor    = "Броня",
  mask     = "Маска"
}

DZ.INVENTORY = {
  BASE_SLOTS = 18,
  MAX_SLOTS = 60,
  BASE_CAPACITY = 30,   -- кг
  MAX_STACK = 200
}

-------------------------------------------------------------------- survival

-- Темпы указаны за игровую секунду.
DZ.SURVIVAL = {
  MAX_HEALTH = 100,
  MAX_BLOOD = 100,
  MAX_HUNGER = 100,
  MAX_THIRST = 100,
  MAX_STAMINA = 100,
  MAX_RADIATION = 100,
  NORMAL_TEMP = 36.6,

  HUNGER_DRAIN = 0.030,
  THIRST_DRAIN = 0.045,
  STARVE_DPS = 0.55,
  DEHYDRATE_DPS = 0.80,
  BLEED_BLOOD_DPS = 2.2,
  BLOOD_REGEN = 0.25,
  BLEED_DPS = 0.90,
  RAD_GAIN_DPS = 4.0,
  RAD_DPS = 0.65,
  COLD_DPS = 0.40,
  INFECTION_DPS = 0.45,
  STAMINA_SPRINT_DRAIN = 7.0,
  STAMINA_REGEN = 7.5,
  STAMINA_MOVE_REGEN = 1.5,
  OVERWEIGHT_STAMINA_CAP = 35,
  BLEED_MAX = 3,

  BLEED_CHANCE_ZOMBIE = 0.38,
  BLEED_CHANCE_BULLET = 0.22,
  INFECT_CHANCE_ZOMBIE = 0.10
}

---------------------------------------------------------------------- combat

-- Урон по зомби на один «контакт» (onClientPedDamage может сработать чаще,
-- поэтому значения ниже, чем в GTA-таблицах оружия).
DZ.WEAPON_DAMAGE = {
  [0] = 9,     -- кулаки
  [1] = 14,    -- кастет
  [4] = 30,    -- нож
  [5] = 22,    -- бейсбольная бита
  [6] = 24,    -- лопата
  [7] = 18,    -- кий
  [8] = 40,    -- катана
  [9] = 55,    -- бензопила
  [16] = 130,  -- граната
  [18] = 65,   -- коктейль Молотова
  [22] = 27,   -- пистолет
  [23] = 24,   -- пистолет с глушителем
  [24] = 46,   -- Desert Eagle
  [25] = 38,   -- дробовик
  [26] = 42,   -- обрез
  [27] = 40,   -- боевой дробовик
  [28] = 14,   -- Micro SMG
  [29] = 18,   -- MP5
  [30] = 27,   -- AK-47
  [31] = 25,   -- M4
  [32] = 14,   -- Tec-9
  [33] = 44,   -- охотничья винтовка
  [34] = 85,   -- снайперская винтовка
  [35] = 180,  -- RPG
  [36] = 180,  -- Heat-seeking RPG
  [37] = 7,    -- огнемёт
  [38] = 20,   -- миниган
  [39] = 180,  -- взрывчатка
  [43] = 1     -- фотоаппарат
}

DZ.WEAPON_NAMES = {
  [0] = "кулаки", [1] = "кастет", [2] = "клюшка", [3] = "кочерга",
  [4] = "нож", [5] = "бита", [6] = "лопата", [7] = "кий", [8] = "катана",
  [9] = "бензопила", [15] = "цветы", [16] = "граната", [17] = "слезоточивый газ",
  [18] = "коктейль Молотова", [22] = "пистолет", [23] = "пистолет с глушителем",
  [24] = "Desert Eagle", [25] = "дробовик", [26] = "обрез", [27] = "боевой дробовик",
  [28] = "Micro SMG", [29] = "MP5", [30] = "AK-47", [31] = "M4", [32] = "Tec-9",
  [33] = "винтовка", [34] = "снайперская винтовка", [35] = "RPG",
  [36] = "RPG с самонаведением", [37] = "огнемёт", [38] = "миниган",
  [39] = "взрывчатка", [41] = "баллончик", [42] = "огнетушитель",
  [43] = "фотоаппарат", [44] = "ПНВ", [45] = "тепловизор", [46] = "парашют"
}

DZ.HEADSHOT_MULTIPLIER = 2.35
DZ.LIMB_MULTIPLIER = 0.80

----------------------------------------------------------------- network/limits

DZ.LIMITS = {
  ZOMBIE_HITS_PER_SEC = 12,
  NOISE_PER_SEC = 10,
  UI_ACTIONS_PER_SEC = 10,
  MAX_UI_JSON = 4096,
  MAX_GROUND_ITEMS = 400,
  ZOMBIE_SNAPSHOT_RADIUS = 280,
  ZOMBIE_SNAPSHOT_MS = 200,
  ZOMBIE_DESPAWN_DISTANCE = 420,
  SAFE_DAMAGE_CANCEL = true
}

----------------------------------------------------------------------- utils

DZ.Util = {}

function DZ.Util.clamp(value, min, max)
  if value < min then return min end
  if value > max then return max end
  return value
end

function DZ.Util.round(value, decimals)
  local mult = 10 ^ (decimals or 0)
  return math.floor(value * mult + 0.5) / mult
end

function DZ.Util.lerp(a, b, t)
  return a + (b - a) * t
end

function DZ.Util.dist2d(x1, y1, x2, y2)
  local dx, dy = x2 - x1, y2 - y1
  return math.sqrt(dx * dx + dy * dy)
end

function DZ.Util.dist3d(x1, y1, z1, x2, y2, z2)
  local dx, dy, dz = x2 - x1, y2 - y1, z2 - z1
  return math.sqrt(dx * dx + dy * dy + dz * dz)
end

function DZ.Util.atan2(y, x)
  if math.atan2 then return math.atan2(y, x) end
  if x > 0 then
    return math.atan(y / x)
  elseif x < 0 and y >= 0 then
    return math.atan(y / x) + math.pi
  elseif x < 0 and y < 0 then
    return math.atan(y / x) - math.pi
  elseif x == 0 and y > 0 then
    return math.pi / 2
  elseif x == 0 and y < 0 then
    return -math.pi / 2
  end
  return 0
end

--- Угол поворота (0 = север, по часовой стрелке), как в GTA.
function DZ.Util.angleTo(x1, y1, x2, y2)
  local deg = math.deg(DZ.Util.atan2(x2 - x1, y2 - y1))
  return (deg + 360) % 360
end

function DZ.Util.roundForNet(value)
  return math.floor(value * 100 + 0.5) / 100
end

--- Длина строки в байтах не должна превышать max; обрезать по UTF-8 нельзя,
--- поэтому просто отказываем слишком длинным строкам.
function DZ.Util.cleanName(name, maxBytes)
  if type(name) ~= "string" then return nil end
  name = name:gsub("[%c<>\"'&]", "")
  name = name:gsub("^%s+", ""):gsub("%s+$", "")
  name = name:gsub("%s+", " ")
  if #name < 3 or #name > (maxBytes or 24) then return nil end
  return name
end

function DZ.Util.cleanText(text, maxLen)
  if type(text) ~= "string" then return "" end
  text = text:gsub("[%c]", " "):gsub("%s+", " ")
  if #text > (maxLen or 140) then text = text:sub(1, maxLen or 140) end
  return text
end

function DZ.Util.count(tbl)
  local n = 0
  for _ in pairs(tbl) do n = n + 1 end
  return n
end

function DZ.Util.timeString(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  local h = math.floor(seconds / 3600)
  local m = math.floor((seconds % 3600) / 60)
  local s = seconds % 60
  if h > 0 then return string.format("%d ч %02d мин", h, m) end
  if m > 0 then return string.format("%d мин %02d с", m, s) end
  return string.format("%d с", s)
end

function DZ.Util.deepCopy(value)
  if type(value) ~= "table" then return value end
  local copy = {}
  for k, v in pairs(value) do copy[k] = DZ.Util.deepCopy(v) end
  return copy
end

------------------------------------------------------------------------- rng

--- Детерминированный LCG (как в classic MTA-скриптах), чтобы лут можно было
--- воспроизводить в тестах. Один экземпляр на сервер.
DZ.Rng = {}
DZ.Rng.__index = DZ.Rng

function DZ.Rng.new(seed)
  local self = setmetatable({}, DZ.Rng)
  self.state = math.floor(tonumber(seed) or 1) % 2147483647
  if self.state <= 0 then self.state = 1 end
  return self
end

function DZ.Rng:next()
  self.state = (self.state * 16807) % 2147483647
  return self.state / 2147483647
end

function DZ.Rng:int(min, max)
  min, max = math.floor(min or 1), math.floor(max or 1)
  if max < min then min, max = max, min end
  return min + math.floor(self:next() * (max - min + 1))
end

function DZ.Rng:float(min, max)
  return min + self:next() * (max - min)
end

function DZ.Rng:chance(probability)
  return self:next() < (probability or 0)
end

function DZ.Rng:pick(list)
  if not list or #list == 0 then return nil end
  return list[self:int(1, #list)]
end

--- entries: { {weight=10, ...}, ... }; возвращает выбранную запись.
function DZ.Rng:weighted(entries)
  local total = 0
  for i = 1, #entries do total = total + (tonumber(entries[i].weight) or 0) end
  if total <= 0 then return nil end
  local roll = self:next() * total
  local acc = 0
  for i = 1, #entries do
    acc = acc + (tonumber(entries[i].weight) or 0)
    if roll <= acc then return entries[i], i end
  end
  return entries[#entries], #entries
end

------------------------------------------------------------------------ types

function DZ.Util.isNumber(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

function DZ.Util.pointDistance(ax, ay, az, bx, by, bz)
  return DZ.Util.dist3d(ax, ay, az, bx, by, bz)
end

return DZ
