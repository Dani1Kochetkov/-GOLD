'use strict';

/**
 * GOLD DAYZ — точка входа серверного ресурса (RAGE Multiplayer / Node.js).
 * Порядок: конфиг → БД → модули → стартовые тики.
 */

const config = require('./config');
const db = require('./db/database');
const world = require('./core/world');
const auth = require('./core/auth');
const stats = require('./core/stats');
const inventory = require('./core/inventory');
const loot = require('./core/loot');
const vehicles = require('./core/vehicles');
const zombies = require('./core/zombies');

console.log('[GOLD] GOLD DAYZ сервер стартует...');

db.init().then(() => {
	world.init();
	loot.init();
	vehicles.init();
	stats.init();
	zombies.init();
	console.log('[GOLD] Все модули запущены. Режим ночи:', world.getMode());
});

/* ------------------------------- Общие события ------------------------------- */

mp.events.add('playerJoin', (player) => {
	console.log(`[GOLD] Игрок подключился: ${player.name} (IP ${player.ip})`);
});

mp.events.add('playerReady', (player) => {
	console.log(`[GOLD] Игрок загрузился: ${player.name} — клиентские ресурсы отданы`);
	stats.ensureData(player);
	world.pushMode(player);
	player.outputChatBox('!{0,#ff5555}[GOLD DAYZ] !{0,ffffff}Добро пожаловать. ' +
		'Команды: /register <логин> <пароль>, /login <логин> <пароль>, /zmode slow|fast, /pos');
	stats.push(player);
});

mp.events.add('playerSpawn', (player) => {
	const data = stats.getData(player);
	if (!data) return;
	player.health = 100;
	// воскресший без оружия: экипировка выдаётся при загрузке персонажа
	if (!data.loadingWeapons) {
		player.removeAllWeapons();
		inventory.giveEquipped(player);
	}
	data.loadingWeapons = false;
	stats.push(player);
});

mp.events.add('playerQuit', (player, exitType, reason) => {
	zombies.onPlayerQuit(player);
	vehicles.onPlayerQuit(player);
	stats.save(player, true);
	stats.dropData(player);
});

// вспомогательная команда: показать координаты (удобно для карты/лута)
mp.events.addCommand('pos', (player) => {
	if (!player) return;
	const p = player.position;
	player.outputChatBox(`!{0,#ffaa00}[GOLD] x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} h=${player.heading.toFixed(2)}`);
});
