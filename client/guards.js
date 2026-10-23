'use strict';

/** Клиентское представление охранников TOP-зоны: пул peds + АДДС-бар. */

const SYNC = require('../shared/sync');
const V = require('../shared/vec3');

const STATE = SYNC.GUARD_STATE_CODES;

class GuardView {
  constructor() {
    this.clientState = SYNC.createClientState();
    this.peds = new Map();
    this.types = [];
    this.models = new Map();
    this.pendingModels = new Map();
    this.lastSnapshot = null;
    this.snapshotAge = 0;
    this.nearby = 0;
    this.pedTasks = new Map();
    this.bars = new Map();
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
    try {
      ped.setInvincible(true);
      ped.setProofs(true, true, true, true, true, true, true, true);
      ped.setCanRagdoll(false);
      ped.setAlpha(255);
      mp.game.ped.setPedCanBeTargetted(ped.handle, false);
      if (typeof ped.setDimension === 'function') ped.setDimension(0);
      else ped.dimension = 0;
      mp.game.ped.setBlockingOfNonTemporaryEvents(ped.handle, true);
      mp.game.ped.setPedFleeAttributes(ped.handle, 0, false);
      mp.game.ped.setPedCombatAttributes(ped.handle, 46, true);
      mp.game.ped.setPedSuffersCriticalHits(ped.handle, false);
      // Военная анимация: оружейная PreparedPedAnimation — без нативного API,
      // оставляем стандартную походку бойца.
    } catch (err) {
      // часть нативов может отсутствовать
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
    const chasing = entity.state === 'aggro' || entity.state === 'attack' || entity.state === 'return';
    const speed = chasing ? 3.6 : 1.4;
    const distance = V.distance(ped.position, pos);

    try {
      if (distance > 4.5) {
        ped.setCoords(pos.x, pos.y, pos.z, false, false, false, false);
        ped.setHeading(heading);
        this.pedTasks.delete(entity.id);
      } else if (entity.state === 'aggro' || entity.state === 'attack' || entity.state === 'patrol') {
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
    this.bars.delete(id);
  }

  drawBar(ped, entity) {
    const id = entity.id;
    let bar = this.bars.get(id);
    if (!bar) {
      bar = this.makeBar();
      if (!bar) return;
      this.bars.set(id, bar);
    }
    try {
      const pos = SYNC.computePosition(entity, Date.now());
      const head = new mp.Vector3(pos.x, pos.y, pos.z + 2.2);
      bar.setCoords(head.x, head.y, head.z, false, false, false, false);
      bar.setHeight(0.18);
      bar.setWidth(1.2);
      bar.setScale(1.2, 1);
      bar.setColour(255, 40, 40);
      bar.setDepth(true);
      bar.setVisible(true);
    } catch (err) {
      // ignore
    }
  }

  makeBar() {
    let bar = null;
    try {
      bar = mp.screenui.newSprite('mpgov_gta_hud', 'mprgb_gta_hud', 0.5, 0.5, 0);
    } catch (err) {
      return null;
    }
    if (!bar) return null;
    try {
      bar.setAlwaysOntop(false);
      bar.setOverlapsEverything(false);
      bar.setPrimaryColourRGB(255, 255, 255);
    } catch (err) {
      // ignore
    }
    return bar;
  }

  update() {
    const now = Date.now();
    const entities = this.clientState.entities;

    for (const [id, entity] of entities) {
      if (now - entity.lastSeenAt > 3000) {
        entities.delete(id);
        this.removePed(id);
      }
    }

    if (this.pendingModels.size) {
      for (const [hash, requestedAt] of this.pendingModels) {
        if (mp.game.streaming.hasModelLoaded(hash)) this.pendingModels.delete(hash);
        else if (now - requestedAt > 15000) this.pendingModels.delete(hash);
      }
      this.syncPeds();
    }

    let nearby = 0;
    const local = mp.players.local;
    for (const entity of entities.values()) {
      const ped = this.peds.get(entity.id);
      if (!ped) continue;
      this.updatePed(ped, entity, now);
      this.drawBar(ped, entity);
      if (local && V.distance(entity.pos, local.position) <= 80) nearby += 1;
    }
    this.nearby = nearby;

    if (this.lastSnapshot) this.snapshotAge = now - (this.clientState.lastSnapshotAt || now);
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

module.exports = new GuardView();
