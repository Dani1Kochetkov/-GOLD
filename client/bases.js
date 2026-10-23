'use strict';

/** Базы выживших: метки на карте, 3D-маркер, ворота, взаимодействие. */

const V = require('../shared/vec3');

// mp.markers.new: type 0 = circle, цвета 0=red 1=green 2=blue 3=yellow.
const MARKER_TYPE = 0;
const MARKER_COLOR_FREE = 1; // зелёный
const MARKER_COLOR_OWNED = 2; // синий

class BaseView {
  constructor() {
    this.zones = new Map();
    this.blips = new Map();
    this.markers = new Map();
    this.lastDraw = 0;
  }

  applyMap(baseZones) {
    const list = Array.isArray(baseZones) ? baseZones : [];
    this.destroyAll();
    for (let i = 0; i < list.length; i += 1) {
      const zone = list[i];
      if (!zone || !zone.id) continue;
      this.zones.set(zone.id, {
        id: zone.id,
        name: zone.name || zone.id,
        pos: V.copy(zone.pos),
        radius: Number(zone.radius) || 20,
        gate: zone.gate ? {
          pos: V.copy(zone.gate.pos),
          heading: Number(zone.gate.heading) || 0,
          radius: Number(zone.gate.radius) || 4
        } : null,
        owner: null,
        codeSet: false,
        gateOpen: false
      });
    }
    this.refreshBlips();
    this.refreshMarkers();
  }

  applyUpdate(payload) {
    let data = null;
    try {
      data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (err) {
      return;
    }
    if (!data || !data.id) return;
    const zone = this.zones.get(String(data.id));
    if (!zone) return;
    if (data.owner !== undefined) zone.owner = data.owner || null;
    if (data.code !== undefined) zone.codeSet = !!data.code;
    if (data.open !== undefined) zone.gateOpen = !!data.open;
    this.refreshBlips();
    this.refreshMarkers();
  }

  refreshBlips() {
    try {
      for (const [id, blip] of Array.from(this.blips.entries())) {
        if (mp.game.ui.doesBlipExist && !mp.game.ui.doesBlipExist(blip)) {
          this.blips.delete(id);
          continue;
        }
        mp.game.ui.removeBlip(blip);
        this.blips.delete(id);
      }
    } catch (err) {
      this.blips.clear();
    }
    for (const zone of this.zones.values()) {
      try {
        const blip = mp.game.ui.addBlipForCoord(zone.pos.x, zone.pos.y, zone.pos.z);
        if (!blip) continue;
        if (mp.game.ui.setBlipSprite) mp.game.ui.setBlipSprite(blip, zone.owner ? 47 : 8);
        if (mp.game.ui.setBlipColour) mp.game.ui.setBlipColour(blip, zone.owner ? 4 : 0);
        if (mp.game.ui.setBlipAlpha) mp.game.ui.setBlipAlpha(blip, 255);
        if (mp.game.ui.setBlipScale) mp.game.ui.setBlipScale(blip, 1.2);
        if (mp.game.ui.setBlipDisplay) mp.game.ui.setBlipDisplay(blip, 0);
        if (mp.game.ui.setBlipName) mp.game.ui.setBlipName(blip, zone.name);
        this.blips.set(zone.id, blip);
      } catch (err) {
        // ignore
      }
    }
  }

  refreshMarkers() {
    // Пересоздём маркеры, если их API недоступен.
    for (const [id, marker] of Array.from(this.markers.entries())) {
      try {
        marker.delete();
      } catch (err) {
        // ignore
      }
      this.markers.delete(id);
    }
    if (!mp.markers || typeof mp.markers.new !== 'function') return;
    for (const zone of this.zones.values()) {
      try {
        const marker = mp.markers.new(
          new mp.Vector3(zone.pos.x, zone.pos.y, zone.pos.z),
          MARKER_TYPE,
          zone.owner ? MARKER_COLOR_OWNED : MARKER_COLOR_FREE,
          0.9,
          false
        );
        if (marker) this.markers.set(zone.id, marker);
      } catch (err) {
        // ignore
      }
    }
  }

  update() {
    const now = Date.now();
    if (now - this.lastDraw < 400) return;
    this.lastDraw = now;
    const local = mp.players.local;
    if (!local) return;

    // Маркеры ворот: перекрашиваем по состоянию (открыт/закрыт).
    for (const zone of this.zones.values()) {
      if (!zone.gate) continue;
      if (V.distance(zone.gate.pos, local.position) > 500) continue;
      const marker = this.markers.get(zone.id);
      if (!marker) continue;
      try {
        marker.setColour(zone.gateOpen ? MARKER_COLOR_FREE : 0);
      } catch (err) {
        // ignore
      }
    }
  }

  nearBase(pos, radius) {
    const max = Number(radius) || 8;
    let best = null;
    let bestDist = Infinity;
    for (const zone of this.zones.values()) {
      const dist = V.distance(zone.pos, pos);
      if (dist <= zone.radius + max && dist < bestDist) {
        best = zone;
        bestDist = dist;
      }
    }
    return best;
  }

  destroyAll() {
    for (const [id, blip] of Array.from(this.blips.entries())) {
      try {
        if (mp.game.ui.doesBlipExist && !mp.game.ui.doesBlipExist(blip)) continue;
        mp.game.ui.removeBlip(blip);
      } catch (err) {
        // ignore
      }
      this.blips.delete(id);
    }
    for (const [id, marker] of Array.from(this.markers.entries())) {
      try {
        marker.delete();
      } catch (err) {
        // ignore
      }
      this.markers.delete(id);
    }
  }

  stats() {
    return { zones: this.zones.size, blips: this.blips.size, markers: this.markers.size };
  }
}

module.exports = new BaseView();
