'use strict';

const fs = require('fs');
const path = require('path');
const { InventoryStore, ZombieDirector, distance3d } = require('./game');
const settings = require('../../../shared/settings.json');

const dataDir = path.join(__dirname, '..', 'data');
const stateFile = path.join(dataDir, 'players.json');
let persistedPlayers = {};
try {
  persistedPlayers = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') console.error('[GOLD DAYZ] Не удалось прочитать players.json:', error.message);
}

const inventory = new InventoryStore(settings.inventory, persistedPlayers);
const zombies = new ZombieDirector(settings.zombie);
zombies.seed();
const lastHitAt = new Map();
let saveTimer;

function savePlayers() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const tempFile = stateFile + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(persistedPlayers, null, 2));
    fs.renameSync(tempFile, stateFile);
  } catch (error) {
    console.error('[GOLD DAYZ] Ошибка сохранения инвентарей:', error.message);
  }
}

function playerKey(player) {
  // Локальный прототип: имя — только запасной ключ; для публичного сервера
  // замените его на проверенную авторизацию/аккаунтную систему.
  return String(player.socialClub || player.name || 'unknown').toLowerCase();
}

function sendInventory(player) {
  const values = inventory.get(playerKey(player));
  const lines = Object.keys(settings.inventory).map((id) =>
    `${settings.inventory[id].label}: ${values[id]}`
  );
  player.outputChatBox(`!{#d7b45a}[GOLD DAYZ] Инвентарь — ${lines.join(' | ')}`);
}

function sendHelp(player) {
  player.outputChatBox('!{#d7b45a}[GOLD DAYZ] Команды: /help, /inv, /zombies, /pos. Подойдите к заражённому и нажмите E.');
}

mp.events.add('playerJoin', (player) => {
  player.name = player.name || 'Survivor';
  player.spawn(new mp.Vector3(settings.spawn.x, settings.spawn.y, settings.spawn.z));
  player.heading = settings.spawn.heading;
  player.health = 100;
  player.armour = 0;
  player.outputChatBox(`!{#d7b45a}Добро пожаловать в ${settings.serverName}. Локальный тестовый режим — /help`);
});

mp.events.add('playerQuit', (player) => {
  lastHitAt.delete(playerKey(player));
  savePlayers();
});

mp.events.add('playerCommand', (player, command) => {
  const parts = String(command || '').trim().split(/\s+/);
  const name = (parts.shift() || '').toLowerCase();
  if (name === 'help') sendHelp(player);
  if (name === 'inv' || name === 'inventory') sendInventory(player);
  if (name === 'zombies') player.outputChatBox(`!{#d7b45a}[GOLD DAYZ] Активных заражённых: ${zombies.zombies.size}`);
  if (name === 'pos') {
    const p = player.position;
    player.outputChatBox(`!{#d7b45a}[GOLD DAYZ] x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}, z: ${p.z.toFixed(2)}`);
  }
});

mp.events.add('gold:ready', (player) => {
  player.call('gold:zombies:snapshot', [zombies.snapshot()]);
});

mp.events.add('gold:zombie:hit', (player, id) => {
  const key = playerKey(player);
  const now = Date.now();
  const last = lastHitAt.get(key) || 0;
  if (now - last < settings.zombie.hitCooldownMs) return;
  const zombie = zombies.zombies.get(String(id));
  if (!zombie || distance3d(player.position, zombie) > settings.zombie.hitRange) return;
  lastHitAt.set(key, now);

  const result = zombies.damage(id, settings.zombie.hitDamage);
  if (!result) return;
  mp.players.forEach((target) => target.call('gold:zombies:update', [result]));
  if (result.dead) {
    // Детерминированная тестовая награда; инвентарь остаётся серверным.
    if (inventory.add(key, 'food', 1)) {
      player.outputChatBox('!{#d7b45a}[GOLD DAYZ] Заражённый повержен: найдены консервы. /inv');
      savePlayers();
    } else {
      player.outputChatBox('!{#d7b45a}[GOLD DAYZ] Заражённый повержен. Инвентарь заполнен.');
    }
  }
});

saveTimer = setInterval(savePlayers, 30000);
if (saveTimer && typeof saveTimer.unref === 'function') saveTimer.unref();
console.log(`[GOLD DAYZ] Загружено заражённых: ${zombies.zombies.size}. Слушайте порт ${require('../../../conf.json').port}.`);
