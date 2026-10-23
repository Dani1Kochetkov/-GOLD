'use strict';

/**
 * Авторизация: /register <логин> <пароль>, /login <логин> <пароль>.
 * Пароль хранится как sha256(логин:пароль:соль) — для локального теста достаточно.
 * Без входа можно играть (свежий персонаж), но прогресс не сохраняется.
 */

const crypto = require('crypto');
const config = require('../config');
const db = require('../db/database');

const SALT = 'GOLD-DAYZ-2026';

function hash(login, password) {
	return crypto.createHash('sha256').update(`${login}:${password}:${SALT}`, 'utf8').digest('hex');
}

function parseArgs(args) {
	const s = Array.isArray(args) ? args.join(' ') : String(args || '');
	const parts = s.trim().split(/\s+/).filter(Boolean);
	return { login: (parts[0] || '').toLowerCase(), password: parts[1] || '' };
}

function validLogin(l) { return /^[a-z0-9_]{3,20}$/.test(l); }
function validPass(p) { return p.length >= 4 && p.length <= 40; }

mp.events.addCommand('register', async (player, args) => {
	if (!player) return;
	const { login, password } = parseArgs(args);
	if (!validLogin(login)) return player.outputChatBox('!{0,#ff5555}[GOLD] Логин: 3-20 символов, a-z 0-9 _');
	if (!validPass(password)) return player.outputChatBox('!{0,#ff5555}[GOLD] Пароль: 4-40 символов');

	const stats = require('./stats');
	const d = stats.getData(player);
	if (d && d.dbId) return player.outputChatBox('!{0,#ffaa00}[GOLD] Вы уже вошли в аккаунт.');
	if (db.isMemoryOnly()) return player.outputChatBox('!{0,#ff5555}[GOLD] БД недоступна — регистрация отключена.');

	try {
		const existing = await db.query('SELECT id FROM accounts WHERE login = ?', [login]);
		if (existing && existing.length) return player.outputChatBox('!{0,#ff5555}[GOLD] Такой логин уже занят.');

		const r = await db.query('INSERT INTO accounts (login, password_hash, serial) VALUES (?,?,?)',
			[login, hash(login, password), player.serial || '']);
		const accountId = r.insertId;

		await db.query(
			'INSERT INTO characters (account_id, pos_x, pos_y, pos_z) VALUES (?,?,?,?)',
			[accountId, config.spawnPoints[0].x, config.spawnPoints[0].y, config.spawnPoints[0].z]
		);

		player.outputChatBox('!{0,#55ff55}[GOLD] Аккаунт зарегистрирован. Вход выполнен.');
		await doLogin(player, accountId, login);
	} catch (e) {
		player.outputChatBox('!{0,#ff5555}[GOLD] Ошибка регистрации: ' + e.message);
	}
});

mp.events.addCommand('login', async (player, args) => {
	if (!player) return;
	const { login, password } = parseArgs(args);
	if (!validLogin(login) || !validPass(password)) {
		return player.outputChatBox('!{0,#ff5555}[GOLD] Использование: /login <логин> <пароль>');
	}
	if (db.isMemoryOnly()) return player.outputChatBox('!{0,#ff5555}[GOLD] БД недоступна — вход отключён.');

	const stats = require('./stats');
	const d = stats.getData(player);
	if (d && d.dbId) return player.outputChatBox('!{0,#ffaa00}[GOLD] Вы уже вошли.');

	try {
		const rows = await db.query('SELECT id, password_hash FROM accounts WHERE login = ?', [login]);
		if (!rows || !rows.length) return player.outputChatBox('!{0,#ff5555}[GOLD] Неверный логин или пароль.');
		if (rows[0].password_hash !== hash(login, password)) {
			return player.outputChatBox('!{0,#ff5555}[GOLD] Неверный логин или пароль.');
		}
		await doLogin(player, rows[0].id, login);
	} catch (e) {
		player.outputChatBox('!{0,#ff5555}[GOLD] Ошибка входа: ' + e.message);
	}
});

async function doLogin(player, accountId, login) {
	const stats = require('./stats');
	const inventory = require('./inventory');

	const chars = await db.query('SELECT * FROM characters WHERE account_id = ?', [accountId]);
	if (!chars || !chars.length) {
		await db.query('INSERT INTO characters (account_id) VALUES (?)', [accountId]);
		return doLogin(player, accountId, login);
	}
	const row = chars[0];
	row.login = login;

	stats.setLoaded(player, row);

	// инвентарь
	const d = stats.getData(player);
	d.inv = safeParse(row.inventory) || [];
	d.equipped = safeParse(row.equipped) || [];

	// телепорт + оружие
	const sp = { x: Number(row.pos_x), y: Number(row.pos_y), z: Number(row.pos_z) };
	d.loadingWeapons = true;
	try {
		player.spawn(new mp.Vector3(sp.x, sp.y, sp.z));
		player.health = 100;
		player.removeAllWeapons();
		setTimeout(() => {
			inventory.giveEquipped(player);
			stats.push(player);
		}, 300);
	} catch (e) {}

	player.outputChatBox(`!{0,#55ff55}[GOLD] Загружен персонаж: !{0,#ffaa00}${login}!{0,#55ff55}. Кровь: ${Math.round(d.stats.blood)}/${config.survival.BLOOD_MAX}`);
	stats.push(player);
}

function safeParse(s) {
	if (!s) return null;
	try { return JSON.parse(s); } catch (e) { return null; }
}
