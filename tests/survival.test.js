'use strict';

const test = require('node:test');
const assert = require('node:assert');
const S = require('../shared/survival');
const { Rng } = require('../shared/rng');

// Тик выживания ограничен 5 секундами (защита от лаг-спайков), поэтому
// длинные интервалы прогоняем шагами по секунде.
function tickFor(stats, ctx, seconds) {
  for (let i = 0; i < seconds; i += 1) S.tick(stats, ctx, 1000);
  return stats;
}

test('выживание: голод и жажда убывают со временем', () => {
  const stats = S.createStats();
  tickFor(stats, {}, 10);
  assert.ok(Math.abs(stats.hunger - 99.5) < 0.01, 'голод -0.05/с');
  assert.ok(Math.abs(stats.thirst - 99.3) < 0.01, 'жажда -0.07/с');
  assert.strictEqual(stats.health, 100);
  assert.strictEqual(stats.alive, true);
});

test('выживание: голод на нуле отнимает здоровье', () => {
  const stats = S.createStats({ hunger: 0 });
  tickFor(stats, {}, 10);
  assert.ok(Math.abs(stats.health - 95) < 0.1, `ожидали ~95, получили ${stats.health}`);
});

test('выживание: кровотечение отнимает кровь и здоровье', () => {
  const stats = S.createStats({ bleeding: 2 });
  tickFor(stats, {}, 10);
  assert.ok(stats.health < 75, `здоровье должно упасть, получили ${stats.health}`);
  assert.ok(stats.blood < 45, `кровь должна упасть, получили ${stats.blood}`);
});

test('выживание: бинт останавливает кровотечение', () => {
  const stats = S.createStats({ bleeding: 2, blood: 50 });
  const result = S.heal(stats, { blood: 12 });
  assert.strictEqual(result.healed, true);
  assert.ok(stats.bleeding < 2, 'уровень кровотечения снизился');
  assert.ok(stats.blood > 50);
});

test('выживание: еда и вода восполняют шкалы', () => {
  const stats = S.createStats({ hunger: 10, thirst: 10 });
  S.applyFood(stats, { calories: 45, water: -5 });
  assert.strictEqual(stats.hunger, 55);
  assert.strictEqual(stats.thirst, 5);
});

test('выживание: урон с бронёй и шансом кровотечения', () => {
  const stats = S.createStats();
  const rng = new Rng(1);
  const result = S.applyDamage(stats, 50, { reduction: 0.2, bleedingChance: 1, rng, cause: 'zombie' });
  assert.ok(Math.abs(stats.health - 60) < 0.001, '50 урона - 20% = 40');
  assert.strictEqual(result.bleedingStarted, true);
  assert.strictEqual(stats.bleeding, 1);
  assert.strictEqual(result.dead, false);
});

test('выживание: смерть от потери крови', () => {
  const stats = S.createStats({ blood: 1, bleeding: 3 });
  const result = S.tick(stats, {}, 2000);
  assert.strictEqual(result.dead, true);
  assert.strictEqual(result.deathCause, 'bloodloss');
  assert.strictEqual(stats.alive, false);
  assert.ok(result.events.some((event) => event.type === 'death'));
});

test('выживание: радиация медленно убивает', () => {
  const stats = S.createStats({ radiation: 100 });
  const ctx = { radiation: 100 };
  for (let i = 0; i < 10; i += 1) S.tick(stats, ctx, 1000);
  assert.ok(stats.radiation > 50, 'радиация накопилась');
  assert.ok(stats.health < 100, 'здоровье снизилось');
});

test('выживание: перегруз не даёт восстановить стамину выше 35%', () => {
  const stats = S.createStats({ stamina: 100 });
  tickFor(stats, { weightRatio: 1.3, moving: true, sprinting: false }, 10);
  assert.ok(stats.stamina <= 35.001, `стамина ${stats.stamina}`);
});

test('выживание: холод отнимает здоровье', () => {
  const stats = S.createStats({ temperature: 33 });
  tickFor(stats, { ambientC: -5, night: true }, 10);
  assert.ok(stats.health < 100, 'на холоде здоровье падает');
});

test('выживание: стамина тратится в спринте и восстанавливается в покое', () => {
  const stats = S.createStats();
  S.tick(stats, { sprinting: true, moving: true }, 5000);
  const afterSprint = stats.stamina;
  assert.ok(afterSprint < 100);
  S.tick(stats, { moving: false }, 5000);
  assert.ok(stats.stamina > afterSprint, 'стамина восстанавливается');
});

test('выживание: причины смерти имеют русские подписи', () => {
  assert.strictEqual(S.causeLabel('zombie'), 'растерзан зомби');
  assert.strictEqual(S.causeLabel('unknown-cause'), 'погиб');
});
