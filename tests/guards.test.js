'use strict';

/** Тесты нпц-охраны ТОП-зон (System 2): чистая логика + серверный интеграционный слой. */

const test = require('node:test');
const assert = require('node:assert');

const GUARDS = require('../shared/guards');
const { Rng } = require('../shared/rng');
const V = require('../shared/vec3');
const { createGame } = require('./helpers');

const MARINE = {
  id: 'marine', name: 'Морской пехотинец', model: 'S_M_Y_Marine_01',
  health: 200, armor: 100, weapon: 'carbinerifle', damage: 12,
  attackRange: 45, aggroRange: 40, patrolRadius: 50, attackRateMs: 900,
  accuracy: 0.75, dropTable: 'top'
};

function makeGuard(opts) {
  const options = Object.assign({
    id: 1, def: MARINE, pos: { x: 0, y: 0, z: 0 }, zone: { pos: { x: 0, y: 0, z: 0 }, radius: 50 }, rng: new Rng(7)
  }, opts || {});
  return GUARDS.createGuard(options);
}

test('охрана: создаётся с правильными параметрами', () => {
  const g = makeGuard();
  assert.strictEqual(g.health, 200);
  assert.strictEqual(g.maxHealth, 200);
  assert.strictEqual(g.armor, 100);
  assert.strictEqual(g.weapon, 'carbinerifle');
  assert.strictEqual(g.dropTable, 'top');
  assert.strictEqual(g.alive, true);
  assert.strictEqual(g.state, GUARDS.GUARD_STATE.PATROL);
});

test('охрана: патрулит внутри радиуса zone', () => {
  const g = makeGuard({ pos: { x: 10, y: 10, z: 0 } });
  const rng = new Rng(3);
  let moved = false;
  for (let i = 0; i < 20; i += 1) {
    GUARDS.stepGuard(g, { now: 1000 + i * 600, rng, players: [] }, 600);
    if (V.distance2d(g.pos, { x: 10, y: 10 }) > 1) moved = true;
  }
  assert.ok(moved, 'охранник отходит от центра патруля');
  assert.ok(V.distance2d(g.pos, g.zoneCenter) <= g.patrolRadius + 35, 'не ушёл за лейш');
});

test('охрана: агрегирует и атакует на расстоянии атаки', () => {
  const g = makeGuard({ pos: { x: 0, y: 0, z: 0 } });
  // В пределах attackRange (45) — прямая атака.
  const player = { id: 5, alive: true, dimension: 0, pos: { x: 30, y: 0, z: 0 }, inSafeZone: false };
  const actions = GUARDS.stepGuard(g, { now: 1000, rng: new Rng(1), players: [player] }, 500);
  assert.strictEqual(g.state, GUARDS.GUARD_STATE.ATTACK);
  assert.ok(actions.some((a) => a.type === 'aggro'));
});

test('охрана: вне aggroRange не агрегирует', () => {
  const g = makeGuard({ pos: { x: 0, y: 0, z: 0 } });
  const player = { id: 5, alive: true, dimension: 0, pos: { x: 200, y: 0, z: 0 }, inSafeZone: false };
  GUARDS.stepGuard(g, { now: 1000, rng: new Rng(1), players: [player] }, 500);
  assert.notStrictEqual(g.state, GUARDS.GUARD_STATE.ATTACK);
  assert.notStrictEqual(g.state, GUARDS.GUARD_STATE.AGGRO);
});

test('охрана: не агрегает в безопасной зоне', () => {
  const g = makeGuard({ pos: { x: 0, y: 0, z: 0 } });
  const player = { id: 5, alive: true, dimension: 0, pos: { x: 10, y: 0, z: 0 }, inSafeZone: true };
  GUARDS.stepGuard(g, { now: 1000, rng: new Rng(1), players: [player] }, 500);
  assert.notStrictEqual(g.state, GUARDS.GUARD_STATE.AGGRO);
  assert.notStrictEqual(g.state, GUARDS.GUARD_STATE.ATTACK);
});

test('охрана: стреляет в атаке с заданной точностью', () => {
  const g = makeGuard({ pos: { x: 0, y: 0, z: 0 } });
  g.attackReadyAt = 0;
  const player = { id: 5, alive: true, dimension: 0, pos: { x: 10, y: 0, z: 0 }, inSafeZone: false };
  const actions = [];
  for (let i = 0; i < 10; i += 1) {
    actions.push.apply(actions, GUARDS.stepGuard(g, { now: 1000 + i * 1000, rng: new Rng(42), players: [player] }, 1000));
  }
  const shots = actions.filter((a) => a.type === 'shot');
  assert.ok(shots.length >= 1, 'хотя бы один выстрел');
  assert.strictEqual(shots[0].playerId, 5);
  assert.strictEqual(shots[0].damage, 12);
});

test('охрана: урон резится бронёй, смерть → dead', () => {
  const g = makeGuard();
  const res = GUARDS.damageGuard(g, 100, { sourceType: 'player', sourceId: 9, now: 1000 });
  assert.strictEqual(res.dead, false);
  assert.ok(g.health < 200 && g.health > 0, 'броня снизила урон');
  assert.strictEqual(g.state, GUARDS.GUARD_STATE.AGGRO);

  const res2 = GUARDS.damageGuard(g, 100000, { sourceId: 9, now: 2000 });
  assert.strictEqual(res2.dead, true);
  assert.strictEqual(g.alive, false);
  assert.strictEqual(g.state, 'dead');
  assert.strictEqual(g.killerId, 9);
});

test('охрана: мёртвый не действует', () => {
  const g = makeGuard();
  g.alive = false;
  const actions = GUARDS.stepGuard(g, { now: 1000, rng: new Rng(1), players: [] }, 500);
  assert.deepStrictEqual(actions, []);
});

test('сервер: spawnGuardInZone создаёт охранника с typeCode', () => {
  const ctx = createGame();
  const game = ctx.game;
  const zone = { id: 'top1', pos: { x: 0, y: 0, z: 0 }, radius: 40, tier: 3 };
  const guard = game.spawnGuardInZone(zone, game.lastTickAt);
  assert.ok(guard, 'охранник создан');
  assert.strictEqual(guard.typeCode, 0);
  assert.ok(guard.id > 0);
  assert.ok(game.guards.includes(guard));
});

test('сервер: guardsAlive в метриках', () => {
  const ctx = createGame();
  const game = ctx.game;
  const zone = { id: 'top1', pos: { x: 0, y: 0, z: 0 }, radius: 40, tier: 3 };
  game.spawnGuardInZone(zone, game.lastTickAt);
  const metrics = game.getMetrics();
  assert.strictEqual(metrics.guardsTotal, 1);
  assert.strictEqual(metrics.guardsAlive, 1);
});

test('сервер: tickGuards передаёт ctx и охрана стреляет в игрока', () => {
  const ctx = createGame();
  const game = ctx.game;
  const player = game.addPlayer({ id: 1, name: 'P', authenticated: true });
  game.setPlayerState(1, { pos: { x: 0, y: 0, z: 0 } });
  player.pos = { x: 0, y: 0, z: 0 };
  player.stats.health = 100;

  const guard = GUARDS.createGuard({
    id: 50, def: MARINE, pos: { x: 8, y: 0, z: 0 },
    zone: { pos: { x: 0, y: 0, z: 0 }, radius: 50 }, zoneId: 'top1', rng: game.rng
  });
  guard.nextThinkAt = 0;
  guard.attackReadyAt = 0;
  game.guards.push(guard);
  game.guardById.set(guard.id, guard);

  const before = player.stats.health;
  // Прогоняем несколько тиков: охрана должна атаковать и ранить игрока.
  for (let i = 0; i < 6; i += 1) {
    game.tickGuards(game.lastTickAt + 1000 + i * 1000, 1000);
  }
  assert.strictEqual(guard.state, GUARDS.GUARD_STATE.ATTACK, 'охрана в режиме атаки');
  assert.ok(player.stats.health < before, 'игрок получил урон от охраны');
});
