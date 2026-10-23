#!/usr/bin/env node
'use strict';

/**
 * Кросс-версионный запуск тестов.
 *
 * `node --test "tests/*.test.js"` работает в Node 21+, а в Node 20 glob не
 * раскрывается (и падает в CI). `node --test tests/` по-разному ведёт себя
 * в 20 и 22. Поэтому файлы перечисляем сами — одинаково на Linux и Windows.
 *
 *   node tools/test.js            # все tests/*.test.js
 *   node tools/test.js inventory  # только файлы, содержащие "inventory"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const filter = process.argv[2] || '';

if (!fs.existsSync(TESTS)) {
  console.error('нет каталога tests/');
  process.exit(1);
}

const files = fs.readdirSync(TESTS)
  .filter((name) => name.endsWith('.test.js'))
  .filter((name) => !filter || name.includes(filter))
  .sort()
  .map((name) => path.join('tests', name));

if (!files.length) {
  console.error('не найдено тестов' + (filter ? ` по фильтру "${filter}"` : ''));
  process.exit(1);
}

console.log(`\n  GOLD DAYZ — тесты (${files.length} файлов)\n`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
