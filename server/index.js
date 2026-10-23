'use strict';

/**
 * Точка входа серверной части GOLD DAYZ для RAGE Multiplayer.
 * Регистрируется как серверный пакет packages/gold/index.js.
 *
 * Вся игровая логика — в server/game.js. Здесь только мост к API RAGE:
 * события, позиции, здоровье, оружие, тик.
 */

const path = require('path');
const { loadData } = require('./core/data');
const { Logger } = require('./core/logger');
const { ProfileStore } = require('./core/store');
const { Game, EVENTS } = require('./game');
const commands = require('./commands');
const { isAdmin, isWhitelisted } = require('./core/permissions');
const { safeJsonParse } = require('../shared/netcode');

const ROOT = path.resolve(__dirname, '..');

const logger = new Logger({
  level: process.env.GOLD_LOG_LEVEL || 'info',
  prefix: 'GOLD DAYZ',
  file: path.join(ROOT, 'logs', 'gold-dayz.log')
});

const overrides = {};
if (process.env.GOLD_PVP !== undefined) overrides.world = Object.assign({}, overrides.world, { pvp: process.env.GOLD_PVP !== '0' });
if (process.env.GOLD_SEED) overrides.seed = Number(process.env.GOLD_SEED);

let data;
try {
  data = loadData(ROOT, overrides);
} catch (err) {
  logger.error(`Критическая ошибка данных: ${err.message}`);
  throw err;
}

const store = new ProfileStore({
  enabled: data.config.persistence.enabled,
  directory: path.join(ROOT, data.config.persistence.directory || 'storage/players'),
  logger
});

/** Мост player.id <-> mp.Player, чтобы не сканировать пул на каждый вызов. */
const mpPlayers = new Map();
const engineState = new Map();

const net = {
  send(playerId, eventName, payload) {
    const player = mpPlayers.get(playerId);
    if (!player) return;
    // Возрождение: если движок успел убить педа (падение, ДТП), его нужно поднять.
    if (eventName === EVENTS.RESPAWN) {
      const data = safeJsonParse(payload, 512);
      if (data && data.pos) {
        try {
          player.spawn(data.pos.x, data.pos.y, data.pos.z, 0);
          player.heading = Number(data.heading) || player.heading;
        } catch (err) {
          logger.warn(`[spawn] ${player.name}: ${err.message}`);
        }
      }
      const engine = engineState.get(playerId);
      if (engine) {
        engine.alive = true;
        // После spawn движок сбрасывает оружие — выдадим его заново.
        engine.weaponKey = '';
      }
    }
    try {
      if (payload === undefined) player.call(eventName);
      else player.call(eventName, [payload]);
    } catch (err) {
      logger.debug(`[net] send ${eventName} -> ${playerId}: ${err.message}`);
    }
  },
  broadcast(eventName, payload) {
    try {
      mp.players.call(eventName, payload === undefined ? [] : [payload]);
    } catch (err) {
      logger.debug(`[net] broadcast ${eventName}: ${err.message}`);
    }
  },
  chat(text, playerId) {
    try {
      if (playerId === null || playerId === undefined) {
        mp.players.forEach((player) => player.outputChatBox(text));
      } else {
        const player = mpPlayers.get(playerId);
        if (player) player.outputChatBox(text);
      }
    } catch (err) {
      logger.debug(`[net] chat: ${err.message}`);
    }
  }
};

const game = new Game({
  data,
  net,
  store,
  logger,
  seed: Number(process.env.GOLD_SEED) || 20260101
});

logger.info('==============================================');
logger.info(' GOLD DAYZ — DayZ для RAGE Multiplayer');
logger.info(` предметов: ${data.items.length}, типов зомби: ${data.zombieTypes.length}, лут-зон: ${data.map.lootZones.length}`);
logger.info(` PvP: ${data.config.world.pvp ? 'вкл' : 'выкл'} | зомби-кап: ${data.config.world.zombieGlobalCap} | режим зомби: ${data.config.zombies.mode}`);
logger.info(` порт из conf.json, bind — локальный, announce выключен (dev)`);
logger.info('==============================================');

// --------------------------------------------------------------- игроки

function bindPlayer(player) {
  if (!player || mpPlayers.has(player.id)) return;
  mpPlayers.set(player.id, player);
  engineState.set(player.id, { alive: true, weaponKey: '', ammo: -1 });
}

function ensureGamePlayer(player) {
  bindPlayer(player);
  const existing = game.players.get(player.id);
  if (existing) return existing;
  const state = game.addPlayer({ id: player.id, name: player.name });
  if (state) {
    try {
      player.dimension = state.dimension;
      player.spawn(state.pos.x, state.pos.y, state.pos.z);
    } catch (err) {
      logger.warn(`[spawn] ${player.name}: ${err.message}`);
    }
    engineState.set(player.id, { alive: true, weaponKey: '', ammo: -1 });
  }
  return state;
}

mp.events.add('playerJoin', (player) => {
  if (!isWhitelisted(player, game.config)) {
    logger.info(`[access] ${player.name} (${player.ip}) отклонён: нет в вайтлисте`);
    try {
      player.kick(String(game.config.access.kickMessage || 'Сервер закрыт для теста.'));
    } catch (err) {
      logger.warn(`[access] не удалось кикнуть ${player.name}: ${err.message}`);
    }
    return;
  }
  bindPlayer(player);
  logger.info(`[join] ${player.name} (${player.ip})`);
});

mp.events.add('playerReady', (player) => {
  if (!isWhitelisted(player, game.config)) return;
  ensureGamePlayer(player);
});

mp.events.add('playerQuit', (player, exitType, reason) => {
  game.removePlayer(player.id);
  mpPlayers.delete(player.id);
  engineState.delete(player.id);
  logger.info(`[quit] ${player.name} (${exitType || 'unknown'}${reason ? `, ${reason}` : ''})`);
});

mp.events.add('playerDeath', (player, reason, killer) => {
  const state = game.players.get(player.id);
  if (!state || !state.alive) return;
  const killerState = killer && killer.id !== undefined ? game.players.get(killer.id) : null;
  game.killPlayer(state, killerState ? 'player' : 'damage', killerState);
  logger.debug(`[death] ${player.name}: engine reason ${reason}, killer ${killerState ? killerState.name : '-'}`);
});

// --------------------------------------------------------------- клиент → сервер

function onClient(eventName, handler) {
  mp.events.add(eventName, (player, ...args) => {
    try {
      if (!player || !game.players.has(player.id)) return;
      handler(player.id, ...args);
    } catch (err) {
      logger.error(`[event ${eventName}] ${err.stack || err.message}`);
    }
  });
}

// Клиент может сообщить о готовности раньше, чем сервер создал игровое состояние.
mp.events.add('gold:ready', (player) => {
  try {
    if (!player) return;
    ensureGamePlayer(player);
  } catch (err) {
    logger.error(`[event gold:ready] ${err.stack || err.message}`);
  }
});

onClient('gold:shot', (playerId, payload) => game.handleShot(playerId, payload));
onClient('gold:melee', (playerId, payload) => game.handleMelee(playerId, payload));
onClient('gold:inv', (playerId, payload) => game.handleInventoryAction(playerId, payload));
onClient('gold:interact', (playerId, payload) => game.handleInteract(playerId, payload));
onClient('gold:moveState', (playerId, payload) => game.handleMoveState(playerId, payload));
onClient('gold:respawnRequest', (playerId) => game.handleRespawnRequest(playerId));
onClient('gold:radio', (playerId, text) => game.handleRadio(playerId, text));

// Клиент присылает координаты метки на карте (админский /tpway).
onClient('gold:tpway', (playerId, payload) => {
  const player = mpPlayers.get(playerId);
  if (!player || !isAdmin(player, game.config)) return;
  const data = safeJsonParse(payload, 256);
  if (!data || !Number.isFinite(Number(data.x)) || !Number.isFinite(Number(data.y))) return;
  game.adminTeleport(playerId, Number(data.x), Number(data.y), Number.isFinite(Number(data.z)) ? Number(data.z) : 100);
});

// --------------------------------------------------------------- тик

let lastHealthSync = 0;
let lastWeaponSync = 0;

function syncPositions() {
  mp.players.forEach((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    try {
      game.setPlayerState(player.id, {
        pos: { x: player.position.x, y: player.position.y, z: player.position.z },
        heading: player.heading,
        dimension: player.dimension
      });
    } catch (err) {
      logger.debug(`[sync] position ${player.name}: ${err.message}`);
    }
  });
}

function syncHealth(now) {
  if (now - lastHealthSync < 500) return;
  lastHealthSync = now;
  mp.players.forEach((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    try {
      const target = state.alive ? Math.max(1, Math.round(state.stats.health)) : 1;
      if (Math.abs((player.health || 0) - target) > 1) player.health = target;
      if (player.dimension !== state.dimension) player.dimension = state.dimension;
    } catch (err) {
      logger.debug(`[sync] health ${player.name}: ${err.message}`);
    }
  });
}

function syncWeapons(now) {
  if (now - lastWeaponSync < 300) return;
  lastWeaponSync = now;
  mp.players.forEach((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    const engine = engineState.get(player.id) || { weaponKey: '', ammo: -1 };
    const equipped = state.inventory.equipment.primary || state.inventory.equipment.melee;
    const def = equipped ? game.getItemDef(equipped.itemId) : null;
    const weapon = def && def.weapon ? def.weapon : null;
    const ammo = equipped && equipped.meta && Number.isFinite(Number(equipped.meta.ammo)) ? Number(equipped.meta.ammo) : 0;
    const key = weapon ? `${equipped.itemId}:${weapon.hash}` : '';

    try {
      if (key !== engine.weaponKey) {
        player.removeAllWeapons();
        if (weapon) {
          // Патроны считает наш инвентарь; движку даём запас, чтобы он не блокировал выстрелы.
          player.giveWeapon(weapon.hash, 9999);
        }
        engine.weaponKey = key;
        engine.ammo = ammo;
        engineState.set(player.id, engine);
      } else if (weapon && weapon.ammoType && ammo !== engine.ammo) {
        // Не трогаем боезапас движка: им управляет наш инвентарь (см. handleShot).
        engine.ammo = ammo;
        engineState.set(player.id, engine);
      }
    } catch (err) {
      logger.debug(`[sync] weapons ${player.name}: ${err.message}`);
    }
  });
}

function syncLives() {
  mp.players.forEach((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    const engine = engineState.get(player.id) || { alive: true };
    if (!engine.alive && state.alive) {
      try {
        player.spawn(state.pos.x, state.pos.y, state.pos.z);
        player.dimension = state.dimension;
      } catch (err) {
        logger.warn(`[respawn] ${player.name}: ${err.message}`);
      }
      engine.alive = true;
      engine.weaponKey = '';
      engineState.set(player.id, engine);
    } else if (engine.alive && !state.alive) {
      engine.alive = false;
      engineState.set(player.id, engine);
    }
  });
}

const tickHandle = setInterval(() => {
  const now = Date.now();
  try {
    syncPositions();
    game.tick(now);
    syncHealth(now);
    syncWeapons(now);
    syncLives();
  } catch (err) {
    logger.error(`[tick] ${err.stack || err.message}`);
  }
}, 50);

try {
  commands.register(game, mp, logger);
} catch (err) {
  logger.error(`[cmd] ${err.stack || err.message}`);
}

function shutdown(signal) {
  logger.info(`[shutdown] ${signal}: сохраняем профили`);
  clearInterval(tickHandle);
  try {
    game.persistAll();
  } catch (err) {
    logger.error(`[shutdown] ${err.message}`);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Периодический сброс метрик в лог, чтобы видеть деградацию на VDS.
const metricsInterval = setInterval(() => {
  const metrics = game.getMetrics();
  logger.info(`[metrics] ${JSON.stringify(metrics)}`);
}, Number(data.config.debug.metricsIntervalMs) || 30000);
metricsInterval.unref && metricsInterval.unref();

logger.info('[boot] GOLD DAYZ готов. Запускайте клиент RAGE и подключайтесь к 127.0.0.1:22005');

module.exports = { game, data };
