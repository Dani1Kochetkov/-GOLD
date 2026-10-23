'use strict';

/** Тесты баз и безопасных зон (System 3):чистая логика + серверный интеграционный слой. */

const test = require('node:test');
const assert = require('node:assert');

const BASES = require('../shared/bases');
const { createGame } = require('./helpers');

function makeBase(opts) {
  const options = Object.assign({
    id: 'b1', name: 'База', pos: { x: 0, y: 0, z: 0 }, radius: 20,
    gate: { pos: { x: 5, y: 0, z: 1 }, heading: 0, radius: 4 }
  }, opts || {});
  return BASES.createBase(options);
}

test('база: создаётся с воротами', () => {
  const base = makeBase();
  assert.strictEqual(base.radius, 20);
  assert.strictEqual(base.owner, null);
  assert.strictEqual(base.gate.open, false);
  assert.strictEqual(base.gate.code, null);
});

test('база: claim/unclaim бесплатны и проверяют владельца', () => {
  const base = makeBase();
  const player = { id: 1, name: 'A' };
  assert.strictEqual(BASES.claimBase(base, player, 1000).ok, true);
  assert.strictEqual(base.owner, 1);
  assert.strictEqual(base.ownerName, 'A');

  const other = { id: 2, name: 'B' };
  const res = BASES.claimBase(base, other, 2000);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'owned');

  assert.strictEqual(BASES.unclaimBase(base, other).ok, false);
  assert.strictEqual(BASES.unclaimBase(base, player).ok, true);
  assert.strictEqual(base.owner, null);
});

test('база: пин-код 3–8 цифр, только у владельца', () => {
  const base = makeBase();
  const player = { id: 1, name: 'A' };
  BASES.claimBase(base, player, 1000);

  assert.strictEqual(BASES.setGateCode(base, otherPlayer(), '12', 1000).ok, false);
  assert.strictEqual(BASES.setGateCode(base, player, 'abcd', 1000).ok, false);
  assert.strictEqual(BASES.setGateCode(base, player, '1234', 1000).ok, true);
  assert.strictEqual(base.gate.code, '1234');

  const other = { id: 2, name: 'B' };
  assert.strictEqual(BASES.setGateCode(base, other, '9999', 2000).ok, false);
  assert.strictEqual(BASES.setGateCode(base, other, '9999', 2000).reason, 'not-owner');
});

function otherPlayer() { return { id: 2, name: 'B' }; }

test('база: ворота открываются у владельца или при коде', () => {
  const base = makeBase();
  const player = { id: 1, name: 'A' };
  BASES.claimBase(base, player, 1000);

  // Нет кода, не владелец — закрыты.
  assert.strictEqual(BASES.toggleGate(base, otherPlayer(), 1000).ok, false);

  BASES.setGateCode(base, player, '1234', 1000);
  const res = BASES.toggleGate(base, otherPlayer(), 1000);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.open, true);
  assert.strictEqual(BASES.toggleGate(base, otherPlayer(), 1000).open, false);
});

test('база: безопасная зона внутри радиуса', () => {
  const base = makeBase({ radius: 20 });
  assert.strictEqual(BASES.isSafeForPlayers(base, { x: 0, y: 0, z: 0 }), true);
  assert.strictEqual(BASES.isSafeForPlayers(base, { x: 25, y: 0, z: 0 }), false);
});

test('сервер: initBases создаёт базы из карты', () => {
  const ctx = createGame();
  const game = ctx.game;
  assert.ok(game.bases.length >= 1, 'базы созданы');
  assert.ok(game.baseById.has(game.bases[0].id));
});

test('сервер: claim через handleBaseAction', () => {
  const ctx = createGame();
  const game = ctx.game;
  const base = game.bases[0];
  const player = game.addPlayer({ id: 1, name: 'P', authenticated: true });
  game.setPlayerState(1, { pos: { x: base.pos.x, y: base.pos.y, z: base.pos.z } });
  player.pos = { x: base.pos.x, y: base.pos.y, z: base.pos.z };
  game.handleBaseAction(player, { base: base.id, act: 'claim' });
  assert.strictEqual(base.owner, 1);
  assert.strictEqual(base.ownerName, 'P');
});

test('сервер: gate и code через handleBaseAction', () => {
  const ctx = createGame();
  const game = ctx.game;
  const base = game.bases[0];
  const player = game.addPlayer({ id: 1, name: 'P', authenticated: true });
  player.pos = { x: base.pos.x, y: base.pos.y, z: base.pos.z };
  game.handleBaseAction(player, { base: base.id, act: 'claim' });
  game.handleBaseAction(player, { base: base.id, act: 'code', code: '4321' });
  assert.strictEqual(base.gate.code, '4321');

  const res = game.handleBaseAction(player, { base: base.id, act: 'gate' });
  assert.strictEqual(base.gate.open, true);
});

test('сервер: baseUpdate broadcast после действий', () => {
  const ctx = createGame();
  const game = ctx.game;
  const base = game.bases[0];
  const player = game.addPlayer({ id: 1, name: 'P', authenticated: true });
  player.pos = { x: base.pos.x, y: base.pos.y, z: base.pos.z };
  game.handleBaseAction(player, { base: base.id, act: 'claim' });
  const updates = ctx.net.sent.filter((m) => m.event === 'gold:baseUpdate');
  assert.ok(updates.length >= 1, 'базовый update разослан');
});
