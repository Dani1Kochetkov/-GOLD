--[[ server/vehicles.lua — транспорт: спавн, топливо, ремонт, респавн. ]]

DZ = DZ or {}
local DZ = DZ
DZ.Vehicles = DZ.Vehicles or {}
local V = DZ.Vehicles

V.byVehicle = V.byVehicle or {}

local function cfg()
  return DZ.Data.config.vehicles
end

local function fuelMax()
  return tonumber(cfg().fuelMax) or 100
end

local function spawnAt(spot)
  if not spot or type(spot.models) ~= "table" or #spot.models == 0 then return nil end
  local model = spot.models[DZ.rng:int(1, #spot.models)]
  local vehicle = createVehicle(model, spot.x, spot.y, (spot.z or 20) + 0.8, 0, 0, spot.rot or 0, "GOLD")
  if not vehicle then
    DZ.UI.log("не удалось создать транспорт " .. tostring(model) .. " в " .. tostring(spot.id))
    return nil
  end
  setElementData(vehicle, "dz:fuel", fuelMax())
  setElementData(vehicle, "dz:spawnId", spot.id)
  setElementData(vehicle, "dz:model", model)
  setVehicleLocked(vehicle, false)
  setVehicleDamageProof(vehicle, false)
  V.byVehicle[vehicle] = { spot = spot, fuel = fuelMax(), emptyWarned = false }
  return vehicle
end

function V.init()
  if not DZ.rng then DZ.rng = DZ.Rng.new(getTickCount()) end
  for i = 1, #DZ.Data.vehicleSpawns do
    spawnAt(DZ.Data.vehicleSpawns[i])
  end
  setTimer(V.fuelTick, 5000, 0)
  addEventHandler("onVehicleExplode", root, V.onExplode)
  DZ.UI.log("транспорт: " .. tostring(DZ.Util.count(V.byVehicle)))
end

function V.onExplode()
  local vehicle = source
  local record = V.byVehicle[vehicle]
  if not record then return end
  local spot = record.spot
  V.byVehicle[vehicle] = nil
  local respawn = tonumber(spot.respawn) or tonumber(cfg().respawnMs) or 90000
  setTimer(function()
    if isElement(vehicle) then destroyElement(vehicle) end
    spawnAt(spot)
  end, respawn, 1)
end

function V.fuelTick()
  local maxFuel = fuelMax()
  for vehicle, record in pairs(V.byVehicle) do
    if isElement(vehicle) then
      local fuel = tonumber(getElementData(vehicle, "dz:fuel")) or record.fuel or maxFuel
      local driver = getVehicleOccupant(vehicle, 0)
      if driver and getElementHealth(driver) > 0 and getVehicleEngineState(vehicle) then
        local vx, vy, vz = getElementVelocity(vehicle)
        local speed = math.sqrt(vx * vx + vy * vy + vz * vz) * 180
        local drain = (tonumber(cfg().fuelDrainPerSec) or 0.02) * 5
        drain = drain + speed * (tonumber(cfg().fuelDrainSpeedFactor) or 0.0014) * 5
        fuel = math.max(0, fuel - drain)
        setElementData(vehicle, "dz:fuel", fuel)
        record.fuel = fuel
        if fuel <= 0 and not record.emptyWarned then
          record.emptyWarned = true
          setVehicleEngineState(vehicle, false)
          DZ.UI.toast(driver, "Топливо закончилось. Нужна канистра.", "warn")
        end
      elseif fuel > 0 then
        record.emptyWarned = false
      end
      record.fuel = fuel
    else
      V.byVehicle[vehicle] = nil
    end
  end
end

function V.nearest(player, range)
  if not isElement(player) then return nil end
  local x, y, z = getElementPosition(player)
  local best, bestDist = nil, nil
  for vehicle in pairs(V.byVehicle) do
    if isElement(vehicle) then
      local vx, vy, vz = getElementPosition(vehicle)
      local distance = DZ.Util.dist3d(x, y, z, vx, vy, vz)
      if distance <= (range or 8) and (not bestDist or distance < bestDist) then
        best, bestDist = vehicle, distance
      end
    end
  end
  return best, bestDist
end

function V.forHud(player)
  local vehicle = getPedOccupiedVehicle(player)
  if not vehicle or not isElement(vehicle) then return nil end
  local fuel = tonumber(getElementData(vehicle, "dz:fuel")) or 0
  local vx, vy, vz = getElementVelocity(vehicle)
  local speed = math.sqrt(vx * vx + vy * vy + vz * vz) * 180
  return {
    fuel = math.floor(fuel),
    maxFuel = fuelMax(),
    speed = math.floor(speed),
    engine = getVehicleEngineState(vehicle) and true or false
  }
end

function V.toggleEngine(player)
  local vehicle = getPedOccupiedVehicle(player)
  if not vehicle then
    DZ.UI.toast(player, "Вы не в машине", "warn")
    return
  end
  if getVehicleOccupant(vehicle, 0) ~= player then
    DZ.UI.toast(player, "Только водитель заводит двигатель", "warn")
    return
  end
  local fuel = tonumber(getElementData(vehicle, "dz:fuel")) or 0
  if fuel <= 0 then
    DZ.UI.toast(player, "Нет топлива", "warn")
    return
  end
  local state = not getVehicleEngineState(vehicle)
  setVehicleEngineState(vehicle, state)
  DZ.UI.toast(player, state and "Двигатель запущен" or "Двигатель заглушён", "info")
end

function V.addFuel(vehicle, amount)
  if not isElement(vehicle) then return end
  local fuel = tonumber(getElementData(vehicle, "dz:fuel")) or 0
  local maxFuel = fuelMax()
  setElementData(vehicle, "dz:fuel", math.min(maxFuel, fuel + (tonumber(amount) or 0)))
end

return DZ
