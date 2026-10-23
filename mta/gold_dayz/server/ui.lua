--[[ server/ui.lua — единая точка общения сервера с CEF и чатом. ]]

DZ = DZ or {}
local DZ = DZ
DZ.UI = DZ.UI or {}
local UI = DZ.UI

UI.HEX = {
  gold = "#c9a24b",
  green = "#94b36a",
  red = "#be4634",
  white = "#e1e6d7",
  muted = "#8a937c",
  blue = "#6d9bb5",
  orange = "#cf7a3e"
}

local function encode(payload)
  local ok, json = pcall(toJSON, payload)
  if not ok or not json then
    outputServerLog("[GOLD DAYZ] UI: не удалось сериализовать payload")
    return nil
  end
  return json
end

--- Отправить CEF-панели пакет { t = type, d = data }.
function UI.send(player, kind, data)
  if not isElement(player) or getElementType(player) ~= "player" then return false end
  local json = encode({ t = kind, d = data or {} })
  if not json then return false end
  triggerClientEvent(player, DZ.EVENTS.UI_PUSH, player, json)
  return true
end

function UI.toast(player, text, kind)
  if not isElement(player) then return end
  UI.send(player, "toast", { text = DZ.Util.cleanText(text, 180), kind = kind or "info" })
end

function UI.panel(player, panel, data)
  UI.send(player, "panel", { panel = panel, data = data or {} })
end

function UI.close(player, panel)
  UI.send(player, "close", { panel = panel })
end

function UI.error(player, text)
  UI.send(player, "loginError", { text = DZ.Util.cleanText(text, 160) })
end

function UI.chat(player, text, color)
  local line = (UI.HEX.gold .. DZ.TAG .. " " .. (color or UI.HEX.white) .. tostring(text))
  outputChatBox(line, player, 255, 255, 255, true)
end

function UI.broadcast(text, color)
  local line = (UI.HEX.gold .. DZ.TAG .. " " .. (color or UI.HEX.white) .. tostring(text))
  outputChatBox(line, root, 255, 255, 255, true)
end

function UI.killfeed(lines)
  local json = encode({ t = "killfeed", d = { lines = lines } })
  if not json then return end
  triggerClientEvent(root, DZ.EVENTS.UI_PUSH, root, json)
end

--- Публичное событие для всех (killfeed, атака босса и т.п.).
function UI.pushAll(kind, data)
  local json = encode({ t = kind, d = data or {} })
  if not json then return end
  triggerClientEvent(root, DZ.EVENTS.UI_PUSH, root, json)
end

function UI.log(message)
  if DZ.Data and DZ.Data.config and DZ.Data.config.logging == false then return end
  outputServerLog("[GOLD DAYZ] " .. tostring(message))
end

return DZ
