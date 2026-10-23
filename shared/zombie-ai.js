'use strict';

/**
 * Детерминированный ИИ зомби GOLD DAYZ.
 *
 * Важно: модуль не знает ничего про RAGE. Он двигает зомби по позициям,
 * а сервер превращает результат в снапшоты/команды клиентам.
 * Именно поэтому логику можно гонять в симуляторе (tools/sim.js) и в тестах.
 */

const { ZOMBIE } = require('./constants');
const V = require('./vec3');

function createZombie(options) {
  const opts = options || {};
  const def = opts.def || {};
  const pos = V.copy(opts.pos || { x: 0, y: 0, z: 0 });
  const rng = opts.rng;
  return {
    id: opts.id,
    typeId: def.id || 'walker',
    typeCode: Number.isFinite(Number(opts.typeCode)) ? Number(opts.typeCode) : 0,
    name: def.name || 'Зомби',
    model: def.model || 'u_m_y_zombie_01',
    tint: def.tint || 0,
    hp: Number(def.health) || 100,
    maxHp: Number(def.health) || 100,
    pos,
    spawnPos: V.copy(pos),
    heading: opts.heading || 0,
    state: 'idle',
    targetId: null,
    targetPos: null,
    lastSeenAt: 0,
    investigatePos: null,
    investigateUntil: 0,
    attackReadyAt: 0,
    screamReadyAt: 0,
    nextThinkAt: 0,
    nextWanderAt: 0,
    wanderPos: null,
    zoneId: opts.zoneId || null,
    zoneCenter: V.copy((opts.zone && opts.zone.pos) || pos),
    zoneRadius: Number((opts.zone && opts.zone.radius) || 50),
    dimension: opts.dimension || 0,
    alive: true,
    deathAt: 0,
    killerId: null,
    controllerId: opts.controllerId || null,
    jitter: rng ? rng.float(0.85, 1.2) : 1,
    lastMoveAt: 0
  };
}

function nearestPlayer(zombie, def, ctx) {
  const players = ctx.players || [];
  let best = null;
  let bestDist = Infinity;
  const range = zombie.targetId ? Math.max(def.detectRange, def.chaseRange) : def.detectRange;
  for (let i = 0; i < players.length; i += 1) {
    const player = players[i];
    if (!player || !player.alive || player.dimension !== zombie.dimension) continue;
    // В безопасных зонах зомби не атакуют выживших.
    if (player.inSafeZone) continue;
    const dist = V.distance(zombie.pos, player.pos);
    if (dist <= range && dist < bestDist) {
      best = player;
      bestDist = dist;
    }
  }
  return best ? { player: best, distance: bestDist } : null;
}

function findPlayerById(players, id) {
  for (let i = 0; i < players.length; i += 1) {
    if (players[i] && players[i].id === id) return players[i];
  }
  return null;
}

/** Ограничивает точку радиусом зоны + лиш (чтобы зомби не уходили через полкарты). */
function leash(zombie, point) {
  const maxRadius = zombie.zoneRadius + ZOMBIE.MAX_LEASH_FROM_ZONE;
  if (V.distance2d(point, zombie.zoneCenter) <= maxRadius) return point;
  const dx = point.x - zombie.zoneCenter.x;
  const dy = point.y - zombie.zoneCenter.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: zombie.zoneCenter.x + (dx / len) * maxRadius,
    y: zombie.zoneCenter.y + (dy / len) * maxRadius,
    z: point.z
  };
}

function pickWanderTarget(zombie, rng) {
  if (!rng) return V.copy(zombie.zoneCenter);
  const radius = Math.max(4, zombie.zoneRadius * 0.55);
  return V.randomPointInCircle(zombie.zoneCenter, radius, rng);
}

/** Реакция на шум (выстрел, сирена, бег). Вызывается сервисом на каждое событие. */
function hearNoise(zombie, def, event) {
  if (!zombie.alive || !event || !event.pos) return false;
  if (event.dimension !== undefined && event.dimension !== zombie.dimension) return false;
  const dist = V.distance(zombie.pos, event.pos);
  if (dist > (Number(event.radius) || 0)) return false;
  // Уже преследует игрока — шум не должен сбивать.
  if (zombie.targetId) return false;
  zombie.investigatePos = V.copy(event.pos);
  zombie.investigateUntil = Number(event.at) + ZOMBIE.NOISE_FORGET_MS;
  zombie.state = 'investigate';
  return true;
}

/** Урон по зомби. Возвращает {dead, bleeding?}. */
function damageZombie(zombie, amount, options) {
  const opts = options || {};
  if (!zombie.alive) return { dead: false, damage: 0 };
  const damage = Math.max(0, Number(amount) || 0);
  zombie.hp -= damage;
  if (opts.sourceType === 'player' && opts.sourceId) {
    zombie.targetId = opts.sourceId;
    zombie.lastSeenAt = opts.now || 0;
    zombie.state = 'chase';
  }
  if (zombie.hp <= 0) {
    zombie.hp = 0;
    zombie.alive = false;
    zombie.state = 'dead';
    zombie.deathAt = opts.now || 0;
    zombie.killerId = opts.sourceId || null;
    zombie.targetId = null;
    return { dead: true, damage };
  }
  return { dead: false, damage };
}

/**
 * Один шаг зомби.
 * @returns {Array<object>} действия: {type:'attack'|'scream', ...}
 */
function stepZombie(zombie, def, ctx, dtMs) {
  if (!zombie.alive) return [];
  const now = Number(ctx.now) || 0;
  const dt = Math.max(0, Math.min(1500, Number(dtMs) || 0)) / 1000;
  const players = ctx.players || [];
  const rng = ctx.rng || null;
  const actions = [];

  if (now >= zombie.nextThinkAt) {
    zombie.nextThinkAt = now + ZOMBIE.THINK_INTERVAL_MS * zombie.jitter;

    let target = zombie.targetId ? findPlayerById(players, zombie.targetId) : null;
    if (target && (!target.alive || target.dimension !== zombie.dimension || target.inSafeZone)) target = null;

    if (!target) {
      const found = nearestPlayer(zombie, def, ctx);
      if (found) {
        target = found.player;
        zombie.targetId = found.player.id;
      }
    }

    if (target) {
      const dist = V.distance(zombie.pos, target.pos);
      if (dist > def.chaseRange) {
        // Потеряли цель — идём к последней известной точке.
        zombie.targetId = null;
        zombie.investigatePos = zombie.targetPos ? V.copy(zombie.targetPos) : V.copy(target.pos);
        zombie.investigateUntil = now + ZOMBIE.LOST_TARGET_MS;
        zombie.state = 'investigate';
      } else {
        zombie.targetPos = V.copy(target.pos);
        zombie.lastSeenAt = now;
        zombie.state = dist <= def.attackRange ? 'attack' : 'chase';
        if (zombie.state === 'attack' && now >= zombie.attackReadyAt) {
          zombie.attackReadyAt = now + Math.max(400, Number(def.attackRate) || 1200);
          actions.push({ type: 'attack', playerId: target.id, damage: Number(def.damage) || 0 });
        }
        if (def.onScream && zombie.state === 'chase' && now >= zombie.screamReadyAt) {
          zombie.screamReadyAt = now + (Number(def.onScream.cooldown) || 9000);
          actions.push({ type: 'scream', radius: Number(def.onScream.radius) || 50, aggro: Number(def.onScream.aggro) || 20 });
        }
      }
    } else if (zombie.investigatePos && now < zombie.investigateUntil) {
      zombie.state = 'investigate';
      zombie.targetPos = V.copy(zombie.investigatePos);
    } else {
      if (zombie.investigatePos) {
        zombie.investigatePos = null;
        zombie.state = 'idle';
      }
      if (!zombie.wanderPos || V.distance2d(zombie.pos, zombie.wanderPos) < 1.5 || now >= zombie.nextWanderAt) {
        if (now >= zombie.nextWanderAt || !zombie.wanderPos) {
          zombie.nextWanderAt = now + (rng ? rng.int(4200, 9500) : 6000);
          // Иногда зомби просто стоит на месте.
          zombie.wanderPos = rng && rng.chance(0.25) ? V.copy(zombie.pos) : pickWanderTarget(zombie, rng);
          zombie.state = V.distance2d(zombie.pos, zombie.wanderPos) < 0.5 ? 'idle' : 'wander';
        }
      }
      if (zombie.state !== 'idle' && zombie.wanderPos) {
        zombie.targetPos = V.copy(zombie.wanderPos);
      } else {
        zombie.targetPos = null;
      }
    }
  }

  // Движение выполняется каждый вызов — так позиция остаётся плавной.
  if (zombie.targetPos) {
    const dest = leash(zombie, zombie.targetPos);
    const dist = V.distance2d(zombie.pos, dest);
    let speed = zombie.state === 'chase' || zombie.state === 'attack' || zombie.state === 'investigate'
      ? (Number(def.speedRun) || 2)
      : (Number(def.speedWalk) || 0.5);
    if (zombie.state === 'attack' && dist < 0.6) speed = 0;
    if (zombie.state === 'chase' && dist < 3.5) speed = (Number(def.speedWalk) || 0.5) * 1.8;
    const step = speed * dt;
    if (dist > 0.35 && step > 0) {
      const next = V.moveTowards(zombie.pos, dest, step);
      next.z = dest.z;
      zombie.heading = V.headingTo(zombie.pos, next);
      zombie.pos = next;
      zombie.lastMoveAt = now;
    } else if (dist > 0 && step > 0) {
      zombie.heading = V.headingTo(zombie.pos, dest);
    }
  }

  // Голодный зомби не должен «зависать» в стене: если долго не двигался — новая цель.
  if (zombie.state === 'wander' && zombie.targetPos && now - zombie.lastMoveAt > 6000) {
    zombie.wanderPos = null;
    zombie.nextWanderAt = 0;
    zombie.targetPos = null;
  }

  return actions;
}

/** Выбор типа зомби с учётом ночи. */
function pickType(types, rng, isNight) {
  const list = (types || []).filter((t) => (Number(t.spawnWeight) || 0) > 0);
  if (!list.length) return (types && types[0]) || null;
  const weighted = list.map((type) => ({
    type,
    weight: (Number(type.spawnWeight) || 0) * (isNight && type.id === 'runner' ? 1.8 : 1)
  }));
  const picked = rng.weighted(weighted);
  return picked ? picked.type : list[0];
}

module.exports = {
  createZombie,
  stepZombie,
  damageZombie,
  hearNoise,
  nearestPlayer,
  pickType,
  leash,
  pickWanderTarget
};
