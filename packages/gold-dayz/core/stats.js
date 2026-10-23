'use strict';

/**
 * Статусы игрока: кровь (ровно 12000), еда, вода, температура, шум, видимость,
 * кровотечение, шок, перелом. Урон, смерть, респавн, автосейв.
 * Классика MTA DayZ: смерть ТОЛЬКО от крови, GTA-HP всегда держим на 100.
 */

const config = require('../config');
const world = require('./world');

const dataMap = new Map(); // player.id -> data

/* ------------------------------- Данные игрока ------------------------------- */

function ensureData(player) {
	let d = dataMap.get(player.id);
	if (!d) {
		d = {
			dbId: null,             // id строки characters (null = не залогинен)
			accountLogin: null,
			stats: {
				blood: config.survival.BLOOD_MAX,
				food: 100,
				water: 100,
				temperature: 36.6,
				shock: 0,
				bleeding: 0,        // 0..3
				fracture: false,
				alive: true
			},
			noise: 0,               // 0..100, шум от бега/выстрелов (для агро)
			visibility: 60,         // 0..100, заметность (поза + ночь)
			shotUntil: 0,           // пульс выстрела: зомби слышат N секунд
			seat: null,             // текущее место в машине (0 = водитель)
			loadingWeapons: false,  // флаг: только что загрузили персонажа
			lastRegen: 0,
			respawning: false
		};
		dataMap.set(player.id, d);
	}
	return d;
}

function getData(player) {
	return dataMap.get(player.id) || null;
}

function dropData(player) {
	dataMap.delete(player.id);
}

/* ------------------------------ Сериализация в CEF ------------------------------ */

function serialize(player) {
	const d = getData(player);
	if (!d) return null;
	const s = d.stats;
	const S = config.survival;

	let inVehicle = null;
	const veh = player.vehicle;
	if (veh) {
		inVehicle = {
			fuel: veh.getVariable('fuel') || 0,
			hasEngine: !!veh.getVariable('hasEngine'),
			hasWheels: !!veh.getVariable('hasWheels'),
			started: !!veh.getVariable('engStarted'),
			isDriver: d.seat === 0 // RageEnums.VehicleSeat.DRIVER === 0
		};
	}

	return {
		blood: Math.max(0, Math.round(s.blood)),
		bloodMax: S.BLOOD_MAX,
		food: Math.max(0, Math.round(s.food)),
		water: Math.max(0, Math.round(s.water)),
		temperature: Math.round(s.temperature * 10) / 10,
		noise: Math.round(d.noise),
		visibility: Math.round(d.visibility),
		bleeding: s.bleeding,
		shock: Math.round(s.shock),
		fracture: s.fracture,
		alive: s.alive,
		nightMode: world.getMode(),
		inVehicle
	};
}

function push(player) {
	const payload = serialize(player);
	if (payload) player.call('hud:stats', [JSON.stringify(payload)]);
}

/* ---------------------------------- Урон ---------------------------------- */

/**
 * Основной вход DayZ-урона.
 * @param player PlayerMp
 * @param amount сколько крови снять
 * @param opts { zombie?:boolean, fall?:boolean, source?:string }
 */
function applyDamage(player, amount, opts) {
	opts = opts || {};
	const d = ensureData(player);
	const s = d.stats;
	const S = config.survival;
	if (!s.alive) return;

	s.blood -= amount;
	s.shock = Math.min(S.SHOCK_MAX, s.shock + amount * 0.05);

	if (opts.zombie) {
		if (Math.random() < S.ZOMBIE_BLEED_CHANCE && s.bleeding < 3) {
			s.bleeding += 1;
			player.outputChatBox('!{0,#ff5555}[GOLD] Вас ранило — идёт кровотечение. Нужен бинт!');
		}
		if (Math.random() < S.ZOMBIE_FRACTURE_CHANCE && !s.fracture) {
			s.fracture = true;
			player.outputChatBox('!{0,#ff5555}[GOLD] Перелом ноги! Двигаться можно только ползком. Нужен морфин.');
		}
	}
	if (opts.fall && !s.fracture && Math.random() < S.FALL_FRACTURE_CHANCE) {
		s.fracture = true;
		player.outputChatBox('!{0,#ff5555}[GOLD] Вы упали и сломали ногу. Ползите до морфина.');
	}

	if (s.blood <= 0) {
		s.blood = 0;
		push(player);
		kill(player);
		return;
	}
	push(player);
}

function kill(player) {
	const d = getData(player);
	if (!d || !d.stats.alive) return;
	d.stats.alive = false;
	d.stats.blood = 0;

	// весь инвентарь падает на землю на месте смерти
	const inventory = require('./inventory');
	const loot = require('./loot');
	const dropList = inventory.buildDropList(player);
	if (dropList.length) loot.spawnDrop(player.position, dropList);
	inventory.onDeath(player);

	player.health = 0; // запускает playerDeath → клиент показывает экран смерти
	push(player);
}

/* --------------------------------- События --------------------------------- */

mp.events.add('playerDamage', (player, healthLoss, armorLoss) => {
	const d = ensureData(player);
	if (!d.stats.alive) return;

	// GTA-HP не участвует в смерти — держим 100, смертность только по крови
	player.health = 100;
	if (!healthLoss || healthLoss <= 0) return;

	// Если рядом зомби — это его удар: урон от проксимити-тика зомби,
	// здесь не начисляем, чтобы не было двойного урона.
	const zombies = require('./zombies');
	if (zombies.isNearZombie(player, 2.2)) return;

	applyDamage(player, healthLoss * config.survival.DAMAGE_TO_BLOOD, {
		fall: healthLoss >= config.survival.FALL_FRACTURE_THRESHOLD,
		source: 'generic'
	});
});

mp.events.add('playerDeath', (player, reason, killer) => {
	const d = ensureData(player);
	if (d.stats.alive) kill(player); // «сторонняя» смерть (если вдруг health ушёл в 0 мимо нас)
	if (d.respawning) return;
	d.respawning = true;
	push(player);
	setTimeout(() => {
		respawn(player);
	}, config.save.respawnDelayMs);
});

function respawn(player) {
	const d = getData(player);
	if (!d) return; // игрок уже вышел
	d.respawning = false;
	d.stats = {
		blood: config.survival.BLOOD_MAX,
		food: 70,
		water: 70,
		temperature: 36.6,
		shock: 0,
		bleeding: 0,
		fracture: false,
		alive: true
	};
	d.noise = 0;
	d.seat = null;
	d.lastRegen = 0;

	const pts = config.spawnPoints;
	const sp = pts[Math.floor(Math.random() * pts.length)];
	try {
		player.spawn(new mp.Vector3(sp.x, sp.y, sp.z));
		player.health = 100;
		player.removeAllWeapons(); // оружие потеряно при смерти
	} catch (e) {
		console.log('[GOLD] respawn error:', e.message);
	}
	push(player);
}

/* ------------------------------ Шум/видимость с клиента ------------------------------ */

mp.events.add('hud:clientStats', (player, noise, visibility) => {
	const d = ensureData(player);
	d.noise = clamp(Number(noise) || 0, 0, 100);
	d.visibility = clamp(Number(visibility) || 0, 0, 100);
});

mp.events.add('noise:shot', (player) => {
	const d = ensureData(player);
	d.noise = 100;            // выстрел — мгновенный максимум шума
	d.shotUntil = Date.now(); // зомби «слышат» его ещё несколько секунд
});

function shotHearing(player) {
	const d = getData(player);
	if (!d) return false;
	return d.shotUntil && Date.now() - d.shotUntil < config.zombies.shotPulseMs;
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* --------------------------------- Тик в 1 сек --------------------------------- */

let tickHandle = null;

function init() {
	if (tickHandle) return;
	tickHandle = setInterval(tick, 1000);

	// автосейв залогиненных персонажей
	setInterval(() => {
		mp.players.forEach(p => save(p, false));
	}, config.save.intervalMs);
}

function tick() {
	mp.players.forEach(player => {
		const d = getData(player);
		if (!d || !d.stats.alive) return;
		const s = d.stats;
		const S = config.survival;

		// голод и жажда
		s.food = Math.max(0, s.food - S.FOOD_DECAY_PER_SEC);
		s.water = Math.max(0, s.water - S.WATER_DECAY_PER_SEC);
		if (s.food <= 0) s.blood -= S.BLOOD_LOSS_STARVING;
		if (s.water <= 0) s.blood -= S.BLOOD_LOSS_THIRST;

		// шум рассасывается
		d.noise = Math.max(0, d.noise - 15);

		// температура тянет к цели режима ночи:
		//   светлая ночь (slow) — комфортные 36.8; тёмная (fast) — 34.9 (холодно, шкала падает)
		const tempTarget = world.isFast() ? 34.9 : 36.8;
		s.temperature += (tempTarget - s.temperature) * 0.02;
		if (s.temperature < S.TEMP_MIN_SAFE) s.blood -= S.TEMP_DAMAGE_LOW;
		if (s.temperature > S.TEMP_MAX_SAFE) s.blood -= S.TEMP_DAMAGE_HIGH;

		// кровотечение: чем выше уровень — тем быстрее теряешь кровь
		if (s.bleeding > 0) s.blood -= s.bleeding * S.BLEEDING_DAMAGE_PER_LVL;

		// шок
		s.shock = Math.max(0, s.shock - S.SHOCK_DECAY_PER_SEC);
		if (s.shock >= S.SHOCK_DAMAGE_THRESHOLD) s.blood -= S.SHOCK_DAMAGE_PER_SEC;

		// регенерация (как в MTA): только сыт/напоен/без кровотечения
		d.lastRegen += 1000;
		if (d.lastRegen >= S.REGEN_INTERVAL_MS) {
			d.lastRegen = 0;
			if (s.food > S.REGEN_FOOD_MIN && s.water > S.REGEN_WATER_MIN &&
				s.bleeding === 0 && s.temperature >= S.TEMP_MIN_SAFE && s.temperature <= S.TEMP_MAX_SAFE) {
				s.blood = Math.min(S.BLOOD_MAX, s.blood + S.REGEN_AMOUNT);
			}
		}

		if (s.blood <= 0) {
			s.blood = 0;
			kill(player);
			return;
		}
		push(player);
	});
}

/* ---------------------------------- Сохранение ---------------------------------- */

function save(player, force) {
	const d = getData(player);
	if (!d || !d.dbId) return; // только залогиненные
	const db = require('../db/database');
	if (db.isMemoryOnly()) return;

	const s = d.stats;
	const inventory = require('./inventory');
	const p = player.position;
	db.query(
		`UPDATE characters SET pos_x=?, pos_y=?, pos_z=?, heading=?,
		 blood=?, food=?, water=?, temperature=?, shock=?, bleeding=?, fracture=?,
		 inventory=?, equipped=? WHERE id=?`,
		[
			p.x, p.y, p.z, player.heading,
			s.blood, s.food, s.water, s.temperature, s.shock, s.bleeding, s.fracture ? 1 : 0,
			JSON.stringify(inventory.getList(player)),
			JSON.stringify(d.equipped || []),
			d.dbId
		]
	).catch(err => console.log('[GOLD] save error:', err.message));
}

function setLoaded(player, row) {
	const d = ensureData(player);
	d.dbId = row.id;
	d.accountLogin = row.login || null;
	d.stats = {
		blood: Math.max(1, row.blood > 0 ? Number(row.blood) : config.survival.BLOOD_MAX),
		food: Number(row.food),
		water: Number(row.water),
		temperature: Number(row.temperature),
		shock: Number(row.shock),
		bleeding: Number(row.bleeding),
		fracture: !!row.fracture,
		alive: true
	};
	if (d.stats.blood <= 0) {
		d.stats.blood = config.survival.BLOOD_MAX;
		d.stats.food = Math.max(d.stats.food, 50);
		d.stats.water = Math.max(d.stats.water, 50);
	}
}

module.exports = {
	init, ensureData, getData, dropData,
	serialize, push, applyDamage, kill,
	save, setLoaded, shotHearing
};
