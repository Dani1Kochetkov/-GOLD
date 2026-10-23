'use strict';

/**
 * Детерминированный ГПСЧ (mulberry32).
 * Один и тот же seed + одинаковые вызовы = одинаковый результат на сервере,
 * в симуляторе и в тестах. Это важно для отладки зомби-синхронизации.
 */
class Rng {
  constructor(seed) {
    const s = typeof seed === 'string' ? hashString(seed) : Number(seed);
    this.state = (s >>> 0) || 0x9e3779b9;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  float(min, max) {
    return min + this.next() * (max - min);
  }

  chance(probability) {
    return this.next() < probability;
  }

  pick(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(this.next() * list.length)];
  }

  shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /** [{weight: 10, ...}, ...] -> элемент пропорционально weight. */
  weighted(list, weightKey) {
    const key = weightKey || 'weight';
    if (!list || !list.length) return null;
    let total = 0;
    for (let i = 0; i < list.length; i += 1) {
      total += Math.max(0, Number(list[i][key]) || 0);
    }
    if (total <= 0) return this.pick(list);
    let roll = this.next() * total;
    for (let i = 0; i < list.length; i += 1) {
      roll -= Math.max(0, Number(list[i][key]) || 0);
      if (roll <= 0) return list[i];
    }
    return list[list.length - 1];
  }
}

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

module.exports = { Rng, hashString };
