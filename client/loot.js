'use strict';

/** Физические 3D-предметы лута: mp.objects.new, появление/исчезновение. */

const V = require('../shared/vec3');
const { sanitizeText } = require('../shared/netcode');

const FALLBACK_MODELS = ['prop_crate_01a', 'prop_box_debris_01'];

class LootView {
  constructor() {
    this.objects = new Map();
    this.pending = new Map();
    this.fallbackIndex = 0;
    this.lastSyncAt = 0;
    this.lastInventoryAt = 0;
  }

  hashFor(modelName) {
    const name = sanitizeText(String(modelName || ''), 64);
    try {
      const hash = mp.game.joaat(name);
      if (hash > 0) return hash;
    } catch (err) {
      // ignore
    }
    const fallback = FALLBACK_MODELS[this.fallbackIndex % FALLBACK_MODELS.length];
    this.fallbackIndex += 1;
    try {
      return mp.game.joaat(fallback);
    } catch (err) {
      return 0;
    }
  }

  onSpawn(payload) {
    let data = null;
    try {
      data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (err) {
      return;
    }
    if (!data || !data.id) return;
    if (this.objects.has(data.id)) return;

    const hash = this.hashFor(data.m);
    if (!hash) return;

    if (!mp.game.streaming.hasModelLoaded(hash)) {
      mp.game.streaming.requestModel(hash);
      this.pending.set(data.id, { hash, data, requestedAt: Date.now() });
      return;
    }
    this.createObject(data.id, hash, data);
  }

  createObject(id, hash, data) {
    if (this.objects.has(id)) return;
    let obj = null;
    try {
      obj = mp.objects.new(hash, new mp.Vector3(Number(data.x) || 0, Number(data.y) || 0, Number(data.z) || 0), mp.players.local.handle, false, false, mp.players.local.dimension || 0);
    } catch (err) {
      obj = null;
    }
    if (!obj) return;
    try {
      obj.setDimension(mp.players.local.dimension || 0);
      obj.setRot(0, 0, 0);
    } catch (err) {
      // ignore
    }
    this.objects.set(id, obj);
  }

  onRemove(payload) {
    let data = null;
    try {
      data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (err) {
      return;
    }
    if (!data || !data.id) return;
    this.removeObject(data.id);
    this.pending.delete(data.id);
  }

  removeObject(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    try {
      obj.delete();
    } catch (err) {
      // уже удалён
    }
    this.objects.delete(id);
  }

  update() {
    const now = Date.now();
    if (now - this.lastSyncAt < 1000) return;
    this.lastSyncAt = now;

    // Ждём загрузки моделей и создаём объекты.
    if (this.pending.size) {
      for (const [id, entry] of Array.from(this.pending.entries())) {
        const loaded = mp.game.streaming.hasModelLoaded(entry.hash);
        if (!loaded && now - entry.requestedAt > 15000) {
          this.pending.delete(id);
          continue;
        }
        if (loaded) {
          this.createObject(id, entry.hash, entry.data);
          this.pending.delete(id);
        }
      }
    }

    // Очистка дальних объектов: иначе при перемещении по карте копится
    // сотни mp.objects, которые больше никто не видит — это тормозит.
    const local = mp.players.local;
    if (local) {
      for (const [id, obj] of Array.from(this.objects.entries())) {
        try {
          const dist = V.distance(obj.position, local.position);
          if (dist > 350) this.removeObject(id);
        } catch (err) {
          this.removeObject(id);
        }
      }
    }
  }

  destroyAll() {
    for (const id of Array.from(this.objects.keys())) this.removeObject(id);
    this.pending.clear();
  }

  stats() {
    return { objects: this.objects.size, pending: this.pending.size };
  }
}

module.exports = new LootView();
