'use strict';

/**
 * Загрузчик данных. Работает в обычном Node (симулятор, тесты, /reload),
 * поэтому не зависит от RAGE API.
 */

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Не удалось прочитать ${file}: ${err.message}`);
  }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @param {string} rootDir корень проекта (папка с data/)
 * @param {object} overrides частичное переопределение настроек (из ENV)
 */
function loadData(rootDir, overrides) {
  const dataDir = path.join(rootDir, 'data');
  const itemsFile = path.join(dataDir, 'items.json');
  const zombiesFile = path.join(dataDir, 'zombies.json');
  const mapFile = path.join(dataDir, 'map.json');
  const lootFile = path.join(dataDir, 'loot.json');
  const configFile = path.join(dataDir, 'gold.config.json');

  const itemsDoc = readJson(itemsFile);
  const zombiesDoc = readJson(zombiesFile);
  const mapDoc = readJson(mapFile);
  const lootDoc = readJson(lootFile);
  const configDoc = readJson(configFile);

  const items = itemsDoc.items || [];
  const itemsIndex = Object.create(null);
  for (let i = 0; i < items.length; i += 1) {
    const def = items[i];
    if (!def.id) throw new Error(`items.json: предмет без id (индекс ${i})`);
    if (itemsIndex[def.id]) throw new Error(`items.json: дубликат id "${def.id}"`);
    itemsIndex[def.id] = def;
  }

  const zombieTypes = zombiesDoc.zombies || [];
  const zombieIndex = Object.create(null);
  for (let i = 0; i < zombieTypes.length; i += 1) {
    const def = zombieTypes[i];
    if (!def.id) throw new Error(`zombies.json: тип без id (индекс ${i})`);
    zombieIndex[def.id] = def;
  }

  const lootTables = (lootDoc && lootDoc.tables) || {};
  const tableNames = Object.keys(lootTables);
  const lootZones = (mapDoc.lootZones || []);
  for (let i = 0; i < lootZones.length; i += 1) {
    const zone = lootZones[i];
    if (!lootTables[zone.lootTable]) {
      throw new Error(`map.json: зона "${zone.id}" ссылается на неизвестную таблицу лута "${zone.lootTable}"`);
    }
  }
  for (let t = 0; t < tableNames.length; t += 1) {
    const table = lootTables[tableNames[t]];
    for (let i = 0; i < table.length; i += 1) {
      if (!itemsIndex[table[i].item]) {
        throw new Error(`loot.json: таблица "${tableNames[t]}" содержит неизвестный предмет "${table[i].item}"`);
      }
    }
  }

  const config = deepMerge(configDoc, overrides || {});

  return {
    items,
    itemsIndex,
    zombieTypes,
    zombieIndex,
    lootTables,
    map: mapDoc,
    config,
    meta: {
      itemsVersion: (itemsDoc.meta && itemsDoc.meta.version) || 0,
      zombieCount: zombieTypes.length,
      lootZones: lootZones.length,
      loadedAt: Date.now()
    }
  };
}

module.exports = { loadData, readJson, deepMerge };
