#!/usr/bin/env node
'use strict';

/**
 * Сборка клиентского бандла без внешних зависимостей.
 *
 * RAGE:MP грузит только client_packages/index.js и файлы внутри client_packages.
 * Наши исходники лежат в client/ и shared/, поэтому перед запуском сервера
 * нужно собрать один файл client_packages/gold/goldclient.js:
 *
 *   npm run build
 *
 * Скрипт собирает статические require() в мини-CommonJS-бандл и копирует CEF-UI.
 * Никакого npm install не требуется — сборка должна работать на чистой машине.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'client', 'index.js');
const OUT_DIR = path.join(ROOT, 'client_packages', 'gold');
const OUT_FILE = path.join(OUT_DIR, 'goldclient.js');
const UI_SRC = path.join(ROOT, 'client', 'ui');
const UI_DST = path.join(OUT_DIR, 'ui');

function fail(message) {
  console.error(`\n[build] ОШИБКА: ${message}\n`);
  process.exit(1);
}

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    fail(`Внешний require("${spec}") в ${path.relative(ROOT, fromFile)}. Клиентский бандл допускает только относительные модули.`);
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  fail(`Не найден модуль "${spec}" (импортируется из ${path.relative(ROOT, fromFile)})`);
  return null;
}

function collect(entry) {
  const modules = [];
  const byFile = new Map();

  function add(file) {
    if (byFile.has(file)) return byFile.get(file).id;
    const id = modules.length;
    const record = { id, file, code: '', deps: [] };
    modules.push(record);
    byFile.set(file, record);
    return id;
  }

  add(entry);

  for (let index = 0; index < modules.length; index += 1) {
    const record = modules[index];
    const raw = fs.readFileSync(record.file, 'utf8');
    if (record.file.endsWith('.json')) {
      record.code = `module.exports = ${raw};`;
      continue;
    }
    const code = raw.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (match, quote, spec) => {
      const resolved = resolveModule(record.file, spec);
      const id = add(resolved);
      return `__require(${id})`;
    });
    record.code = code;
  }

  return modules;
}

function render(modules, entryId) {
  const chunks = [];
  chunks.push('/* GOLD DAYZ — client bundle. Собран tools/build-client.js. Правьте client/ и shared/, затем npm run build. */');
  chunks.push('(function () {');
  chunks.push('  "use strict";');
  chunks.push('  var __modules = {');
  for (let i = 0; i < modules.length; i += 1) {
    const mod = modules[i];
    chunks.push(`    ${mod.id}: function (module, exports, __require) { /* ${path.relative(ROOT, mod.file).replace(/\\/g, '/')} */`);
    chunks.push(mod.code);
    chunks.push('    }' + (i === modules.length - 1 ? '' : ','));
  }
  chunks.push('  };');
  chunks.push('  var __cache = {};');
  chunks.push('  function __require(id) {');
  chunks.push('    var cached = __cache[id];');
  chunks.push('    if (cached) return cached.exports;');
  chunks.push('    var module = { exports: {} };');
  chunks.push('    __cache[id] = module;');
  chunks.push('    __modules[id].call(module.exports, module, module.exports, __require);');
  chunks.push('    return module.exports;');
  chunks.push('  }');
  chunks.push(`  __require(${entryId});`);
  chunks.push('})();');
  return chunks.join('\n');
}

function copyUI() {
  if (!fs.existsSync(UI_SRC)) fail(`Нет папки UI: ${path.relative(ROOT, UI_SRC)}`);
  fs.mkdirSync(UI_DST, { recursive: true });
  const files = ['index.html', 'style.css', 'app.js'];
  for (let i = 0; i < files.length; i += 1) {
    const src = path.join(UI_SRC, files[i]);
    if (!fs.existsSync(src)) fail(`Нет файла UI: ${path.relative(ROOT, src)}`);
    fs.copyFileSync(src, path.join(UI_DST, files[i]));
  }
  return files;
}

function main() {
  if (!fs.existsSync(ENTRY)) fail(`Нет клиентской точки входа: ${path.relative(ROOT, ENTRY)}`);
  const startedAt = Date.now();
  const modules = collect(ENTRY);
  const bundle = render(modules, 0);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, bundle, 'utf8');
  const uiFiles = copyUI();

  const manifest = {
    builtAt: new Date().toISOString(),
    entry: path.relative(ROOT, ENTRY).replace(/\\/g, '/'),
    out: path.relative(ROOT, OUT_FILE).replace(/\\/g, '/'),
    modules: modules.map((mod) => path.relative(ROOT, mod.file).replace(/\\/g, '/')),
    bytes: Buffer.byteLength(bundle, 'utf8'),
    uiFiles
  };
  fs.writeFileSync(path.join(OUT_DIR, 'build-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log('[build] готово за ' + (Date.now() - startedAt) + ' мс');
  console.log(`[build] модулей: ${modules.length}, размер: ${(manifest.bytes / 1024).toFixed(1)} КБ`);
  console.log(`[build] -> ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`[build] -> ${path.relative(ROOT, UI_DST)} (${uiFiles.join(', ')})`);
  console.log('[build] не забудьте перезапустить RAGE-сервер (или зайдите заново в игру), чтобы клиент подхватил бандл');
}

if (require.main === module) main();

module.exports = { collect, render, resolveModule };
