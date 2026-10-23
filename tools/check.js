#!/usr/bin/env node
'use strict';

/**
 * Проверка проекта перед запуском: данные, синтаксис, бандл, бюджеты payload.
 * Работает на Linux/Windows без RAGE и без npm install.
 *
 *   npm run check          # отчёт
 *   node tools/check.js --json
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const { loadData } = require(path.join(ROOT, 'server', 'core', 'data.js'));
const SYNC = require(path.join(ROOT, 'shared', 'sync.js'));
const { chunkByBytes } = require(path.join(ROOT, 'shared', 'chunk.js'));
const { ITEM_SLOTS } = require(path.join(ROOT, 'shared', 'constants.js'));

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const MAX_PAYLOAD = 7800;

function createReport() {
  const report = { errors: [], warnings: [], ok: [] };
  report.error = (message) => report.errors.push(message);
  report.warn = (message) => report.warnings.push(message);
  report.pass = (message) => report.ok.push(message);
  return report;
}

function listJs(dir, acc) {
  const out = acc || [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'ui') continue;
      listJs(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function validateData(report) {
  let data;
  try {
    data = loadData(ROOT);
    report.pass(`data/*.json загружены: ${data.items.length} предметов, ${data.zombieTypes.length} типов зомби`);
  } catch (err) {
    report.error(`data: ${err.message}`);
    return null;
  }

  // ---- предметы
  const ids = new Set();
  data.items.forEach((def, index) => {
    const where = `items[${index}] (${def.id || 'без id'})`;
    if (!def.id) report.error(`${where}: нет id`);
    if (ids.has(def.id)) report.error(`${where}: дубликат id`);
    ids.add(def.id);
    if (!def.name) report.error(`${where}: нет name`);
    if (!def.icon) report.warn(`${where}: нет icon`);
    if (!Number.isFinite(Number(def.weight)) || Number(def.weight) < 0) report.error(`${where}: некорректный weight`);
    if (!Number.isFinite(Number(def.stack)) || Number(def.stack) < 1) report.error(`${where}: stack должен быть >= 1`);
    if (def.slot && def.slot !== 'none' && ITEM_SLOTS.indexOf(def.slot) < 0) report.error(`${where}: неизвестный slot "${def.slot}"`);
    if (def.rarity && RARITIES.indexOf(def.rarity) < 0) report.warn(`${where}: неизвестная редкость "${def.rarity}"`);
    if (def.weapon) {
      const weapon = def.weapon;
      if (!Number.isFinite(Number(weapon.hash))) report.error(`${where}: weapon.hash должен быть числом`);
      if (!Number.isFinite(Number(weapon.damage)) || Number(weapon.damage) <= 0) report.error(`${where}: weapon.damage <= 0`);
      if (!Number.isFinite(Number(weapon.range)) || Number(weapon.range) <= 0) report.error(`${where}: weapon.range <= 0`);
      if (!Number.isFinite(Number(weapon.rate)) || Number(weapon.rate) < 50) report.error(`${where}: weapon.rate < 50`);
      if (weapon.ammoType && !data.itemsIndex[weapon.ammoType]) report.error(`${where}: неизвестный ammoType "${weapon.ammoType}"`);
      if (weapon.ammoType && Number(weapon.mag) <= 0) report.error(`${where}: для огнестрела нужен mag > 0`);
      if (weapon.ammoType && !data.itemsIndex[weapon.ammoType].ammo) report.warn(`${where}: ammoType "${weapon.ammoType}" не помечен ammo: true`);
    }
    if (def.equipable && (!def.slot || def.slot === 'none')) report.error(`${where}: equipable без slot`);
  });
  report.pass('структура предметов проверена');

  // ---- лут
  Object.keys(data.lootTables).forEach((tableName) => {
    const table = data.lootTables[tableName];
    if (!Array.isArray(table) || !table.length) {
      report.error(`loot[${tableName}]: пустая таблица`);
      return;
    }
    const sum = table.reduce((acc, row) => acc + (Number(row.weight) || 0), 0);
    if (sum <= 0) report.error(`loot[${tableName}]: суммарный вес <= 0`);
    table.forEach((row) => {
      if (!data.itemsIndex[row.item]) report.error(`loot[${tableName}]: нет предмета "${row.item}"`);
      const min = Number(row.min) || 1;
      const max = Number(row.max) || 1;
      if (min < 1) report.error(`loot[${tableName}][${row.item}]: min < 1`);
      if (max < min) report.error(`loot[${tableName}][${row.item}]: max < min`);
      const def = data.itemsIndex[row.item];
      if (def && def.stack && max > def.stack) report.warn(`loot[${tableName}][${row.item}]: max ${max} больше stack ${def.stack}`);
    });
  });
  report.pass('таблицы лута проверены');

  // ---- зомби
  data.zombieTypes.forEach((def) => {
    if (!def.model) report.error(`zombies[${def.id}]: нет model`);
    if (!(Number(def.health) > 0)) report.error(`zombies[${def.id}]: health <= 0`);
    if (!(Number(def.speedWalk) >= 0)) report.error(`zombies[${def.id}]: speedWalk < 0`);
    if (!(Number(def.speedRun) > 0)) report.error(`zombies[${def.id}]: speedRun <= 0`);
    if (Number(def.speedRun) < Number(def.speedWalk)) report.warn(`zombies[${def.id}]: speedRun < speedWalk`);
    if (!data.lootTables[def.lootTable]) report.error(`zombies[${def.id}]: нет lootTable "${def.lootTable}"`);
    if (!(Number(def.detectRange) > 0)) report.error(`zombies[${def.id}]: detectRange <= 0`);
    if (!(Number(def.chaseRange) >= Number(def.detectRange))) report.warn(`zombies[${def.id}]: chaseRange < detectRange`);
  });
  report.pass('типы зомби проверены');

  // ---- карта
  const map = data.map;
  if (!Array.isArray(map.spawnPoints) || !map.spawnPoints.length) report.error('map: нет spawnPoints');
  (map.spawnPoints || []).forEach((point) => {
    if (!point.pos || !Number.isFinite(Number(point.pos.x))) report.error(`map.spawnPoints[${point.id}]: нет координат`);
  });
  (map.lootZones || []).forEach((zone) => {
    if (!(Number(zone.radius) > 0)) report.error(`map.lootZones[${zone.id}]: radius <= 0`);
    if (!data.lootTables[zone.lootTable]) report.error(`map.lootZones[${zone.id}]: нет lootTable`);
    if (!(Number(zone.count) > 0)) report.warn(`map.lootZones[${zone.id}]: count <= 0`);
  });
  (map.zombieZones || []).forEach((zone) => {
    if (!(Number(zone.radius) > 0)) report.error(`map.zombieZones[${zone.id}]: radius <= 0`);
    if (!(Number(zone.max) > 0)) report.error(`map.zombieZones[${zone.id}]: max <= 0`);
  });
  (map.toxinZones || []).forEach((zone) => {
    if (zone.requiredItem && !data.itemsIndex[zone.requiredItem]) report.error(`map.toxinZones[${zone.id}]: нет предмета "${zone.requiredItem}"`);
  });
  const totalMax = (map.zombieZones || []).reduce((acc, zone) => acc + (Number(zone.max) || 0), 0);
  if (totalMax > Number(data.config.world.zombieGlobalCap)) {
    report.warn(`сумма max зон зомби (${totalMax}) больше глобального капа (${data.config.world.zombieGlobalCap}) — часть зон не заполнится`);
  }
  report.pass('карта проверена');

  // ---- конфиг
  const cfg = data.config;
  if (!(Number(cfg.server.tickMs) >= 20)) report.error('config: server.tickMs < 20');
  if (!(Number(cfg.world.zombieGlobalCap) > 0)) report.error('config: world.zombieGlobalCap <= 0');
  if (!(Number(cfg.inventory.maxWeightKg) > 0)) report.error('config: inventory.maxWeightKg <= 0');
  if (!(Number(cfg.zombies.snapshotRadius) > 0)) report.error('config: zombies.snapshotRadius <= 0');
  (cfg.spawn.starterItems || []).forEach((item) => {
    if (!data.itemsIndex[item.item]) report.error(`config.spawn.starterItems: нет предмета "${item.item}"`);
  });
  report.pass('конфиг проверен');

  return data;
}

function validateSyntax(report) {
  const dirs = ['shared', 'server', 'client', 'tools', 'tests'].map((dir) => path.join(ROOT, dir));
  const files = [];
  dirs.forEach((dir) => listJs(dir, files));
  const uiApp = path.join(ROOT, 'client', 'ui', 'app.js');
  if (fs.existsSync(uiApp)) files.push(uiApp);

  let failed = 0;
  files.forEach((file) => {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    } catch (err) {
      failed += 1;
      report.error(`синтаксис ${path.relative(ROOT, file)}: ${err.message}`);
    }
  });
  if (!failed) report.pass(`синтаксис JS проверен: ${files.length} файлов`);
}

function validateBundle(report) {
  const bundleFile = path.join(ROOT, 'client_packages', 'gold', 'goldclient.js');
  const uiFiles = ['index.html', 'style.css', 'app.js'].map((file) => path.join(ROOT, 'client_packages', 'gold', 'ui', file));
  const indexFile = path.join(ROOT, 'client_packages', 'index.js');

  if (!fs.existsSync(indexFile)) report.error('client_packages/index.js отсутствует — RAGE не загрузит клиент');
  if (!fs.existsSync(bundleFile)) {
    report.error('client_packages/gold/goldclient.js отсутствует. Запустите: npm run build');
    return;
  }
  const bundle = fs.readFileSync(bundleFile, 'utf8');
  if (!bundle.includes('GOLD DAYZ — client bundle')) report.warn('в бандле нет метки сборки (собран другой версией tools/build-client.js?)');
  if (!bundle.includes('__require(')) report.error('бандл не похож на сборку tools/build-client.js');
  const externalRequire = bundle.match(/\brequire\s*\(\s*['"][^."'][^'"]*['"]\s*\)/);
  if (externalRequire) report.error(`в бандле остался внешний require: ${externalRequire[0]}`);

  uiFiles.forEach((file) => {
    if (!fs.existsSync(file)) report.error(`нет UI-файла client_packages/gold/ui/${path.basename(file)} — запустите npm run build`);
  });
  const html = fs.existsSync(uiFiles[0]) ? fs.readFileSync(uiFiles[0], 'utf8') : '';
  if (html && (!html.includes('app.js') || !html.includes('style.css'))) report.error('ui/index.html не подключает app.js/style.css');
  const manifestFile = path.join(ROOT, 'client_packages', 'gold', 'build-manifest.json');
  if (fs.existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      report.pass(`клиентский бандл: ${(manifest.bytes / 1024).toFixed(1)} КБ, ${manifest.modules.length} модулей, собран ${manifest.builtAt}`);
    } catch (err) {
      report.warn('build-manifest.json повреждён');
    }
  }
}

/** CEF-интерфейс: файлы на месте, скрипт валиден, HTML содержит нужные id. */
function validateUI(report) {
  const dir = path.join(ROOT, 'client', 'ui');
  const files = ['index.html', 'style.css', 'app.js'];
  for (let i = 0; i < files.length; i += 1) {
    if (!fs.existsSync(path.join(dir, files[i]))) {
      report.error(`client/ui/${files[i]} отсутствует — интерфейс не загрузится`);
      return;
    }
  }

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

  try {
    new vm.Script(app, { filename: 'client/ui/app.js' });
  } catch (err) {
    report.error(`client/ui/app.js: синтаксическая ошибка — ${err.message}`);
  }

  if (!/<script[^>]+src=["']app\.js["']/.test(html)) report.error('client/ui/index.html не подключает app.js');
  if (!/<link[^>]+href=["']style\.css["']/.test(html)) report.error('client/ui/index.html не подключает style.css');
  if (!/window\.goldUI\s*=/.test(app)) report.error('client/ui/app.js не экспортирует window.goldUI');
  if (!/goldUI[\s\S]{0,80}receive/.test(app)) report.error('client/ui/app.js: нет ui.receive() — клиент не сможет слать сообщения');

  const htmlIds = new Set();
  const idRegex = /id=["']([A-Za-z0-9_-]+)["']/g;
  let match = idRegex.exec(html);
  while (match) {
    htmlIds.add(match[1]);
    match = idRegex.exec(html);
  }
  // Динамические id ('' + key) пропускаем: они собираются из префикса и названия бара.
  const missing = [];
  const useRegex = /getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g;
  match = useRegex.exec(app);
  while (match) {
    if (!htmlIds.has(match[1])) missing.push(match[1]);
    match = useRegex.exec(app);
  }
  const uniqueMissing = Array.from(new Set(missing));
  if (uniqueMissing.length) {
    report.error(`client/ui: app.js ищет отсутствующие в HTML элементы: ${uniqueMissing.slice(0, 5).join(', ')}`);
  }

  const messages = ['catalog', 'inventory', 'hud', 'map', 'toast', 'panel', 'death', 'hit', 'damage', 'ammo'];
  const notHandled = messages.filter((name) => app.indexOf(`case '${name}'`) === -1);
  if (notHandled.length) report.error(`client/ui/app.js не обрабатывает сообщения: ${notHandled.join(', ')}`);

  report.pass(`CEF-интерфейс: ${files.join(', ')}, ${htmlIds.size} элементов, все id и сообщения совпадают`);
}

function validatePayloads(report, data) {
  if (!data) return;

  // Каталог предметов: имитируем нарезку из server/game.js sendCatalog.
  const compact = data.items.map((def) => ({
    id: def.id, n: def.name, i: def.icon || '▪', d: def.desc || '', s: def.slot || 'none',
    w: Number(def.weight) || 0, st: Number(def.stack) || 1, r: def.rarity || 'common',
    e: !!def.equipable, u: !!def.usable, wp: def.weapon || null, he: def.heal || null,
    fo: def.food || null, stg: def.storage || 0, dr: def.damageReduction || 0,
    gp: def.gasProtection || 0, rad: !!def.radio, um: !!def.unlocksMap, am: !!def.ammo
  }));
  const chunks = chunkByBytes(compact, MAX_PAYLOAD, 64);
  let catalogOk = true;
  chunks.forEach((chunk, index) => {
    const bytes = Buffer.byteLength(JSON.stringify({ part: index, total: chunks.length, items: chunk }), 'utf8');
    if (bytes > MAX_PAYLOAD) {
      catalogOk = false;
      report.error(`каталог: часть ${index} весит ${bytes} байт — больше лимита player.call`);
    }
  });
  if (catalogOk) {
    const biggest = chunks.reduce((acc, chunk, index) => {
      const bytes = Buffer.byteLength(JSON.stringify({ part: index, total: chunks.length, items: chunk }), 'utf8');
      return Math.max(acc, bytes);
    }, 0);
    report.pass(`каталог предметов: ${chunks.length} частей, крупнейшая ${biggest} байт — лимит соблюдён`);
  }

  // Карта.
  const mapPayload = JSON.stringify({
    spawnPoints: data.map.spawnPoints,
    lootZones: data.map.lootZones,
    zombieZones: data.map.zombieZones,
    safeZones: data.map.safeZones,
    toxinZones: data.map.toxinZones
  });
  if (Buffer.byteLength(mapPayload) > MAX_PAYLOAD) {
    report.error(`payload карты ${Buffer.byteLength(mapPayload)} байт — больше лимита player.call (8192)`);
  } else {
    report.pass(`payload карты: ${Buffer.byteLength(mapPayload)} байт`);
  }

  // Худший инвентарь: 60 слотов, длинные id, патроны в каждом слоте.
  const worstSlots = [];
  for (let i = 0; i < 60; i += 1) worstSlots.push(['sniperrifle', 999, 999]);
  const inventoryPayload = JSON.stringify({
    slots: worstSlots,
    size: 60,
    eq: { primary: ['carbinerifle', 999], melee: ['crowbar', null], back: ['backpack', null], armor: ['vest', null], mask: ['gas_mask', null], hands: ['flashlight', null] },
    w: 999.9,
    cap: 30,
    used: 60,
    alive: true
  });
  if (Buffer.byteLength(inventoryPayload) > MAX_PAYLOAD) report.error(`инвентарь: ${Buffer.byteLength(inventoryPayload)} байт — больше лимита`);
  else report.pass(`payload инвентаря (худший случай): ${Buffer.byteLength(inventoryPayload)} байт`);

  // Худший снапшот: 96 зомби с максимальными координатами.
  const zombies = [];
  for (let i = 0; i < 96; i += 1) {
    zombies.push({
      id: 100000 + i,
      alive: true,
      dimension: 0,
      hp: 100,
      maxHp: 100,
      heading: 359.9,
      state: 'investigate',
      typeCode: 3,
      pos: { x: -4299.99, y: -4299.99, z: 4299.99 }
    });
  }
  const snapshot = SYNC.buildSnapshot(zombies, {
    position: { x: 0, y: 0, z: 0 },
    radius: 99999,
    maxEntities: 96,
    maxBytes: MAX_PAYLOAD,
    now: 1
  });
  if (snapshot.bytes > MAX_PAYLOAD) report.error(`снапшот ${snapshot.bytes} байт превышает лимит`);
  else report.pass(`снапшот 96 зомби: ${snapshot.bytes} байт (лимит ${MAX_PAYLOAD})`);
}

/** Ссылки $schema в data/*.json должны вести на существующие валидные схемы. */
function validateSchemas(report) {
  const files = ['items', 'zombies', 'loot', 'map'];
  let checked = 0;
  for (let i = 0; i < files.length; i += 1) {
    const file = path.join(ROOT, 'data', `${files[i]}.json`);
    if (!fs.existsSync(file)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      report.error(`data/${files[i]}.json: ${err.message}`);
      continue;
    }
    if (!json.$schema) continue;
    const schemaPath = path.resolve(path.dirname(file), json.$schema);
    if (!fs.existsSync(schemaPath)) {
      report.error(`data/${files[i]}.json: $schema ссылается на отсутствующий ${json.$schema}`);
      continue;
    }
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      if (!schema.$schema || typeof schema.definitions !== 'object' && typeof schema.properties !== 'object') {
        report.error(`data/${files[i]}.json: схема ${json.$schema} повреждена`);
        continue;
      }
      checked += 1;
    } catch (err) {
      report.error(`схема ${json.$schema}: ${err.message}`);
    }
  }
  report.pass(`JSON-схемы: проверено ${checked} (подсказки в редакторе + защита от опечаток)`);
}

function validateConf(report) {
  const file = path.join(ROOT, 'conf.json');
  if (!fs.existsSync(file)) {
    report.error('conf.json отсутствует — RAGE не запустится');
    return;
  }
  try {
    const conf = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(Number(conf.port))) report.error('conf.json: port должен быть числом');
    if (!conf.bind) report.error('conf.json: нет bind');
    if (conf.announce === true) report.warn('conf.json: announce=true — локальный тестовый сервер попадёт в мастер-лист (для dev оставьте false)');
    if (conf.bind && conf.bind !== '127.0.0.1' && !conf.localTest) report.warn('conf.json: bind не 127.0.0.1 — сервер будет доступен из сети');
    if (!conf.gamemode) {
      report.error("conf.json: не задан gamemode (RAGE грузит packages/<gamemode>/index.js)");
    } else {
      const pkg = path.join(ROOT, 'packages', String(conf.gamemode), 'index.js');
      if (!fs.existsSync(pkg)) {
        report.error(`conf.json: gamemode "${conf.gamemode}", но packages/${conf.gamemode}/index.js не найден`);
      }
    }
    if (Number(conf.port) < 1024) report.warn('conf.json: порт < 1024 может требовать прав администратора');
    report.pass(`conf.json: порт ${conf.port}, bind ${conf.bind}, announce ${conf.announce}`);
    const prod = path.join(ROOT, 'conf.production.example.json');
    if (fs.existsSync(prod)) JSON.parse(fs.readFileSync(prod, 'utf8'));
  } catch (err) {
    report.error(`conf.json: ${err.message}`);
  }
}

function validateCommands(report) {
  const file = path.join(ROOT, 'server', 'commands.js');
  if (!fs.existsSync(file)) return;
  const code = fs.readFileSync(file, 'utf8');
  const names = {};
  const regex = /addCommand\(\s*'([^']+)'/g;
  let match = regex.exec(code);
  while (match) {
    names[match[1]] = (names[match[1]] || 0) + 1;
    match = regex.exec(code);
  }
  Object.keys(names).forEach((name) => {
    if (names[name] > 1) report.error(`команда /${name} зарегистрирована ${names[name]} раза`);
  });
  report.pass(`чат-команды: ${Object.keys(names).length} шт., дубликатов нет`);
}

function validateGames(report, data) {
  if (!data) return;
  const { Game } = require(path.join(ROOT, 'server', 'game.js'));
  const net = { send() {}, broadcast() {}, chat() {}, log() {} };
  const game = new Game({ data, net, seed: 1, logger: { info() {}, warn() {}, error() {} } });
  game.addPlayer({ id: 1, name: 'SmokeTest' });
  game.lastTickAt = Date.now() - 200;
  game.tick(Date.now());
  const player = game.players.get(1);
  if (!player) {
    report.error('Game: игрок не создался');
    return;
  }
  if (!player.inventory.slots.length) report.error('Game: у игрока нет слотов инвентаря');
  const metrics = game.getMetrics();
  report.pass(`Game: тик выполнен, зомби ${metrics.zombiesAlive}, предметов на земле ${metrics.groundItems}`);
}

function runChecks() {
  const report = createReport();
  validateConf(report);
  const data = validateData(report);
  validateSchemas(report);
  validateSyntax(report);
  validateBundle(report);
  validateUI(report);
  validatePayloads(report, data);
  validateCommands(report);
  validateGames(report, data);
  return report;
}

function printReport(report) {
  console.log('\n  GOLD DAYZ — проверка проекта\n');
  report.ok.forEach((line) => console.log(`  ✅ ${line}`));
  report.warnings.forEach((line) => console.log(`  ⚠️  ${line}`));
  report.errors.forEach((line) => console.log(`  ❌ ${line}`));
  console.log('');
  if (report.errors.length) {
    console.log(`  Итог: ${report.errors.length} ошибок, ${report.warnings.length} предупреждений — сервер запускать рано.\n`);
  } else {
    console.log(`  Итог: ошибок нет (${report.warnings.length} предупреждений). Можно запускать RAGE-сервер (ragemp-server.exe / ./ragemp-server)\n`);
  }
}

if (require.main === module) {
  const report = runChecks();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ errors: report.errors, warnings: report.warnings, ok: report.ok }, null, 2));
  } else {
    printReport(report);
  }
  process.exit(report.errors.length ? 1 : 0);
}

module.exports = { runChecks, validateData, validateSchemas, validateUI, validatePayloads, MAX_PAYLOAD };
