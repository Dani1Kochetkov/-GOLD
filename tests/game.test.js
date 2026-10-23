'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createGame, spawnZombieNear, createNet } = require('./helpers');
const { EVENTS } = require('../server/game');
const { ProfileStore } = require('../server/core/store');
const INV = require('../shared/inventory');
const NET = require('../shared/netcode');

function setup(options) {
  const ctx = createGame(options);
  const player = ctx.game.addPlayer({ id: 1, name: 'Tester' });
  ctx.game.setPlayerState(1, { pos: { x: 0, y: 0, z: 0 } });
  return { ctx, game: ctx.game, net: ctx.net, player };
}

function giveWeapon(game, playerId, weaponId, ammoId, ammoCount) {
  const player = game.players.get(playerId);
  game.adminGive(playerId, weaponId, 1);
  if (ammoId) game.adminGive(playerId, ammoId, ammoCount || 30);
  const index = player.inventory.slots.findIndex((slot) => slot && slot.itemId === weaponId);
  game.handleInventoryAction(playerId, JSON.stringify({ a: 'equip', slot: index }));
  if (ammoId) game.handleInventoryAction(playerId, JSON.stringify({ a: 'reload' }));
}

function shotPayload(from, to) {
  return JSON.stringify({
    o: [from.x, from.y, from.z],
    t: [to.x, to.y, to.z]
  });
}

test('игра: подключение выдаёт стартовый набор и отправляет UI-пакеты', () => {
  const { ctx, game, net, player } = setup();
  assert.ok(player.alive);
  assert.ok(INV.countItem(player.inventory, 'knife') >= 1, 'нож в стартовом наборе');
  assert.ok(INV.countItem(player.inventory, 'map') >= 1);
  assert.ok(INV.countItem(player.inventory, 'rags') >= 2);

  const catalog = net.all(EVENTS.CATALOG);
  assert.ok(catalog.length >= 1, 'каталог отправлен');
  let items = 0;
  catalog.forEach((message) => {
    assert.ok(NET.byteLength(message.payload) <= 8192, `часть каталога ${NET.byteLength(message.payload)} байт`);
    const parsed = JSON.parse(message.payload);
    items += parsed.items.length;
  });
  assert.strictEqual(items, game.data.items.length, 'каталог целиком');
  assert.ok(net.last(1, EVENTS.MAP), 'карта отправлена');
  assert.ok(net.last(1, EVENTS.INVENTORY), 'инвентарь отправлен');
  assert.ok(net.last(1, EVENTS.HUD), 'HUD отправлен');
  assert.ok(net.last(1, EVENTS.WELCOME), 'welcome отправлен');

  const inventory = JSON.parse(net.last(1, EVENTS.INVENTORY).payload);
  assert.strictEqual(inventory.size, 18);
  assert.ok(Array.isArray(inventory.slots));
  assert.strictEqual(inventory.slots.length, 18);
  assert.ok(inventory.eq && 'primary' in inventory.eq);
  ctx.advance(100);
  assert.ok(game.getMetrics().ticks > 0);
});

test('игра: экипировка оружия и перезарядка', () => {
  const { ctx, game, net, player } = setup();
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 30);
  assert.strictEqual(player.inventory.equipment.primary.itemId, 'pistol');
  assert.strictEqual(player.inventory.equipment.primary.meta.ammo, 12, 'магазин заполнен');
  assert.strictEqual(INV.countItem(player.inventory, 'ammo_9mm'), 18);
  const inventory = JSON.parse(net.last(1, EVENTS.INVENTORY).payload);
  assert.deepStrictEqual(inventory.eq.primary[0], 'pistol');
  ctx.advance(100);
  assert.ok(game.getMetrics().ticks > 0);
});

test('игра: выстрел наносит урон зомби и тратит патрон', () => {
  const { ctx, game, net, player } = setup();
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 30);
  const zombie = spawnZombieNear(game, { x: 2, y: 0, z: 0 }, { hp: 100 });
  ctx.advance(100);
  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 0, z: 0.95 }));

  assert.strictEqual(zombie.hp, 72, 'пистолет 28 урона');
  assert.strictEqual(player.inventory.equipment.primary.meta.ammo, 11);
  assert.ok(net.last(1, EVENTS.HIT), 'клиент получил подтверждение попадания');
  assert.strictEqual(game.getMetrics().shots, 1);
  assert.strictEqual(game.getMetrics().hits, 1);
});

test('игра: пустой магазин не стреляет и не наносит урон', () => {
  const { ctx, game, net, player } = setup();
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 30);
  const zombie = spawnZombieNear(game, { x: 2, y: 0, z: 0 });
  player.inventory.equipment.primary.meta.ammo = 0;
  ctx.advance(100);
  net.clear();
  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 0, z: 0.95 }));
  assert.strictEqual(zombie.hp, 100);
  assert.strictEqual(game.getMetrics().shots, 0);
  assert.ok(net.last(1, EVENTS.SHOT), 'клиенту сообщили о пустом магазине');
});

test('игра: убийство зомби даёт очки и лут-шанс', () => {
  const { ctx, game, player } = setup();
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 30);
  const zombie = spawnZombieNear(game, { x: 2, y: 0, z: 0 }, { hp: 10 });
  ctx.advance(100);
  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 0, z: 1.0 }));
  assert.strictEqual(zombie.alive, false);
  assert.strictEqual(player.kills.zombies, 1);
  assert.ok(player.score >= 10);
  assert.strictEqual(game.getMetrics().zombiesKilled, 1);
});

test('игра: нож (ближний бой) работает без патронов', () => {
  const { ctx, game, player } = setup();
  const knifeIndex = player.inventory.slots.findIndex((slot) => slot && slot.itemId === 'knife');
  game.handleInventoryAction(1, JSON.stringify({ a: 'equip', slot: knifeIndex }));
  assert.strictEqual(player.inventory.equipment.melee.itemId, 'knife');
  const zombie = spawnZombieNear(game, { x: 1, y: 0, z: 0 });
  ctx.advance(100);
  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.0 }));
  assert.strictEqual(zombie.hp, 60, 'нож 40 урона');
  ctx.advance(1000);
  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 1, y: 0, z: 1.0 }));
  assert.strictEqual(zombie.hp, 20);
});

test('игра: подбор лута рядом и ограничение по весу', () => {
  const { ctx, game, player } = setup();
  ctx.advance(100);
  game.spawnGroundItem({ itemId: 'bandage', count: 3, pos: { x: 1, y: 0, z: 0 } });
  game.handleInteract(1, JSON.stringify({}));
  assert.strictEqual(INV.countItem(player.inventory, 'bandage'), 3);
  assert.strictEqual(game.groundItems.length, 0);

  // Перегруз: осталось 1.5 кг свободного веса, а на земле 3 металлолома по 1.5 кг.
  player.inventory.slots = new Array(18).fill(null);
  player.inventory.equipment = INV.emptyEquipment();
  INV.addItem(player.inventory, game.data.itemsIndex, 'scrap', 19, null, {});
  game.spawnGroundItem({ itemId: 'scrap', count: 3, pos: { x: 0.5, y: 0, z: 0 } });
  game.handleInteract(1, JSON.stringify({}));
  assert.strictEqual(INV.countItem(player.inventory, 'scrap'), 20, 'поместился только 1 кусок');
  const left = game.groundItems.find((item) => item.itemId === 'scrap');
  assert.ok(left && left.count === 2, 'остаток остался на земле');
});

test('игра: использование бинта лечит кровотечение и тратит предмет', () => {
  const { ctx, game, player } = setup();
  player.stats.bleeding = 2;
  player.stats.blood = 50;
  game.adminGive(1, 'bandage', 2);
  const index = player.inventory.slots.findIndex((slot) => slot && slot.itemId === 'bandage');
  ctx.advance(100);
  game.handleInventoryAction(1, JSON.stringify({ a: 'use', slot: index }));
  assert.strictEqual(player.stats.bleeding, 1);
  assert.ok(player.stats.blood > 50);
  assert.strictEqual(INV.countItem(player.inventory, 'bandage'), 1);
});

test('игра: смерть выбрасывает лут, респавн возвращает стартовый набор', () => {
  const { ctx, game, net, player } = setup();
  game.adminGive(1, 'medkit', 2);
  const before = game.groundItems.length;
  ctx.advance(100);
  game.killPlayer(player, 'zombie', null);
  assert.strictEqual(player.alive, false);
  assert.ok(game.groundItems.length > before, 'вещи выпали на землю');
  assert.strictEqual(INV.countItem(player.inventory, 'medkit'), 0);
  assert.ok(net.last(1, EVENTS.DEATH), 'клиент получил экран смерти');

  const delay = Number(game.config.spawn.respawnDelayMs) || 12000;
  ctx.advance(delay + 1000);
  // autoRespawn выключен: сервер не воскрешает игрока за спиной экрана смерти.
  assert.strictEqual(player.alive, false);
  game.handleRespawnRequest(1);
  assert.strictEqual(player.alive, true);
  assert.ok(INV.countItem(player.inventory, 'knife') >= 1, 'стартовый набор выдан');
  assert.ok(net.last(1, EVENTS.RESPAWN), 'клиенту пришёл респавн');
  assert.strictEqual(player.stats.health, 100);
});

test('игра: autoRespawn=true возрождает без запроса клиента', () => {
  const { ctx, game, player } = setup({ config: { spawn: { autoRespawn: true } } });
  ctx.advance(100);
  game.killPlayer(player, 'zombie', null);
  const delay = Number(game.config.spawn.respawnDelayMs) || 12000;
  ctx.advance(delay + 1000);
  assert.strictEqual(player.alive, true, 'сервер возродил сам');
});

test('игра: PvP урон и защита безопасной зоны', () => {
  const ctx = createGame({ seed: 11 });
  const game = ctx.game;
  const first = game.addPlayer({ id: 1, name: 'Alpha' });
  const second = game.addPlayer({ id: 2, name: 'Bravo' });
  // Спавн-неуязвимость мешает тесту боевой механики — снимаем.
  first.invulnerableUntil = 0;
  second.invulnerableUntil = 0;
  game.setPlayerState(1, { pos: { x: 0, y: 0, z: 0 } });
  game.setPlayerState(2, { pos: { x: 6, y: 0, z: 0 } });
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 30);
  ctx.advance(100);

  game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 6, y: 0, z: 1.0 }));
  assert.ok(second.stats.health < 100, `PvP урон нанесён (${second.stats.health})`);
  assert.ok(first.kills.players === 0 || second.alive === false);

  // Безопасная зона: оба в лагере выживших.
  const safe = game.data.map.safeZones[0];
  game.setPlayerState(1, { pos: safe.pos, force: true });
  game.setPlayerState(2, { pos: { x: safe.pos.x + 2, y: safe.pos.y, z: safe.pos.z }, force: true });
  ctx.advance(500);
  assert.strictEqual(first.safeZoneId, safe.id);
  assert.strictEqual(second.safeZoneId, safe.id);
  const hpBefore = second.stats.health;
  first.lastShotAt = 0;
  game.handleShot(1, shotPayload(safe.pos, { x: safe.pos.x + 2, y: safe.pos.y, z: safe.pos.z + 1 }));
  assert.strictEqual(second.stats.health, hpBefore, 'в безопасной зоне урон не проходит');
});

test('игра: зомби спавнятся рядом с игроком в Палето-Бей', () => {
  const ctx = createGame({ seed: 21 });
  const game = ctx.game;
  game.addPlayer({ id: 1, name: 'Zoner' });
  game.setPlayerState(1, { pos: { x: -275, y: 6450, z: 32 } });
  ctx.advance(20000);
  assert.ok(game.zombies.length > 0, 'зомби заспавнились');
  const metrics = game.getMetrics();
  assert.ok(metrics.zombiesAlive > 0);
  const snapshot = ctx.net.last(1, EVENTS.ZOMBIES);
  assert.ok(snapshot, 'снапшот отправлен');
  assert.ok(NET.byteLength(snapshot.payload) <= 8192);
});

test('игра: зомби наносит урон игроку', () => {
  const { ctx, game, player } = setup();
  player.invulnerableUntil = 0;
  player.stats.health = 100;
  const zombie = spawnZombieNear(game, { x: 0.8, y: 0, z: 0 }, { hp: 100 });
  zombie.nextThinkAt = 0;
  ctx.advance(3000);
  assert.ok(player.stats.health < 100, `здоровье ${player.stats.health}`);
});

test('игра: токсичная зона без противогаза отнимает здоровье', () => {
  const ctx = createGame({ seed: 31 });
  const game = ctx.game;
  const player = game.addPlayer({ id: 1, name: 'Tox' });
  const zone = game.data.map.toxinZones[0];
  game.setPlayerState(1, { pos: zone.pos });
  player.invulnerableUntil = 0;
  ctx.advance(4000);
  assert.ok(player.stats.health < 100, 'токсины нанесли урон');
  assert.ok(player.stats.radiation > 0, 'радиация накопилась');
});

test('игра: большие снапшоты не превышают лимит player.call', () => {
  const { ctx, game, player } = setup();
  for (let i = 0; i < 150; i += 1) {
    spawnZombieNear(game, { x: 5 + i * 0.5, y: 5, z: 0 }, { id: 1000 + i });
  }
  ctx.net.clear();
  ctx.advance(300);
  const messages = ctx.net.all(EVENTS.ZOMBIES);
  assert.ok(messages.length > 0, 'снапшоты отправлялись');
  messages.forEach((message) => {
    assert.ok(NET.byteLength(message.payload) <= 8192, `payload ${NET.byteLength(message.payload)}`);
    const parsed = JSON.parse(message.payload);
    assert.ok(parsed.z.length <= 96);
  });
  assert.ok(player.alive);
});

test('игра: лимит частоты выстрелов работает', () => {
  const { ctx, game } = setup();
  giveWeapon(game, 1, 'pistol', 'ammo_9mm', 200);
  spawnZombieNear(game, { x: 2, y: 0, z: 0 });
  ctx.advance(100);
  const before = game.getMetrics().shots;
  for (let i = 0; i < 40; i += 1) {
    game.handleShot(1, shotPayload({ x: 0, y: 0, z: 1.6 }, { x: 2, y: 0, z: 1 }));
  }
  const fired = game.getMetrics().shots - before;
  assert.ok(fired <= 20, `за один тик не больше лимита, получилось ${fired}`);
});

test('игра: профиль сохраняется и загружается', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-dayz-test-'));
  try {
    const store = new ProfileStore({ directory: dir, logger: { warn() {} } });
    const first = createGame({ store, seed: 5 });
    first.game.addPlayer({ id: 1, name: 'Saver' });
    first.game.adminGive(1, 'medkit', 2);
    first.game.persistPlayer(first.game.players.get(1));

    const second = createGame({ store, seed: 6 });
    second.game.addPlayer({ id: 1, name: 'Saver' });
    const restored = second.game.players.get(1);
    assert.ok(INV.countItem(restored.inventory, 'medkit') >= 1, 'предмет восстановлен из профиля');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('игра: метрики и мир адекватны', () => {
  const { ctx, game } = setup();
  ctx.advance(2000);
  const metrics = game.getMetrics();
  assert.ok(metrics.ticks > 0);
  assert.ok(metrics.tickAvgMs >= 0);
  assert.ok(game.worldHour >= 0 && game.worldHour < 24);
  assert.strictEqual(typeof game.isNight(), 'boolean');
  assert.ok(game.getMetrics().uptimeSec >= 0);
});

test('игра: /reload данных не ломает мир', () => {
  const { ctx, game } = setup();
  const data = require('./helpers').createData();
  game.reloadData(data);
  assert.strictEqual(game.data.items.length, data.items.length);
  ctx.advance(200);
  assert.ok(game.players.size === 1);
});

test('игра: админ-команды', () => {
  const { ctx, game, player } = setup();
  ctx.advance(100);
  const spawned = game.adminSpawnZombies(3, { x: 5, y: 5, z: 0 });
  assert.strictEqual(spawned, 3);
  assert.ok(game.zombies.length >= 3);
  const cleared = game.adminClearZombies();
  assert.ok(cleared >= 3);
  assert.strictEqual(game.zombies.length, 0);

  assert.strictEqual(game.adminTeleport(1, 10, 10, 10), true);
  assert.strictEqual(player.pos.x, 10);
  assert.strictEqual(game.setStat(1, 'health', 42), true);
  assert.strictEqual(player.stats.health, 42);
  assert.strictEqual(game.setStat(1, 'god', true), true);
  assert.strictEqual(player.godMode, true);

  const stats = game.adminStats(1);
  assert.ok(typeof stats.hp === 'number');
  assert.ok(netHas(ctx.net, EVENTS.TELEPORT));
});

function netHas(net, event) {
  return net.all(event).length > 0;
}
