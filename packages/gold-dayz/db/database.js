'use strict';

/**
 * Подключение к MySQL/MariaDB (mysql2).
 * Если БД недоступна — сервер продолжит работу в режиме «только память»
 * (данные игроков не сохранятся, всё остальное будет работать).
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

let pool = null;
let memoryOnly = false;

async function init() {
	try {
		const mysql = require('mysql2/promise');
		pool = mysql.createPool({
			host: config.db.host,
			port: config.db.port,
			user: config.db.user,
			password: config.db.password,
			database: config.db.database,
			charset: config.db.charset,
			waitForConnections: true,
			connectionLimit: 10
		});

		// прогоняем схему (идемпотентная: CREATE TABLE IF NOT EXISTS)
		const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', 'gold_dayz.sql'), 'utf8');
		const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
		for (const stmt of statements) {
			await pool.query(stmt);
		}

		const [rows] = await pool.query('SELECT 1 AS ok');
		console.log('[GOLD] MySQL подключена:', config.db.database, rows[0].ok === 1 ? '(ok)' : '');
	} catch (err) {
		memoryOnly = true;
		pool = null;
		console.log('');
		console.log('[GOLD][ОШИБКА] Не удалось подключиться к MySQL:', err.message);
		console.log('[GOLD][ОШИБКА] Проверьте config.js → db { host, user, password, database }');
		console.log('[GOLD][ОШИБКА] и наличие базы: CREATE DATABASE gold_dayz CHARACTER SET utf8mb4;');
		console.log('[GOLD] Сервер работает в режиме «только память» — прогресс НЕ сохраняется.');
		console.log('');
	}
}

function query(sql, params) {
	if (!pool) return Promise.resolve(null);
	return pool.query(sql, params).then(([rows]) => rows);
}

function isMemoryOnly() {
	return memoryOnly;
}

module.exports = { init, query, isMemoryOnly };
