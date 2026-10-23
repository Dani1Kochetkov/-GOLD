'use strict';

/**
 * Запуск настоящего server/index.js в обычном Node с подставным API RAGE.
 * Вызывается из tests/server-boot.test.js в отдельном процессе (там живёт тик 50 мс).
 *
 * Печатает JSON-отчёт в stdout. Ненулевой код — инфраструктура не поднялась.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const handlers = new Map();
const commands = new Map();
const playerCalls = [];
const broadcastCalls = [];
const chatLog = [];
const players = new Set();
const shared = { game: null, data: null };

function makePlayer(id, name) {
  const player = {
    id,
    name,
    ip: '127.0.0.1',
    position: { x: 0, y: 0, z: 0 },
    heading: 0,
    health: 100,
    dimension: 0,
    spawned: 0,
    weapons: [],
    call(eventName, args) {
      playerCalls.push({ to: id, event: eventName, args: args || [] });
    },
    outputChatBox(text) { chatLog.push({ to: id, text: String(text) }); },
    spawn(x, y, z, heading) {
      player.spawned += 1;
      player.position = { x: x, y: y, z: z };
      if (heading !== undefined) player.heading = heading;
    },
    removeAllWeapons() { player.weapons = []; },
    giveWeapon(hash, ammo) { player.weapons.push({ hash: hash, ammo: ammo }); }
  };
  return player;
}

const mp = {
  events: {
    add(eventName, fn) {
      handlers.set(eventName, fn);
    },
    call(eventName, ...args) {
      const fn = handlers.get(eventName);
      if (fn) fn(...args);
    },
    addCommand(name, fn) {
      commands.set(name, fn);
    }
  },
  players: {
    forEach(fn) { players.forEach(fn); },
    call(eventName, args) { broadcastCalls.push({ event: eventName, args: args || [] }); },
    at(id) { return Array.from(players).find((p) => p.id === id) || null; }
  },
  peds: {
    new() { return null; }
  }
};

global.mp = mp;

const report = { ok: false, errors: [] };
const originalError = console.error;
console.error = (...args) => {
  report.errors.push(args.map(String).join(' '));
  originalError.apply(console, args);
};

process.on('uncaughtException', (err) => {
  report.errors.push(`uncaught: ${err.stack || err.message}`);
  console.log(JSON.stringify(report));
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  report.errors.push(`unhandled: ${String(reason)}`);
});

try {
  const mod = require(path.join(ROOT, 'server', 'index.js'));
  shared.game = mod.game;
  shared.data = mod.data;
} catch (err) {
  report.errors.push(`boot: ${err.stack || err.message}`);
  console.log(JSON.stringify(report));
  process.exit(1);
}

const player = makePlayer(1, 'BootTester');
players.add(player);

function fire(eventName, ...args) {
  const fn = handlers.get(eventName);
  if (!fn) {
    report.errors.push(`нет обработчика ${eventName}`);
    return;
  }
  try {
    fn(player, ...args);
  } catch (err) {
    report.errors.push(`${eventName}: ${err.stack || err.message}`);
  }
}

// Жизненный цикл: join → ready → клиентские события.
fire('playerJoin');
setTimeout(() => {
  fire('playerReady');
  setTimeout(() => {
    fire('gold:ready');
    fire('gold:moveState', JSON.stringify({ m: 1, s: 0, w: 0, f: 0 }));
    fire('gold:interact', JSON.stringify({}));
    fire('gold:inv', JSON.stringify({ a: 'equip', slot: 0 }));
    fire('gold:inv', JSON.stringify({ a: 'reload' }));
    fire('gold:shot', JSON.stringify({ o: [0, 0, 1.6], t: [1, 0, 1.6] }));
    fire('gold:melee', JSON.stringify({ o: [0, 0, 1.6], t: [1, 0, 1.0] }));
    fire('gold:radio', 'проверка связи');
    fire('gold:tpway', JSON.stringify({ x: 10, y: 10, z: 30 }));
    fire('gold:respawnRequest');

    // Пара команд: игроцкая и админская (localhost разрешён политикой).
    const execute = (name, ...args) => {
      const command = commands.get(name);
      if (!command) {
        report.errors.push(`нет команды /${name}`);
        return;
      }
      try {
        command(player, name, ...args);
      } catch (err) {
        report.errors.push(`/${name}: ${err.stack || err.message}`);
      }
    };
    execute('pos');
    execute('stats');
    execute('zcount');
    execute('metrics');
    execute('help');

    setTimeout(() => {
      const state = shared.game.players.get(1);
      const events = {};
      playerCalls.forEach((entry) => { events[entry.event] = (events[entry.event] || 0) + 1; });

      report.ok = true;
      report.summary = {
        commands: commands.size,
        handlers: handlers.size,
        hasState: !!state,
        playerAlive: state ? state.alive : null,
        inventorySlots: state ? state.inventory.slots.length : 0,
        zombies: shared.game.zombies.length,
        events: events,
        welcomeBytes: (playerCalls.find((entry) => entry.event === 'gold:welcome') || { args: [''] }).args[0].length,
        catalogParts: events['gold:catalog'] || 0,
        chatMessages: chatLog.length,
        weaponsGiven: player.weapons.length,
        engineSpawns: player.spawned,
        broadcasts: broadcastCalls.length,
        metrics: shared.game.getMetrics()
      };
      console.log(JSON.stringify(report));
      process.exit(0);
    }, 400);
  }, 120);
}, 60);
