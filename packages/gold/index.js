'use strict';

/**
 * Серверный пакет RAGE Multiplayer.
 * Реальная логика лежит в /server — так её можно тестировать обычным Node.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

try {
  require(path.join(ROOT, 'server', 'index.js'));
} catch (err) {
  console.error('[GOLD DAYZ] Не удалось загрузить серверный gamemode:', err && err.stack ? err.stack : err);
  throw err;
}
