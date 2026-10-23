--[[
  server/db.lua — SQLite: аккаунты, профили, базы.

  Пароль: sha256 с солью и 400 итерациями. Это не bcrypt, но и не
  plaintext; для игрового сервера достаточно, для банка — нет.
]]

DZ = DZ or {}
local DZ = DZ
DZ.DB = DZ.DB or {}
local DB = DZ.DB

local db = nil
local DB_FILE = "gold_dayz.db"

local function q(query, ...)
  if not db then return nil end
  local ok, handle = pcall(dbQuery, db, query, ...)
  if not ok or not handle then
    outputServerLog("[GOLD DAYZ] DB query failed: " .. tostring(query))
    return nil
  end
  local result = dbPoll(handle, -1)
  dbFree(handle)
  return result or nil
end

local function exec(query, ...)
  if not db then return false end
  local ok, result = pcall(dbExec, db, query, ...)
  if not ok or result == false then
    outputServerLog("[GOLD DAYZ] DB exec failed: " .. tostring(query))
    return false
  end
  return true
end

function DB.init()
  db = dbConnect("sqlite", DB_FILE)
  if not db then
    error("GOLD DAYZ: не удалось открыть SQLite " .. DB_FILE, 0)
  end
  exec([[CREATE TABLE IF NOT EXISTS accounts (
    name TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    created INTEGER NOT NULL
  )]])
  exec([[CREATE TABLE IF NOT EXISTS players (
    name TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated INTEGER NOT NULL
  )]])
  exec([[CREATE TABLE IF NOT EXISTS bases (
    id TEXT PRIMARY KEY,
    owner TEXT,
    code TEXT,
    stash TEXT,
    updated INTEGER
  )]])
  outputServerLog("[GOLD DAYZ] SQLite: " .. DB_FILE)
  return true
end

--- Закрыть соединение (вызывается при остановке ресурса).
function DB.close()
  if db then
    if isElement(db) then destroyElement(db) end
    db = nil
  end
end

function DB.hashPassword(salt, password)
  local digest = hash("sha256", tostring(salt) .. ":" .. tostring(password))
  for _ = 1, 400 do
    digest = hash("sha256", digest .. tostring(salt))
  end
  return digest
end

function DB.newSalt()
  local stamp = 0
  local ok, time = pcall(getRealTime)
  if ok and time and time.timestamp then stamp = time.timestamp end
  return hash("sha256",
    tostring(getTickCount()) .. ":" .. tostring(stamp) .. ":" ..
    tostring(math.random(1, 2147483000)) .. ":" .. tostring(math.random(1, 2147483000))
  )
end

function DB.getAccount(name)
  local rows = q("SELECT name, salt, hash FROM accounts WHERE name = ? COLLATE NOCASE LIMIT 1", name)
  if rows and rows[1] then return rows[1] end
  return nil
end

function DB.createAccount(name, salt, digest)
  return exec("INSERT OR REPLACE INTO accounts (name, salt, hash, created) VALUES (?, ?, ?, ?)",
    name, salt, digest, os.time and os.time() or 0)
end

function DB.verify(name, password)
  local account = DB.getAccount(name)
  if not account then return false, "no-account" end
  local digest = DB.hashPassword(account.salt, password)
  if digest == account.hash then return true end
  return false, "bad-password"
end

function DB.register(name, password)
  local salt = DB.newSalt()
  local digest = DB.hashPassword(salt, password)
  if not DB.createAccount(name, salt, digest) then return false end
  return true
end

function DB.loadPlayer(name)
  local rows = q("SELECT data FROM players WHERE name = ? COLLATE NOCASE LIMIT 1", name)
  if not rows or not rows[1] or not rows[1].data then return nil end
  local decoded = fromJSON(rows[1].data)
  if type(decoded) ~= "table" then
    outputServerLog("[GOLD DAYZ] DB: битый профиль " .. tostring(name))
    return nil
  end
  return decoded
end

function DB.savePlayer(name, profile)
  local json = toJSON(profile)
  if not json then return false end
  local stamp = 0
  local ok, time = pcall(getRealTime)
  if ok and time and time.timestamp then stamp = time.timestamp end
  return exec("INSERT OR REPLACE INTO players (name, data, updated) VALUES (?, ?, ?)", name, json, stamp)
end

function DB.loadBaseRows()
  return q("SELECT id, owner, code, stash FROM bases") or {}
end

function DB.saveBase(id, owner, code, stash)
  local stashJson = stash and toJSON(stash) or nil
  local stamp = 0
  local ok, time = pcall(getRealTime)
  if ok and time and time.timestamp then stamp = time.timestamp end
  return exec("INSERT OR REPLACE INTO bases (id, owner, code, stash, updated) VALUES (?, ?, ?, ?, ?)",
    id, owner, code, stashJson, stamp)
end

function DB.saveAll(profiles)
  for name, profile in pairs(profiles or {}) do
    DB.savePlayer(name, profile)
  end
end

return DZ
