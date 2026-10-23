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

/**
 * Вайтлист: необязательный «пропуск» на сервер.
 *
 * RAGE не поддерживает пароли на подключение, поэтому закрытый тестовый сервер
 * делается списком допущенных: ник, Social Club ID и/или IP.
 * По умолчанию выключен — локальная отладка не требует никаких входов.
 */
function isWhitelisted(player, config) {
  const cfg = (config && config.access) || {};
  if (cfg.whitelistEnabled !== true) return true;
  if (!player) return true; // серверная консоль

  const names = Array.isArray(cfg.nicknames) ? cfg.nicknames.map((name) => String(name).toLowerCase()) : [];
  if (names.indexOf(String(player.name || '').toLowerCase()) >= 0) return true;

  const ids = Array.isArray(cfg.socialClubIds) ? cfg.socialClubIds.map((id) => String(id)) : [];
  if (ids.length) {
    const socialClub = player.socialClub !== undefined && player.socialClub !== null ? String(player.socialClub) : '';
    const rgscId = player.rgscId !== undefined && player.rgscId !== null ? String(player.rgscId) : '';
    if ((socialClub && ids.indexOf(socialClub) >= 0) || (rgscId && ids.indexOf(rgscId) >= 0)) return true;
  }

  const ips = Array.isArray(cfg.ips) ? cfg.ips.map((ip) => String(ip)) : [];
  if (ips.indexOf(String(player.ip || '')) >= 0) return true;

  return false;
}

module.exports = { isAdmin, isWhitelisted };
