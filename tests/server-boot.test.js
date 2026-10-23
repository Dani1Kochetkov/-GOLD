'use strict';

/**
 * Boot-тест серверного адаптера (server/index.js) в отдельном процессе
 * с подставным API RAGE: проверяет, что пакет gamemode реально поднимается,
 * регистрирует команды/события и отдаёт клиенту корректные пакеты.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'fake-rage-boot.js');
const PAYLOAD_LIMIT = 8192;

function runBoot() {
  const result = spawnSync(process.execPath, [FIXTURE], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20000,
    env: Object.assign({}, process.env, { GOLD_LOG_LEVEL: 'warn' })
  });
  assert.strictEqual(result.status, 0, `boot упал: ${result.stderr || result.stdout}`);
  const lines = String(result.stdout || '').trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  let report = null;
  try {
    report = JSON.parse(last);
  } catch (err) {
    assert.fail(`не удалось разобрать отчёт: ${last}`);
  }
  return { report, output: `${result.stdout}\n${result.stderr}` };
}

test('адаптер: gamemode поднимается, регистрирует команды и отдаёт welcome', () => {
  const { report, output } = runBoot();
  assert.deepStrictEqual(report.errors, [], `ошибки при загрузке: ${report.errors.join(' | ')}`);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.summary.hasState, true, 'игрок создан');
  assert.strictEqual(report.summary.playerAlive, true, 'игрок жив после спавна');
  assert.strictEqual(report.summary.inventorySlots, 18, 'инвентарь базового размера');
  assert.ok(report.summary.commands >= 25, `команд: ${report.summary.commands}`);
  assert.ok(!/подозрительный прыжок/.test(output), 'позиция после spawn не отклоняется анти-телепортом');
});

test('адаптер: клиент получает снапшоты, HUD и инвентарь', () => {
  const { report } = runBoot();
  const events = report.summary.events;
  assert.strictEqual(events['gold:welcome'], 1, 'welcome один раз');
  assert.ok(events['gold:catalog'] >= 1, 'каталог отправлен');
  assert.strictEqual(events['gold:map'], 1, 'карта отправлена');
  assert.ok(events['gold:inventory'] >= 1, 'инвентарь отправлен');
  assert.ok(events['gold:hud'] >= 1, 'HUD отправлен');
  assert.ok(events['gold:zombies'] >= 1, 'снапшоты зомби идут');
  assert.ok(report.summary.welcomeBytes > 0 && report.summary.welcomeBytes < PAYLOAD_LIMIT,
    `welcome влезает в лимит: ${report.summary.welcomeBytes}`);
  assert.ok(report.summary.chatMessages > 0, 'команды отвечают в чат');
});

test('адаптер: тик живёт и метрики осмысленные', () => {
  const { report } = runBoot();
  const metrics = report.summary.metrics;
  assert.ok(metrics.ticks >= 2, `тиков: ${metrics.ticks}`);
  assert.strictEqual(metrics.players, 1);
  assert.ok(metrics.snapshotsSent >= 1, 'снапшоты отправлялись');
  assert.ok(metrics.tickAvgMs >= 0 && metrics.tickAvgMs < 50, `tickAvgMs: ${metrics.tickAvgMs}`);
  assert.ok(metrics.snapshotAvgBytes > 0 && metrics.snapshotAvgBytes < PAYLOAD_LIMIT);
});
