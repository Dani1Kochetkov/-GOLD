'use strict';

/**
 * ИИ нпц-охраны ТОП-зон (System 2).
 *
 * Военные педы патрулируют радиус вокруг ТОП-лута, агрегуют на игрока
 * ближе 40 м и стреляют. Убить бота — получить ТОП-лут.
 *
 * Аналог shared/zombie-ai.js: модуль чистый, не знает про RAGE.
 * Состояния: idle → patrol → aggro → attack → return.
 */

const V = require('./vec3');

const GUARD_STATE = {
  IDLE: 'idle',
  PATROL: 'patrol',
  AGGRO: 'aggro',
  ATTACK: 'attack',
  RETURN: 'return'
};

function createGuard(options) {
  const opts = options || {};
  const def = opts.def || {};
  const pos = V.copy(opts.pos || { x: 0, y: 0, z: 0 });
  const rng = opts.rng;
  const patrolRadius = Math.max(5, Number(def.patrolRadius) || 50);
  return {
    id: opts.id,
    typeId: def.id || 'marine',
    name: def.name || 'Охранник',
    model: def.model || 'S_M_Y_Marine_01',
    health: Number(def.health) || 200,
    maxHealth: Number(def.health) || 200,
    armor: Number(def.armor) || 100,
    weapon: def.weapon || 'carbinerifle',
    damage: Number(def.damage) || 12,
    attackRange: Math.max(5, Number(def.attackRange) || 45),
    aggroRange: Math.max(5, Number(def.aggroRange) || 40),
    patrolRadius,
    thinkIntervalMs: Math.max(100, Number(def.thinkIntervalMs) || 500),
    attackRateMs: Math.max(150, Number(def.attackRateMs) || 900),
    accuracy: clamp01(Number(def.accuracy) || 0.75),
    dropTable: def.dropTable || 'top',
    pos,
    spawnPos: V.copy(pos),
    zoneCenter: V.copy((opts.zone && opts.zone.pos) || pos),
    zoneRadius: Number((opts.zone && opts.zone.radius) || patrolRadius),
    heading: opts.heading || 0,
    state: GUARD_STATE.PATROL,
    targetId: null,
    targetPos: null,
    lastSeenAt: 0,
    attackReadyAt: 0,
    nextThinkAt: 0,
    nextPatrolAt: 0,
    patrolPos: null,
    lastMoveAt: 0,
    dimension: opts.dimension || 0,
    alive: true,
    deathAt: 0,
    killerId: null,
    summonedBy: opts.summonedBy || null,
    jitter: rng ? rng.float(0.85, 1.2) : 1
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function nearestPlayer(guard, ctx) {
  const players = ctx.players || [];
  let best = null;
  let bestDist = Infinity;
  const range = guard.state === GUARD_STATE.ATTACK ? guard.attackRange + 15 : guard.aggroRange;
  for (let i = 0; i < players.length; i += 1) {
    const player = players[i];
    if (!player || !player.alive || player.dimension !== guard.dimension) continue;
    // В безопасной зоне базсы/свои безопасные зоны охрана не агрегает.
    if (player.inSafeZone) continue;
    const dist = V.distance(guard.pos, player.pos);
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

function pickPatrolPoint(guard, rng) {
  if (!rng) return V.copy(guard.zoneCenter);
  const radius = Math.max(4, guard.patrolRadius * 0.7);
  return V.randomPointInCircle(guard.zoneCenter, radius, rng);
}

/**
 * Один шаг охраны.
 * @returns {Array} действия: {type:'shot', playerId, damage} | {type:'aggro'}
 */
function stepGuard(guard, ctx, dtMs) {
  if (!guard.alive) return [];
  const now = Number(ctx.now) || 0;
  const dt = Math.max(0, Math.min(1500, Number(dtMs) || 0)) / 1000;
  const rng = ctx.rng || null;
  const players = ctx.players || [];
  const actions = [];

  if (now >= guard.nextThinkAt) {
    guard.nextThinkAt = now + guard.thinkIntervalMs * guard.jitter;

    let target = guard.targetId ? findPlayerById(players, guard.targetId) : null;
    if (target && (!target.alive || target.dimension !== guard.dimension || target.inSafeZone)) {
      target = null;
      guard.targetId = null;
    }

    if (!target) {
      const found = nearestPlayer(guard, ctx);
      if (found) {
        target = found.player;
        guard.targetId = found.player.id;
        guard.state = found.distance <= guard.attackRange ? GUARD_STATE.ATTACK : GUARD_STATE.AGGRO;
        actions.push({ type: 'aggro' });
      }
    }

    if (target) {
      const dist = V.distance(guard.pos, target.pos);
      guard.targetPos = V.copy(target.pos);
      guard.lastSeenAt = now;
      if (dist <= guard.attackRange) {
        guard.state = GUARD_STATE.ATTACK;
        if (now >= guard.attackReadyAt) {
          guard.attackReadyAt = now + guard.attackRateMs;
          // Точность: близкий ботик стреляет почти всегда.
          const hit = !rng || rng.chance(guard.accuracy);
          actions.push({ type: 'shot', playerId: target.id, damage: guard.damage, hit });
        }
      } else if (dist <= guard.aggroRange) {
        guard.state = GUARD_STATE.AGGRO;
      } else {
        // Выдырил — догоняем последнюю известность, потом возвращаемся.
        guard.state = GUARD_STATE.RETURN;
      }
    } else if (guard.state === GUARD_STATE.ATTACK || guard.state === GUARD_STATE.AGGRO) {
      guard.state = GUARD_STATE.RETURN;
    }

    if (guard.state === GUARD_STATE.RETURN) {
      if (!guard.targetPos || V.distance2d(guard.pos, guard.targetPos) < 3 || now >= guard.nextPatrolAt) {
        guard.targetPos = null;
        guard.state = GUARD_STATE.PATROL;
        guard.nextPatrolAt = now + (rng ? rng.int(3000, 7000) : 5000);
      } else {
        guard.state = GUARD_STATE.RETURN;
      }
    }

    if (guard.state === GUARD_STATE.PATROL || guard.state === GUARD_STATE.IDLE) {
      if (!guard.patrolPos || V.distance2d(guard.pos, guard.patrolPos) < 1.5 || now >= guard.nextPatrolAt) {
        guard.nextPatrolAt = now + (rng ? rng.int(4000, 9000) : 6000);
        guard.patrolPos = rng && rng.chance(0.2) ? V.copy(guard.pos) : pickPatrolPoint(guard, rng);
        guard.state = V.distance2d(guard.pos, guard.patrolPos) < 0.5 ? GUARD_STATE.IDLE : GUARD_STATE.PATROL;
      }
    }

    if (guard.state === GUARD_STATE.PATROL || guard.state === GUARD_STATE.RETURN) {
      guard.targetPos = guard.state === GUARD_STATE.PATROL ? guard.patrolPos : guard.targetPos;
    }
    if (guard.state === GUARD_STATE.AGGRO || guard.state === GUARD_STATE.ATTACK) {
      guard.targetPos = guard.targetPos || V.copy(guard.pos);
    }
  }

  // Движение.
  if (guard.targetPos) {
    const dest = leash(guard, guard.targetPos);
    const dist = V.distance2d(guard.pos, dest);
    let speed = guard.state === GUARD_STATE.ATTACK || guard.state === GUARD_STATE.AGGRO
      ? 4.2
      : guard.state === GUARD_STATE.RETURN ? 3.6 : 2.0;
    if (guard.state === GUARD_STATE.ATTACK && dist < 1.0) speed = 0;
    const step = speed * dt;
    if (dist > 0.3 && step > 0) {
      const next = V.moveTowards(guard.pos, dest, step);
      next.z = dest.z;
      guard.heading = V.headingTo(guard.pos, next);
      guard.pos = next;
      guard.lastMoveAt = now;
    } else if (dist > 0) {
      guard.heading = V.headingTo(guard.pos, dest);
    }
  }

  if (guard.state === GUARD_STATE.PATROL && guard.targetPos && now - guard.lastMoveAt > 8000) {
    guard.patrolPos = null;
    guard.nextPatrolAt = 0;
    guard.targetPos = null;
    guard.state = GUARD_STATE.IDLE;
  }

  return actions;
}

function leash(guard, point) {
  const maxRadius = guard.patrolRadius + 30;
  if (V.distance2d(point, guard.zoneCenter) <= maxRadius) return point;
  const dx = point.x - guard.zoneCenter.x;
  const dy = point.y - guard.zoneCenter.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: guard.zoneCenter.x + (dx / len) * maxRadius,
    y: guard.zoneCenter.y + (dy / len) * maxRadius,
    z: point.z
  };
}

/** Урон по охраннику. Возвращает {dead}. */
function damageGuard(guard, amount, options) {
  const opts = options || {};
  if (!guard.alive) return { dead: false, damage: 0 };
  const armor = Math.max(0, Number(guard.armor) || 0);
  // Броня режет урон (как у игроков), но не более 70%.
  const reduction = Math.min(0.7, armor / (armor + 120));
  const damage = Math.max(0, Number(amount) || 0) * (1 - reduction);
  guard.health -= damage;
  if (opts.sourceType === 'player' && opts.sourceId) {
    guard.targetId = opts.sourceId;
    guard.lastSeenAt = opts.now || 0;
    guard.state = GUARD_STATE.AGGRO;
  }
  if (guard.health <= 0) {
    guard.health = 0;
    guard.alive = false;
    guard.state = 'dead';
    guard.deathAt = opts.now || 0;
    guard.killerId = opts.sourceId || null;
    guard.targetId = null;
    return { dead: true, damage };
  }
  return { dead: false, damage };
}

module.exports = {
  GUARD_STATE,
  createGuard,
  stepGuard,
  damageGuard,
  nearestPlayer,
  pickPatrolPoint,
  leash
};
