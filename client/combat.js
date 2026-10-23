'use strict';

/** Стрельба/ближний бой: клиент считает луч и отправляет серверу геометрию выстрела. */

const UI = require('./ui');

function rotationToDirection(rotation) {
  const z = (rotation.z * Math.PI) / 180;
  const x = (rotation.x * Math.PI) / 180;
  const num = Math.abs(Math.cos(x));
  return new mp.Vector3(-Math.sin(z) * num, Math.cos(z) * num, Math.sin(x));
}

class Combat {
  constructor() {
    this.catalog = new Map();
    this.inventory = null;
    this.lastShotAt = 0;
    this.lastServerAmmo = null;
    this.blocked = false;
    this.dead = false;
  }

  setCatalog(items) {
    this.catalog = new Map();
    for (let i = 0; i < items.length; i += 1) this.catalog.set(items[i].id, items[i]);
  }

  setInventory(payload) {
    this.inventory = payload;
    const primary = payload && payload.eq && payload.eq.primary;
    if (primary) this.lastServerAmmo = primary[1];
  }

  equipped() {
    const eq = this.inventory && this.inventory.eq;
    if (!eq) return null;
    const entry = eq.primary || eq.melee;
    if (!entry) return null;
    const def = this.catalog.get(entry[0]);
    return { entry, def, ammo: entry[1] };
  }

  equippedAmmo() {
    const current = this.equipped();
    if (!current || !current.def || !current.def.wp || !current.def.wp.ammoType) return null;
    return Number(current.ammo) || 0;
  }

  canAct() {
    const local = mp.players.local;
    if (!local) return false;
    // В клиентском API здоровье — свойство (local.health), а не метод.
    const health = typeof local.health === 'number' ? local.health : 100;
    return !this.blocked && !this.dead && health > 0;
  }

  attack() {
    if (!this.canAct()) return;
    const now = Date.now();
    const current = this.equipped();
    const def = current && current.def;
    const weapon = def && def.wp ? def.wp : null;
    const rate = weapon ? Math.max(80, Number(weapon.rate) || 300) : 700;
    if (now - this.lastShotAt < rate) return;

    if (weapon && weapon.ammoType && this.equippedAmmo() <= 0) {
      UI.toast('Нет патронов. R — перезарядка', 'warning');
      return;
    }

    const local = mp.players.local;
    let cam;
    let rotation;
    try {
      cam = mp.game.cam.getGameplayCamCoord();
      rotation = mp.game.cam.getGameplayCamRot(2);
    } catch (err) {
      return;
    }
    const dir = rotationToDirection(rotation);
    const maxRange = weapon ? Number(weapon.range) + 2 : 2.2;
    const rawEnd = new mp.Vector3(cam.x + dir.x * maxRange, cam.y + dir.y * maxRange, cam.z + dir.z * maxRange);

    let end = rawEnd;
    try {
      const hit = mp.raycasting.testPointToPoint(cam, rawEnd, local, 1 | 16 | 4 | 8);
      if (hit && hit.position) {
        end = new mp.Vector3(hit.position.x, hit.position.y, hit.position.z);
      }
    } catch (err) {
      // если raycast недоступен — стреляем в точку по направлению
    }

    const origin = new mp.Vector3(cam.x, cam.y, cam.z);
    const payload = {
      o: [Math.round(origin.x * 100) / 100, Math.round(origin.y * 100) / 100, Math.round(origin.z * 100) / 100],
      t: [Math.round(end.x * 100) / 100, Math.round(end.y * 100) / 100, Math.round(end.z * 100) / 100],
      h: 0
    };
    mp.events.callRemote('gold:shot', JSON.stringify(payload));
    this.lastShotAt = now;

    // Локальное отображение патронов (сервер остаётся авторитетом).
    if (weapon && weapon.ammoType && current.entry) {
      current.entry[1] = Math.max(0, (Number(current.entry[1]) || 0) - 1);
      this.lastServerAmmo = current.entry[1];
      UI.post({
        t: 'ammo',
        ammo: current.entry[1],
        mag: Number(weapon.mag) || 0,
        itemId: current.entry[0]
      });
    }
  }

  reload() {
    if (this.blocked || this.dead) return;
    const current = this.equipped();
    if (!current || !current.def || !current.def.wp || !current.def.wp.ammoType) {
      UI.toast('Нечего перезаряжать', 'muted');
      return;
    }
    mp.events.callRemote('gold:inv', JSON.stringify({ a: 'reload' }));
  }

  onServerShot(payload) {
    let data = null;
    try {
      data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (err) {
      return;
    }
    if (!data) return;
    if (data.dry) UI.toast('Магазин пуст', 'warning');
    if (typeof data.ammo === 'number') {
      const current = this.equipped();
      if (current && current.entry && current.def && current.def.wp && current.def.wp.ammoType) {
        current.entry[1] = data.ammo;
        UI.post({
          t: 'ammo',
          ammo: data.ammo,
          mag: Number(current.def.wp.mag) || 0,
          itemId: current.entry[0]
        });
      }
    }
  }

  update() {
    this.blocked = !!this.forceBlocked;
    this.dead = !!this.forceDead;
  }
}

module.exports = new Combat();
