--[[
  client/ui.lua — CEF-мост: браузер, ввод, показ панелей.

  Браузер создаётся один раз на весь сеанс. Пока панели нет, он не рисуется
  и не перехватывает курсор — игрок продолжает управлять персонажем.
]]

DZ = DZ or {}
local DZ = DZ
DZ.CEF = DZ.CEF or {}
local CEF = DZ.CEF

CEF.visible = false
CEF.ready = false
CEF.queue = CEF.queue or {}
CEF.browser = nil

local function inject(json)
  if not isElement(CEF.browser) then return end
  executeBrowserJavascript(CEF.browser, "window.dzUI && dzUI.push(" .. tostring(json) .. ");")
end

function CEF.push(json)
  if not CEF.ready then
    CEF.queue[#CEF.queue + 1] = json
    if #CEF.queue > 12 then table.remove(CEF.queue, 1) end
    return
  end
  inject(json)
end

function CEF.flush()
  if not CEF.ready then return end
  for i = 1, #CEF.queue do inject(CEF.queue[i]) end
  CEF.queue = {}
end

function CEF.isVisible()
  return CEF.visible == true
end

function CEF.render()
  if not CEF.visible or not isElement(CEF.browser) then return end
  local width, height = guiGetScreenSize()
  dxDrawImage(0, 0, width, height, CEF.browser, 0, 0, 0, tocolor(255, 255, 255, 255), false)
end

function CEF.show()
  if CEF.visible then return end
  CEF.visible = true
  showCursor(true)
  toggleAllControls(false, true, false)
  if isElement(CEF.browser) then
    focusBrowser(CEF.browser)
  end
end

function CEF.hide()
  if not CEF.visible then return end
  CEF.visible = false
  showCursor(false)
  toggleAllControls(true, true, true)
end

function CEF.init()
  if isElement(CEF.browser) then return end
  local screenW, screenH = guiGetScreenSize()
  CEF.browser = createBrowser(screenW, screenH, true, true)
  if not CEF.browser then
    outputChatBox("[GOLD] CEF недоступен: интерфейс не загрузится", 255, 120, 90)
    return
  end

  addEventHandler("onClientBrowserCreated", CEF.browser, function()
    loadBrowserURL(CEF.browser, "http://mta/local/ui/index.html")
    CEF.ready = false
  end)

  addEventHandler("onClientBrowserDocumentReady", CEF.browser, function()
    CEF.ready = true
    CEF.flush()
    triggerServerEvent(DZ.EVENTS.CLIENT_READY, localPlayer)
  end)

  addEventHandler("onClientRender", root, CEF.render)

  addEventHandler("onClientCursorMove", root, function(_, _, absX, absY)
    if not CEF.visible or not isElement(CEF.browser) then return end
    injectBrowserMouseMove(CEF.browser, absX, absY)
  end)

  addEventHandler("onClientClick", root, function(button, state)
    if not CEF.visible or not isElement(CEF.browser) then return end
    if button ~= "left" and button ~= "right" and button ~= "middle" then return end
    if state == "down" then
      injectBrowserMouseDown(CEF.browser, button)
    else
      injectBrowserMouseUp(CEF.browser, button)
    end
  end)

  addEventHandler("onClientBrowserInputFocusChanged", CEF.browser, function(focused)
    if CEF.visible and not focused then focusBrowser(CEF.browser) end
  end)
end

--- События из JavaScript: mta.triggerEvent('dz:ui', json)
addEventHandler(DZ.EVENTS.UI, root, function(json)
  if source ~= CEF.browser then return end
  if type(json) ~= "string" or #json > 16384 then return end
  local action = fromJSON(json)
  if type(action) == "table" and action.a == "close" then CEF.hide() end
  triggerServerEvent(DZ.EVENTS.UI, localPlayer, json)
end)

addEventHandler("onClientResourceStart", resourceRoot, function()
  CEF.init()
end)

addEventHandler("onClientResourceStop", resourceRoot, function()
  if isElement(CEF.browser) then destroyElement(CEF.browser) end
end)

return DZ
