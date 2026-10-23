#!/usr/bin/env node
'use strict';

/**
 * Диагностика окружения перед запуском GOLD DAYZ.
 *   npm run doctor
 * Проверяет файлы, порты, права на запись и сами данные.
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { runChecks } = require('./check');

const ROOT = path.resolve(__dirname, '..');
const GAME_PORT = 22005;

function line(ok, text) {
  console.log(`  ${ok === true ? '✅' : ok === false ? '❌' : '·'} ${text}`);
}

function fileExists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

function findServerBinary() {
  const candidates = ['ragemp-server.exe', 'ragemp-server', 'server-files/ragemp-server.exe', 'server-files/ragemp-server'];
  for (let i = 0; i < candidates.length; i += 1) {
    const full = path.join(ROOT, candidates[i]);
    if (fs.existsSync(full)) return candidates[i];
  }
  return null;
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve({ port, free: false, error: err.code }));
    server.once('listening', () => server.close(() => resolve({ port, free: true })));
    server.listen(port, '0.0.0.0');
  });
}

function checkWritable(relative) {
  const dir = path.join(ROOT, relative);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    return false;
  }
}

async function main() {
  console.log('\n  GOLD DAYZ — диагностика окружения\n');
  line(null, `Node.js ${process.version} (${process.platform}/${process.arch})`);
  line(null, `Node.js поддерживается: ${Number(process.versions.node.split('.')[0]) >= 14 ? 'да' : 'НЕТ, нужен 14+'}`);

  const binary = findServerBinary();
  line(binary !== null, binary
    ? `сервер RAGE найден: ${binary}`
    : 'сервер RAGE не найден в корне. Скачайте server-files с https://rage.mp и распакуйте в корень репозитория');

  const required = [
    'conf.json',
    'packages/gold/index.js',
    'client_packages/index.js',
    'client_packages/gold/goldclient.js',
    'client_packages/gold/ui/index.html',
    'data/items.json',
    'data/zombies.json',
    'data/map.json',
    'data/loot.json',
    'data/gold.config.json'
  ];
  let missing = 0;
  required.forEach((file) => {
    const exists = fileExists(file);
    if (!exists) missing += 1;
    line(exists, `${exists ? 'есть' : 'НЕТ'}: ${file}`);
  });

  const writableLogs = checkWritable('logs');
  const writableStorage = checkWritable('storage/players');
  line(writableLogs, 'запись в logs/');
  line(writableStorage, 'запись в storage/players/');

  const ports = await Promise.all([checkPort(GAME_PORT), checkPort(GAME_PORT + 1)]);
  ports.forEach((result) => {
    line(result.free, result.free
      ? `порт ${result.port} свободен`
      : `порт ${result.port} занят (${result.error || 'слушается кем-то'}) — возможно, сервер уже запущен`);
  });

  const freeMemMb = Math.round(os.freemem() / 1024 / 1024);
  const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
  line(totalMemMb >= 2048, `память: свободно ${freeMemMb} МБ из ${totalMemMb} МБ`);

  const report = runChecks();
  line(report.errors.length === 0, `проверка проекта: ${report.errors.length} ошибок, ${report.warnings.length} предупреждений`);
  report.errors.slice(0, 8).forEach((error) => console.log(`      ❌ ${error}`));

  const steps = [];
  if (binary === null) {
    steps.push('Скачайте server-files (Windows/Linux) с rage.mp и распакуйте в корень проекта.');
    steps.push('Запустите: Windows — ragemp-server.exe | Linux — ./ragemp-server');
  } else {
    steps.push(`Запустите сервер: ${binary}`);
  }
  steps.push('В клиенте RAGE: Direct Connect → 127.0.0.1:22005');
  steps.push('Проверьте в игре: F1 (телеметрия синхронизации), /zcount, /metrics.');
  steps.push('Перед выкладкой на VDS: docs/DEPLOY-VDS.md');

  console.log('\n  Что дальше:');
  steps.forEach((text, index) => console.log(`   ${index + 1}. ${text}`));
  console.log('');

  process.exit(missing || report.errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`[doctor] ${err.stack || err.message}`);
  process.exit(2);
});
