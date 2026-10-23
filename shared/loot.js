'use strict';

/**
 * Логика лута по зонам (System 1).
 *
 * Три категории опасности, каждая со своим шансом спавна, таблицей лута
 * и таймером респавна. Модуль чистый — не знает про RAGE, поэтому
 * кушет в tests и tools/sim.js.
 *
 *   tier 1 — Гражданская (пляжи, юг ЛС, деревни): высокий шанс,
 *           еда/вода/бинты/пистолеты/холодное оружие.
 *   tier 2 — Военная (аэропорт ЛС, Сэнди, Палето-Бэй): средний шанс,
 *           автоматы, бронежилеты 1–2 ур., средняя медицина.
 *   tier 3 — ТОП-Зона (Форт-Занкудо, Лаборатория Гуман, авианосец):
 *          низкий шанс, долгий респавн, ТОП-лут.
 */

const { ITEM_KIND } = require('./constants');

const TIER_IDS = [1, 2, 3];

/** Базовая таблица тьеров. Перекрывается конфигом data/gold.config.json. */
const DEFAULT_TIERS = {
  1: {
    id: 1,
    name: 'Гражданская',
    spawnChance: 0.9,
    respawnMs: 120000,
    topUpMs: 20000,
    tables: ['civilian', 'food', 'medical', 'industrial'],
    color: '#8fc76a'
  },
  2: {
    id: 2,
    name: 'Военная',
    spawnChance: 0.6,
    respawnMs: 210000,
    topUpMs: 25000,
    tables: ['police', 'military'],
    color: '#c9a24b'
  },
  3: {
    id: 3,
    name: 'ТОП-Зона',
    spawnChance: 0.3,
    respawnMs: 300000,
    topUpMs: 45000,
    tables: ['military', 'top'],
    color: '#b64a37'
  }
};

/** Категория предмета → ключ модели для физического объекта на земле. */
function categoryOf(def) {
  if (!def) return ITEM_KIND.MATERIAL;
  if (def.ammo) return 'ammo';
  if (def.weapon) return 'weapon';
  if (def.heal) return 'medical';
  if (def.food) return 'food';
  if (def.equipable) return 'gear';
  return 'material';
}

/**
 * Объединяет дефолтные тьеры с конфигом.
 * @param {object} config data/gold.config.json
 */
function tiers(config) {
  const out = {};
  const source = config && config.loot && config.loot.tiers;
  for (let i = 0; i < TIER_IDS.length; i += 1) {
    const id = TIER_IDS[i];
    const base = DEFAULT_TIERS[id];
    const patch = source && source[String(id)];
    out[id] = Object.assign({}, base, patch || {}, { id });
    out[id].respawnMs = Math.max(10000, Number(out[id].respawnMs) || base.respawnMs);
    out[id].spawnChance = clamp01(Number(out[id].spawnChance));
    out[id].tables = Array.isArray(out[id].tables) && out[id].tables.length ? out[id].tables : base.tables;
    out[id].topUpMs = Math.max(5000, Number(out[id].topUpMs) || base.topUpMs);
  }
  return out;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Шанс спавна для зоны: падает с рангом тьера. */
function spawnChance(tierConfig, rng) {
  const chance = clamp01(Number(tierConfig && tierConfig.spawnChance));
  if (!rng || typeof rng.chance !== 'function') return chance > 0;
  return rng.chance(chance);
}

/** Таблицы лута для тьера (с дефолтным военным добавлением). */
function tablesForTier(tierConfig) {
  return Array.isArray(tierConfig && tierConfig.tables) ? tierConfig.tables.slice() : [];
}

/**
 * Выбирает предмет из одной из таблиц тьера.
 * @param {object} rng модуль Rng
 * @param {object} lootTables data/loot.json
 * @param {Array<string>} tableNames
 */
function rollTierLoot(rng, lootTables, tableNames) {
  const tables = (tableNames || []).filter((name) => lootTables && lootTables[name] && lootTables[name].length);
  if (!tables.length) return null;
  const chosen = rng.pick(tables);
  const table = lootTables[chosen];
  const picked = rng.weighted(table);
  if (!picked) return null;
  const count = rng.int(Number(picked.min) || 1, Number(picked.max) || 1);
  return { itemId: picked.item, count: Math.max(1, count), table: chosen };
}

/** Модель физического объекта для предмета. */
function modelForItem(def, models) {
  const map = models || {};
  const key = categoryOf(def);
  return map[key] || map.material || map.crate || 'prop_crate_01a';
}

/** name-модель (для клиента, чтобы просить модель заранее). */
function modelNameForItem(def, models) {
  const name = modelForItem(def, models);
  return typeof name === 'number' ? null : name;
}

module.exports = {
  TIER_IDS,
  DEFAULT_TIERS,
  tiers,
  spawnChance,
  tablesForTier,
  rollTierLoot,
  categoryOf,
  modelForItem,
  modelNameForItem,
  clamp01
};
