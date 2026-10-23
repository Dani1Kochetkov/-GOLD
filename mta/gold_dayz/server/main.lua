--[[
  server/main.lua — точка входа ресурса.

  Порядок инициализации важен: сначала БД и данные, потом сервисы, которые
  на них опираются. Любая ошибка на старте останавливает ресурс с понятным
  сообщением, чтобы не запускать сервер с полупустыми таблицами.
]]

DZ = DZ or {}
local DZ = DZ

local function fatal(message)
  outputServerLog("[GOLD DAYZ] ОСТАНОВ: " .. tostring(message))
  outputChatBox("#c9a24b[GOLD DAYZ] #be4634Ошибка запуска: " .. tostring(message), root, 255, 255, 255, true)
  return false
end

local function setWorld()
  local world = DZ.Data.world or {}
  local server = (DZ.Data.config and DZ.Data.config.server) or {}
  local hour = tonumber(world.hour) or tonumber(server.hour) or 8
  local minute = tonumber(world.minute) or tonumber(server.minute) or 0
  local weather = tonumber(world.weather) or tonumber(server.weather)
  setTime(hour, minute)
  if weather and setWeather then setWeather(weather) end
  if setMinuteDuration then
    local duration = tonumber(world.minuteDurationMs) or 120000
    setMinuteDuration(duration)
  end
end

function DZ.start()
  DZ.rng = DZ.Rng.new(tonumber(getTickCount()) or os.time())
  if not DZ.DB.init() then return fatal("не удалось открыть базу данных gold_dayz.db") end
  if not DZ.Data.load() then return fatal("данные не загружены") end
  setWorld()

  DZ.registerEvents()
  DZ.Zombies.bindEvents()
  DZ.UI.log("GOLD DAYZ " .. tostring(DZ.VERSION) .. " — запуск")

  if DZ.Data.config.bases.enabled ~= false then DZ.Bases.init() end
  if DZ.Data.config.traders.enabled ~= false then DZ.Traders.init() end
  if DZ.Data.config.vehicles.enabled ~= false then DZ.Vehicles.init() end
  DZ.Loot.initZones()
  DZ.Zombies.init()
  DZ.Players.init()

  DZ.UI.log(("готово: предметов %d, зон %d, зомби %d, машин %d, баз %d")
    :format(#DZ.Data.itemsList, #DZ.Data.lootZones, DZ.Zombies.count(),
      DZ.Util.count(DZ.Vehicles.byVehicle), DZ.Util.count(DZ.Bases.byId)))
  return true
end

addEventHandler("onResourceStart", resourceRoot, function()
  local ok, err = pcall(DZ.start)
  if not ok then
    fatal(err)
    outputDebugString("[GOLD DAYZ] " .. tostring(err), 1)
  end
end)

addEventHandler("onResourceStop", resourceRoot, function()
  if DZ.Players then DZ.Players.saveAll() end
  if DZ.Bases then DZ.DB.saveAll(DZ.Bases.byId) end
  outputServerLog("[GOLD DAYZ] ресурс остановлен, прогресс сохранён")
end)

return DZ
