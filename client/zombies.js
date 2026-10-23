'use strict';

/** Клиентское представление зомби: пул client-side peds, интерполяция, анимация. */

const SYNC = require('../shared/sync');
const V = require('../shared/vec3');

const STATE = SYNC.STATE_CODES;

class ZombieView {
  constructor() {
    this.clientState = SYNC.createClientState();
    this.peds = new Map();
    this.types = [];
    this.models = new Map();
    this.pendingModels = new Map();
    this.lastUpdate = Date.now();
    this.lastSnapshot = null;
    this.snapshotAge = 0;
    this.nearby = 0;
    this.pedTasks = new Map();
  }

  setTypes(types) {
    this.types = Array.isArray(types) ? types : [];
    for (let i = 0; i < this.types.length; i += 1) {
      const type = this.types[i];
      if (!type || !type.m) continue;
      const hash = mp.game.joaat(type.m);
      this.models.set(type.c, hash);
      if (!mp.game.streaming.hasModelLoaded(hash)) {
        mp.game.streaming.requestModel(hash);
        this.pendingModels.set(hash, Date.now());
      }
    }
  }

  typeFor(code) {
    for (let i = 0; i < this.types.length; i += 1) {
      if (this.types[i].c === code) return this.types[i];
    }
    return null;
  }

  applySnapshot(payload) {
    const snapshot = SYNC.unpackSnapshot(payload);
    if (!snapshot) return;
    this.lastSnapshot = snapshot;
    this.snapshotAge = 0;
    SYNC.applySnapshot(this.clientState, snapshot, Date.now());
    this.syncPeds();
  }

  ensurePed(entity) {
    const existing = this.peds.get(entity.id);
    if (existing) return existing;
    const hash = this.models.get(entity.typeCode) || this.models.get(0);
    if (!hash) return null;
    if (!mp.game.streaming.hasModelLoaded(hash)) {
      mp.game.streaming.requestModel(hash);
      this.pendingModels.set(hash, Date.now());
      return null;
    }
    let ped = null;
    try {
      ped = mp.peds.new(hash, new mp.Vector3(entity.pos.x, entity.pos.y, entity.pos.z), entity.heading || 0, 0);
    } catch (err) {
      return null;
    }
    if (!ped) return null;
    this.peds.set(entity.id, ped);
    this.configurePed(ped, entity);
    return ped;
  }

  configurePed(ped, entity) {
    const type = this.typeFor(entity.typeCode);
    try {
      ped.setInvincible(true);
      ped.setProofs(true, true, true, true, true, true, true, true);
      ped.setCanRagdoll(false);
      ped.setAlpha(255);
      // Не даём движку наводить прицел на зомби: урон считает сервер.
      mp.game.ped.setPedCanBeTargetted(ped.handle, false);
      if (typeof ped.setDimension === 'function') ped.setDimension(0);
      else ped.dimension = 0;
      mp.game.ped.setBlockingOfNonTemporaryEvents(ped.handle, true);
      mp.game.ped.setPedFleeAttributes(ped.handle, 0, false);
      mp.game.ped.setPedCombatAttributes(ped.handle, 46, true);
      mp.game.ped.setPedSuffersCriticalHits(ped.handle, false);
      // Tint в data/zombies.json зарезервирован под визуальные модификации
      // (в GTA V нет прямого натива для тонировки зомби-педа).
    } catch (err) {
      // часть нативов может отсутствовать в старых сборках клиента
    }
  }

  syncPeds() {
    const now = Date.now();
    const entities = this.clientState.entities;
    for (const entity of entities.values()) {
      const ped = this.ensurePed(entity);
      if (!ped) continue;
      this.updatePed(ped, entity, now);
    }
  }

  updatePed(ped, entity, now) {
    const pos = SYNC.computePosition(entity, now);
    const heading = SYNC.computeHeading(entity, now);
    const chasing = entity.state === 'chase' || entity.state === 'attack' || entity.state === 'investigate';
    const speed = chasing ? 3.0 : 0.9;
    const distance = V.distance(ped.position, pos);

    try {
      if (distance > 4.5) {
        // Сильное расхождение — принудительно ставим на место (анти-дрейф).
        ped.setCoords(pos.x, pos.y, pos.z, false, false, false, false);
        ped.setHeading(heading);
        this.pedTasks.delete(entity.id);
      } else if (entity.state === 'chase' || entity.state === 'wander' || entity.state === 'investigate') {
        const lastTaskAt = this.pedTasks.get(entity.id) || 0;
        if (now - lastTaskAt > 600) {
          this.pedTasks.set(entity.id, now);
          mp.game.ped.taskGoStraightToCoord(ped.handle, pos.x, pos.y, pos.z, speed, 1200, heading, 0.4);
        }
      } else {
        ped.setCoords(pos.x, pos.y, pos.z, false, false, false, false);
        ped.setHeading(heading);
      }
    } catch (err) {
      // пед мог быть удалён движком — пересоздадим в следующем кадре
      this.peds.delete(entity.id);
    }
  }

  onKilled(payload) {
    let data = null;
    try {
      data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (err) {
      return;
    }
    if (!data || !data.id) return;
    const ped = this.peds.get(data.id);
    if (ped) {
      try {
        mp.game.ped.setPedToRagdoll(ped.handle, 3500, 3500, 0, false, false, false);
      } catch (err) {
        // ignore
      }
      setTimeout(() => this.removePed(data.id), 1500);
    }
    this.clientState.entities.delete(data.id);
  }

  removePed(id) {
    const ped = this.peds.get(id);
    if (!ped) return;
    try {
      ped.destroy();
    } catch (err) {
      // уже уничтожен
    }
    this.peds.delete(id);
    this.pedTasks.delete(id);
  }

  update() {
    const now = Date.now();
    const entities = this.clientState.entities;

    // Протухшие сущности убираем (зомби ушёл из радиуса).
    for (const [id, entity] of entities) {
      if (now - entity.lastSeenAt > 3000) {
        entities.delete(id);
        this.removePed(id);
      }
    }

    // Модели, которые ещё грузятся.
    if (this.pendingModels.size) {
      for (const [hash, requestedAt] of this.pendingModels) {
        if (mp.game.streaming.hasModelLoaded(hash)) this.pendingModels.delete(hash);
        else if (now - requestedAt > 15000) this.pendingModels.delete(hash);
      }
      this.syncPeds();
    }

    for (const entity of entities.values()) {
      const ped = this.peds.get(entity.id);
      if (!ped) continue;
      this.updatePed(ped, entity, now);
    }

    this.nearby = this.countNearby();

    if (this.lastSnapshot) this.snapshotAge = now - (this.clientState.lastSnapshotAt || now);
  }

  countNearby(radius) {
    const max = radius || 60;
    const local = mp.players.local;
    if (!local) return 0;
    let count = 0;
    for (const entity of this.clientState.entities.values()) {
      if (V.distance(entity.pos, local.position) <= max) count += 1;
    }
    return count;
  }

  setDimension() {
    const dimension = mp.players.local.dimension || 0;
    for (const ped of this.peds.values()) {
      try {
        if (typeof ped.setDimension === 'function') ped.setDimension(dimension);
        else ped.dimension = dimension;
      } catch (err) {
        // ignore
      }
    }
  }

  destroyAll() {
    for (const id of Array.from(this.peds.keys())) this.removePed(id);
    this.clientState.entities.clear();
  }

  stats() {
    return {
      peds: this.peds.size,
      entities: this.clientState.entities.size,
      snapshotAge: this.snapshotAge,
      nearby: this.nearby
    };
  }
}

module.exports = new ZombieView();
