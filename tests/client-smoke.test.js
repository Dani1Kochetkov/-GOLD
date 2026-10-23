'use strict';

/**
 * Smoke-тест собранного клиента в фейковом RAGE.
 *
 * Загружает client_packages/gold/goldclient.js в vm-контекст с подставным `mp`
 * и прогоняет реальные сценарии: подключение, каталог, снапшоты зомби, клавиши,
 * стрельба, смерть/респавн. Ловит опечатки в событиях и нативах без GTA V.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(ROOT, 'client_packages', 'gold', 'goldclient.js');

function readBundle() {
  if (!fs.existsSync(BUNDLE)) throw new Error('нет client_packages/gold/goldclient.js — сначала npm run build');
  return fs.readFileSync(BUNDLE, 'utf8');
}

// ------------------------------------------------------------------ фейковый RAGE

function createEnv() {
  const handlers = new Map();
  const keybinds = [];
  const executed = [];
  const remote = [];
  const chat = [];
  const peds = [];
  const coordsCalls = [];
  let cursorVisible = false;

  function V3(x, y, z) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this.z = Number(z) || 0;
  }
  V3.prototype.copy = function copy() { return new V3(this.x, this.y, this.z); };

  function namespace(impl) {
    return new Proxy(impl, {
      get(target, prop) {
        if (prop === 'then') return undefined;
        if (prop in target) return target[prop];
        const fallback = () => 0;
        target[prop] = fallback;
        return fallback;
      }
    });
  }

  const pedByHandle = new Map();

  function makePed(hash, position, heading) {
    const ped = {
      handle: 1000 + peds.length,
      position: new V3(position && position.x, position && position.y, position && position.z),
      heading: Number(heading) || 0,
      dimension: 0,
      destroyed: false,
      alpha: 255,
      setInvincible() {},
      setProofs() {},
      setCanRagdoll() {},
      setAlpha(value) { this.alpha = value; },
      setDimension(value) { this.dimension = value; },
      setCoords(x, y, z) {
        this.position = new V3(x, y, z);
        coordsCalls.push(ped.handle);
      },
      setHeading(value) { this.heading = value; },
      destroy() { this.destroyed = true; }
    };
    peds.push(ped);
    pedByHandle.set(ped.handle, ped);
    return ped;
  }

  const local = {
    handle: 1,
    position: new V3(0, 0, 0),
    dimension: 0,
    health: 100,
    armour: 0,
    getSpeed: () => 0,
    setInvincible() {},
    setCanBeTargetted() {},
    setHealth() {},
    setArmour() {},
    clearBloodDamage() {},
    freezePosition() {}
  };

  const game = namespace({
    joaat: () => 123456,
    streaming: namespace({
      hasModelLoaded: () => true,
      requestModel: () => {},
      setModelAsNoLongerNeeded: () => {}
    }),
    cam: namespace({
      getGameplayCamCoord: () => new V3(0, 0, 1.7),
      getGameplayCamRot: () => new V3(0, 0, 0),
      setGameplayCamRelativePitch: () => {}
    }),
    ped: namespace({
      isPedSprinting: () => false,
      isPedRunning: () => false,
      isPedInWater: () => false,
      setPedToRagdoll: () => {},
      clearPedBloodDamage: () => {},
      taskGoStraightToCoord: (handle, x, y, z) => {
        const ped = pedByHandle.get(handle);
        if (ped) ped.position = new V3(x, y, z);
      }
    }),
    ui: namespace({
      displayHud: () => {},
      displayRadar: () => {},
      getFirstBlipInfoId: () => 0,
      doesBlipExist: () => false,
      getBlipInfoIdCoord: () => new V3(0, 0, 0),
      setNewWaypoint: () => {}
    }),
    player: namespace({
      setHealthRechargeMultiplier: () => {},
      setPoliceIgnorePlayer: () => {},
      setEveryoneIgnorePlayer: () => {},
      resetPlayerStamina: () => {},
      restorePlayerStamina: () => {}
    }),
    controls: namespace({
      disableAllControlActions: () => {},
      enableControlAction: () => {},
      disableControlAction: () => {}
    }),
    time: namespace({ pauseClock: () => {}, setClockTime: () => {} }),
    gameplay: namespace({
      setWeatherTypeNowPersist: () => {},
      setOverrideWeather: () => {},
      getGroundZFor3dCoord: () => 10
    }),
    entity: namespace({ setEntityCoords: () => {} }),
    audio: namespace({ playSoundFrontend: () => {} })
  });

  const mp = {
    Vector3: V3,
    events: {
      add(name, fn) { handlers.set(name, fn); },
      call(name, ...args) {
        const fn = handlers.get(name);
        if (fn) fn(...args);
      },
      callRemote(name, ...args) { remote.push({ name, args }); }
    },
    keys: {
      bind(code, hold, fn) { keybinds.push({ code, hold, fn }); }
    },
    browsers: {
      new(url) {
        return {
          url,
          execute(code) { executed.push(code); },
          destroy() {}
        };
      }
    },
    gui: {
      chat: {
        active: false,
        push(text) { chat.push(String(text)); },
        activate() {}
      },
      cursor: {
        show(visible) { cursorVisible = !!visible; }
      }
    },
    players: {
      local,
      forEach(fn) { fn(local); },
      call() {}
    },
    peds: {
      new(hash, position, heading) { return makePed(hash, position, heading); }
    },
    raycasting: {
      testPointToPoint: () => undefined
    },
    game
  };

  const context = {
    mp,
    console,
    setTimeout,
    clearTimeout,
    // Интервалы клиента (ready-пинг, часы смерти) в тесте не нужны:
    // иначе node:test не завершится, пока живы таймеры.
    setInterval: () => 0,
    clearInterval: () => {},
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite
  };

  vm.createContext(context);
  vm.runInContext(readBundle(), context, { filename: 'goldclient.js' });

  return {
    mp,
    handlers,
    keybinds,
    executed,
    remote,
    chat,
    peds,
    coordsCalls,
    context,
    isCursorVisible: () => cursorVisible,
    emit(name, ...args) {
      const fn = handlers.get(name);
      assert.ok(fn, `клиент не слушает ${name}`);
      return fn(...args);
    },
    key(code, hold) {
      const matches = keybinds.filter((entry) => entry.code === code && (hold === undefined || entry.hold === hold));
      assert.ok(matches.length > 0, `клавиша ${code} не привязана`);
      matches.forEach((entry) => entry.fn());
    },
    pedsByHandle: pedByHandle,
    close() {
      // Останавливаем интервалы клиента, иначе тест не завершится.
      const timers = context.__timers || [];
      timers.forEach((id) => clearInterval(id));
    }
  };
}

/** Сообщения, отправленные в CEF: window.goldUI.receive("<json>"). */
function uiMessages(executed) {
  const out = [];
  for (let i = 0; i < executed.length; i += 1) {
    const match = /receive\((".*")\)\s*;?\s*$/.exec(executed[i]);
    if (!match) continue;
    try {
      out.push(JSON.parse(JSON.parse(match[1])));
    } catch (err) {
      // не наше сообщение — пропускаем
    }
  }
  return out;
}

function lastOf(list, type) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] && list[i].t === type) return list[i];
  }
  return null;
}

// ------------------------------------------------------------------ данные сервера

const CATALOG = [
  {
    id: 'pistol',
    n: 'Пистолет',
    i: '🔫',
    d: 'Тестовый пистолет',
    s: 'primary',
    w: 1.2,
    st: 1,
    r: 'rare',
    e: true,
    u: false,
    wp: { hash: 453432689, damage: 26, range: 35, rate: 250, ammoType: 'ammo_9mm', mag: 12, noise: 110 },
    he: null,
    fo: null
  },
  {
    id: 'ammo_9mm',
    n: 'Патроны 9 мм',
    i: '▪',
    d: 'Патроны',
    s: 'none',
    w: 0.01,
    st: 120,
    r: 'common',
    e: false,
    u: false,
    wp: null,
    he: null,
    fo: null
  }
];

const WELCOME = {
  name: 'Тестер',
  server: 'GOLD DAYZ',
  weather: 'OVERCAST',
  hour: 10.5,
  night: false,
  pvp: true,
  zombies: [{ c: 0, m: 'u_m_y_zombie_01', t: 0, n: 'Ходячий' }]
};

const INVENTORY = {
  slots: [['ammo_9mm', 24, null], null, null, null],
  size: 18,
  eq: { primary: ['pistol', 12], melee: null, back: null, armor: null, mask: null, hands: null },
  w: 1.3,
  cap: 30,
  used: 1,
  alive: true
};

const HUD = {
  h: 95,
  b: 90,
  hu: 80,
  t: 75,
  s: 100,
  r: 0,
  bl: 0,
  temp: 36.6,
  w: 1.3,
  cap: 30,
  z: 0,
  p: 0,
  sc: 0,
  d: 0,
  night: false,
  hour: 10.5,
  px: 0,
  py: 0,
  nz: 0,
  safe: null,
  alive: true,
  respawnIn: 0
};

const MAP = {
  spawnPoints: [{ id: 'sp1', name: 'Точка', pos: { x: 0, y: 0, z: 0 } }],
  lootZones: [{ id: 'lz1', name: 'Больница', pos: { x: 10, y: 10, z: 0 }, radius: 30, tier: 2, lootTable: 'medical', count: 8 }],
  zombieZones: [{ id: 'zz1', name: 'Палето', pos: { x: 0, y: 0, z: 0 }, radius: 150, max: 12 }],
  safeZones: [{ id: 'sz1', name: 'Лагерь', pos: { x: 5, y: 5, z: 0 }, radius: 20 }],
  toxinZones: []
};

function bootReady() {
  const env = createEnv();
  env.emit('guiReady');
  env.emit('goldui:ready');
  env.emit('gold:welcome', JSON.stringify(WELCOME));
  env.emit('gold:map', JSON.stringify(MAP));
  env.emit('gold:catalog', JSON.stringify({ part: 0, total: 1, items: CATALOG }));
  env.emit('gold:inventory', JSON.stringify(INVENTORY));
  env.emit('gold:hud', JSON.stringify(HUD));
  return env;
}

// ------------------------------------------------------------------ тесты

test('клиент: подписан на события сервера и клавиши', () => {
  const env = createEnv();
  const expected = [
    'guiReady', 'render', 'gold:welcome', 'gold:catalog', 'gold:map', 'gold:inventory', 'gold:hud',
    'gold:toast', 'gold:zombies', 'gold:zombieKilled', 'gold:scream', 'gold:shot', 'gold:hit',
    'gold:damage', 'gold:death', 'gold:respawn', 'gold:teleport', 'gold:ui', 'gold:tpwayRequest'
  ];
  expected.forEach((name) => assert.ok(env.handlers.has(name), `нет обработчика ${name}`));
  [0x49, 0x4D, 0x45, 0x52, 0x1B, 0x70].forEach((code) => {
    assert.ok(env.keybinds.some((entry) => entry.code === code), `клавиша ${code.toString(16)} не привязана`);
  });
  assert.ok(env.keybinds.some((entry) => entry.code === 0x01 && entry.hold === true), 'ЛКМ привязана с автоповтором');
  assert.ok(!env.chat.some((line) => line.startsWith('! [GOLD]')), `ошибки инициализации: ${env.chat.join(' | ')}`);
});

test('клиент: CEF открывается и получает welcome/карту/каталог/инвентарь/HUD', () => {
  const env = bootReady();
  const messages = uiMessages(env.executed);
  assert.ok(messages.length >= 5, `в CEF ушло ${messages.length} сообщений`);
  assert.strictEqual(lastOf(messages, 'welcome').data.server, 'GOLD DAYZ');
  assert.strictEqual(lastOf(messages, 'catalog').items.length, 2);
  assert.strictEqual(lastOf(messages, 'map').data.lootZones.length, 1);
  assert.strictEqual(lastOf(messages, 'inventory').data.size, 18);
  assert.strictEqual(lastOf(messages, 'hud').data.h, 95);
  assert.ok(!env.chat.some((line) => line.startsWith('! [GOLD]')), `ошибки: ${env.chat.join(' | ')}`);
});

test('клиент: снапшот зомби создаёт педов и двигает их без ошибок', () => {
  const env = bootReady();
  // state=0 (idle) — клиент ставит педа через setCoords; chase/wander идут нативным таском.
  env.emit('gold:zombies', JSON.stringify({ t: 1000, z: [[7, 10, 0, 0, 90, 0, 100, 0], [8, 12, 0, 0, 180, 0, 80, 0]] }));
  for (let i = 0; i < 5; i += 1) env.emit('render');
  assert.strictEqual(env.peds.length, 2, 'создано два педа');
  assert.ok(env.coordsCalls.length > 0, 'позиции педов обновляются');

  env.emit('gold:zombieKilled', JSON.stringify({ id: 7, pos: { x: 10, y: 0, z: 0 } }));
  for (let i = 0; i < 3; i += 1) env.emit('render');
  assert.ok(!env.chat.some((line) => line.startsWith('! [GOLD]')), `ошибки: ${env.chat.join(' | ')}`);
});

test('клиент: I открывает инвентарь, курсор включается, действия уходят на сервер', () => {
  const env = bootReady();
  env.key(0x49);
  assert.strictEqual(env.isCursorVisible(), true, 'курсор показан');
  const panel = lastOf(uiMessages(env.executed), 'panel');
  assert.ok(panel && panel.name === 'inventory' && panel.open === true, 'панель открыта');

  env.emit('goldui:action', JSON.stringify({ t: 'move', from: 1, to: 2 }));
  env.emit('goldui:action', JSON.stringify({ t: 'equip', slot: 0 }));
  const inventoryCalls = env.remote.filter((call) => call.name === 'gold:inv');
  assert.strictEqual(inventoryCalls.length, 2, 'два действия инвентаря');
  assert.deepStrictEqual(JSON.parse(inventoryCalls[0].args[0]), { a: 'move', from: 1, to: 2 });
  assert.deepStrictEqual(JSON.parse(inventoryCalls[1].args[0]), { a: 'equip', slot: 0 });

  env.key(0x1B);
  assert.strictEqual(env.isCursorVisible(), false, 'Esc закрывает панель и прячет курсор');
});

test('клиент: ЛКМ отправляет выстрел с ограничением по дальности оружия', () => {
  const env = bootReady();
  env.key(0x01);
  const shot = env.remote.find((call) => call.name === 'gold:shot');
  assert.ok(shot, 'выстрел отправлен');
  const payload = JSON.parse(shot.args[0]);
  assert.ok(Array.isArray(payload.o) && payload.o.length === 3, 'origin — вектор');
  assert.ok(Array.isArray(payload.t) && payload.t.length === 3, 'target — вектор');
  const dist = Math.hypot(payload.t[0] - payload.o[0], payload.t[1] - payload.o[1], payload.t[2] - payload.o[2]);
  assert.ok(dist <= 37, `дальность в пределах оружия (${dist.toFixed(1)} м)`);

  // Второй вызов сразу — темп оружия не даёт стрелять чаще.
  env.key(0x01);
  assert.strictEqual(env.remote.filter((call) => call.name === 'gold:shot').length, 1, 'темп оружия соблюдён');
});

test('клиент: смерть, респавн и телеметрия не ломают рендер', () => {
  const env = bootReady();
  env.emit('gold:death', JSON.stringify({ cause: 'zombie', label: 'растерзан зомби', by: null, respawnInMs: 12000 }));
  const death = lastOf(uiMessages(env.executed), 'death');
  assert.ok(death && death.data.label === 'растерзан зомби', 'экран смерти показан');
  assert.strictEqual(env.isCursorVisible(), true, 'курсор для кнопки «Возродиться»');

  env.emit('gold:respawn', JSON.stringify({ pos: { x: 5, y: 5, z: 0 }, heading: 0 }));
  assert.strictEqual(env.isCursorVisible(), false, 'курсор спрятан после респавна');
  assert.ok(lastOf(uiMessages(env.executed), 'hudReset'), 'HUD сброшен');

  env.key(0x70); // F1
  const debug = lastOf(uiMessages(env.executed), 'debug');
  assert.ok(debug && /sync:/.test(debug.text), 'F1 показывает телеметрию');
  for (let i = 0; i < 10; i += 1) env.emit('render');
  assert.ok(!env.chat.some((line) => line.startsWith('! [GOLD]')), `ошибки: ${env.chat.join(' | ')}`);
});
