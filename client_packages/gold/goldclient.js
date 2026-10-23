/* GOLD DAYZ — client bundle. Собран tools/build-client.js. Правьте client/ и shared/, затем npm run build. */
(function () {
  "use strict";
  var __modules = {
    0: function (module, exports, __require) { /* client/index.js */
'use strict';

/**
 * Клиентская точка входа GOLD DAYZ.
 * Собирается esbuild в client_packages/gold/goldclient.js (npm run build).
 */

const UI = __require(1);
const Zombies = __require(2);
const Combat = __require(3);
const World = __require(4);
const { sanitizeText } = __require(5);

const state = {
  catalog: new Map(),
  catalogParts: new Map(),
  catalogTotal: 0,
  inventory: null,
  map: null,
  welcome: null,
  hud: null,
  panel: null,
  dead: false,
  ready: false,
  lastDamageAt: 0
};

function post(msg) {
  UI.post(msg);
}

function on(eventName, handler) {
  mp.events.add(eventName, (...args) => {
    try {
      handler(...args);
    } catch (err) {
      mp.gui.chat.push(`! [GOLD] ${eventName}: ${err.message}`);
    }
  });
}

// ------------------------------------------------------------------ CEF

function initUI() {
  UI.init(handleUIAction);
  setTimeout(() => {
    mp.events.callRemote('gold:ready');
    state.ready = true;
  }, 500);
}

function handleUIAction(action) {
  if (!action || typeof action !== 'object') return;
  switch (action.t) {
    case 'move':
      sendInventoryAction({ a: 'move', from: Number(action.from), to: Number(action.to) });
      break;
    case 'equip':
      sendInventoryAction({ a: 'equip', slot: Number(action.slot) });
      break;
    case 'unequip':
      sendInventoryAction({ a: 'unequip', eq: sanitizeText(action.eq, 16) });
      break;
    case 'use':
      sendInventoryAction({ a: 'use', slot: Number(action.slot) });
      break;
    case 'drop':
      sendInventoryAction({ a: 'drop', slot: Number(action.slot), count: Number(action.count) || 1 });
      break;
    case 'reload':
      Combat.reload();
      break;
    case 'pickup':
      mp.events.callRemote('gold:interact', JSON.stringify({}));
      break;
    case 'close':
      closePanel();
      break;
    case 'respawn':
      mp.events.callRemote('gold:respawnRequest');
      break;
    case 'waypoint':
      World.setWaypoint(Number(action.x), Number(action.y));
      closePanel();
      break;
    case 'radio':
      mp.events.callRemote('gold:radio', sanitizeText(action.text, 140));
      break;
    default:
      break;
  }
}

function sendInventoryAction(action) {
  mp.events.callRemote('gold:inv', JSON.stringify(action));
}

// ------------------------------------------------------------------ панели

function setCursor(visible) {
  try {
    mp.gui.cursor.show(!!visible, !!visible);
    mp.gui.chat.activate(!visible);
  } catch (err) {
    // ignore
  }
}

function openPanel(name) {
  if (state.dead) return;
  state.panel = name;
  World.setPanelOpen(true);
  setCursor(true);
  post({ t: 'panel', name, open: true });
}

function closePanel() {
  state.panel = null;
  World.setPanelOpen(false);
  setCursor(false);
  post({ t: 'panel', name: null, open: false });
}

function togglePanel(name) {
  if (state.panel === name) closePanel();
  else openPanel(name);
}

function chatActive() {
  try {
    return mp.gui.chat.active === true;
  } catch (err) {
    return false;
  }
}

// ------------------------------------------------------------------ события сервера

on('gold:catalog', (payload) => {
  const part = JSON.parse(payload);
  if (!part || !Array.isArray(part.items)) return;
  state.catalogTotal = Number(part.total) || 1;
  state.catalogParts.set(Number(part.part) || 0, part.items);
  if (state.catalogParts.size < state.catalogTotal) return;
  const all = [];
  for (let i = 0; i < state.catalogTotal; i += 1) {
    const items = state.catalogParts.get(i) || [];
    for (let k = 0; k < items.length; k += 1) all.push(items[k]);
  }
  state.catalog = new Map(all.map((def) => [def.id, def]));
  Combat.setCatalog(all);
  post({ t: 'catalog', items: all });
});

on('gold:map', (payload) => {
  state.map = JSON.parse(payload);
  post({ t: 'map', data: state.map });
});

on('gold:welcome', (payload) => {
  state.welcome = JSON.parse(payload);
  Zombies.setTypes(state.welcome.zombies || []);
  World.applyWelcome(state.welcome);
  post({ t: 'welcome', data: state.welcome });
});

on('gold:inventory', (payload) => {
  state.inventory = JSON.parse(payload);
  Combat.setInventory(state.inventory);
  post({ t: 'inventory', data: state.inventory });
});

on('gold:hud', (payload) => {
  const hud = JSON.parse(payload);
  state.hud = hud;
  if (hud && Number.isFinite(Number(hud.hour))) World.setHour(hud.hour);
  post({ t: 'hud', data: hud });
});

on('gold:toast', (payload) => {
  const data = JSON.parse(payload);
  if (!data) return;
  UI.toast(data.text || '', data.kind || 'info');
});

on('gold:chat', (text) => {
  mp.gui.chat.push(String(text || ''));
});

on('gold:zombies', (payload) => {
  Zombies.applySnapshot(payload);
});

on('gold:zombieKilled', (payload) => {
  Zombies.onKilled(payload);
});

on('gold:scream', () => {
  try {
    mp.game.audio.playSoundFrontend(-1, 'Beep_Red', 'DLC_HEIST_HACKING_SNAKE_SOUNDS', true);
  } catch (err) {
    // ignore
  }
});

on('gold:shot', (payload) => Combat.onServerShot(payload));

on('gold:hit', (payload) => {
  let hit = null;
  try {
    hit = JSON.parse(payload);
  } catch (err) {
    return;
  }
  if (!hit) return;
  post({ t: 'hit', data: hit });
  if (hit.kill) UI.toast(hit.type === 'zombie' ? 'Зомби уничтожен' : 'Цель ликвидирована', 'success');
});

on('gold:damage', (payload) => {
  let damage = null;
  try {
    damage = JSON.parse(payload);
  } catch (err) {
    return;
  }
  state.lastDamageAt = Date.now();
  post({ t: 'damage', data: damage });
});

on('gold:death', (payload) => {
  let data = null;
  try {
    data = JSON.parse(payload);
  } catch (err) {
    data = {};
  }
  state.dead = true;
  Combat.forceDead = true;
  World.onDeath();
  closePanel();
  // Экран смерти кликабельный: без курсора кнопку «Возродиться» не нажать.
  setCursor(true);
  post({ t: 'death', data: data || {} });
});

on('gold:respawn', (payload) => {
  let data = null;
  try {
    data = JSON.parse(payload);
  } catch (err) {
    data = {};
  }
  state.dead = false;
  Combat.forceDead = false;
  setCursor(false);
  World.onRespawn(data && data.pos);
  UI.post({ t: 'hudReset' });
});

on('gold:teleport', (payload) => {
  let data = null;
  try {
    data = JSON.parse(payload);
  } catch (err) {
    return;
  }
  World.teleport(data);
});

on('gold:stats', (payload) => {
  if (state.panel === 'map') return;
  post({ t: 'debug', text: String(payload || '') });
});

on('gold:tpwayRequest', () => {
  // Берём метку с карты и возвращаем серверу координаты (для админского /tpway).
  try {
    const blip = mp.game.ui.getFirstBlipInfoId(8);
    if (!blip || !mp.game.ui.doesBlipExist(blip)) {
      mp.gui.chat.push('! Метка на карте не найдена (Esc → карта → ЛКМ).');
      return;
    }
    const coords = mp.game.ui.getBlipInfoIdCoord(blip);
    const ground = mp.game.gameplay.getGroundZFor3dCoord(coords.x, coords.y, 1000, 0, false);
    mp.events.callRemote('gold:tpway', JSON.stringify({
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      z: Number.isFinite(ground) && ground !== 0 ? Math.round(ground + 1) : 100
    }));
  } catch (err) {
    mp.gui.chat.push(`! /tpway: ${err.message}`);
  }
});

on('gold:ui', (payload) => {
  let data = null;
  try {
    data = JSON.parse(payload);
  } catch (err) {
    return;
  }
  if (!data) return;
  if (data.open) openPanel(data.panel);
  else closePanel();
});

// ------------------------------------------------------------------ управление

function bindKey(code, handler) {
  try {
    mp.keys.bind(code, false, () => {
      if (chatActive()) return;
      try {
        handler();
      } catch (err) {
        mp.gui.chat.push(`! [GOLD] key ${code}: ${err.message}`);
      }
    });
  } catch (err) {
    // ignore
  }
}

const KEY = { I: 0x49, M: 0x4D, E: 0x45, R: 0x52, ESC: 0x1B, F1: 0x70, TAB: 0x09 };

bindKey(KEY.I, () => togglePanel('inventory'));
bindKey(KEY.M, () => togglePanel('map'));
bindKey(KEY.ESC, () => {
  if (state.panel) closePanel();
});
bindKey(KEY.E, () => {
  if (state.dead || state.panel) return;
  mp.events.callRemote('gold:interact', JSON.stringify({}));
});
bindKey(KEY.R, () => {
  if (state.dead || state.panel) return;
  Combat.reload();
});
bindKey(KEY.F1, () => {
  const zombies = Zombies.stats();
  const ammo = Combat.equippedAmmo();
  const line = `sync: peds ${zombies.peds}/ent ${zombies.entities} | snapshot ${zombies.snapshotAge} мс | рядом ${zombies.nearby} | патроны ${ammo === null ? '-' : ammo} | ${World.debugLine()}`;
  UI.toast(line, 'debug');
  post({ t: 'debug', text: line });
});

// ЛКМ: hold=true — автоматический огонь у автоматов; темп режет Combat.attack().
try {
  mp.keys.bind(0x01, true, () => {
    if (state.dead || state.panel || chatActive()) return;
    Combat.attack();
  });
} catch (err) {
  // ignore
}

// ------------------------------------------------------------------ жизненный цикл

mp.events.add('guiReady', () => {
  initUI();
});

mp.events.add('render', () => {
  try {
    Combat.forceBlocked = !!state.panel;
    Zombies.update();
    World.update();
    Combat.update();
  } catch (err) {
    // Никогда не роняем render из-за одной ошибки.
  }
});

mp.events.add('playerSpawn', () => {
  try {
    World.setupLocalPlayer();
    Zombies.setDimension();
  } catch (err) {
    // ignore
  }
});

mp.events.add('entityStreamIn', (entity) => {
  // Клиентские педы-зомби помечаем, чтобы не путать с игроками.
  try {
    if (entity && entity.type === 'ped' && !entity.goldZombie) {
      const view = Zombies.peds;
      for (const ped of view.values()) {
        if (ped === entity) {
          entity.goldZombie = true;
          Zombies.configurePed(entity, { typeCode: 0 });
          break;
        }
      }
    }
  } catch (err) {
    // ignore
  }
});

setInterval(() => {
  if (!state.ready) {
    try {
      mp.events.callRemote('gold:ready');
    } catch (err) {
      // ignore
    }
  }
}, 4000);

module.exports = { state };

    },
    1: function (module, exports, __require) { /* client/ui.js */
'use strict';

/**
 * Мост клиент ⇄ CEF-интерфейс.
 * Все сообщения — JSON; CEF отвечает событиями goldui:action.
 */
class UIBridge {
  constructor() {
    this.browser = null;
    this.ready = false;
    this.queue = [];
    this.onAction = null;
    this.visible = false;
    this.failed = false;
  }

  init(onAction) {
    this.onAction = onAction;
    // Слушатели регистрируем ДО создания браузера: CEF может загрузиться
    // и прислать goldui:ready раньше, чем мы успеем подписаться.
    mp.events.add('goldui:ready', () => {
      this.ready = true;
      this.flush();
    });
    try {
      this.browser = mp.browsers.new('package://gold/ui/index.html');
    } catch (err) {
      this.failed = true;
      mp.gui.chat.push('! GOLD DAYZ: не удалось открыть UI (gold/ui/index.html). Соберите клиент: npm run build');
      return;
    }
    // Страховка: если CEF не прислал ready (например, ошибка JS в app.js),
    // всё равно пробуем отправлять сообщения, чтобы HUD не остался пустым.
    setTimeout(() => {
      if (!this.ready && !this.failed) {
        this.ready = true;
        this.flush();
        mp.gui.chat.push('! GOLD DAYZ: UI не ответил вовремя — проверьте client_packages/gold/ui/app.js');
      }
    }, 5000);
    mp.events.add('goldui:action', (payload) => {
      let action = null;
      try {
        action = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (err) {
        return;
      }
      if (action && typeof this.onAction === 'function') this.onAction(action);
    });
    mp.events.add('goldui:log', (message) => {
      mp.gui.chat.push(`[UI] ${message}`);
    });
  }

  post(message) {
    if (this.failed) return;
    if (!this.ready) {
      if (this.queue.length < 200) this.queue.push(message);
      return;
    }
    const json = JSON.stringify(message);
    try {
      this.browser.execute(`window.goldUI && window.goldUI.receive(${JSON.stringify(json)})`);
    } catch (err) {
      // CEF мог перезагрузиться — попробуем ещё раз после goldui:ready.
      this.ready = false;
      this.queue.push(message);
    }
  }

  flush() {
    const list = this.queue.splice(0, this.queue.length);
    for (let i = 0; i < list.length; i += 1) this.post(list[i]);
  }

  execute(code) {
    if (!this.ready || this.failed) return;
    try {
      this.browser.execute(code);
    } catch (err) {
      // игнорируем
    }
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.post({ t: 'visible', visible: this.visible });
  }

  toast(text, kind) {
    this.post({ t: 'toast', text: String(text || ''), kind: kind || 'info' });
  }
}

module.exports = new UIBridge();

    },
    2: function (module, exports, __require) { /* client/zombies.js */
'use strict';

/** Клиентское представление зомби: пул client-side peds, интерполяция, анимация. */

const SYNC = __require(6);
const V = __require(7);

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

    },
    3: function (module, exports, __require) { /* client/combat.js */
'use strict';

/** Стрельба/ближний бой: клиент считает луч и отправляет серверу геометрию выстрела. */

const UI = __require(1);

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

    },
    4: function (module, exports, __require) { /* client/world.js */
'use strict';

/** Мир вокруг игрока: время, погода, вода, HUD, отправка состояния движения. */

const UI = __require(1);

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

    },
    5: function (module, exports, __require) { /* shared/netcode.js */
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

    },
    6: function (module, exports, __require) { /* shared/sync.js */
'use strict';

/**
 * Компактный протокол синхронизации зомби.
 *
 * Снапшот — JSON в одном player.call(), поэтому важно экономить байты:
 * RAGE:MP режет payload на 8192 байтах.
 * Формат: [id, x, y, z, heading, state, hpPercent, typeCode].
 */

const { SYNC } = __require(8);
const V = __require(7);

const STATE_CODES = { idle: 0, wander: 1, investigate: 2, chase: 3, attack: 4, dead: 5 };
const STATE_NAMES = ['idle', 'wander', 'investigate', 'chase', 'attack', 'dead'];

function stateCode(state) {
  const code = STATE_CODES[state];
  return typeof code === 'number' ? code : 0;
}

function stateName(code) {
  return STATE_NAMES[code] || 'idle';
}

function round(value, digits) {
  const k = digits === 1 ? 10 : 100;
  return Math.round((Number(value) || 0) * k) / k;
}

/** Адаптивный интервал снапшотов: на локальной отладке важна отзывчивость. */
function chooseInterval(playersOnline, zombiesVisible) {
  if (!zombiesVisible) return SYNC.SNAPSHOT_INTERVAL_IDLE;
  if (playersOnline >= SYNC.SNAPSHOT_BUSY_PLAYERS) return SYNC.SNAPSHOT_INTERVAL_BUSY;
  return SYNC.SNAPSHOT_INTERVAL;
}

function toEntry(zombie) {
  return [
    zombie.id,
    round(zombie.pos.x, 2),
    round(zombie.pos.y, 2),
    round(zombie.pos.z, 2),
    Math.round(((zombie.heading || 0) % 360) * 10) / 10,
    stateCode(zombie.state),
    Math.max(0, Math.min(100, Math.round((zombie.hp / (zombie.maxHp || 1)) * 100))),
    Number(zombie.typeCode) || 0
  ];
}

/**
 * Собирает снапшот для одного наблюдателя.
 * @param {Array} zombies
 * @param {object} opts { position, radius, maxEntities, maxBytes, now, dimension, includeStates }
 */
function buildSnapshot(zombies, opts) {
  const options = opts || {};
  const radius = Number(options.radius) || SYNC.SNAPSHOT_RADIUS;
  const maxEntities = Math.max(1, Math.min(SYNC.SNAPSHOT_MAX_ZOMBIES, Number(options.maxEntities) || SYNC.SNAPSHOT_MAX_ZOMBIES));
  const maxBytes = Math.max(512, Number(options.maxBytes) || SYNC.MAX_PAYLOAD_BYTES);
  const origin = options.position || { x: 0, y: 0, z: 0 };
  const dimension = options.dimension || 0;

  const candidates = [];
  for (let i = 0; i < zombies.length; i += 1) {
    const zombie = zombies[i];
    if (!zombie || !zombie.alive) continue;
    if ((zombie.dimension || 0) !== dimension) continue;
    const dist = V.distance(origin, zombie.pos);
    if (dist > radius) continue;
    candidates.push({ zombie, dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const entries = [];
  let bytes = 32; // {"t":0,"z":[]}
  let dropped = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    if (entries.length >= maxEntities) {
      dropped = candidates.length - entries.length;
      break;
    }
    const entry = toEntry(candidates[i].zombie);
    const size = JSON.stringify(entry).length + 1;
    if (bytes + size > maxBytes) {
      dropped = candidates.length - entries.length;
      break;
    }
    entries.push(entry);
    bytes += size;
  }

  return {
    entries,
    count: entries.length,
    bytes,
    dropped,
    total: candidates.length,
    now: Number(options.now) || Date.now()
  };
}

function packSnapshot(snapshot) {
  return JSON.stringify({ t: snapshot.now, z: snapshot.entries });
}

function unpackSnapshot(payload) {
  if (typeof payload !== 'string' || !payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || !Array.isArray(parsed.z)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function createClientState() {
  return { entities: new Map(), lastSnapshotAt: 0, lastBytes: 0 };
}

/** Применяет снапшот и настраивает интерполяцию между кадрами. */
function applySnapshot(state, snapshot, now) {
  const time = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const received = snapshot && Array.isArray(snapshot.z) ? snapshot.z : [];
  const seen = new Set();

  for (let i = 0; i < received.length; i += 1) {
    const row = received[i];
    if (!Array.isArray(row) || row.length < 7) continue;
    const typeCode = row.length > 7 ? Number(row[7]) || 0 : 0;
    const id = row[0];
    const pos = { x: row[1], y: row[2], z: row[3] };
    seen.add(id);
    let entity = state.entities.get(id);
    if (!entity) {
      entity = {
        id,
        from: V.copy(pos),
        to: V.copy(pos),
        pos: V.copy(pos),
        heading: row[4],
        targetHeading: row[4],
        state: stateName(row[5]),
        hp: row[6],
        typeCode,
        startedAt: time,
        duration: 0,
        lastSeenAt: time
      };
      state.entities.set(id, entity);
      continue;
    }
    const rendered = computePosition(entity, time);
    entity.from = rendered;
    entity.to = V.copy(pos);
    entity.pos = V.copy(pos);
    entity.heading = entity.targetHeading;
    entity.targetHeading = row[4];
    entity.state = stateName(row[5]);
    entity.hp = row[6];
    entity.typeCode = typeCode;
    const delta = time - entity.lastSeenAt;
    entity.duration = Math.max(40, Math.min(500, delta));
    entity.startedAt = time;
    entity.lastSeenAt = time;
  }

  state.lastSnapshotAt = time;
  state.lastBytes = received.length;
  return { seen: seen.size, removed: pruneClientState(state, time) };
}

function interpolateAngle(from, to, t) {
  let delta = ((to - from + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

function computePosition(entity, now) {
  if (!entity || !entity.to) return { x: 0, y: 0, z: 0 };
  if (!entity.duration) return V.copy(entity.to);
  const t = Math.max(0, Math.min(1, (Number(now) - entity.startedAt) / entity.duration));
  return {
    x: V.lerp(entity.from.x, entity.to.x, t),
    y: V.lerp(entity.from.y, entity.to.y, t),
    z: V.lerp(entity.from.z, entity.to.z, t)
  };
}

function computeHeading(entity, now) {
  if (!entity) return 0;
  if (!entity.duration) return entity.targetHeading || 0;
  const t = Math.max(0, Math.min(1, (Number(now) - entity.startedAt) / entity.duration));
  return interpolateAngle(entity.heading || 0, entity.targetHeading || 0, t);
}

/** Убирает зомби, которые давно не приходили в снапшотах. */
function pruneClientState(state, now, ttlMs) {
  const ttl = Number(ttlMs) || 3000;
  let removed = 0;
  const ids = Array.from(state.entities.keys());
  for (let i = 0; i < ids.length; i += 1) {
    const entity = state.entities.get(ids[i]);
    if (!entity || now - entity.lastSeenAt > ttl) {
      state.entities.delete(ids[i]);
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  STATE_CODES,
  STATE_NAMES,
  stateCode,
  stateName,
  chooseInterval,
  toEntry,
  buildSnapshot,
  packSnapshot,
  unpackSnapshot,
  createClientState,
  applySnapshot,
  computePosition,
  computeHeading,
  pruneClientState
};

    },
    7: function (module, exports, __require) { /* shared/vec3.js */
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

    },
    8: function (module, exports, __require) { /* shared/constants.js */
'use strict';

/**
 * Общие константы GOLD DAYZ.
 * Файл используется и на сервере, и на клиенте (бандлится tools/build-client.js),
 * поэтому никаких зависимостей от API RAGE здесь быть не может.
 */

const ITEM_SLOTS = ['primary', 'melee', 'back', 'armor', 'mask', 'hands'];

const SLOT_LABELS = {
  primary: 'Оружие',
  melee: 'Ближний бой',
  back: 'Рюкзак',
  armor: 'Разгрузка',
  mask: 'Маска',
  hands: 'В руках'
};

const INVENTORY = {
  BASE_SLOTS: 18,
  MAX_SLOTS: 60,
  BASE_CAPACITY_KG: 30,
  STACK_OVERFLOW_GUARD: 10000
};

const SURVIVAL = {
  MAX_HEALTH: 100,
  MAX_BLOOD: 100,
  MAX_HUNGER: 100,
  MAX_THIRST: 100,
  MAX_STAMINA: 100,
  MAX_RADIATION: 100,
  BODY_TEMPERATURE: 37,
  HUNGER_DRAIN: 0.05,
  THIRST_DRAIN: 0.07,
  STARVE_HEALTH_DRAIN: 0.5,
  DEHYDRATE_HEALTH_DRAIN: 0.7,
  BLEED_HEALTH_DRAIN: 1.4,
  BLEED_BLOOD_DRAIN: 3.0,
  RADIATION_HEALTH_DRAIN: 0.02,
  COLD_HEALTH_DRAIN: 0.35,
  STAMINA_REGEN: 9,
  STAMINA_SPRINT_DRAIN: 7.5,
  STAMINA_JUMP_COST: 6,
  STAMINA_EXHAUSTED_AT: 8,
  STAMINA_MAX_OVERWEIGHT: 0.35,
  RESPAWN_DELAY_MS: 12000,
  DEATH_STATS_RESET: true
};

const ZOMBIE = {
  THINK_INTERVAL_MS: 400,
  ATTACK_TOLERANCE: 1.35,
  LOS_REPORT_INTERVAL_MS: 250,
  MAX_LEASH_FROM_ZONE: 60,
  CORPSE_TTL_MS: 90000,
  NOISE_FORGET_MS: 6000,
  LOST_TARGET_MS: 7000,
  GLOBAL_CAP: 120,
  MAX_PER_PLAYER: 24
};

const SYNC = {
  // RAGE:MP ограничивает payload player.call() 8192 байтами.
  MAX_PAYLOAD_BYTES: 7800,
  SNAPSHOT_MAX_ZOMBIES: 96,
  SNAPSHOT_INTERVAL: 50,
  SNAPSHOT_INTERVAL_BUSY: 100,
  SNAPSHOT_INTERVAL_IDLE: 200,
  SNAPSHOT_BUSY_PLAYERS: 14,
  INTERP_TIME_MS: 120,
  MAX_EXTRAPOLATION_MS: 250,
  SNAPSHOT_RADIUS: 320
};

const RATE = {
  INVENTORY_ACTIONS_PER_SEC: 12,
  SHOT_EVENTS_PER_SEC: 20,
  CHAT_MESSAGES_PER_10S: 8,
  MOVE_EVENTS_PER_SEC: 30,
  MAX_STRING_ARG: 64
};

const ITEM_KIND = {
  WEAPON: 'weapon',
  AMMO: 'ammo',
  MEDICAL: 'medical',
  FOOD: 'food',
  GEAR: 'gear',
  MATERIAL: 'material',
  TOOL: 'tool'
};

module.exports = {
  ITEM_SLOTS,
  SLOT_LABELS,
  INVENTORY,
  SURVIVAL,
  ZOMBIE,
  SYNC,
  RATE,
  ITEM_KIND
};

    }
  };
  var __cache = {};
  function __require(id) {
    var cached = __cache[id];
    if (cached) return cached.exports;
    var module = { exports: {} };
    __cache[id] = module;
    __modules[id].call(module.exports, module, module.exports, __require);
    return module.exports;
  }
  __require(0);
})();