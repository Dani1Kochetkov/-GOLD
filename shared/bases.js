'use strict';

/**
 * Система баз и безопасных зон (System 3).
 *
 *   claim      — игрок «занимает» базу (бесплатно, если свободна)
 *   gate       — ворота на пароле: только владелец или тот, кто знает код
 *   safezone   — внутри радиуса база: урон по игрокам/машинам запрещён
 *
 * Чистая логика — сервер решает, разрешён ли урон, и кому принадлежит база.
 */

const V = require('./vec3');

function createBase(options) {
  const opts = options || {};
  const pos = V.copy(opts.pos || { x: 0, y: 0, z: 0 });
  const radius = Math.max(3, Number(opts.radius) || 20);
  const gate = opts.gate || {};
  return {
    id: opts.id,
    name: opts.name || 'База выживших',
    pos,
    radius,
    gate: {
      pos: gate.pos ? V.copy(gate.pos) : { x: pos.x, y: pos.y, z: pos.z + 1 },
      heading: Number(gate.heading) || 0,
      radius: Math.max(1.5, Number(gate.radius) || 4),
      open: false,
      code: opts.gate && opts.gate.code ? String(opts.gate.code) : null,
      codeSetAt: 0
    },
    owner: null,
    ownerName: null,
    claimedAt: 0,
    claimedById: null,
    guarded: !!opts.guarded
  };
}

function distanceToBase(base, pos) {
  return V.distance2d(base.pos, pos);
}

function inBase(base, pos, pad) {
  return distanceToBase(base, pos) <= base.radius + (Number(pad) || 0);
}

function inGate(base, pos, pad) {
  return V.distance(base.gate.pos, pos) <= base.gate.radius + (Number(pad) || 0);
}

/** Захват/аренда: бесплатно, если база свободна. */
function claimBase(base, player, now) {
  if (!base) return { ok: false, reason: 'no-base' };
  if (base.owner && base.owner !== player.id) {
    return { ok: false, reason: 'owned', owner: base.ownerName };
  }
  base.owner = player.id;
  base.ownerName = player.name;
  base.claimedAt = now;
  base.claimedById = player.id;
  return { ok: true };
}

function unclaimBase(base, player) {
  if (!base) return { ok: false, reason: 'no-base' };
  if (base.owner && base.owner !== player.id) return { ok: false, reason: 'not-owner' };
  base.owner = null;
  base.ownerName = null;
  base.claimedAt = 0;
  base.claimedById = null;
  base.gate.open = false;
  base.gate.code = null;
  base.gate.codeSetAt = 0;
  return { ok: true };
}

function setGateCode(base, player, code, now) {
  if (!base) return { ok: false, reason: 'no-base' };
  const normalized = String(code || '').replace(/\s+/g, '');
  if (!/^\d{3,8}$/.test(normalized)) return { ok: false, reason: 'bad-code' };
  if (base.owner && base.owner !== player.id) return { ok: false, reason: 'not-owner' };
  base.gate.code = normalized;
  base.gate.codeSetAt = now;
  return { ok: true, code: normalized };
}

function toggleGate(base, player, now) {
  if (!base) return { ok: false, reason: 'no-base' };
  const isOwner = base.owner === player.id;
  const knowsCode = !!base.gate.code;
  if (!isOwner && !knowsCode) return { ok: false, reason: 'locked' };
  base.gate.open = !base.gate.open;
  return { ok: true, open: base.gate.open };
}

/** Может ли игрок открывать/закрывать ворота. */
function canOpenGate(base, player) {
  if (!base) return false;
  if (base.owner === player.id) return true;
  return !!base.gate.code;
}

/** Безопасная зона: урон по игрокам и машинам запрещён. */
function isSafeForPlayers(base, pos) {
  return !!base && inBase(base, pos, 1.5);
}

module.exports = {
  createBase,
  distanceToBase,
  inBase,
  inGate,
  claimBase,
  unclaimBase,
  setGateCode,
  toggleGate,
  canOpenGate,
  isSafeForPlayers
};
