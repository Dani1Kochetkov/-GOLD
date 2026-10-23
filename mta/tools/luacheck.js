#!/usr/bin/env node
/**
 * tools/luacheck.js — проверка ресурса GOLD DAYZ без запуска MTA.
 *
 * 1. JSON: парсинг и ссылочная целостность (лут -> предметы и т.п.).
 * 2. Lua: синтаксис через luaparse (Lua 5.1, как в MTA).
 * 3. Shared: выполнение в fengari + тесты tests/shared_spec.lua.
 * 4. meta.xml: все файлы на месте, скрипты подключены.
 * 5. API: вызовы DZ.* существуют в коде.
 *
 * Запуск: node mta/tools/luacheck.js
 */
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");
const luaparse = require("luaparse");
const fengari = require("fengari");

const ROOT = path.resolve(__dirname, "..", "gold_dayz");
const TESTS = path.resolve(__dirname, "..", "tests");
const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;
const to_luastring = fengari.to_luastring;
const to_jsstring = fengari.to_jsstring;

const errors = [];
const notes = [];

function fail(section, message) {
  errors.push(`[${section}] ${message}`);
}

function note(message) {
  notes.push(message);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walk(dir, filter, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, filter, out);
    else if (!filter || filter(full)) out.push(full);
  }
  return out;
}

function relative(full) {
  return path.relative(ROOT, full).split(path.sep).join("/");
}

function readJson(rel, section) {
  try {
    return JSON.parse(read(rel));
  } catch (err) {
    fail(section, `${rel}: невалидный JSON — ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ JSON */

const data = {
  items: readJson("data/items.json", "json"),
  loot: readJson("data/loot.json", "json"),
  zombies: readJson("data/zombies.json", "json"),
  map: readJson("data/map.json", "json"),
  traders: readJson("data/traders.json", "json"),
  vehicles: readJson("data/vehicles.json", "json"),
  recipes: readJson("data/recipes.json", "json"),
  config: readJson("data/config.json", "json")
};

const RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary"]);
const KINDS = new Set(["medical", "food", "drink", "weapon", "ammo", "backpack", "armor", "mask", "tool", "material", "valuable", "gear"]);
const SLOTS = new Set(["weapon", "backpack", "armor", "mask"]);

const itemMap = new Map();

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

if (data.items) {
  const rows = Array.isArray(data.items.items) ? data.items.items : [];
  if (!rows.length) fail("json", "items.json: пустой список items");
  for (const def of rows) {
    if (!def.id) { fail("json", "items: предмет без id"); continue; }
    if (itemMap.has(def.id)) fail("json", `items: дубль id ${def.id}`);
    itemMap.set(def.id, def);
    if (!def.name) fail("json", `items.${def.id}: нет name`);
    if (!isNum(def.weight) || def.weight <= 0) fail("json", `items.${def.id}: некорректный weight`);
    if (!isNum(def.stack) || def.stack < 1) fail("json", `items.${def.id}: некорректный stack`);
    if (def.rarity && !RARITIES.has(def.rarity)) fail("json", `items.${def.id}: неизвестная редкость ${def.rarity}`);
    if (def.kind && !KINDS.has(def.kind)) fail("json", `items.${def.id}: неизвестный kind ${def.kind}`);
    if (def.slot && !SLOTS.has(def.slot)) fail("json", `items.${def.id}: неизвестный slot ${def.slot}`);
    if (def.kind === "weapon" && (!isNum(def.weapon) || def.weapon < 0 || def.weapon > 46)) {
      fail("json", `items.${def.id}: weapon id вне 0..46`);
    }
    if (def.kind === "weapon" && def.ammoKind && !isNum(def.startAmmo)) {
      fail("json", `items.${def.id}: нет startAmmo при ammoKind`);
    }
  }
  note(`items: ${rows.length}`);
}

if (data.loot) {
  const tables = Object.keys(data.loot.tables || {});
  if (!tables.length) fail("json", "loot.json: нет tables");
  let entries = 0;
  for (const name of tables) {
    const list = data.loot.tables[name];
    if (!Array.isArray(list) || !list.length) { fail("json", `loot.${name}: пустая таблица`); continue; }
    for (const row of list) {
      entries += 1;
      if (!itemMap.has(row.item)) fail("json", `loot.${name}: предмет ${row.item} не найден в items.json`);
      if (!isNum(row.weight) || row.weight <= 0) fail("json", `loot.${name}.${row.item}: weight <= 0`);
      if (row.min !== undefined && (!isNum(row.min) || row.min < 1)) fail("json", `loot.${name}.${row.item}: min`);
      if (row.max !== undefined && (!isNum(row.max) || row.max < (row.min || 1))) fail("json", `loot.${name}.${row.item}: max < min`);
    }
  }
  note(`loot: ${tables.length} таблиц, ${entries} записей`);
}

const zombieLootTables = new Set();
if (data.zombies) {
  const types = Array.isArray(data.zombies.types) ? data.zombies.types : [];
  if (!types.length) fail("json", "zombies.json: нет types");
  const ids = new Set();
  for (const spec of types) {
    if (!spec.id) { fail("json", "zombies: тип без id"); continue; }
    if (ids.has(spec.id)) fail("json", `zombies: дубль ${spec.id}`);
    ids.add(spec.id);
    if (!isNum(spec.health) || spec.health <= 0) fail("json", `zombies.${spec.id}: health`);
    if (!isNum(spec.speed) || spec.speed <= 0) fail("json", `zombies.${spec.id}: speed`);
    if (!isNum(spec.damage) || spec.damage <= 0) fail("json", `zombies.${spec.id}: damage`);
    if (!Array.isArray(spec.skins) || !spec.skins.length) fail("json", `zombies.${spec.id}: skins`);
    else if (spec.skins.some((s) => !isNum(s) || s < 0 || s > 312)) fail("json", `zombies.${spec.id}: скин вне 0..312`);
    if (data.loot) {
      const hasTable = data.loot.tables && data.loot.tables[spec.lootTable];
      if (!hasTable) fail("json", `zombies.${spec.id}: lootTable ${spec.lootTable} не найден`);
      else zombieLootTables.add(spec.lootTable);
    }
  }
  note(`zombies: ${types.length} типов`);
}

if (data.map) {
  const groups = [
    ["spawns", data.map.spawns],
    ["lootZones", data.map.lootZones],
    ["zombieZones", data.map.zombieZones],
    ["safeZones", data.map.safeZones],
    ["radiationZones", data.map.radiationZones],
    ["bases", data.map.bases]
  ];
  for (const [key, list] of groups) {
    if (!Array.isArray(list) || !list.length) { fail("json", `map.${key}: пустой список`); continue; }
    const ids = new Set();
    for (const zone of list) {
      if (!zone.id) fail("json", `map.${key}: зона без id`);
      else if (ids.has(zone.id)) fail("json", `map.${key}: дубль ${zone.id}`);
      else ids.add(zone.id);
      if (!isNum(zone.x) || !isNum(zone.y) || !isNum(zone.z)) fail("json", `map.${key}.${zone.id}: координаты`);
      if (zone.x < -3100 || zone.x > 3100 || zone.y < -3100 || zone.y > 3100) {
        fail("json", `map.${key}.${zone.id}: координаты вне карты`);
      }
    }
    note(`map.${key}: ${list.length}`);
  }
  for (const zone of data.map.zombieZones || []) {
    if (!isNum(zone.max) || zone.max < 1) fail("json", `map.zombieZones.${zone.id}: max`);
    if (!zone.types || typeof zone.types !== "object" || !Object.keys(zone.types).length) {
      fail("json", `map.zombieZones.${zone.id}: нет types`);
    } else {
      const known = new Set(((data.zombies && data.zombies.types) || []).map((t) => t.id));
      for (const [type, weight] of Object.entries(zone.types)) {
        if (!known.has(type)) fail("json", `map.zombieZones.${zone.id}: неизвестный тип ${type}`);
        if (!isNum(weight) || weight <= 0) fail("json", `map.zombieZones.${zone.id}.${type}: вес`);
      }
    }
  }
  for (const zone of data.map.lootZones || []) {
    if (!Array.isArray(zone.tables) || !zone.tables.length) fail("json", `map.lootZones.${zone.id}: нет tables`);
    else {
      for (const name of zone.tables) {
        if (!data.loot || !data.loot.tables || !data.loot.tables[name]) {
          fail("json", `map.lootZones.${zone.id}: таблица лута ${name} не найдена`);
        }
      }
    }
    if (!isNum(zone.count) || zone.count < 1) fail("json", `map.lootZones.${zone.id}: count`);
    if (!isNum(zone.tier) || zone.tier < 1 || zone.tier > 3) fail("json", `map.lootZones.${zone.id}: tier`);
  }
  for (const zone of data.map.bases || []) {
    if (!isNum(zone.radius) || zone.radius < 5) fail("json", `map.bases.${zone.id}: radius`);
  }
  if (!data.map.world || !isNum(data.map.world.hour)) fail("json", "map.world: нет hour");
  if (data.map.world && (!isNum(data.map.world.weather) || data.map.world.weather < 0 || data.map.world.weather > 255)) {
    fail("json", "map.world.weather: вне 0..255");
  }
}

if (data.traders) {
  const traders = Array.isArray(data.traders.traders) ? data.traders.traders : [];
  if (!traders.length) fail("json", "traders.json: пусто");
  for (const trader of traders) {
    if (!trader.id) fail("json", "traders: торговец без id");
    if (!isNum(trader.x) || !isNum(trader.y) || !isNum(trader.z)) fail("json", `traders.${trader.id}: координаты`);
    if (!isNum(trader.skin) || trader.skin < 0 || trader.skin > 312) fail("json", `traders.${trader.id}: скин вне 0..312`);
    if (!Array.isArray(trader.stock) || !trader.stock.length) fail("json", `traders.${trader.id}: пустой stock`);
    for (const row of trader.stock || []) {
      if (!itemMap.has(row.item)) fail("json", `traders.${trader.id}: предмет ${row.item} не найден`);
      if (!isNum(row.price) || row.price <= 0) fail("json", `traders.${trader.id}.${row.item}: price`);
      if (!isNum(row.stock) || row.stock < 0) fail("json", `traders.${trader.id}.${row.item}: stock`);
    }
  }
  if (!isNum(data.traders.sellMultiplier) || data.traders.sellMultiplier <= 0 || data.traders.sellMultiplier > 1) {
    fail("json", "traders.sellMultiplier: вне 0..1");
  }
  note(`traders: ${traders.length}`);
}

if (data.vehicles) {
  const spots = Array.isArray(data.vehicles.spawns) ? data.vehicles.spawns : [];
  if (!spots.length) fail("json", "vehicles.json: нет spawns");
  for (const spot of spots) {
    if (!spot.id) fail("json", "vehicles: точка без id");
    if (!Array.isArray(spot.models) || !spot.models.length) fail("json", `vehicles.${spot.id}: models`);
    for (const model of spot.models || []) {
      if (!isNum(model) || model < 400 || model > 611) fail("json", `vehicles.${spot.id}: модель ${model} вне 400..611`);
    }
    if (!isNum(spot.x) || !isNum(spot.y) || !isNum(spot.z)) fail("json", `vehicles.${spot.id}: координаты`);
  }
  note(`vehicles: ${spots.length} точек`);
}

if (data.recipes) {
  const recipes = Array.isArray(data.recipes.recipes) ? data.recipes.recipes : [];
  if (!recipes.length) fail("json", "recipes.json: пусто");
  const ids = new Set();
  for (const recipe of recipes) {
    if (!recipe.id) fail("json", "recipes: рецепт без id");
    if (ids.has(recipe.id)) fail("json", `recipes: дубль ${recipe.id}`);
    ids.add(recipe.id);
    if (!itemMap.has(recipe.out)) fail("json", `recipes.${recipe.id}: результат ${recipe.out} не найден`);
    if (!Array.isArray(recipe.in) || !recipe.in.length) fail("json", `recipes.${recipe.id}: нет ингредиентов`);
    for (const need of recipe.in || []) {
      if (!itemMap.has(need.item)) fail("json", `recipes.${recipe.id}: ингредиент ${need.item} не найден`);
      if (!isNum(need.count) || need.count < 1) fail("json", `recipes.${recipe.id}.${need.item}: count`);
    }
  }
  note(`recipes: ${recipes.length}`);
}

if (data.config) {
  for (const key of ["server", "auth", "spawn", "survival", "zombies", "loot", "vehicles", "pvp", "bases", "traders", "admin"]) {
    if (data.config[key] === undefined) fail("json", `config: нет секции ${key}`);
  }
  if (!isNum(data.config.server.tickMs) || data.config.server.tickMs < 50) fail("json", "config.server.tickMs");
  if (!Array.isArray(data.config.spawn.skins) || !data.config.spawn.skins.length) {
    fail("json", "config.spawn.skins");
  } else if (data.config.spawn.skins.some((skin) => !isNum(skin) || skin < 0 || skin > 312)) {
    fail("json", "config.spawn.skins: скин вне 0..312");
  }
  if (!isNum(data.config.server.weather) || data.config.server.weather < 0 || data.config.server.weather > 255) {
    fail("json", "config.server.weather: вне 0..255");
  }
  if (!Array.isArray(data.config.admin.accounts)) fail("json", "config.admin.accounts: не массив");
  if (!isNum(data.config.loot.groundCap) || data.config.loot.groundCap < 10) fail("json", "config.loot.groundCap");
  if (!Array.isArray(data.config.spawn.starter)) fail("json", "config.spawn.starter");
  for (const row of data.config.spawn.starter || []) {
    if (!itemMap.has(row.item)) fail("json", `config.spawn.starter: ${row.item} не найден`);
  }
}

/* -------------------------------------------------------------- Lua syntax */

const luaFiles = walk(ROOT, (file) => file.endsWith(".lua"));
if (!luaFiles.length) fail("lua", "не найдено ни одного .lua файла");

for (const file of luaFiles) {
  const rel = relative(file);
  const source = fs.readFileSync(file, "utf8");
  try {
    luaparse.parse(source, { luaVersion: "5.1", comments: false, scope: false, locations: true });
  } catch (err) {
    const line = err.line ? `:${err.line}` : "";
    fail("lua", `${rel}${line}: ${err.message}`);
  }
}
note(`lua: ${luaFiles.length} файлов разобрано`);

/* ------------------------------------------------------- Shared + тесты */

function runChunk(L, source, name) {
  const buffer = to_luastring(source);
  let status = lauxlib.luaL_loadbuffer(L, buffer, buffer.length, to_luastring(name));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(`${name}: ${message}`);
  }
  status = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
}

const sharedFiles = ["shared/core.lua", "shared/inventory.lua", "shared/survival.lua", "shared/zombie_ai.lua", "shared/loot.lua"];

try {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  for (const rel of sharedFiles) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail("shared", `${rel}: файл не найден`);
      continue;
    }
    try {
      runChunk(L, read(rel), rel);
    } catch (err) {
      fail("shared", err.message);
    }
  }

  try {
    const spec = fs.readFileSync(path.join(TESTS, "shared_spec.lua"), "utf8");
    runChunk(L, spec, "tests/shared_spec.lua");
    lua.lua_getglobal(L, to_luastring("TEST_SUMMARY"));
    const summary = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    note(`tests: ${summary}`);
  } catch (err) {
    fail("tests", err.message);
  }

  lua.lua_close(L);
} catch (err) {
  fail("fengari", err.message);
}

/* --------------------------------------------------------------- meta.xml */

const metaPath = path.join(ROOT, "meta.xml");
if (!fs.existsSync(metaPath)) {
  fail("meta", "meta.xml отсутствует");
} else {
  const meta = fs.readFileSync(metaPath, "utf8");
  const scripts = [];
  const re = /<script\s+src="([^"]+)"\s+type="([^"]+)"[^>]*\/?>/g;
  let match;
  while ((match = re.exec(meta)) !== null) scripts.push({ src: match[1], type: match[2] });

  if (!scripts.length) fail("meta", "нет ни одного <script>");
  for (const script of scripts) {
    if (!fs.existsSync(path.join(ROOT, script.src))) fail("meta", `script не найден: ${script.src}`);
  }

  const types = scripts.map((s) => s.type);
  if (types.filter((t) => t === "server").length === 0) fail("meta", "нет серверных скриптов");
  if (types.filter((t) => t === "client").length === 0) fail("meta", "нет клиентских скриптов");
  if (types.filter((t) => t === "shared").length !== sharedFiles.length) {
    fail("meta", "число shared-скриптов не совпадает");
  }
  if (scripts[0] && scripts[0].type !== "shared") fail("meta", "shared-скрипты должны идти первыми");
  const lastServer = [...scripts].reverse().find((s) => s.type === "server");
  if (!lastServer || lastServer.src !== "server/main.lua") fail("meta", "server/main.lua должен быть последним серверным скриптом");

  const serverDir = path.join(ROOT, "server");
  const clientDir = path.join(ROOT, "client");
  for (const file of walk(serverDir, (f) => f.endsWith(".lua"))) {
    const rel = relative(file);
    if (!scripts.some((s) => s.src === rel)) fail("meta", `серверный скрипт не подключён: ${rel}`);
  }
  for (const file of walk(clientDir, (f) => f.endsWith(".lua"))) {
    const rel = relative(file);
    if (!scripts.some((s) => s.src === rel)) fail("meta", `клиентский скрипт не подключён: ${rel}`);
  }

  const htmlMatch = /<html\s+src="([^"]+)"/.exec(meta);
  if (!htmlMatch) fail("meta", "нет <html src=...>");
  else if (!fs.existsSync(path.join(ROOT, htmlMatch[1]))) fail("meta", `html не найден: ${htmlMatch[1]}`);

  const fileRe = /<file\s+src="([^"]+)"/g;
  while ((match = fileRe.exec(meta)) !== null) {
    if (!fs.existsSync(path.join(ROOT, match[1]))) fail("meta", `file не найден: ${match[1]}`);
  }
  note(`meta: ${scripts.length} скриптов`);
}

/* --------------------------------------------------------------- UI файлы */

for (const rel of ["ui/index.html", "ui/style.css", "ui/app.js"]) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail("ui", `${rel} отсутствует`);
}
try {
  execFileSync(process.execPath, ["--check", path.join(ROOT, "ui", "app.js")], { stdio: "pipe" });
} catch (err) {
  fail("ui", "app.js не проходит node --check: " + (err.stderr ? err.stderr.toString().split("\n")[0] : err.message));
}
try {
  const html = read("ui/index.html");
  for (const ref of ["style.css", "app.js"]) {
    if (!html.includes(ref)) fail("ui", `index.html не ссылается на ${ref}`);
  }
  const js = read("ui/app.js");
  if (!js.includes("dzUI")) fail("ui", "app.js не публикует window.dzUI");
  if (!js.includes("triggerEvent")) fail("ui", "app.js не вызывает mta.triggerEvent");
} catch (err) {
  fail("ui", err.message);
}

/* ------------------------------------------------------------------ API */

const allLua = luaFiles.map((file) => ({ rel: relative(file), src: fs.readFileSync(file, "utf8") }));

// Псевдонимы вида `local IS = DZ.IS`: по ним определяем полные имена.
const aliases = new Map();
for (const { src } of allLua) {
  const aliasRe = /local\s+([A-Za-z_]\w*)\s*=\s*(DZ\.[A-Za-z_]\w*)/g;
  let m;
  while ((m = aliasRe.exec(src)) !== null) {
    if (!aliases.has(m[1])) aliases.set(m[1], m[2]);
  }
}
function fullName(name) {
  const parts = name.split(".");
  if (parts.length === 2 && aliases.has(parts[0])) return `${aliases.get(parts[0])}.${parts[1]}`;
  return name;
}

const defined = new Set();
for (const { src } of allLua) {
  const fnRe = /function\s+([A-Za-z_][\w.]*)\s*\(/g;
  const assignRe = /([A-Za-z_][\w.]*)\s*=\s*function/g;
  let m;
  while ((m = fnRe.exec(src)) !== null) defined.add(fullName(m[1]));
  while ((m = assignRe.exec(src)) !== null) defined.add(fullName(m[1]));
}

const known = new Set();
for (const { src } of allLua) {
  const callRe = /\b(DZ\.[A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) known.add(`${m[1]}.${m[2]}`);
}
for (const symbol of [...known].sort()) {
  if (!defined.has(symbol)) fail("api", `используется, но не определено: ${symbol}`);
}
note(`api: ${known.size} вызовов`);

/* ---------------------------------------------------------------- отчёт */

if (notes.length) {
  console.log("GOLD DAYZ · проверка ресурса\n");
  for (const line of notes) console.log("  · " + line);
  console.log("");
}

if (errors.length) {
  console.error(`ОШИБКИ (${errors.length}):`);
  for (const line of errors) console.error("  ✗ " + line);
  process.exit(1);
}

console.log("Всё в порядке: JSON, Lua, shared-тесты, meta.xml и UI.");
