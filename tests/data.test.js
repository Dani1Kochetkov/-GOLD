'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');
const { loadData } = require('../server/core/data');
const { runChecks } = require('../tools/check');

test('данные: все JSON-файлы валидны и содержат meta.version', () => {
  const files = ['items.json', 'zombies.json', 'map.json', 'loot.json', 'gold.config.json'];
  files.forEach((file) => {
    const full = path.join(ROOT, 'data', file);
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    assert.ok(parsed.meta, `${file}: нет блока meta`);
    assert.ok(Number(parsed.meta.version) >= 1, `${file}: нет версии`);
  });
});

test('данные: загрузчик связывает предметы, лут и зоны', () => {
  const data = loadData(ROOT);
  assert.ok(data.items.length >= 20, 'достаточно предметов');
  assert.ok(data.itemsIndex.pistol, 'пистолет есть');
  assert.ok(data.lootTables.zombie_common.length > 0);
  assert.ok(data.map.lootZones.length >= 10);
  assert.ok(data.map.zombieZones.length >= 5);
  assert.ok(data.map.spawnPoints.length >= 3);
  assert.ok(data.map.safeZones.length >= 1);
  assert.strictEqual(data.zombieTypes.filter((type) => type.id === 'walker').length, 1);
});

test('данные: кривой JSON даёт понятную ошибку', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gold-data-'));
  try {
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'items.json'), '{ broken json');
    assert.throws(() => loadData(dir), /items\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('данные: полная проверка проекта проходит без ошибок', () => {
  const report = runChecks();
  assert.deepStrictEqual(report.errors, [], `ошибки: ${report.errors.join(' | ')}`);
});

test('data: $schema ссылается на существующую схему', () => {
  for (const name of ['items', 'zombies', 'loot', 'map']) {
    const file = path.join(ROOT, 'data', `${name}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(json.$schema, `data/${name}.json: нет $schema`);
    const schemaPath = path.resolve(path.dirname(file), json.$schema);
    assert.ok(fs.existsSync(schemaPath), `схема ${json.$schema} отсутствует`);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.ok(schema.$schema, `схема ${json.$schema} без $schema-версии`);
    assert.ok(schema.type === 'object', `схема ${json.$schema} должна описывать объект`);
  }
});
