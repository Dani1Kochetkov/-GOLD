'use strict';

/**
 * Общие константы GOLD DAYZ.
 * Файл используется и на сервере, и на клиенте (бандлится tools/build-client.js),
 * поэтому никаких зависимостей от API RAGE здесь быть не может.
 */

const ITEM_SLOTS = ['primary', 'melee', 'back', 'armor', 'mask', 'hands'];

const SLOT_LABELS = {
  primary: 'Оружие',
  melee: 'Ближний бой',
  back: 'Рюкзак',
  armor: 'Разгрузка',
  mask: 'Маска',
  hands: 'В руках'
};

const INVENTORY = {
  BASE_SLOTS: 18,
  MAX_SLOTS: 60,
  BASE_CAPACITY_KG: 30,
  STACK_OVERFLOW_GUARD: 10000
};

const SURVIVAL = {
  MAX_HEALTH: 100,
  MAX_BLOOD: 100,
  MAX_HUNGER: 100,
  MAX_THIRST: 100,
  MAX_STAMINA: 100,
  MAX_RADIATION: 100,
  BODY_TEMPERATURE: 37,
  HUNGER_DRAIN: 0.05,
  THIRST_DRAIN: 0.07,
  STARVE_HEALTH_DRAIN: 0.5,
  DEHYDRATE_HEALTH_DRAIN: 0.7,
  BLEED_HEALTH_DRAIN: 1.4,
  BLEED_BLOOD_DRAIN: 3.0,
  RADIATION_HEALTH_DRAIN: 0.02,
  COLD_HEALTH_DRAIN: 0.35,
  STAMINA_REGEN: 9,
  STAMINA_SPRINT_DRAIN: 7.5,
  STAMINA_JUMP_COST: 6,
  STAMINA_EXHAUSTED_AT: 8,
  STAMINA_MAX_OVERWEIGHT: 0.35,
  RESPAWN_DELAY_MS: 12000,
  DEATH_STATS_RESET: true
};

const ZOMBIE = {
  THINK_INTERVAL_MS: 400,
  ATTACK_TOLERANCE: 1.35,
  LOS_REPORT_INTERVAL_MS: 250,
  MAX_LEASH_FROM_ZONE: 60,
  CORPSE_TTL_MS: 90000,
  NOISE_FORGET_MS: 6000,
  LOST_TARGET_MS: 7000,
  GLOBAL_CAP: 120,
  MAX_PER_PLAYER: 24
};

const SYNC = {
  // RAGE:MP ограничивает payload player.call() 8192 байтами.
  MAX_PAYLOAD_BYTES: 7800,
  SNAPSHOT_MAX_ZOMBIES: 96,
  SNAPSHOT_INTERVAL: 50,
  SNAPSHOT_INTERVAL_BUSY: 100,
  SNAPSHOT_INTERVAL_IDLE: 200,
  SNAPSHOT_BUSY_PLAYERS: 14,
  INTERP_TIME_MS: 120,
  MAX_EXTRAPOLATION_MS: 250,
  SNAPSHOT_RADIUS: 320
};

const RATE = {
  INVENTORY_ACTIONS_PER_SEC: 12,
  SHOT_EVENTS_PER_SEC: 20,
  CHAT_MESSAGES_PER_10S: 8,
  MOVE_EVENTS_PER_SEC: 30,
  MAX_STRING_ARG: 64
};

const ITEM_KIND = {
  WEAPON: 'weapon',
  AMMO: 'ammo',
  MEDICAL: 'medical',
  FOOD: 'food',
  GEAR: 'gear',
  MATERIAL: 'material',
  TOOL: 'tool'
};

module.exports = {
  ITEM_SLOTS,
  SLOT_LABELS,
  INVENTORY,
  SURVIVAL,
  ZOMBIE,
  SYNC,
  RATE,
  ITEM_KIND
};
