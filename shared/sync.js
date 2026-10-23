'use strict';

/**
 * Компактный протокол синхронизации зомби.
 *
 * Снапшот — JSON в одном player.call(), поэтому важно экономить байты:
 * RAGE:MP режет payload на 8192 байтах.
 * Формат: [id, x, y, z, heading, state, hpPercent, typeCode].
 */

const { SYNC } = require('./constants');
const V = require('./vec3');

const STATE_CODES = { idle: 0, wander: 1, investigate: 2, chase: 3, attack: 4, dead: 5 };
const STATE_NAMES = ['idle', 'wander', 'investigate', 'chase', 'attack', 'dead'];

function stateCode(state) {
  const code = STATE_CODES[state];
  return typeof code === 'number' ? code : 0;
}

function stateName(code) {
  return STATE_NAMES[code] || 'idle';
}

function round(value, digits) {
  const k = digits === 1 ? 10 : 100;
  return Math.round((Number(value) || 0) * k) / k;
}

/** Адаптивный интервал снапшотов: на локальной отладке важна отзывчивость. */
function chooseInterval(playersOnline, zombiesVisible) {
  if (!zombiesVisible) return SYNC.SNAPSHOT_INTERVAL_IDLE;
  if (playersOnline >= SYNC.SNAPSHOT_BUSY_PLAYERS) return SYNC.SNAPSHOT_INTERVAL_BUSY;
  return SYNC.SNAPSHOT_INTERVAL;
}

function toEntry(zombie) {
  return [
    zombie.id,
    round(zombie.pos.x, 2),
    round(zombie.pos.y, 2),
    round(zombie.pos.z, 2),
    Math.round(((zombie.heading || 0) % 360) * 10) / 10,
    stateCode(zombie.state),
    Math.max(0, Math.min(100, Math.round((zombie.hp / (zombie.maxHp || 1)) * 100))),
    Number(zombie.typeCode) || 0
  ];
}

/**
 * Собирает снапшот для одного наблюдателя.
 * @param {Array} zombies
 * @param {object} opts { position, radius, maxEntities, maxBytes, now, dimension, includeStates }
 */
function buildSnapshot(zombies, opts) {
  const options = opts || {};
  const radius = Number(options.radius) || SYNC.SNAPSHOT_RADIUS;
  const maxEntities = Math.max(1, Math.min(SYNC.SNAPSHOT_MAX_ZOMBIES, Number(options.maxEntities) || SYNC.SNAPSHOT_MAX_ZOMBIES));
  const maxBytes = Math.max(512, Number(options.maxBytes) || SYNC.MAX_PAYLOAD_BYTES);
  const origin = options.position || { x: 0, y: 0, z: 0 };
  const dimension = options.dimension || 0;

  const candidates = [];
  for (let i = 0; i < zombies.length; i += 1) {
    const zombie = zombies[i];
    if (!zombie || !zombie.alive) continue;
    if ((zombie.dimension || 0) !== dimension) continue;
    const dist = V.distance(origin, zombie.pos);
    if (dist > radius) continue;
    candidates.push({ zombie, dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const entries = [];
  let bytes = 32; // {"t":0,"z":[]}
  let dropped = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    if (entries.length >= maxEntities) {
      dropped = candidates.length - entries.length;
      break;
    }
    const entry = toEntry(candidates[i].zombie);
    const size = JSON.stringify(entry).length + 1;
    if (bytes + size > maxBytes) {
      dropped = candidates.length - entries.length;
      break;
    }
    entries.push(entry);
    bytes += size;
  }

  return {
    entries,
    count: entries.length,
    bytes,
    dropped,
    total: candidates.length,
    now: Number(options.now) || Date.now()
  };
}

function packSnapshot(snapshot) {
  return JSON.stringify({ t: snapshot.now, z: snapshot.entries });
}

function unpackSnapshot(payload) {
  if (typeof payload !== 'string' || !payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || !Array.isArray(parsed.z)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function createClientState() {
  return { entities: new Map(), lastSnapshotAt: 0, lastBytes: 0 };
}

/** Применяет снапшот и настраивает интерполяцию между кадрами. */
function applySnapshot(state, snapshot, now) {
  const time = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const received = snapshot && Array.isArray(snapshot.z) ? snapshot.z : [];
  const seen = new Set();

  for (let i = 0; i < received.length; i += 1) {
    const row = received[i];
    if (!Array.isArray(row) || row.length < 7) continue;
    const typeCode = row.length > 7 ? Number(row[7]) || 0 : 0;
    const id = row[0];
    const pos = { x: row[1], y: row[2], z: row[3] };
    seen.add(id);
    let entity = state.entities.get(id);
    if (!entity) {
      entity = {
        id,
        from: V.copy(pos),
        to: V.copy(pos),
        pos: V.copy(pos),
        heading: row[4],
        targetHeading: row[4],
        state: stateName(row[5]),
        hp: row[6],
        typeCode,
        startedAt: time,
        duration: 0,
        lastSeenAt: time
      };
      state.entities.set(id, entity);
      continue;
    }
    const rendered = computePosition(entity, time);
    entity.from = rendered;
    entity.to = V.copy(pos);
    entity.pos = V.copy(pos);
    entity.heading = entity.targetHeading;
    entity.targetHeading = row[4];
    entity.state = stateName(row[5]);
    entity.hp = row[6];
    entity.typeCode = typeCode;
    const delta = time - entity.lastSeenAt;
    entity.duration = Math.max(40, Math.min(500, delta));
    entity.startedAt = time;
    entity.lastSeenAt = time;
  }

  state.lastSnapshotAt = time;
  state.lastBytes = received.length;
  return { seen: seen.size, removed: pruneClientState(state, time) };
}

function interpolateAngle(from, to, t) {
  let delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function computePosition(entity, now) {
  if (!entity || !entity.to) return { x: 0, y: 0, z: 0 };
  if (!entity.duration) return V.copy(entity.to);
  const t = Math.max(0, Math.min(1, (Number(now) - entity.startedAt) / entity.duration));
  return {
    x: V.lerp(entity.from.x, entity.to.x, t),
    y: V.lerp(entity.from.y, entity.to.y, t),
    z: V.lerp(entity.from.z, entity.to.z, t)
  };
}

function computeHeading(entity, now) {
  if (!entity) return 0;
  if (!entity.duration) return entity.targetHeading || 0;
  const t = Math.max(0, Math.min(1, (Number(now) - entity.startedAt) / entity.duration));
  return interpolateAngle(entity.heading || 0, entity.targetHeading || 0, t);
}

/** Убирает зомби, которые давно не приходили в снапшотах. */
function pruneClientState(state, now, ttlMs) {
  const ttl = Number(ttlMs) || 3000;
  let removed = 0;
  const ids = Array.from(state.entities.keys());
  for (let i = 0; i < ids.length; i += 1) {
    const entity = state.entities.get(ids[i]);
    if (!entity || now - entity.lastSeenAt > ttl) {
      state.entities.delete(ids[i]);
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  STATE_CODES,
  STATE_NAMES,
  stateCode,
  stateName,
  chooseInterval,
  toEntry,
  buildSnapshot,
  packSnapshot,
  unpackSnapshot,
  createClientState,
  applySnapshot,
  computePosition,
  computeHeading,
  pruneClientState
};
