--[[
  client/hud.lua — HUD на dxDraw: полосы выживания, деньги, оружие, киллфид.
]]

DZ = DZ or {}
local DZ = DZ
DZ.HUD = DZ.HUD or {}
local H = DZ.HUD

H.data = nil
H.prompt = nil
H.toasts = {}
H.hintUntil = 0
H.lines = {}
H.flashUntil = 0
H.flashPower = 0
H.hitUntil = 0

local GOLD = { 201, 162, 75 }
local WHITE = { 225, 230, 215 }
local MUTED = { 138, 147, 124 }
local RED = { 190, 70, 52 }
local GREEN = { 148, 179, 106 }
local BLUE = { 109, 155, 181 }
local ORANGE = { 207, 122, 62 }
local DARK = { 12, 15, 11 }

local function panel(x, y, w, h, alpha)
  dxDrawRectangle(x, y, w, h, tocolor(DARK[1], DARK[2], DARK[3], alpha or 168), false)
  dxDrawRectangle(x, y, w, 1, tocolor(GOLD[1], GOLD[2], GOLD[3], 190), false)
  dxDrawRectangle(x, y + h - 1, w, 1, tocolor(GOLD[1], GOLD[2], GOLD[3], 70), false)
  dxDrawRectangle(x, y, 1, h, tocolor(GOLD[1], GOLD[2], GOLD[3], 70), false)
  dxDrawRectangle(x + w - 1, y, 1, h, tocolor(GOLD[1], GOLD[2], GOLD[3], 70), false)
end

local function text(str, x, y, w, h, color, scale, align, font)
  dxDrawText(tostring(str), x, y, x + w, y + h, tocolor(color[1], color[2], color[3], 255),
    scale or 1, font or "default-bold", align or "left", "top", false, false, false, false)
end

local function bar(x, y, w, h, value, max, color, label)
  local ratio = 0
  if max and max > 0 then ratio = math.max(0, math.min(1, value / max)) end
  dxDrawRectangle(x, y, w, h, tocolor(255, 255, 255, 18), false)
  dxDrawRectangle(x, y, math.floor(w * ratio), h, tocolor(color[1], color[2], color[3], 235), false)
  if label then
    dxDrawText(label, x + 4, y, x + w - 4, y + h, tocolor(12, 15, 11, 235), 0.86, "default-bold", "left", "center", false, false, false, false)
    dxDrawText(tostring(math.floor(value)), x, y, x + w - 5, y + h, tocolor(WHITE[1], WHITE[2], WHITE[3], 235), 0.86, "default-bold", "right", "center", false, false, false, false)
  end
end

local function clockFromData(data)
  return data.clock or "--:--"
end

function H.toast(text, kind)
  if not text then return end
  H.toasts[#H.toasts + 1] = { text = tostring(text), kind = kind or "info", at = getTickCount() }
  while #H.toasts > 6 do table.remove(H.toasts, 1) end
end

function H.hitmarker(data)
  H.hitUntil = getTickCount() + 180
  if data and data.kill then
    H.lines[#H.lines + 1] = { text = "Цель уничтожена", color = GREEN, at = getTickCount() }
  end
end

function H.flash(damage)
  H.flashUntil = getTickCount() + 380
  H.flashPower = math.min(1, (tonumber(damage) or 10) / 60)
end

function H.killfeed(json)
  local payload = type(json) == "string" and fromJSON(json) or json
  if type(payload) ~= "table" then return end
  local d = payload.d or {}
  local now = getTickCount()
  if type(d.lines) == "table" then
    for i = 1, #d.lines do
      H.lines[#H.lines + 1] = { text = tostring(d.lines[i]), color = WHITE, at = now }
    end
  elseif d.line then
    H.lines[#H.lines + 1] = { text = tostring(d.line), color = GOLD, at = now }
  end
end

local function drawKillfeed(sw, sh, s)
  local now = getTickCount()
  local keep = {}
  for i = 1, #H.lines do
    if now - H.lines[i].at < 9000 then keep[#keep + 1] = H.lines[i] end
  end
  H.lines = keep
  local y = 132 * s
  for i = #keep, 1, -1 do
    local line = keep[i]
    local age = now - line.at
    local alpha = 255
    if age > 7500 then alpha = math.floor(255 * (1 - (age - 7500) / 1500)) end
    if alpha > 0 then
      dxDrawText(line.text, sw - 520 * s, y, sw - 24 * s, y + 20 * s, tocolor(line.color[1], line.color[2], line.color[3], alpha),
        0.92 * s, "default-bold", "right", "top", true, false, false, false)
    end
    y = y + 20 * s
  end
end

function H.render()
  local data = H.data
  local sw, sh = guiGetScreenSize()
  local s = math.max(0.75, math.min(1.65, sh / 1080))

  if getTickCount() < H.flashUntil then
    local alpha = math.floor(90 * H.flashPower)
    local r, g, b = 150, 20, 16
    dxDrawRectangle(0, 0, sw, sh, tocolor(r, g, b, alpha), false)
  end

  if not data then return end

  -- Левый верх: локация и время.
  panel(20 * s, 20 * s, 300 * s, 78 * s)
  text("GOLD DAYZ", 32 * s, 26 * s, 260 * s, 20 * s, GOLD, 1.0 * s)
  text(data.zone or "Пустошь", 32 * s, 46 * s, 260 * s, 20 * s, WHITE, 1.0 * s)
  text(clockFromData(data) .. "  ·  " .. tostring(data.online or 0) .. " в сети", 32 * s, 66 * s, 260 * s, 18 * s, MUTED, 0.9 * s)
  if data.safe then
    text("БЕЗОПАСНАЯ ЗОНА", 32 * s, 84 * s, 260 * s, 16 * s, GREEN, 0.85 * s)
  elseif data.base then
    text("УБЕЖИЩЕ: " .. tostring(data.base), 32 * s, 84 * s, 260 * s, 16 * s, BLUE, 0.85 * s)
  end

  -- Правый верх: деньги и статистика.
  local rw = 250 * s
  panel(sw - rw - 20 * s, 20 * s, rw, 96 * s)
  text("$" .. tostring(data.money or 0), sw - rw - 8 * s, 26 * s, rw - 12 * s, 26 * s, GOLD, 1.25 * s, "right")
  text("убийств " .. tostring(data.kills or 0) .. " · смертей " .. tostring(data.deaths or 0),
    sw - rw - 8 * s, 54 * s, rw - 12 * s, 20 * s, WHITE, 0.9 * s, "right")
  text("зомби " .. tostring(data.zk or 0) .. " · в мире " .. tostring(data.zombies or 0),
    sw - rw - 8 * s, 74 * s, rw - 12 * s, 20 * s, MUTED, 0.9 * s, "right")
  text("выжил " .. DZ.Util.timeString(data.survived or 0), sw - rw - 8 * s, 94 * s, rw - 12 * s, 18 * s, MUTED, 0.88 * s, "right")

  drawKillfeed(sw, sh, s)

  -- Левый низ: выживание.
  local bx, bw = 20 * s, 300 * s
  local bh = 30 * s
  local by = sh - (bh * 6 + 34 * s)
  panel(bx, by - 10 * s, bw, bh * 6 + 22 * s)
  bar(bx + 12 * s, by, bw - 24 * s, 15 * s, data.hp or 0, 100, RED, "HP")
  bar(bx + 12 * s, by + bh, bw - 24 * s, 15 * s, data.blood or 0, 100, { 140, 40, 38 }, "КРОВЬ")
  bar(bx + 12 * s, by + bh * 2, bw - 24 * s, 15 * s, data.hunger or 0, 100, ORANGE, "ГОЛОД")
  bar(bx + 12 * s, by + bh * 3, bw - 24 * s, 15 * s, data.thirst or 0, 100, BLUE, "ЖАЖДА")
  bar(bx + 12 * s, by + bh * 4, bw - 24 * s, 15 * s, data.stamina or 0, 100, GREEN, "СТАМИНА")

  local temp = tonumber(data.temp) or 36.6
  local tempColor = WHITE
  if temp < 35 then tempColor = BLUE elseif temp > 38 then tempColor = ORANGE end
  text(string.format("Температура %.1f°C", temp), bx + 12 * s, by + bh * 5 + 2 * s, bw * 0.55, 16 * s, tempColor, 0.88 * s)
  local status = {}
  if (data.bleed or 0) > 0 then status[#status + 1] = "КРОВОТЕЧЕНИЕ" end
  if (data.rad or 0) > 0 then status[#status + 1] = "РАДИАЦИЯ " .. tostring(data.rad) end
  if (data.infection or 0) > 0 then status[#status + 1] = "ИНФЕКЦИЯ" end
  if #status > 0 then
    text(table.concat(status, " · "), bx + 12 * s, by + bh * 5 + 18 * s, bw - 24 * s, 16 * s, RED, 0.82 * s)
  elseif (data.armor or 0) > 0 then
    text("Броня " .. tostring(data.armor), bx + 12 * s, by + bh * 5 + 18 * s, bw - 24 * s, 16 * s, WHITE, 0.82 * s)
  end

  -- Правый низ: оружие, вес, транспорт.
  local vr = 290 * s
  panel(sw - vr - 20 * s, sh - 132 * s, vr, 112 * s)
  local weapon = data.weapon or {}
  text(weapon.name or "Без оружия", sw - vr - 8 * s, sh - 124 * s, vr - 16 * s, 22 * s, WHITE, 1.0 * s, "right")
  if weapon.total then
    text(tostring(weapon.clip or 0) .. " / " .. tostring(weapon.total or 0), sw - vr - 8 * s, sh - 102 * s, vr - 16 * s, 22 * s, GOLD, 1.15 * s, "right")
  end
  text(string.format("%.1f / %.0f кг", data.weight or 0, data.capacity or 30), sw - vr - 8 * s, sh - 78 * s, vr - 16 * s, 18 * s, MUTED, 0.9 * s, "right")
  if data.vehicle then
    local v = data.vehicle
    text(string.format("Топливо %d%% · %d км/ч", v.fuel or 0, v.speed or 0), sw - vr - 8 * s, sh - 58 * s, vr - 16 * s, 18 * s, (v.fuel or 0) < 15 and RED or WHITE, 0.9 * s, "right")
  else
    text("пешком", sw - vr - 8 * s, sh - 58 * s, vr - 16 * s, 18 * s, MUTED, 0.9 * s, "right")
  end

  -- Босс.
  if data.boss then
    local boss = data.boss
    local bw2 = 520 * s
    local bx2 = (sw - bw2) / 2
    panel(bx2, 20 * s, bw2, 54 * s)
    text("ИСПОЛИН · " .. tostring(boss.name or ""), bx2 + 12 * s, 24 * s, bw2 - 24 * s, 18 * s, GOLD, 0.95 * s, "center")
    bar(bx2 + 12 * s, 46 * s, bw2 - 24 * s, 14 * s, boss.hp or 0, boss.maxHp or 1, RED, nil)
  end

  -- Уведомления (рисуем в dx, чтобы они были видны без открытой панели).
  local now = getTickCount()
  local toastY = sh - (H.prompt and 148 or 118) * s
  local keepToasts = {}
  for i = 1, #H.toasts do
    if now - H.toasts[i].at < 3800 then keepToasts[#keepToasts + 1] = H.toasts[i] end
  end
  H.toasts = keepToasts
  for i = #H.toasts, 1, -1 do
    local item = H.toasts[i]
    local color = WHITE
    if item.kind == "ok" then color = GREEN
    elseif item.kind == "warn" then color = ORANGE
    elseif item.kind == "danger" then color = RED
    elseif item.kind == "loot" then color = { 200, 178, 110 } end
    local alpha = 235
    local age = now - item.at
    if age > 3000 then alpha = math.floor(235 * (1 - (age - 3000) / 800)) end
    local tw = math.min(560 * s, math.max(260 * s, #item.text * 8 * s))
    local tx = (sw - tw) / 2
    dxDrawRectangle(tx, toastY, tw, 24 * s, tocolor(DARK[1], DARK[2], DARK[3], math.min(200, alpha)), false)
    dxDrawRectangle(tx, toastY, 2, 24 * s, tocolor(color[1], color[2], color[3], alpha), false)
    dxDrawText(item.text, tx + 10 * s, toastY, tx + tw - 8 * s, toastY + 24 * s,
      tocolor(color[1], color[2], color[3], alpha), 0.9 * s, "default-bold", "center", "center", false, false, false, false)
    toastY = toastY - 29 * s
  end

  -- Подсказка управления в первые секунды.
  if now < H.hintUntil and not DZ.CEF.isVisible() then
    local hint = "I — инвентарь   ·   M — карта   ·   C — крафт   ·   E — взаимодействие   ·   F1 — помощь"
    dxDrawText(hint, 0, sh - 40 * s, sw, sh - 16 * s, tocolor(MUTED[1], MUTED[2], MUTED[3], 210),
      0.9 * s, "default-bold", "center", "center", false, false, false, false)
  end

  -- Подсказка взаимодействия.
  if H.prompt and not DZ.CEF.isVisible() then
    local pw = 420 * s
    local px = (sw - pw) / 2
    dxDrawRectangle(px, sh - 96 * s, pw, 28 * s, tocolor(DARK[1], DARK[2], DARK[3], 190), false)
    dxDrawRectangle(px, sh - 96 * s, pw, 1, tocolor(GOLD[1], GOLD[2], GOLD[3], 200), false)
    text(H.prompt, px, sh - 94 * s, pw, 24 * s, WHITE, 0.95 * s, "center")
  end

  -- Хитмаркер.
  if getTickCount() < H.hitUntil then
    local cx, cy = sw / 2, sh / 2
    local d = 6 * s
    local color = tocolor(GOLD[1], GOLD[2], GOLD[3], 235)
    dxDrawLine(cx - d, cy - d, cx - d / 3, cy - d / 3, color, 2, false)
    dxDrawLine(cx + d, cy - d, cx + d / 3, cy - d / 3, color, 2, false)
    dxDrawLine(cx - d, cy + d, cx - d / 3, cy + d / 3, color, 2, false)
    dxDrawLine(cx + d, cy + d, cx + d / 3, cy + d / 3, color, 2, false)
  end
end

function H.init()
  addEventHandler("onClientRender", root, H.render)
end

return DZ
