'use strict';

/**
 * Прогон CEF-интерфейса (client/ui/app.js) в Node с минимальным DOM.
 *
 * Проверяет, что каждое сообщение клиента реально отрисовывается и не бросает
 * исключений: HUD, инвентарь, карта, экран смерти, тосты, битые данные.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'client', 'ui', 'app.js');

const CATALOG = [
  {
    id: 'bandage', n: 'Бинт', i: '🩹', d: 'Останавливает кровотечение', s: 'none', w: 0.1, st: 10,
    r: 'common', e: false, u: true, wp: null, he: { blood: 10, time: 2000 }, fo: null
  },
  {
    id: 'pistol', n: 'Пистолет', i: '🔫', d: '9 мм', s: 'primary', w: 1.2, st: 1,
    r: 'rare', e: true, u: false, wp: { hash: 453432689, damage: 26, range: 35, rate: 250, ammoType: 'ammo_9mm', mag: 12 }, he: null, fo: null
  },
  {
    id: 'backpack', n: 'Рюкзак', i: '🎒', d: '+6 слотов', s: 'back', w: 2, st: 1,
    r: 'uncommon', e: true, u: false, wp: null, he: null, fo: null, stg: 6
  }
];

function createDom() {
  const registry = new Map();

  const ctx2d = new Proxy({}, {
    get(target, prop) {
      if (prop === 'canvas') return null;
      if (!(prop in target)) target[prop] = () => {};
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });

  class El {
    constructor(tag, id) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.id = id || '';
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.dataset = {};
      this.disabled = false;
      this.value = '';
      this.width = 980;
      this.height = 620;
      this.offsetWidth = 200;
      this._classes = new Set();
      this._text = '';
      this._html = '';
      this._attrs = {};
      const self = this;
      this.classList = {
        add(...names) { names.forEach((name) => self._classes.add(name)); },
        remove(...names) { names.forEach((name) => self._classes.delete(name)); },
        contains(name) { return self._classes.has(name); },
        toggle(name, force) {
          const on = force === undefined ? !self._classes.has(name) : !!force;
          if (on) self._classes.add(name);
          else self._classes.delete(name);
          return on;
        }
      };
    }

    get className() { return Array.from(this._classes).join(' '); }
    set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }

    get textContent() { return this._text; }
    set textContent(value) { this._text = String(value === undefined || value === null ? '' : value); }

    get innerHTML() { return this._html; }
    set innerHTML(value) { this._html = String(value || ''); this.children = []; }

    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }

    replaceChildren(...nodes) {
      this.children = [];
      nodes.forEach((node) => this.appendChild(node));
    }

    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }

    append(node) { this.appendChild(node); }

    addEventListener(type, fn) {
      this._events = this._events || {};
      this._events[type] = this._events[type] || [];
      this._events[type].push(fn);
    }

    removeEventListener() {}
    setAttribute(name, value) { this._attrs[name] = value; }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest(selector) {
      let node = this;
      while (node) {
        if (selector === '.slot' && node.classList.contains('slot')) return node;
        if (selector === '.eq-slot' && node.classList.contains('eq-slot')) return node;
        if (selector === '[data-action]' && node.getAttribute('data-action') !== null) return node;
        node = node.parentNode;
      }
      return null;
    }
    focus() {}
    blur() {}
    click() { this._events && this._events.click && this._events.click.forEach((fn) => fn({ target: this })); }
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height };
    }
    getContext() { return ctx2d; }
  }

  const docListeners = {};

  const document = {
    readyState: 'complete',
    body: new El('body', 'body'),
    createElement(tag) { return new El(tag); },
    createTextNode(text) { return { textContent: String(text) }; },
    getElementById(id) {
      if (!registry.has(id)) registry.set(id, new El('div', id));
      return registry.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(fn);
    },
    removeEventListener() {}
  };

  const window = {
    document,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, fn) {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(fn);
    },
    removeEventListener() {}
  };

  return {
    document,
    window,
    registry,
    El,
    ctx2d,
    dispatch(type, target) {
      const listeners = docListeners[type] || [];
      const event = {
        target,
        preventDefault() {},
        stopPropagation() {},
        dataTransfer: { setData() {}, getData() { return ''; }, effectAllowed: 'move' },
        clientX: 10,
        clientY: 10,
        key: ''
      };
      listeners.forEach((fn) => fn(event));
      return listeners.length;
    }
  };
}

function boot() {
  const dom = createDom();
  const triggered = [];
  const mp = {
    trigger(name, payload) { triggered.push({ name, payload }); }
  };

  const context = {
    window: dom.window,
    document: dom.document,
    mp,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
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
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    RegExp,
    Error,
    Promise
  };
  context.window.document = dom.document;

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(APP, 'utf8'), context, { filename: 'app.js' });

  return {
    dom,
    triggered,
    ui: context.window.goldUI,
    receive(message) {
      assert.ok(context.window.goldUI, 'UI не экспортировал window.goldUI');
      context.window.goldUI.receive(typeof message === 'string' ? message : JSON.stringify(message));
    },
    el(id) { return dom.document.getElementById(id); },
    dispatch(type, target) { return dom.dispatch(type, target); }
  };
}

test('ui: инициализируется, сообщает о готовности и принимает HUD', () => {
  const env = boot();
  assert.ok(env.ui && typeof env.ui.receive === 'function', 'есть receive');
  assert.strictEqual(env.el('bar-health').style.width, undefined);

  env.receive({
    t: 'hud',
    data: {
      h: 80, b: 70, hu: 60, t: 50, s: 40, r: 2, bl: 1, temp: 36.5,
      w: 12.5, cap: 30, z: 3, p: 1, sc: 120, d: 2, night: true, hour: 21.5,
      px: 0, py: 0, nz: 4, safe: 'sz_paleto', alive: true, respawnIn: 0
    }
  });

  assert.strictEqual(env.el('bar-health').style.width, '80.0%');
  assert.strictEqual(env.el('val-health').textContent, '80');
  assert.strictEqual(env.el('stat-zombies').textContent, '3');
  assert.strictEqual(env.el('weight-text').textContent, '12.5 / 30 кг');
  assert.strictEqual(env.el('status-bleed').classList.contains('hidden'), false, 'кровотечение показано');
  assert.strictEqual(env.el('status-night').classList.contains('hidden'), false, 'ночь показана');
  assert.strictEqual(env.el('status-safe').classList.contains('hidden'), false, 'безопасная зона показана');
  assert.ok(/21:30/.test(env.el('clock-hour').textContent), `часы: ${env.el('clock-hour').textContent}`);
  assert.ok(/ЗОМБИ РЯДОМ: 4/.test(env.el('nearby-zombies').textContent));
});

test('ui: инвентарь рисует слоты, экипировку и карточку предмета', () => {
  const env = boot();
  env.receive({ t: 'catalog', items: CATALOG });
  env.receive({
    t: 'inventory',
    data: {
      slots: [['bandage', 3, null], ['pistol', 1, 12], null, null],
      size: 18,
      eq: { primary: ['pistol', 12], melee: null, back: ['backpack', 1], armor: null, mask: null, hands: null },
      w: 3.4,
      cap: 30,
      used: 3,
      alive: true
    }
  });
  env.receive({ t: 'panel', name: 'inventory', open: true });

  const slots = env.el('inv-grid').children;
  assert.strictEqual(slots.length, 18, 'слотов ровно по размеру инвентаря');
  assert.ok(slots[0].innerHTML.includes('🩹'), 'иконка бинта в слоте');
  assert.ok(slots[0].innerHTML.includes('3'), 'количество в слоте');
  assert.ok(slots[1].innerHTML.includes('12'), 'патроны в слоте оружия');
  assert.ok(slots[2].classList.contains('empty'), 'пустой слот помечен');

  const equipment = env.el('equipment-slots').children;
  assert.ok(equipment.length >= 6, 'все слоты экипировки отрисованы');
  const equipmentHtml = equipment.map((node) => node.innerHTML).join(' ');
  assert.ok(equipmentHtml.includes('Пистолет'), `экипировка содержит пистолет: ${equipmentHtml.slice(0, 160)}`);
  assert.ok(equipmentHtml.includes('Рюкзак'), 'экипировка содержит рюкзак');
  assert.strictEqual(env.el('weapon-ammo').textContent, '12', 'патроны в карточке оружия');
  assert.strictEqual(env.el('inv-weight-text').textContent, '3.4 / 30 кг');
});

test('ui: панели открываются, карта рисуется на canvas', () => {
  const env = boot();
  env.receive({ t: 'catalog', items: CATALOG });
  env.receive({
    t: 'map',
    data: {
      spawnPoints: [{ id: 'sp', name: 'Спавн', pos: { x: -275, y: 6450, z: 32 } }],
      lootZones: [{ id: 'lz', name: 'Больница', pos: { x: -200, y: 6400, z: 30 }, radius: 40, tier: 2, lootTable: 'medical', count: 8 }],
      zombieZones: [{ id: 'zz', name: 'Палето', pos: { x: -275, y: 6450, z: 30 }, radius: 180, max: 20 }],
      safeZones: [{ id: 'sz', name: 'Лагерь', pos: { x: -300, y: 6500, z: 30 }, radius: 25 }],
      toxinZones: [{ id: 'tz', name: 'Токсины', pos: { x: -100, y: 6300, z: 20 }, radius: 30, damagePerSecond: 5 }]
    }
  });
  env.receive({ t: 'inventory', data: { slots: [null], size: 6, eq: {}, w: 0, cap: 30, used: 0, alive: true } });
  env.receive({ t: 'hud', data: { h: 100, b: 100, hu: 100, t: 100, s: 100, px: -275, py: 6450, hour: 12, nz: 0 } });

  env.receive({ t: 'panel', name: 'inventory', open: true });
  assert.strictEqual(env.el('inventory').classList.contains('hidden'), false, 'инвентарь открыт');
  env.receive({ t: 'panel', name: 'map', open: true });
  assert.strictEqual(env.el('map').classList.contains('hidden'), false, 'карта открыта');
  env.receive({ t: 'panel', name: null, open: false });
  assert.strictEqual(env.el('map').classList.contains('hidden'), true, 'карта закрыта');
});

test('ui: экран смерти, тосты, попадания и урон', () => {
  const env = boot();
  env.receive({ t: 'death', data: { cause: 'zombie', label: 'растерзан зомби', by: 'Zed', respawnInMs: 12000 } });
  assert.strictEqual(env.el('death').classList.contains('hidden'), false, 'экран смерти показан');
  assert.strictEqual(env.el('death-cause').textContent, 'растерзан зомби');
  assert.ok(/Zed/.test(env.el('death-by').textContent));
  assert.strictEqual(env.el('respawn-btn').disabled, true, 'кнопка заблокирована на время таймера');

  env.receive({ t: 'toast', text: 'Подобрано: Бинт', kind: 'success' });
  env.receive({ t: 'hit', data: { head: true, kill: false } });
  env.receive({ t: 'damage', data: { amount: 12, bleeding: true } });

  env.receive({ t: 'respawn' });
  assert.strictEqual(env.el('death').classList.contains('hidden'), true, 'экран смерти скрыт');
  env.receive({ t: 'ammo', ammo: 7, mag: 12, itemId: 'pistol' });
});

test('ui: битые и неполные сообщения не роняют интерфейс', () => {
  const env = boot();
  assert.doesNotThrow(() => env.receive('не json'));
  assert.doesNotThrow(() => env.receive({}));
  assert.doesNotThrow(() => env.receive('null'));
  assert.doesNotThrow(() => env.receive({ t: 'catalog', items: [] }));
  assert.doesNotThrow(() => env.receive({ t: 'inventory', data: { slots: [['unknown_item', 1, null]], size: 4, eq: {}, w: 0, cap: 30, used: 1, alive: true } }));
  assert.doesNotThrow(() => env.receive({ t: 'hud', data: {} }));
  assert.doesNotThrow(() => env.receive({ t: 'map', data: {} }));
  assert.doesNotThrow(() => env.receive({ t: 'panel', name: 'inventory', open: true }));
  assert.doesNotThrow(() => env.receive({ t: 'death', data: null }));
  assert.doesNotThrow(() => env.receive({ t: 'welcome', data: { name: 'T', server: 'GOLD', weather: 'CLEAR', hour: 8 } }));
});

test('ui: двойной клик по слоту отправляет use/equip через mp.trigger', () => {
  const env = boot();
  env.receive({ t: 'catalog', items: CATALOG });
  env.receive({
    t: 'inventory',
    data: {
      slots: [['bandage', 2, null], ['pistol', 1, 12]],
      size: 18,
      eq: { primary: null, melee: null, back: null, armor: null, mask: null, hands: null },
      w: 2, cap: 30, used: 2, alive: true
    }
  });
  env.receive({ t: 'panel', name: 'inventory', open: true });

  const slots = env.el('inv-grid').children;
  assert.ok(slots.length >= 2, 'слоты есть');
  assert.strictEqual(env.triggered.length, 0, 'до клика действий нет');

  // Бинт: usable → use. Пистолет: equipable → equip.
  env.dispatch('dblclick', slots[0]);
  env.dispatch('dblclick', slots[1]);
  const actions = env.triggered.map((entry) => JSON.parse(entry.payload));
  assert.ok(actions.some((action) => action.t === 'use' && action.slot === 0), `нет use: ${JSON.stringify(actions)}`);
  assert.ok(actions.some((action) => action.t === 'equip' && action.slot === 1), `нет equip: ${JSON.stringify(actions)}`);

  // Правый клик по слоту — выброс одного предмета.
  env.dispatch('contextmenu', slots[0]);
  const drop = env.triggered.map((entry) => JSON.parse(entry.payload)).filter((action) => action.t === 'drop');
  assert.ok(drop.length === 1 && drop[0].count === 1, 'выброс одного предмета');
});
