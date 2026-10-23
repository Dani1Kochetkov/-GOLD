'use strict';

const test = require('node:test');
const assert = require('node:assert');
const AI = require('../shared/zombie-ai');
const { Rng } = require('../shared/rng');
const V = require('../shared/vec3');

const DEFS = {
  walker: {
    id: 'walker', name: 'Ходячий', health: 100, speedWalk: 0.55, speedRun: 2.1,
    damage: 8, attackRange: 1.6, attackRate: 1400, detectRange: 22, chaseRange: 55, spawnWeight: 70
  },
  runner: {
    id: 'runner', name: 'Бегун', health: 70, speedWalk: 1.2, speedRun: 3.4,
    damage: 10, attackRange: 1.6, attackRate: 1100, detectRange: 30, chaseRange: 70, spawnWeight: 22
  }
};

function makeZombie(def, pos, zone) {
  return AI.createZombie({
    id: 1,
    def: def || DEFS.walker,
    pos: pos || { x: 0, y: 0, z: 0 },
    zone: zone || { pos: { x: 0, y: 0, z: 0 }, radius: 50 },
    rng: new Rng(5)
  });
}

function player(id, pos, extra) {
  return Object.assign({ id, pos, alive: true, dimension: 0 }, extra || {});
}

test('зомби: замечает игрока в радиусе обнаружения и начинает погоню', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const ctx = { now: 1000, players: [player(7, { x: 10, y: 0, z: 0 })], rng: new Rng(1) };
  AI.stepZombie(zombie, DEFS.walker, ctx, 100);
  assert.strictEqual(zombie.state, 'chase');
  assert.strictEqual(zombie.targetId, 7);
  assert.ok(zombie.targetPos.x > 0);
});

test('зомби: не видит игрока вне радиуса и спокойно бродит', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const ctx = { now: 1000, players: [player(7, { x: 60, y: 0, z: 0 })], rng: new Rng(2) };
  AI.stepZombie(zombie, DEFS.walker, ctx, 100);
  assert.strictEqual(zombie.targetId, null);
  assert.ok(['idle', 'wander'].indexOf(zombie.state) >= 0, `состояние ${zombie.state}`);
});

test('зомби: двигается к цели с корректной скоростью', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const ctx = { now: 1000, players: [player(7, { x: 12, y: 0, z: 0 })], rng: new Rng(1) };
  const before = V.distance(zombie.pos, { x: 12, y: 0, z: 0 });
  AI.stepZombie(zombie, DEFS.walker, ctx, 1000);
  const dist = V.distance(zombie.pos, { x: 12, y: 0, z: 0 });
  assert.ok(dist < before, 'дистанция сократилась');
  // за секунду не быстрее speedRun (2.1 м) + небольшой запас
  assert.ok(before - dist <= 2.2, `слишком быстрый шаг: ${before - dist}`);
});

test('зомби: атакует в радиусе удара и соблюдает перезарядку', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const ctx = { now: 1000, players: [player(7, { x: 0.5, y: 0, z: 0 })], rng: new Rng(1) };
  const actions = AI.stepZombie(zombie, DEFS.walker, ctx, 100);
  const attack = actions.find((action) => action.type === 'attack');
  assert.ok(attack, 'первая атака');
  assert.strictEqual(attack.playerId, 7);
  assert.strictEqual(attack.damage, DEFS.walker.damage);

  const actions2 = AI.stepZombie(zombie, DEFS.walker, { now: 1100, players: ctx.players, rng: new Rng(1) }, 100);
  assert.strictEqual(actions2.filter((action) => action.type === 'attack').length, 0, 'вторая атака ещё на кулдауне');

  const actions3 = AI.stepZombie(zombie, DEFS.walker, { now: 2600, players: ctx.players, rng: new Rng(1) }, 100);
  assert.strictEqual(actions3.filter((action) => action.type === 'attack').length, 1, 'атака после кулдауна');
});

test('зомби: теряет цель и идёт к последней известной точке', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const near = { now: 1000, players: [player(7, { x: 10, y: 0, z: 0 })], rng: new Rng(1) };
  AI.stepZombie(zombie, DEFS.walker, near, 100);
  assert.strictEqual(zombie.targetId, 7);

  // Ждём гарантированного «размышления» (think раз в ~400 мс с джиттером).
  const far = { now: 2600, players: [player(7, { x: 400, y: 0, z: 0 })], rng: new Rng(1) };
  AI.stepZombie(zombie, DEFS.walker, far, 100);
  assert.strictEqual(zombie.targetId, null);
  assert.strictEqual(zombie.state, 'investigate');
  assert.ok(zombie.investigatePos, 'есть последняя известная точка');
});

test('зомби: не уходит за лиш зоны', () => {
  const zone = { pos: { x: 0, y: 0, z: 0 }, radius: 30 };
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 }, zone);
  zombie.state = 'chase';
  zombie.targetPos = { x: 5000, y: 5000, z: 0 };
  for (let i = 0; i < 200; i += 1) {
    AI.stepZombie(zombie, DEFS.walker, { now: 1000 + i * 100, players: [], rng: new Rng(i + 1) }, 100);
  }
  assert.ok(V.distance2d(zombie.pos, zone.pos) <= zone.radius + 60 + 1, `зомби ушёл на ${V.distance2d(zombie.pos, zone.pos)}`);
});

test('зомби: слышит шум и идёт проверять', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const heard = AI.hearNoise(zombie, DEFS.walker, {
    pos: { x: 15, y: 0, z: 0 }, radius: 80, at: 1000, dimension: 0
  });
  assert.strictEqual(heard, true);
  assert.strictEqual(zombie.state, 'investigate');
  AI.stepZombie(zombie, DEFS.walker, { now: 1100, players: [], rng: new Rng(1) }, 100);
  assert.strictEqual(zombie.state, 'investigate');
});

test('зомби: шум вне радиуса игнорируется', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const heard = AI.hearNoise(zombie, DEFS.walker, { pos: { x: 200, y: 0, z: 0 }, radius: 50, at: 1000 });
  assert.strictEqual(heard, false);
  assert.strictEqual(zombie.state, 'idle');
});

test('зомби: урон, смерть и агро на стрелка', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const hit = AI.damageZombie(zombie, 30, { now: 1000, sourceType: 'player', sourceId: 4 });
  assert.strictEqual(hit.dead, false);
  assert.strictEqual(zombie.hp, 70);
  assert.strictEqual(zombie.targetId, 4, 'зомби агрится на стрелка');

  const kill = AI.damageZombie(zombie, 500, { now: 1100, sourceType: 'player', sourceId: 4 });
  assert.strictEqual(kill.dead, true);
  assert.strictEqual(zombie.alive, false);
  assert.strictEqual(zombie.state, 'dead');
  assert.strictEqual(zombie.killerId, 4);
});

test('зомби: мёртвый не действует', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  AI.damageZombie(zombie, 999, { now: 1 });
  const actions = AI.stepZombie(zombie, DEFS.walker, { now: 5000, players: [player(1, { x: 1, y: 0, z: 0 })], rng: new Rng(1) }, 100);
  assert.deepStrictEqual(actions, []);
  assert.strictEqual(zombie.pos.x, 0);
});

test('зомби: выбор типа зависит от ночи', () => {
  const types = [
    { id: 'walker', spawnWeight: 70 },
    { id: 'runner', spawnWeight: 22 },
    { id: 'special', spawnWeight: 0 }
  ];
  const dayCounts = { walker: 0, runner: 0 };
  const nightCounts = { walker: 0, runner: 0 };
  const rng = new Rng(99);
  for (let i = 0; i < 3000; i += 1) {
    const day = AI.pickType(types, rng, false);
    const night = AI.pickType(types, rng, true);
    if (day) dayCounts[day.id] += 1;
    if (night) nightCounts[night.id] += 1;
  }
  assert.strictEqual(dayCounts.special || 0, 0, 'тип с spawnWeight 0 не выбирается');
  assert.ok(nightCounts.runner > dayCounts.runner, `ночью бегунов больше: ${nightCounts.runner} > ${dayCounts.runner}`);
});

test('зомби: игрок в безопасной зоне не привлекает', () => {
  const zombie = makeZombie(DEFS.walker, { x: 0, y: 0, z: 0 });
  const ctx = {
    now: 1000,
    players: [player(7, { x: 5, y: 0, z: 0 }, { inSafeZone: true })],
    rng: new Rng(1)
  };
  AI.stepZombie(zombie, DEFS.walker, ctx, 100);
  assert.strictEqual(zombie.targetId, null);
});
