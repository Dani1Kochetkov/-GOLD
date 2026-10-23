'use strict';

/** Чистая DayZ-механика выживания: голод, жажда, кровь, радиация, температура. */

const { SURVIVAL } = require('./constants');
const { clamp } = require('./vec3');

function createStats(overrides) {
  const stats = {
    health: SURVIVAL.MAX_HEALTH,
    blood: SURVIVAL.MAX_BLOOD,
    hunger: SURVIVAL.MAX_HUNGER,
    thirst: SURVIVAL.MAX_THIRST,
    stamina: SURVIVAL.MAX_STAMINA,
    temperature: SURVIVAL.BODY_TEMPERATURE,
    radiation: 0,
    bleeding: 0,
    alive: true,
    lastDamageAt: 0,
    deathCause: null
  };
  if (overrides && typeof overrides === 'object') {
    const keys = Object.keys(overrides);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (key in stats && Number.isFinite(Number(overrides[key]))) stats[key] = Number(overrides[key]);
    }
  }
  return stats;
}

function clampStats(stats) {
  stats.health = clamp(stats.health, 0, SURVIVAL.MAX_HEALTH);
  stats.blood = clamp(stats.blood, 0, SURVIVAL.MAX_BLOOD);
  stats.hunger = clamp(stats.hunger, 0, SURVIVAL.MAX_HUNGER);
  stats.thirst = clamp(stats.thirst, 0, SURVIVAL.MAX_THIRST);
  stats.stamina = clamp(stats.stamina, 0, SURVIVAL.MAX_STAMINA);
  stats.radiation = clamp(stats.radiation, 0, SURVIVAL.MAX_RADIATION);
  stats.temperature = clamp(stats.temperature, 30, 42);
  stats.bleeding = clamp(stats.bleeding, 0, 3);
  return stats;
}

/**
 * Урон. bleedingChance — шанс открыть кровотечение (нож/пуля/зомби).
 * Возвращает {dead, bleedingStarted, cause}.
 */
function applyDamage(stats, amount, options) {
  const opts = options || {};
  if (!stats.alive) return { dead: true, bleedingStarted: false, cause: stats.deathCause };
  const reduction = clamp(Number(opts.reduction) || 0, 0, 0.9);
  const damage = Math.max(0, Number(amount) || 0) * (1 - reduction);
  stats.health -= damage;
  stats.lastDamageAt = Number(opts.now) || 0;
  let bleedingStarted = false;
  const chance = Number(opts.bleedingChance) || 0;
  if (damage > 0 && chance > 0 && opts.rng && opts.rng.chance(chance) && stats.bleeding < 3) {
    stats.bleeding = Math.min(3, stats.bleeding + 1);
    bleedingStarted = true;
  }
  let dead = false;
  if (stats.health <= 0 || stats.blood <= 0) {
    stats.health = 0;
    stats.alive = false;
    stats.deathCause = opts.cause || 'damage';
    dead = true;
  }
  clampStats(stats);
  return { dead, bleedingStarted, cause: stats.deathCause };
}

function heal(stats, effect) {
  if (!stats.alive || !effect) return { healed: false };
  let changed = false;
  if (effect.blood) {
    stats.blood = clamp(stats.blood + effect.blood, 0, SURVIVAL.MAX_BLOOD);
    changed = true;
    if (stats.bleeding > 0 && effect.blood >= 5) stats.bleeding = Math.max(0, stats.bleeding - 1);
  }
  if (effect.health) {
    stats.health = clamp(stats.health + effect.health, 0, SURVIVAL.MAX_HEALTH);
    changed = true;
  }
  if (effect.radiation) {
    stats.radiation = clamp(stats.radiation - effect.radiation, 0, SURVIVAL.MAX_RADIATION);
    changed = true;
  }
  return { healed: changed };
}

function applyFood(stats, effect) {
  if (!stats.alive || !effect) return { consumed: false };
  if (effect.calories) stats.hunger = clamp(stats.hunger + effect.calories, 0, SURVIVAL.MAX_HUNGER);
  if (effect.water) stats.thirst = clamp(stats.thirst + effect.water, 0, SURVIVAL.MAX_THIRST);
  return { consumed: true };
}

/**
 * Один тик выживания.
 * @param {object} stats
 * @param {object} ctx { sprinting, moving, weightRatio, ambientC, inWater, nearFire, radiation }
 * @param {number} dtMs
 * @returns {{stats:object, events:Array, dead:boolean, deathCause:string|null}}
 */
function tick(stats, ctx, dtMs) {
  const context = ctx || {};
  const dt = Math.max(0, Math.min(5000, Number(dtMs) || 0)) / 1000;
  const events = [];
  if (!stats.alive || dt <= 0) {
    return { stats, events, dead: !stats.alive, deathCause: stats.deathCause || null };
  }

  stats.hunger -= SURVIVAL.HUNGER_DRAIN * dt;
  stats.thirst -= SURVIVAL.THIRST_DRAIN * dt;

  if (stats.hunger <= 0) {
    stats.hunger = 0;
    stats.health -= SURVIVAL.STARVE_HEALTH_DRAIN * dt;
  }
  if (stats.thirst <= 0) {
    stats.thirst = 0;
    stats.health -= SURVIVAL.DEHYDRATE_HEALTH_DRAIN * dt;
  }

  if (stats.bleeding > 0) {
    const severity = Math.min(3, stats.bleeding);
    stats.health -= SURVIVAL.BLEED_HEALTH_DRAIN * severity * dt;
    stats.blood -= SURVIVAL.BLEED_BLOOD_DRAIN * severity * dt;
  }

  if (stats.radiation > 0) {
    stats.health -= SURVIVAL.RADIATION_HEALTH_DRAIN * (stats.radiation / SURVIVAL.MAX_RADIATION) * SURVIVAL.MAX_BLOOD * 0.02 * dt;
  }

  // Температура: мокрый/холодный игрок мёрзнет, у костра греется.
  const ambient = Number.isFinite(Number(context.ambientC)) ? Number(context.ambientC) : 20;
  const targetTemperature = context.nearFire ? 37.6 : 36.6 + (ambient - 20) * 0.02 - (context.inWater ? 0.8 : 0) - (context.night ? 0.3 : 0);
  const drift = (targetTemperature - stats.temperature) * 0.03 * dt;
  stats.temperature += drift;
  if (stats.temperature < 35.2) {
    stats.health -= SURVIVAL.COLD_HEALTH_DRAIN * dt;
    if (stats.temperature < 34.5) stats.stamina -= 2 * dt;
  }

  // Выносливость.
  const weightRatio = clamp(Number(context.weightRatio) || 0, 0, 2);
  if (context.sprinting && context.moving) {
    stats.stamina -= SURVIVAL.STAMINA_SPRINT_DRAIN * (1 + weightRatio * 0.8) * dt;
  } else if (!context.moving) {
    stats.stamina += SURVIVAL.STAMINA_REGEN * (1 - Math.min(0.6, weightRatio * 0.4)) * dt;
  } else {
    stats.stamina += SURVIVAL.STAMINA_REGEN * 0.25 * dt;
  }

  // Тяжёлый вес не даёт восстановиться выше 35%.
  if (weightRatio > 1) stats.stamina = Math.min(stats.stamina, SURVIVAL.MAX_STAMINA * SURVIVAL.STAMINA_MAX_OVERWEIGHT);
  if (context.radiation > 0) {
    stats.radiation = clamp(stats.radiation + context.radiation * dt, 0, SURVIVAL.MAX_RADIATION);
  }

  clampStats(stats);

  if (stats.health <= 0 || stats.blood <= 0 || stats.temperature <= 32) {
    stats.alive = false;
    stats.health = Math.max(0, stats.health);
    if (!stats.deathCause) {
      if (stats.blood <= 0) stats.deathCause = 'bloodloss';
      else if (stats.temperature <= 32) stats.deathCause = 'hypothermia';
      else if (stats.hunger <= 0) stats.deathCause = 'starvation';
      else if (stats.thirst <= 0) stats.deathCause = 'dehydration';
      else if (stats.radiation >= 90) stats.deathCause = 'radiation';
      else stats.deathCause = 'unknown';
    }
    events.push({ type: 'death', cause: stats.deathCause });
    return { stats, events, dead: true, deathCause: stats.deathCause };
  }

  return { stats, events, dead: false, deathCause: null };
}

const DEATH_CAUSES = {
  damage: 'убит',
  zombie: 'растерзан зомби',
  player: 'убит игроком',
  bloodloss: 'потерял слишком много крови',
  hypothermia: 'замёрз',
  starvation: 'умер от голода',
  dehydration: 'умер от жажды',
  radiation: 'умер от радиации',
  fall: 'разбился при падении',
  toxin: 'отравился токсинами',
  drowning: 'утонул',
  suicide: 'покончил с собой'
};

function causeLabel(cause) {
  return DEATH_CAUSES[cause] || 'погиб';
}

module.exports = {
  createStats,
  clampStats,
  applyDamage,
  heal,
  applyFood,
  tick,
  causeLabel,
  DEATH_CAUSES
};
