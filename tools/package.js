#!/usr/bin/env node
'use strict';

/**
 * Готовый дистрибутив проекта.
 *
 *   npm run package
 *
 * Делает release/gold-dayz-<version>/ и release/gold-dayz-<version>.zip:
 * всё, что нужно положить рядом с server-files RAGE Multiplayer.
 * Сам бинарник RAGE (ragemp-server) в архив не входит — его скачивают с rage.mp.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '0.0.0';
const NAME = `gold-dayz-${VERSION}`;
const DIST = path.join(ROOT, 'release');
const STAGING = path.join(DIST, NAME);

// Что кладём в архив. client/ нужен только для пересборки бандла,
// но он маленький и без него невозможно `npm run build` на другой машине.
const INCLUDE = [
  'server',
  'shared',
  'data',
  'packages',
  'client_packages',
  'client',
  'tools',
  'docs',
  'tests',
  'package.json',
  'conf.json',
  'conf.production.example.json',
  'start.cmd',
  'start.sh',
  'README.md'
];

const START_TEXT = `GOLD DAYZ ${VERSION} — готовый дистрибутив
=====================================================

ВХОД НА СЕРВЕР
  Логина и пароля нет. RAGE Multiplayer не поддерживает пароли на подключение:
  заходите по нику, как в обычном мультиплеере.
  Если нужен закрытый тест "только для своих" — см. раздел 5.

1. ЧТО НУЖНО СКАЧАТЬ ОТДЕЛЬНО
   - Server-files RAGE Multiplayer (Windows или Linux): https://rage.mp
     Архив с ragemp-server.exe / ragemp-server, он не входит в эту сборку.
   - Клиент RAGE Multiplayer + лицензионная GTA V (Steam/Epic/Rockstar).

2. УСТАНОВКА
   Диск любой: D:\, E:\, папка с пробелами — start.cmd сам берёт свой путь.
   a) Распакуйте server-files RAGE в любую папку на любом диске,
      например D:\\gold-dayz\\ или D:\\GOLD\\
      (лучше без кириллицы и пробелов в пути — так меньше сюрпризов у RAGE и Node)
   b) Скопируйте содержимое этой папки В ТУ ЖЕ папку (файлы не пересекаются).
   c) Ничего собирать не нужно: клиентский бандл уже собран.

   Должно получиться так:
     D:\\gold-dayz\\ragemp-server.exe   <- из server-files
     D:\\gold-dayz\\conf.json
     D:\\gold-dayz\\packages\\gold\\index.js
     D:\\gold-dayz\\client_packages\\index.js
     D:\\gold-dayz\\client_packages\\gold\\goldclient.js
     D:\\gold-dayz\\server\\  shared\\  data\\

   Диск и имя папки любые: start.cmd берёт свой путь (%cd%) и работает с D:,
   E: и с папкой вроде D:\\Games\\GOLD DAYZ. Ничего прописывать вручную не нужно.

3. ЗАПУСК
   Windows: двойной клик по start.cmd (или ragemp-server.exe).
   Linux:   ./start.sh  (или ./ragemp-server)
   В консоли появится "GOLD DAYZ готов".
   В клиенте RAGE: Direct Connect -> 127.0.0.1:22005
   Порт 22005 (игровой) и 22006 (раздача клиентских пакетов) должны быть свободны.

4. УПРАВЛЕНИЕ В ИГРЕ
   I  инвентарь      M  карта        E  подобрать
   R  перезарядка    F1 телеметрия синхронизации зомби
   Чат-команды: /help (игрок), /help — админские см. docs/CHECKLIST.md

5. ТОЛЬКО ДЛЯ СВОИХ (необязательно)
   Откройте data/gold.config.json, блок "access":
     "whitelistEnabled": true,
     "nicknames": ["ВашНик", "НикДруга"],
     "socialClubIds": [],
     "ips": []
   Перезапустите сервер (или /reload в игре под админом).
   Остальных будет кикать с сообщением из "kickMessage".
   Админ-команды по умолчанию работают только с этого же ПК (127.0.0.1),
   для друзей впишите их ники в admin.names.

6. ПРОВЕРКА ПЕРЕД ИГРОЙ (по желанию, нужен Node.js 18+)
   npm run doctor    окружение, файлы, порты
   npm run check     данные и бюджеты пакетов
   npm test          91 тест без GTA

7. ПУБЛИЧНЫЙ СЕРВЕР (VDS)
   Замените conf.json на conf.production.example.json (bind 0.0.0.0, announce true),
   откройте 22005/tcp+udp и 22006/tcp. Подробно: docs/DEPLOY-VDS.md

Документация: README.md, docs/ARCHITECTURE.md, docs/DEBUGGING.md,
docs/DATA.md, docs/DEPLOY-VDS.md, docs/CHECKLIST.md
`;

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyRecursive(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach((name) => {
      copyRecursive(path.join(from, name), path.join(to, name));
    });
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function dirSize(dir) {
  let total = 0;
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    });
  };
  walk(dir);
  return total;
}

function countFiles(dir) {
  let total = 0;
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += 1;
    });
  };
  walk(dir);
  return total;
}

function makeArchive(zipPath) {
  // 1) zip — есть в Linux/macOS и в Git Bash.
  let result = spawnSync('zip', ['-r', '-q', zipPath, NAME], { cwd: DIST });
  if (result.status === 0) return 'zip';

  // 2) Windows PowerShell.
  if (process.platform === 'win32') {
    result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${path.join(STAGING, '*')}' -DestinationPath '${zipPath}' -Force`
    ], { cwd: DIST });
    if (result.status === 0) return 'powershell';
  }

  // 3) tar.gz — последний вариант, распаковывается на Windows 10+.
  const tgz = zipPath.replace(/\.zip$/, '.tar.gz');
  result = spawnSync('tar', ['-czf', tgz, NAME], { cwd: DIST });
  if (result.status === 0) return `tar (${path.basename(tgz)})`;

  return null;
}

// ------------------------------------------------------------------ сборка

console.log(`\n  GOLD DAYZ — сборка дистрибутива ${VERSION}\n`);

const build = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-client.js')], {
  cwd: ROOT,
  stdio: 'inherit'
});
if (build.status !== 0) {
  console.error('\n  ❌ не удалось собрать клиентский бандл');
  process.exit(1);
}

rmrf(STAGING);
fs.mkdirSync(STAGING, { recursive: true });

const missing = [];
INCLUDE.forEach((entry) => {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) {
    missing.push(entry);
    return;
  }
  copyRecursive(from, path.join(STAGING, entry));
});

// Не тащим тесты и инструменты, лишние в готовой сборке? Наоборот: они позволяют
// проверить сервер на месте. Но reports/ и logs/ из tools/ не копируем — их нет в INCLUDE.

fs.writeFileSync(path.join(STAGING, 'START.txt'), START_TEXT, 'utf8');

// В готовой сборке dev-конфиг со сжатием 0 — это нормально для домашнего ПК.
// Рядом лежит production-шаблон; подсказка внутри START.txt.

const stats = {
  files: countFiles(STAGING),
  bytes: dirSize(STAGING)
};

const zipPath = path.join(DIST, `${NAME}.zip`);
const archiveKind = makeArchive(zipPath);

console.log('');
console.log(`  ✅ release/${NAME}/ — ${stats.files} файлов, ${(stats.bytes / 1024).toFixed(0)} КБ`);
if (archiveKind) {
  const sizes = fs.readdirSync(DIST).filter((name) => /\.(zip|tar\.gz)$/.test(name));
  sizes.forEach((name) => {
    const size = fs.statSync(path.join(DIST, name)).size;
    console.log(`  ✅ release/${name} — ${(size / 1024).toFixed(0)} КБ (${archiveKind})`);
  });
} else {
  console.log('  ⚠️  архиватор не найден: используйте папку release/' + NAME);
}
if (missing.length) {
  console.log(`  ⚠️  не найдены и пропущены: ${missing.join(', ')}`);
}

console.log('');
console.log('  Что дальше:');
console.log('   1. Скачайте server-files RAGE Multiplayer с https://rage.mp');
console.log(`   2. Распакуйте их и скопируйте туда содержимое release/${NAME}/`);
console.log('   3. Запустите start.cmd (Windows) / ./start.sh (Linux) или ragemp-server');
console.log('   4. В клиенте RAGE: Direct Connect -> 127.0.0.1:22005');
console.log('   5. Логин и пароль не нужны — вход по нику. Закрытый тест: data/gold.config.json -> access');
console.log('');
