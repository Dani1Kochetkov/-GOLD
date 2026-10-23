'use strict';

/** Утилиты защиты от «мусора» из сети + лимитеры. Работают и на сервере, и в клиенте. */

function byteLength(str) {
  if (typeof str !== 'string') return 0;
  if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(str, 'utf8');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function safeJsonParse(value, maxBytes) {
  if (typeof value !== 'string' || !value) return null;
  if (maxBytes && byteLength(value) > maxBytes) return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function sanitizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const limit = Math.max(1, Math.floor(maxLength || 64));
  // Убираем управляющие символы, оставляем переводы строки/табы -> пробел.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length > limit ? cleaned.slice(0, limit) : cleaned;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number.isFinite(fallback) ? fallback : min;
  return Math.min(max, Math.max(min, n));
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(clampNumber(value, min, max, fallback));
  return Number.isFinite(n) ? n : min;
}

/**
 * Скользящее окно лимитов на ключ (playerId + действие).
 * allow() возвращает false, если лимит исчерпан.
 */
class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.lastSweep = 0;
  }

  allow(key, limit, windowMs, now) {
    const time = Number(now) || Date.now();
    const window = Math.max(100, Number(windowMs) || 1000);
    const max = Math.max(1, Number(limit) || 1);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, resetAt: time + window };
      this.buckets.set(key, bucket);
    }
    if (time >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = time + window;
    }
    if (bucket.count >= max) return false;
    bucket.count += 1;
    if (time - this.lastSweep > 30000) this.sweep(time);
    return true;
  }

  reset(key) {
    this.buckets.delete(key);
  }

  sweep(now) {
    const time = Number(now) || Date.now();
    const keys = Array.from(this.buckets.keys());
    for (let i = 0; i < keys.length; i += 1) {
      const bucket = this.buckets.get(keys[i]);
      if (!bucket || time >= bucket.resetAt + 60000) this.buckets.delete(keys[i]);
    }
    this.lastSweep = time;
  }
}

function makeId(prefix, counter) {
  return `${prefix || 'id'}:${counter}`;
}

/** Безопасный вызов: любая ошибка не должна ронять обработчик события RAGE. */
function guard(fn, onError) {
  return function guarded() {
    try {
      return fn.apply(this, arguments);
    } catch (err) {
      if (typeof onError === 'function') onError(err);
      return undefined;
    }
  };
}

module.exports = {
  byteLength,
  safeJsonParse,
  sanitizeText,
  clampNumber,
  clampInt,
  RateLimiter,
  makeId,
  guard
};
