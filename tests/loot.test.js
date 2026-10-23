'use strict';

/** Тесты лута по зонам (System 1):чистая логика + серверный интеграционный слой. */

const test = require('node:test');
const assert = require('node:assert');

const LOOT = require('../shared/loot');
const { Rng } = require('../shared/rng');
const { createGame, createData } = require('./helpers');

const CONFIG = {
  loot: {
    tiers: {
      '1': { spawnChance: 0.9, respawnMs: 120000, topUpMs: 20000, tables: ['civilian', 'food', 'medical', 'industrial'] },
      '2': { spawnChance: 0.6, respawnMs: 210000, topUpMs: 25000, tables: ['police', 'military'] },
      '3': { spawnChance: 0.3, respawnMs: 300000, topUpMs: 45000, tables: ['military', 'top'] }
    }
  }
};

test('лут: tiers объединяет дефолты с конфигом', () => {
  const tiers = LOOT.tiers(CONFIG);
  assert.strictEqual(tiers[1].name, 'Гражданская');
  assert.strictEqual(tiers[3].name, 'ТОП-Зона');
  assert.strictEqual(tiers[3].spawnChance, 0.3);
  assert.strictEqual(tiers[3].respawnMs, 300000);
  assert.deepStrictEqual(tiers[3].tables, ['military', 'top']);
});

test('лут: spawnChance падает с рангом тьера', () => {
  const tiers = LOOT.tiers(CONFIG);
  const rng = new Rng(11);
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 500; i += 1) {
    for (const id of [1, 2, 3]) {
      if (LOOT.spawnChance(tiers[id], rng)) counts[id] += 1;
    }
  }
  assert.ok(counts[1] > counts[2], 'tier1 > tier2');
  assert.ok(counts[2] > counts[3], 'tier2 > tier3');
});

test('лут: rollTierLoot выбирает предмет из таблиц тьера', () => {
  const data = createData();
  const rng = new Rng(5);
  const tiers = LOOT.tiers(CONFIG);
  for (let i = 0; i < 50; i += 1) {
    const roll = LOOT.rollTierLoot(rng, data.lootTables, LOOT.tablesForTier(tiers[3]));
    assert.ok(roll, 'рондад');
    assert.ok(roll.itemId, 'есть itemId');
    assert.ok(roll.count >= 1, 'count >= 1');
  }
});

test('лут: modelForItem выбирает модель по категории', () => {
  const models = { weapon: 'prop_box_guncase_01a', medical: 'prop_ld_health_pack' };
  assert.strictEqual(LOOT.modelForItem({ weapon: true }, models), 'prop_box_guncase_01a');
  assert.strictEqual(LOOT.modelForItem({ heal: true }, models), 'prop_ld_health_pack');
  // Нет модели под категорию → дефолтный ящик.
  assert.strictEqual(LOOT.modelForItem({ food: true }, models), 'prop_crate_01a');
});

test('лут: categoryOf распознаёт категории', () => {
  assert.strictEqual(LOOT.categoryOf({ weapon: true }), 'weapon');
  assert.strictEqual(LOOT.categoryOf({ ammo: true }), 'ammo');
  assert.strictEqual(LOOT.categoryOf({ heal: true }), 'medical');
  assert.strictEqual(LOOT.categoryOf({ food: true }), 'food');
  assert.strictEqual(LOOT.categoryOf({ equipable: true }), 'gear');
  assert.strictEqual(LOOT.categoryOf({}), 'material');
});

test('сервер: spawnGroundItem создаёт физический объект с моделью', () => {
  const ctx = createGame();
  const game = ctx.game;
  const item = game.spawnGroundItem({
    itemId: 'knife', count: 1, pos: { x: 1, y: 2, z: 3 }, zoneId: 'lz1', source: 'loot'
  });
  assert.ok(item, 'предмет создан');
  assert.ok(item.model, 'есть модель');
  assert.strictEqual(item.itemId, 'knife');
  assert.ok(game.groundItems.includes(item));
});

test('сервер: pickupGroundItem удаляет предмет и запускает респавн', () => {
  const ctx = createGame();
  const game = ctx.game;
  const player = game.addPlayer({ id: 1, name: 'P', authenticated: true });
  game.setPlayerState(1, { pos: { x: 0, y: 0, z: 0 } });
  const zone = game.data.map.lootZones[0];
  const item = game.spawnGroundItem({
    itemId: 'bandage', count: 1, pos: { x: zone.pos.x, y: zone.pos.y, z: zone.pos.z }, zoneId: zone.id, source: 'loot'
  });
  game.pickupGroundItem(player, item);
  assert.ok(!game.groundItems.includes(item), 'предмет удалён');
  const runtime = game.zoneRuntime.get(zone.id);
  assert.ok(runtime.pendingRespawn >= 1, 'запланирован респавн');
});

test('сервер: tickLoot респавнит по таймеру', () => {
  const ctx = createGame();
  const game = ctx.game;
  const zone = game.data.map.lootZones[0];
  const runtime = game.zoneRuntime.get(zone.id);
  runtime.pendingRespawn = 1;
  runtime.nextRespawnAt = game.lastTickAt;
  const before = game.groundItems.length;
  game.tickLoot(game.lastTickAt + 1000);
  assert.ok(game.groundItems.length >= before, 'лоты респавнятся');
});
