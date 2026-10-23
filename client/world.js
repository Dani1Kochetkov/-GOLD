'use strict';

/** Мир вокруг игрока: время, погода, вода, HUD, отправка состояния движения. */

const UI = require('./ui');

class World {
  constructor() {
    this.hour = 10;
    this.minute = 0;
    this.weather = 'OVERCAST';
    this.lastMoveStateAt = 0;
    this.lastClockAt = 0;
    this.dead = false;
    this.panelOpen = false;
    this.inWater = false;
    this.invincibleSet = false;
    this.hintsShown = false;
  }

  setPanelOpen(open) {
    this.panelOpen = !!open;
  }

  applyWelcome(data) {
    if (!data) return;
    if (Number.isFinite(Number(data.worldHour))) this.hour = Number(data.worldHour);
    if (data.weather) this.weather = String(data.weather);
    this.applyWeather();
    this.applyClock(true);
    this.setupLocalPlayer();
  }

  setupLocalPlayer() {
    const local = mp.players.local;
    if (!local) return;
    try {
      mp.game.ui.displayHud(false);
      mp.game.ui.displayRadar(false);
      mp.game.player.setHealthRechargeMultiplier(0);
      mp.game.player.setPoliceIgnorePlayer(true);
      mp.game.player.setEveryoneIgnorePlayer(true);
      local.setInvincible(true);
      mp.game.ped.clearPedBloodDamage(local.handle);
      mp.game.ped.clearPedDamageDecalByZone(local.handle, 0, 0);
    } catch (err) {
      // часть нативов может отсутствовать
    }
    this.invincibleSet = true;
    if (!this.hintsShown) {
      this.hintsShown = true;
      mp.gui.chat.push('! GOLD DAYZ: I — инвентарь, M — карта, E — подобрать, R — перезарядка, F1 — телеметрия синхронизации.');
    }
  }

  applyWeather() {
    try {
      if (mp.game.gameplay.setWeatherTypeNowPersist) mp.game.gameplay.setWeatherTypeNowPersist(this.weather);
      else if (mp.game.gameplay.setOverrideWeather) mp.game.gameplay.setOverrideWeather(this.weather);
    } catch (err) {
      // ignore
    }
  }

  applyClock(force) {
    const now = Date.now();
    if (!force && now - this.lastClockAt < 5000) return;
    this.lastClockAt = now;
    const hour = Math.floor(this.hour) % 24;
    const minute = Math.floor((this.hour % 1) * 60);
    try {
      mp.game.time.pauseClock(true);
      mp.game.time.setClockTime(hour, minute, 0);
    } catch (err) {
      // ignore
    }
  }

  setHour(hour) {
    if (!Number.isFinite(Number(hour))) return;
    this.hour = Number(hour);
    this.applyClock(false);
  }

  update() {
    const local = mp.players.local;
    if (!local) return;

    if (this.panelOpen) {
      try {
        mp.game.controls.disableAllControlActions(0);
        mp.game.controls.enableControlAction(0, 200, true); // ESC / pause
        mp.game.controls.enableControlAction(0, 199, true);
        mp.game.controls.enableControlAction(0, 245, true); // chat
        mp.game.controls.enableControlAction(0, 246, true);
        mp.game.controls.enableControlAction(0, 249, true);
      } catch (err) {
        // ignore
      }
    }

    if (this.dead) {
      try {
        mp.game.controls.disableAllControlActions(0);
        mp.game.controls.enableControlAction(0, 200, true);
      } catch (err) {
        // ignore
      }
      return;
    }

    const now = Date.now();
    if (now - this.lastMoveStateAt < 250) return;
    this.lastMoveStateAt = now;

    let moving = false;
    let sprinting = false;
    let inWater = false;
    try {
      const speed = local.getSpeed ? local.getSpeed() : 0;
      moving = speed > 0.6;
      sprinting = !!(mp.game.ped.isPedSprinting && mp.game.ped.isPedSprinting(local.handle));
      inWater = !!(mp.game.ped.isPedInWater && mp.game.ped.isPedInWater(local.handle));
      if (!sprinting) {
        sprinting = speed > 5.2 && (mp.game.ped.isPedRunning && mp.game.ped.isPedRunning(local.handle));
      }
    } catch (err) {
      moving = false;
    }
    this.inWater = inWater;

    mp.events.callRemote('gold:moveState', JSON.stringify({
      m: moving ? 1 : 0,
      s: sprinting ? 1 : 0,
      w: inWater ? 1 : 0,
      f: 0
    }));
  }

  onDeath() {
    this.dead = true;
    try {
      mp.game.ped.setPedToRagdoll(mp.players.local.handle, 20000, 20000, 0, false, false, false);
      mp.game.controls.disableAllControlActions(0);
    } catch (err) {
      // ignore
    }
  }

  onRespawn(pos) {
    this.dead = false;
    if (pos) this.teleport(pos);
    try {
      const local = mp.players.local;
      // Снимаем ragdoll с экрана смерти, иначе пед останется лежать.
      try {
        mp.game.ped.clearPedToRagdoll(local.handle, 0, 0, 0);
      } catch (err) {
        // натив может отсутствовать в старых сборках
      }
      mp.game.ped.clearPedBloodDamage(local.handle);
      local.setArmour(0);
      mp.game.player.resetPlayerStamina();
      mp.game.player.restorePlayerStamina(100);
      local.freezePosition(false);
      // Здоровье приходит от сервера (player.health), здесь его не трогаем.
    } catch (err) {
      // ignore
    }
    UI.post({ t: 'respawn' });
  }

  teleport(pos) {
    if (!pos) return;
    try {
      const coords = new mp.Vector3(Number(pos.x), Number(pos.y), Number(pos.z));
      mp.players.local.position = coords;
      mp.game.entity.setEntityCoords(mp.players.local.handle, coords.x, coords.y, coords.z, false, false, false, false);
      mp.game.cam.setGameplayCamRelativePitch(0, 0);
    } catch (err) {
      mp.gui.chat.push(`! Не удалось телепортироваться: ${err.message}`);
    }
  }

  setWaypoint(x, y) {
    try {
      mp.game.ui.setNewWaypoint(Number(x), Number(y));
      mp.gui.chat.push(`! Метка установлена: ${Math.round(x)}, ${Math.round(y)}`);
    } catch (err) {
      // ignore
    }
  }

  debugLine() {
    return `час ${this.hour.toFixed(1)} | погода ${this.weather} | вода ${this.inWater ? 'да' : 'нет'}`;
  }
}

module.exports = new World();
