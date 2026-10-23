'use strict';

/**
 * Чат-команды GOLD DAYZ.
 * RAGE вызывает обработчики с сигнатурой (player, fullText, arg1, arg2...).
 */

const INV = require('../shared/inventory');
const SURVIVAL_MOD = require('../shared/survival');
const V = require('../shared/vec3');
const { sanitizeText, clampInt } = require('../shared/netcode');
const { isAdmin } = require('./core/permissions');

const HELP_PLAYER = [
  'GOLD DAYZ — команды:',
  '/pos — координаты и зона',
  '/stats — состояние персонажа',
  '/inv — инвентарь (или I)',
  '/map — карта лут-зон (или M)',
  '/take — подобрать рядом (или E)',
  '/reload — перезарядить оружие (или R)',
  '/fill — наполнить флягу у воды',
  '/radio <текст> — общий эфир (нужна рация)',
  '/base — база рядом (owner/ворота)',
  '/baseclaim — занять базу',
  '/basegate — открыть/закрыть ворота',
  '/basecode <3-8 цифр> — пин-код ворот',
  '/help — помощь',
  '/respawn — новая жизнь после смерти'
].join('\n');

const HELP_ADMIN = [
  'GOLD DAYZ — админ:',
  '/zspawn [n] — зомби рядом с вами',
  '/zclear — убрать всех зомби',
  '/zcount — статистика зомби',
  '/give <item> [n] — выдать предмет',
  '/lootzone <zoneId> [n] — заспавнить лут в зоне',
  '/tp <x> <y> <z> — телепорт (или /tpway)',
  '/god — бессмертие вкл/выкл',
  '/heal — полное лечение',
  '/setstat <key> <value> — health/hunger/thirst/stamina/radiation/bleeding',
  '/kill <id|me> — убить игрока',
  '/announce <text> — объявление',
  '/metrics — метрики сервера',
  '/reload — перечитать data/*.json',
  '/save — сохранить профили',
  '/players — список игроков'
].join('\n');

function say(player, text) {
  if (!player) return;
  try {
    player.outputChatBox(text);
  } catch (err) {
    // игрок отключился между событиями — это нормально
  }
}

function register(game, mp, logger) {
  const hasAdminRights = (player) => isAdmin(player, game.config);

  const findPlayerById = (id) => {
    let found = null;
    mp.players.forEach((candidate) => {
      if (found) return;
      if (candidate.id === id) found = candidate;
    });
    return found;
  };

  const admin = (handler) => (player, ...args) => {
    if (!hasAdminRights(player)) {
      say(player, '! Недостаточно прав.');
      return;
    }
    try {
      handler(player, ...args);
    } catch (err) {
      logger.error(`[cmd] ${err.stack || err.message}`);
      say(player, `! Ошибка команды: ${err.message}`);
    }
  };

  const playerOnly = (handler) => (player, ...args) => {
    if (!player) {
      say(player, 'Команда доступна только игроку.');
      return;
    }
    try {
      handler(player, ...args);
    } catch (err) {
      logger.error(`[cmd] ${err.stack || err.message}`);
      say(player, `! Ошибка команды: ${err.message}`);
    }
  };

  // ------------------------------------------------------------ игроку
  mp.events.addCommand('help', playerOnly((player) => {
    say(player, HELP_PLAYER);
    if (hasAdminRights(player)) say(player, `\n${HELP_ADMIN}`);
  }));

  mp.events.addCommand('pos', playerOnly((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    const zone = game.findSafeZone(state.pos);
    const toxin = game.findToxinZone(state.pos);
    say(player, `Позиция: ${state.pos.x.toFixed(2)}, ${state.pos.y.toFixed(2)}, ${state.pos.z.toFixed(2)}` +
      (zone ? ` | ${zone.name}` : '') + (toxin ? ` | ТОКСИНЫ: ${toxin.name}` : ''));
  }));

  mp.events.addCommand('stats', playerOnly((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    const stats = state.stats;
    const weight = INV.totalWeight(state.inventory, game.data.itemsIndex);
    say(player, `HP ${Math.round(stats.health)} | Кровь ${Math.round(stats.blood)} | Еда ${Math.round(stats.hunger)} | Вода ${Math.round(stats.thirst)} | Стамина ${Math.round(stats.stamina)}`);
    say(player, `Вес ${weight.toFixed(1)}/${INV.capacityKg(state.inventory, 0)} кг | Радиация ${Math.round(stats.radiation)} | Кровотечение ${stats.bleeding} | Зомби: ${state.kills.zombies} | Счёт: ${state.score}`);
  }));

  mp.events.addCommand('inv', playerOnly((player) => {
    player.call('gold:ui', [JSON.stringify({ panel: 'inventory', open: true })]);
  }));

  mp.events.addCommand('map', playerOnly((player) => {
    player.call('gold:ui', [JSON.stringify({ panel: 'map', open: true })]);
  }));

  mp.events.addCommand('take', playerOnly((player) => {
    game.handleInteract(player.id, '{}');
  }));

  // ----------------------------------------------------------- базы (System 3)

  const nearestBaseInfo = (player) => {
    const state = game.players.get(player.id);
    if (!state) return null;
    const base = game.findNearestBase(state.pos, 60);
    return base ? { base, state } : null;
  };

  mp.events.addCommand('base', playerOnly((player) => {
    const found = nearestBaseInfo(player);
    if (!found) {
      say(player, '! База не найдена (ближайшая в 60 м).');
      return;
    }
    const { base } = found;
    say(player, `База: ${base.name} | радиус ${Math.round(base.radius)} м`);
    say(player, `Владелец: ${base.ownerName || 'свободна'} | ворота: ${base.gate.open ? 'отворены' : 'закрыты'}`);
    if (!base.owner) say(player, 'Свободна — /baseclaim.');
    else if (base.owner === found.state.id) say(player, 'Ваша база — /basegate, /basecode <3-8 цифр>.');
    else say(player, 'Чужая база — /basegate с пин-кодом.');
  }));

  mp.events.addCommand('baseclaim', playerOnly((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    game.handleBaseAction(player, { base: '', act: 'claim' });
  }));

  mp.events.addCommand('baseunclaim', playerOnly((player) => {
    game.handleBaseAction(player, { base: '', act: 'unclaim' });
  }));

  mp.events.addCommand('basegate', playerOnly((player) => {
    game.handleBaseAction(player, { base: '', act: 'gate' });
  }));

  mp.events.addCommand('basecode', playerOnly((player, code) => {
    if (!code) {
      say(player, '! /basecode <3-8 цифр> — установить пин-код ворот.');
      return;
    }
    game.handleBaseAction(player, { base: '', act: 'code', code });
  }));

  mp.events.addCommand('reloadweapon', playerOnly((player) => {
    game.handleInventoryAction(player.id, JSON.stringify({ a: 'reload' }));
  }));

  // /reload: для админа — перечитать data/*.json, для игрока — перезарядить оружие.
  mp.events.addCommand('reload', (player, ...args) => {
    try {
      if (hasAdminRights(player)) {
        const { loadData } = require('./core/data');
        const path = require('path');
        const data = loadData(path.resolve(__dirname, '..'));
        game.reloadData(data);
        say(player, `Данные перезагружены: ${data.items.length} предметов, ${data.zombieTypes.length} типов зомби.`);
        logger.info('[reload] data/*.json перечитаны');
        return;
      }
      if (!player) return;
      game.handleInventoryAction(player.id, JSON.stringify({ a: 'reload' }));
    } catch (err) {
      say(player, `Ошибка перезагрузки: ${err.message}`);
      logger.error(`[reload] ${err.stack || err.message}`);
    }
  });

  mp.events.addCommand('fill', playerOnly((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    if (!state.flags.inWater) {
      say(player, 'Нужно стоять в воде.');
      return;
    }
    const canteen = INV.findSlot(state.inventory, 'canteen') >= 0;
    const bottle = INV.findSlot(state.inventory, 'water_bottle') >= 0;
    if (!canteen && !bottle) {
      say(player, 'Нет ёмкости для воды (нужна кружка или фляга).');
      return;
    }
    if (bottle && !canteen) {
      state.stats.thirst = Math.min(100, state.stats.thirst + 40);
      say(player, 'Вы напились из фляги.');
    } else {
      state.stats.thirst = Math.min(100, state.stats.thirst + 50);
      say(player, 'Кружка наполнена, вы попили.');
    }
    game.sendHud(state, game.lastTickAt);
    game.sendInventory(state);
  }));

  mp.events.addCommand('radio', playerOnly((player, text) => {
    game.handleRadio(player.id, text || '');
  }));

  mp.events.addCommand('respawn', playerOnly((player) => {
    game.handleRespawnRequest(player.id);
  }));

  mp.events.addCommand('suicide', playerOnly((player) => {
    game.handleSuicide(player.id);
  }));

  mp.events.addCommand('players', playerOnly((player) => {
    const list = game.allPlayers().map((entry) => `${entry.name} (#${entry.id}) ${entry.alive ? 'жив' : 'мёртв'} HP ${Math.round(entry.stats.health)}`);
    say(player, list.length ? `Онлайн (${list.length}):\n${list.join('\n')}` : 'Никого нет.');
  }));

  mp.events.addCommand('report', playerOnly((player, text) => {
    const message = sanitizeText(text, 200);
    if (!message) {
      say(player, 'Использование: /report <текст>');
      return;
    }
    logger.info(`[report] ${player.name} (${player.ip}): ${message}`);
    say(player, 'Жалоба записана в лог сервера.');
  }));

  // ------------------------------------------------------------ админ
  mp.events.addCommand('zspawn', admin((player, amount) => {
    const state = game.players.get(player.id);
    const spawned = game.adminSpawnZombies(clampInt(amount, 1, 40, 5), state ? state.pos : null);
    say(player, `Заспавнено зомби: ${spawned}`);
  }));

  mp.events.addCommand('zclear', admin((player) => {
    const cleared = game.adminClearZombies();
    say(player, `Убрано зомби: ${cleared}`);
  }));

  mp.events.addCommand('zcount', admin((player) => {
    const alive = game.zombies.filter((zombie) => zombie.alive).length;
    const byZone = {};
    game.zombies.forEach((zombie) => {
      if (zombie.alive) byZone[zombie.zoneId] = (byZone[zombie.zoneId] || 0) + 1;
    });
    say(player, `Зомби: ${alive} живых / ${game.zombies.length} всего`);
    say(player, `По зонам: ${JSON.stringify(byZone)}`);
  }));

  mp.events.addCommand('give', admin((player, itemId, count) => {
    if (!itemId) {
      say(player, 'Использование: /give <itemId> [count]');
      return;
    }
    const state = game.players.get(player.id);
    const ok = game.adminGive(state ? state.id : player.id, itemId, clampInt(count, 1, 500, 1));
    say(player, ok ? `Выдано: ${itemId} x${count || 1}` : `Не удалось выдать "${itemId}". Проверьте data/items.json`);
  }));

  mp.events.addCommand('lootzone', admin((player, zoneId, count) => {
    if (!zoneId) {
      say(player, `Зоны: ${Array.from(game.zoneRuntime.keys()).join(', ')}`);
      return;
    }
    const spawned = game.adminSpawnLoot(zoneId, clampInt(count, 1, 50, 5));
    say(player, spawned ? `Лут в ${zoneId}: ${spawned}` : `Зона "${zoneId}" не найдена или пустая таблица`);
  }));

  mp.events.addCommand('tp', admin((player, x, y, z) => {
    const state = game.players.get(player.id);
    if (!state) return;
    if (x === undefined) {
      say(player, 'Использование: /tp <x> <y> <z> или /tpway');
      return;
    }
    if (y === undefined) {
      // /tp <playerId>
      const targetId = clampInt(x, 0, 1e9, -1);
      const target = game.players.get(targetId);
      if (!target) {
        say(player, 'Игрок не найден');
        return;
      }
      game.adminTeleport(player.id, target.pos.x, target.pos.y, target.pos.z + 1);
      return;
    }
    game.adminTeleport(player.id, Number(x), Number(y), Number(z === undefined ? state.pos.z : z));
  }));

  mp.events.addCommand('tpway', admin((player) => {
    // Координаты метки знает только клиент — просим его прислать их обратно.
    player.call('gold:tpwayRequest');
    say(player, 'Читаю метку на карте…');
  }));

  mp.events.addCommand('god', admin((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    state.godMode = !state.godMode;
    say(player, `Бессмертие: ${state.godMode ? 'вкл' : 'выкл'}`);
  }));

  mp.events.addCommand('heal', admin((player) => {
    const state = game.players.get(player.id);
    if (!state) return;
    state.stats = SURVIVAL_MOD.createStats();
    game.sendHud(state, game.lastTickAt);
    game.sendInventory(state);
    say(player, 'Персонаж вылечен полностью.');
  }));

  mp.events.addCommand('setstat', admin((player, key, value) => {
    const state = game.players.get(player.id);
    if (!state || !key) {
      say(player, 'Использование: /setstat <health|hunger|thirst|stamina|radiation|bleeding|temperature> <value>');
      return;
    }
    const ok = game.setStat(state.id, String(key), Number(value));
    game.sendHud(state, game.lastTickAt);
    say(player, ok ? `${key} = ${value}` : `Неизвестный параметр "${key}"`);
  }));

  mp.events.addCommand('kill', admin((player, targetId) => {
    if (!targetId) {
      say(player, 'Использование: /kill <playerId|me>');
      return;
    }
    const id = String(targetId) === 'me' ? player.id : Number(targetId);
    const state = game.players.get(id);
    if (!state) {
      say(player, 'Игрок не найден');
      return;
    }
    game.killPlayer(state, 'damage', null);
    say(player, `Убит: ${state.name}`);
  }));

  mp.events.addCommand('announce', admin((player, text) => {
    const message = sanitizeText(text, 200);
    if (!message) return;
    mp.players.forEach((target) => target.outputChatBox(`[ОБЪЯВЛЕНИЕ] ${message}`));
    logger.info(`[announce] ${message}`);
  }));

  mp.events.addCommand('metrics', admin((player) => {
    const metrics = game.getMetrics();
    say(player, JSON.stringify(metrics, null, 2));
    logger.info('[metrics]', metrics);
  }));

  mp.events.addCommand('save', admin((player) => {
    game.persistAll();
    say(player, 'Профили сохранены.');
  }));

  mp.events.addCommand('kick', admin((player, targetId, reason) => {
    const target = findPlayerById(Number(targetId));
    if (!target) {
      say(player, 'Игрок не найден');
      return;
    }
    logger.warn(`[admin] kick ${target.name}: ${sanitizeText(reason, 100) || 'без причины'}`);
    target.kick(sanitizeText(reason, 100) || 'Кик администратором');
  }));

  // ------------------------------------------------------------ серверный чат
  mp.events.add('playerChat', (player, text) => {
    const state = game.players.get(player.id);
    if (!state) return;
    const message = sanitizeText(text, 140);
    if (!message) return;
    if (!game.limiter.allow(`chat:${player.id}`, 6, 10000, game.lastTickAt)) {
      say(player, '! Слишком много сообщений.');
      return;
    }
    logger.info(`[chat] ${player.name}: ${message}`);
    mp.players.forEach((target) => target.outputChatBox(`${player.name}: ${message}`));
  });

  logger.info('[cmd] команды зарегистрированы');
  return { isAdmin: hasAdminRights };
}

module.exports = { register, HELP_PLAYER, HELP_ADMIN };
