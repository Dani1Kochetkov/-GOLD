#!/usr/bin/env node
/**
 * tools/simulate.js — прогон серверной логики без MTA.
 *
 * Поднимает fengari, подсовывает минимальный MTA (tests/mta_mock.lua),
 * загружает настоящие модули ресурса и проигрывает сценарий игрока:
 * старт ресурса, вход, спавн, зомби, лут, торговец, крафт, база, смерть,
 * возрождение и сохранение.
 *
 * Запуск: node mta/tools/simulate.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const fengari = require("fengari");

const lua = fengari.lua;
const lauxlib = fengari.lauxlib;
const lualib = fengari.lualib;
const to_luastring = fengari.to_luastring;
const to_jsstring = fengari.to_jsstring;

const ROOT = path.resolve(__dirname, "..", "gold_dayz");
const TESTS = path.resolve(__dirname, "..", "tests");

/** Сериализация JSON -> Lua-литерал (для MOCK_JSON). */
function toLua(value) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "{" + value.map(toLua).join(",") + "}";
  const parts = [];
  for (const key of Object.keys(value)) parts.push(`[${JSON.stringify(key)}]=${toLua(value[key])}`);
  return "{" + parts.join(",") + "}";
}

const JSON_FILES = ["items", "loot", "zombies", "map", "traders", "vehicles", "recipes", "config"];
const mockJsonLines = JSON_FILES.map((name) => {
  const rel = `data/${name}.json`;
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const data = JSON.parse(raw);
  return `MOCK_JSON[${JSON.stringify(raw)}]=${toLua(data)}\nMOCK_FILES[${JSON.stringify(rel)}]=${JSON.stringify(raw)}`;
});
const prelude = [
  "MOCK_JSON = {}",
  "MOCK_FILES = {}",
  ...mockJsonLines,
  ""
].join("\n");

// Патчи ставятся после mta_mock.lua: мок по умолчанию не читает файлы.
const patches = [
  "function fileGetSize(file) return #(MOCK_FILES[file.path] or '') end",
  "function fileRead(file, size)",
  "  local content = MOCK_FILES[file.path] or ''",
  "  if size and size < #content then return content:sub(1, size) end",
  "  return content",
  "end",
  ""
].join("\n");

const SERVER_FILES = [
  "server/data.lua",
  "server/ui.lua",
  "server/db.lua",
  "server/inventory.lua",
  "server/loot.lua",
  "server/zombies.lua",
  "server/players.lua",
  "server/traders.lua",
  "server/crafting.lua",
  "server/bases.lua",
  "server/vehicles.lua",
  "server/admin.lua",
  "server/main.lua"
];

const SHARED_FILES = [
  "shared/core.lua",
  "shared/inventory.lua",
  "shared/survival.lua",
  "shared/zombie_ai.lua",
  "shared/loot.lua"
];

function runChunk(L, source, name) {
  const buffer = to_luastring(source);
  let status = lauxlib.luaL_loadbuffer(L, buffer, buffer.length, to_luastring(name));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(`${name}: не загрузился — ${message}`);
  }
  status = lua.lua_pcall(L, 0, 0, 0);
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
}

function main() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  try {
    runChunk(L, prelude + fs.readFileSync(path.join(TESTS, "mta_mock.lua"), "utf8") + "\n" + patches, "tests/mta_mock.lua");
    for (const rel of SHARED_FILES) runChunk(L, fs.readFileSync(path.join(ROOT, rel), "utf8"), rel);
    for (const rel of SERVER_FILES) runChunk(L, fs.readFileSync(path.join(ROOT, rel), "utf8"), rel);
    runChunk(L, fs.readFileSync(path.join(TESTS, "server_spec.lua"), "utf8"), "tests/server_spec.lua");

    lua.lua_getglobal(L, to_luastring("SERVER_REPORT"));
    const summary = readReport(L);
    lua.lua_pop(L, 1);

    console.log(`\nСерверный сценарий: ${summary.passed} passed, ${summary.failed} failed`);
    if (summary.logs.length) {
      console.log("\nЛог сервера (первые 12 строк):");
      for (const line of summary.logs.slice(0, 12)) console.log("  · " + line);
    }
    if (summary.failed > 0) process.exit(1);
  } catch (err) {
    console.error("\nСЦЕНАРИЙ УПАЛ:");
    console.error("  " + err.message.split("\n").join("\n  "));
    process.exit(1);
  } finally {
    lua.lua_close(L);
  }
}

function readField(L, tableIndex, key) {
  lua.lua_getfield(L, tableIndex, to_luastring(key));
  let value = 0;
  if (lua.lua_isnumber(L, -1)) value = lua.lua_tonumber(L, -1);
  lua.lua_pop(L, 1);
  return value;
}

function readReport(L) {
  const report = { passed: 0, failed: 0, logs: [] };
  if (lua.lua_type(L, -1) !== lua.LUA_TTABLE) return report;
  const index = lua.lua_gettop(L);
  report.passed = readField(L, index, "passed");
  report.failed = readField(L, index, "failed");

  lua.lua_getfield(L, index, to_luastring("errors"));
  if (lua.lua_type(L, -1) === lua.LUA_TTABLE) {
    const errorsIndex = lua.lua_gettop(L);
    const length = lua.lua_rawlen(L, errorsIndex);
    for (let i = 1; i <= length; i++) {
      lua.lua_rawgeti(L, errorsIndex, i);
      if (lua.lua_type(L, -1) === lua.LUA_TSTRING) report.logs.push("FAIL: " + to_jsstring(lua.lua_tostring(L, -1)));
      lua.lua_pop(L, 1);
    }
  }
  lua.lua_pop(L, 1);

  lua.lua_getglobal(L, to_luastring("MOCK"));
  if (lua.lua_type(L, -1) === lua.LUA_TTABLE) {
    const mockIndex = lua.lua_gettop(L);
    lua.lua_getfield(L, mockIndex, to_luastring("logs"));
    if (lua.lua_type(L, -1) === lua.LUA_TTABLE) {
      const logsIndex = lua.lua_gettop(L);
      const length = lua.lua_rawlen(L, logsIndex);
      for (let i = 1; i <= length && i <= 40; i++) {
        lua.lua_rawgeti(L, logsIndex, i);
        if (lua.lua_type(L, -1) === lua.LUA_TSTRING) report.logs.push(to_jsstring(lua.lua_tostring(L, -1)));
        lua.lua_pop(L, 1);
      }
    }
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1);
  return report;
}

main();
