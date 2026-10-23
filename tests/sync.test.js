'use strict';

const test = require('node:test');
const assert = require('node:assert');
const SYNC = require('../shared/sync');
const { byteLength } = require('../shared/netcode');

function zombie(id, x, y, opts) {
  const extra = opts || {};
  return {
    id,
    alive: extra.alive !== false,
    dimension: extra.dimension || 0,
    hp: extra.hp || 100,
    maxHp: 100,
    heading: 90,
    state: extra.state || 'chase',
    typeCode: extra.typeCode || 0,
    pos: { x, y, z: extra.z || 0 }
  };
}

test('синхронизация: снапшот фильтрует мёртвых, чужие измерения и дальних', () => {
  const list = [
    zombie(1, 10, 0),
    zombie(2, 50, 0),
    zombie(3, 500, 0),
    zombie(4, 5, 0, { alive: false }),
    zombie(5, 5, 0, { dimension: 2 })
  ];
  const snap = SYNC.buildSnapshot(list, { position: { x: 0, y: 0, z: 0 }, radius: 100, now: 1000 });
  const ids = snap.entries.map((row) => row[0]);
  assert.deepStrictEqual(ids, [1, 2], 'только живые в радиусе и в своём измерении');
  assert.strictEqual(snap.total, 2);
});

test('синхронизация: снапшот сортируется по расстоянию и уважает maxEntities', () => {
  const list = [];
  for (let i = 0; i < 20; i += 1) list.push(zombie(i + 1, 5 + i, 0));
  const snap = SYNC.buildSnapshot(list, {
    position: { x: 0, y: 0, z: 0 },
    radius: 200,
    maxEntities: 5,
    now: 1
  });
  assert.strictEqual(snap.entries.length, 5);
  assert.deepStrictEqual(snap.entries.map((row) => row[0]), [1, 2, 3, 4, 5]);
});

test('синхронизация: снапшот не превышает лимит байт', () => {
  const list = [];
  for (let i = 0; i < 400; i += 1) {
    list.push(zombie(100000 + i, i, i, { z: 4299.99 }));
  }
  const snap = SYNC.buildSnapshot(list, {
    position: { x: 0, y: 0, z: 0 },
    radius: 100000,
    maxEntities: 400,
    maxBytes: 7800,
    now: 1
  });
  const packed = SYNC.packSnapshot(snap);
  assert.ok(byteLength(packed) <= 7800, `payload ${byteLength(packed)} байт`);
  assert.ok(snap.entries.length > 0);
  assert.ok(snap.dropped > 0, 'лишние зомби отброшены, но не потеряны молча');
});

test('синхронизация: pack/unpack сохраняет данные', () => {
  const snap = SYNC.buildSnapshot([zombie(7, 1.25, -3.5, { state: 'attack', hp: 40 })], {
    position: { x: 0, y: 0, z: 0 }, now: 555
  });
  const packed = SYNC.packSnapshot(snap);
  const parsed = SYNC.unpackSnapshot(packed);
  assert.strictEqual(parsed.t, 555);
  assert.strictEqual(parsed.z.length, 1);
  assert.deepStrictEqual(parsed.z[0], [7, 1.25, -3.5, 0, 90, 4, 40, 0]);
});

test('синхронизация: unpackSnapshot устойчив к мусору', () => {
  assert.strictEqual(SYNC.unpackSnapshot('{oops'), null);
  assert.strictEqual(SYNC.unpackSnapshot(''), null);
  assert.strictEqual(SYNC.unpackSnapshot(null), null);
  assert.strictEqual(SYNC.unpackSnapshot('{"t":1,"z":"no"}'), null);
});

test('синхронизация: клиент интерполирует позицию между снапшотами', () => {
  const state = SYNC.createClientState();
  SYNC.applySnapshot(state, { t: 1000, z: [[1, 0, 0, 0, 0, 3, 100, 0]] }, 1000);
  SYNC.applySnapshot(state, { t: 1050, z: [[1, 10, 0, 0, 0, 3, 100, 0]] }, 1050);

  const entity = state.entities.get(1);
  assert.ok(entity, 'сущность создана');
  const half = SYNC.computePosition(entity, 1075);
  assert.ok(half.x > 0 && half.x < 10, `середина интерполяции: ${half.x}`);
  const done = SYNC.computePosition(entity, 1200);
  assert.ok(Math.abs(done.x - 10) < 0.001, `в конце движения: ${done.x}`);
});

test('синхронизация: интерполяция заголовка идёт по кратчайшей дуге', () => {
  const state = SYNC.createClientState();
  SYNC.applySnapshot(state, { t: 0, z: [[2, 0, 0, 0, 350, 1, 100, 0]] }, 0);
  SYNC.applySnapshot(state, { t: 100, z: [[2, 0, 0, 0, 10, 1, 100, 0]] }, 100);
  const entity = state.entities.get(2);
  const h = SYNC.computeHeading(entity, 150);
  assert.ok(h > 350 || h < 20, `заголовок ${h} должен идти через 0, а не через 180`);
});

test('синхронизация: старые сущности удаляются по TTL', () => {
  const state = SYNC.createClientState();
  SYNC.applySnapshot(state, { t: 0, z: [[1, 0, 0, 0, 0, 1, 100, 0]] }, 0);
  assert.strictEqual(state.entities.size, 1);
  const removed = SYNC.pruneClientState(state, 5000, 3000);
  assert.strictEqual(removed, 1);
  assert.strictEqual(state.entities.size, 0);
});

test('синхронизация: тип зомби передаётся в снапшоте', () => {
  const snap = SYNC.buildSnapshot([zombie(3, 1, 1, { typeCode: 2 })], { position: { x: 0, y: 0, z: 0 }, now: 1 });
  assert.strictEqual(snap.entries[0][7], 2);
});

test('синхронизация: интервал адаптируется под нагрузку', () => {
  assert.strictEqual(SYNC.chooseInterval(2, 0), 200, 'без зомби — реже');
  assert.strictEqual(SYNC.chooseInterval(2, 10), 50, 'мало игроков — чаще');
  assert.strictEqual(SYNC.chooseInterval(30, 10), 100, 'много игроков — реже');
});
