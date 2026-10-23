'use strict';

/**
 * Права администратора.
 *
 * По умолчанию админские команды доступны только с локального IP — это
 * удобно для отладки на домашнем ПК и безопасно, пока сервер не опубликован.
 * Для VDS либо выключите admin.commandsFromLocalhostOnly в data/gold.config.json,
 * либо впишите ники в admin.names.
 */
function isAdmin(player, config) {
  if (!player) return true; // серверная консоль
  const cfg = (config && config.admin) || {};
  if (!cfg.enabled) return false;

  const names = Array.isArray(cfg.names)
    ? cfg.names.map((name) => String(name).toLowerCase())
    : [];
  if (names.indexOf(String(player.name || '').toLowerCase()) >= 0) return true;

  if (cfg.commandsFromLocalhostOnly) {
    const ip = String(player.ip || '');
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1';
  }

  // Если ограничение по IP выключено, но список ников пуст — админки нет.
  return false;
}

module.exports = { isAdmin };
