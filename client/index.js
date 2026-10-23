'use strict';

/**
 * Клиентская точка входа GOLD DAYZ.
 * Собирается esbuild в client_packages/gold/goldclient.js (npm run build).
 */

const UI = require('./ui');
const Zombies = require('./zombies');
const Combat = require('./combat');
const World = require('./world');
const { sanitizeText } = require('../shared/netcode');

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
