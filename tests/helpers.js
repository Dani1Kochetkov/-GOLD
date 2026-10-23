'use strict';

const path = require('path');
const { loadData } = require('../server/core/data');
const { Game } = require('../server/game');
const { RateLimiter } = require('../shared/netcode');

const ROOT = path.resolve(__dirname, '..');

function createNet() {
  const sent = [];
  return {
    sent,
    send(playerId, event, payload) {
      sent.push({ playerId, event, payload });
    },
    broadcast(event, payload) {
      sent.push({ playerId: null, event, payload });
    },
    chat() {},
    log() {},
    last(playerId, event) {
      for (let i = sent.length - 1; i >= 0; i -= 1) {
        if (sent[i].playerId === playerId && sent[i].event === event) return sent[i];
      }
      return null;
    },
    all(event) {
      return sent.filter((message) => message.event === event);
    },
    clear() {
      sent.length = 0;
    }
  };
}

const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {}
};

function createData() {
  return loadData(ROOT);
}

/** Небольшой deep-merge: тестам нужно менять 1–2 поля конфига. */
function mergeConfig(target, patch) {
  const out = Object.assign({}, target);
  Object.keys(patch || {}).forEach((key) => {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && target && typeof target[key] === 'object') {
      out[key] = mergeConfig(target[key], value);
    } else {
      out[key] = value;
    }
  });
  return out;
}

function createGame(options) {
  const opts = options || {};
  const data = opts.data || createData();
  if (opts.config) data.config = mergeConfig(data.config, opts.config);
  const net = opts.net || createNet();
  let clock = opts.startTime || 1700000000000;
  const game = new Game({
    data,
    net,
    seed: opts.seed || 1234,
    logger: opts.logger || silentLogger,
    store: opts.store || null,
    now: clock
  });

  function advance(ms) {
    const step = Number(opts.stepMs) || 100;
    const total = Math.max(step, ms);
    let elapsed = 0;
    while (elapsed < total) {
      clock += step;
      elapsed += step;
      game.tick(clock);
    }
    return clock;
  }

  function now() {
    return clock;
  }

  return { game, net, data, advance, now, get clock() { return clock; } };
}

function spawnZombieNear(game, pos, opts) {
  const AI = require('../shared/zombie-ai');
  const options = opts || {};
  const def = options.def || game.data.zombieTypes.find((type) => type.id === (options.typeId || 'walker')) || game.data.zombieTypes[0];
  const zombie = AI.createZombie({
    id: options.id || 9000 + game.zombies.length,
    def,
    pos: pos || { x: 0, y: 0, z: 0 },
    zone: options.zone || { pos: pos || { x: 0, y: 0, z: 0 }, radius: options.radius || 60 },
    zoneId: options.zoneId || 'test',
    rng: game.rng,
    typeCode: 0
  });
  if (options.hp) zombie.hp = options.hp;
  game.zombies.push(zombie);
  game.zombieById.set(zombie.id, zombie);
  return zombie;
}

module.exports = { ROOT, createNet, createData, createGame, spawnZombieNear, silentLogger, RateLimiter };
