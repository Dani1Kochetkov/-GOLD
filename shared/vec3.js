'use strict';

/** Небольшие утилиты для работы с позициями (plain-объекты {x,y,z}). */

function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback || 0;
}

function vec(x, y, z) {
  return { x: num(x), y: num(y), z: num(z) };
}

function toVec(v) {
  if (!v) return { x: 0, y: 0, z: 0 };
  return vec(v.x, v.y, v.z);
}

function copy(v) {
  return { x: num(v.x), y: num(v.y), z: num(v.z) };
}

function distanceSq(a, b) {
  const dx = num(a.x) - num(b.x);
  const dy = num(a.y) - num(b.y);
  const dz = num(a.z) - num(b.z);
  return dx * dx + dy * dy + dz * dz;
}

function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}

function distance2d(a, b) {
  const dx = num(a.x) - num(b.x);
  const dy = num(a.y) - num(b.y);
  return Math.sqrt(dx * dx + dy * dy);
}

function isInside(pos, center, radius) {
  return distanceSq(pos, center) <= radius * radius;
}

function isInside2d(pos, center, radius) {
  const d = distance2d(pos, center);
  return d <= radius;
}

function moveTowards(from, to, maxStep) {
  const dx = num(to.x) - num(from.x);
  const dy = num(to.y) - num(from.y);
  const dz = num(to.z) - num(from.z);
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist <= 1e-6 || maxStep <= 0) return copy(from);
  if (dist <= maxStep) return copy(to);
  const k = maxStep / dist;
  return { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
}

function headingTo(from, to) {
  const dx = num(to.x) - num(from.x);
  const dy = num(to.y) - num(from.y);
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0;
  return (Math.atan2(-dx, dy) * 180) / Math.PI;
}

/** Случайная точка в круге (детерминированно, если передан rng). */
function randomPointInCircle(center, radius, rng) {
  const angle = rng.float(0, Math.PI * 2);
  const r = radius * Math.sqrt(rng.next());
  return {
    x: center.x + Math.cos(angle) * r,
    y: center.y + Math.sin(angle) * r,
    z: center.z
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, num(value, min)));
}

module.exports = {
  num,
  vec,
  toVec,
  copy,
  distance,
  distanceSq,
  distance2d,
  isInside,
  isInside2d,
  moveTowards,
  headingTo,
  randomPointInCircle,
  lerp,
  clamp
};
