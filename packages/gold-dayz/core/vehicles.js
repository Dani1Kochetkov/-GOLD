'use strict';

/**
 * Машины: все спавнятся бРОКНИМИ (нет двигателя, нет колёс, пустой бак).
 * Сборка: Двигатель + Колёса + канистра бензина → заводим.
 * Хранилище багажника = переменная машины 'storage'.
 */

const config = require('../config');
const db = require('../db/database');

const vehMap = new Map(); // server vehicle id -> { veh, rowId }

const STORAGE_SLOTS = 16;
const STORAGE_MAX_WEIGHT = 80;

/* ---------------------------------- Создание ---------------------------------- */

function createVehicle(row) {
	const veh = mp.vehicles.new(mp.joaat(row.model), new mp.Vector3(row.pos_x, row.pos_y, row.pos_z), {
		heading: row.heading || 0,
		engine: false,
		locked: false,
		dimension: 0,
		numberPlate: 'GOLD'
	});
	if (!veh) {
		console.log(`[GOLD] Не удалось заспавнить машину: ${row.model} (проверьте модель)`);
		return null;
	}

	// все машины — разбитые и пустые
	veh.setVariable('hasEngine', !!row.has_engine);
	veh.setVariable('hasWheels', !!row.has_wheels);
	veh.setVariable('fuel', row.fuel | 0);
	veh.setVariable('engStarted', false);
	veh.setVariable('storage', safeParse(row.storage) || []);
	veh.setVariable('model', row.model);
	try { veh.bodyHealth = row.has_engine ? 1000 : 650; } catch (e) {}

	vehMap.set(veh.id, { veh, rowId: row.id || null, model: row.model });
	return veh;
}

function safeParse(s) {
	if (!s) return null;
	try { return JSON.parse(s); } catch (e) { return null; }
}

function init() {
	db.query('SELECT * FROM vehicles').then(rows => {
		let list = [];
		if (rows && rows.length) {
			list = rows;
			console.log(`[GOLD] Загружено машин из БД: ${list.length}`);
		} else {
			list = config.vehicleSpawns.map((v, i) => ({
				id: null,
				model: v.model,
				pos_x: v.pos.x, pos_y: v.pos.y, pos_z: v.pos.z,
				heading: v.heading,
				fuel: 0, has_engine: 0, has_wheels: 0, storage: null
			}));
			console.log(`[GOLD] БД пуста — спавним машины из config: ${list.length} (сохраним при первом автосейве)`);
			// засеваем в БД, чтобы дальше машины жили в таблице
			if (!db.isMemoryOnly()) {
				for (const row of list) {
					db.query(
						'INSERT INTO vehicles (model, pos_x, pos_y, pos_z, heading, fuel, has_engine, has_wheels, storage) VALUES (?,?,?,?,?,?,?,?,?)',
						[row.model, row.pos_x, row.pos_y, row.pos_z, row.heading, 0, 0, 0, null]
					).then(r => {
						// подставим id в уже созданный объект позже — проще сохранить по индексу
					}).catch(() => {});
				}
			}
		}
		for (const row of list) createVehicle(row);
	}).catch(err => console.log('[GOLD] vehicles load error:', err.message));

	// расход бензина
	setInterval(tickFuel, 1000);
	// автосейв состояния машин
	setInterval(saveAll, config.vehicleConfig.saveIntervalMs);
}

function tickFuel() {
	const burn = config.vehicleConfig.fuelBurnPerSec;
	for (const rec of vehMap.values()) {
		const v = rec.veh;
		if (!v || !v.getVariable('engStarted')) continue;
		let fuel = (v.getVariable('fuel') || 0) - burn;
		if (fuel <= 0) {
			fuel = 0;
			v.setVariable('engStarted', false);
			v.engine = false;
			try { v.call('veh:engineOff', []); } catch (e) {}
		}
		v.setVariable('fuel', Math.round(fuel * 10) / 10);
	}
}

/* --------------------------------- Поиск/панель --------------------------------- */

function nearest(player, maxDist) {
	let best = null;
	let bestD = maxDist;
	for (const rec of vehMap.values()) {
		const v = rec.veh;
		if (!v) continue;
		const d = player.dist(v.position);
		if (d < bestD) { bestD = d; best = v; }
	}
	return best;
}

function panelFor(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return null;
	const storage = veh.getVariable('storage') || [];
	const d = require('./stats').ensureData(player);
	return {
		id: veh.id,
		model: veh.getVariable('model') || 'vehicle',
		storage: storage.map(it => {
			const def = config.inventory.items[it.key];
			return {
				key: it.key,
				name: def ? def.name : it.key,
				count: it.count,
				weight: def ? def.weight : 0,
				cat: def ? def.cat : 'part'
			};
		}),
		hasEngine: !!veh.getVariable('hasEngine'),
		hasWheels: !!veh.getVariable('hasWheels'),
		fuel: veh.getVariable('fuel') || 0,
		fuelTank: config.vehicleConfig.fuelTank,
		started: !!veh.getVariable('engStarted'),
		isDriver: d.seat === 0, // DRIVER = 0
		storageSlots: STORAGE_SLOTS
	};
}

/* --------------------------------- Багажник --------------------------------- */

function storageAdd(veh, key, count) {
	const def = config.inventory.items[key];
	if (!def) return false;
	const storage = veh.getVariable('storage') || [];
	const currentWeight = storage.reduce((w, it) => {
		const d = config.inventory.items[it.key];
		return w + (d ? d.weight * it.count : 0);
	}, 0);
	if (currentWeight + def.weight * count > STORAGE_MAX_WEIGHT) return false;

	const it = storage.find(x => x.key === key);
	if (it) {
		if (it.count + count > def.stack) return false;
		it.count += count;
	} else {
		if (storage.length >= STORAGE_SLOTS) return false;
		storage.push({ key, count });
	}
	veh.setVariable('storage', storage);
	return true;
}

function storageRemove(veh, key, count) {
	const storage = veh.getVariable('storage') || [];
	const it = storage.find(x => x.key === key);
	if (!it || it.count < count) return false;
	it.count -= count;
	if (it.count <= 0) storage.splice(storage.indexOf(it), 1);
	veh.setVariable('storage', storage);
	return true;
}

/* ------------------------------ Сборка и запуск ------------------------------ */

function notify(player, msg) { player.outputChatBox(msg); }

function installEngine(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return notify(player, '!{0,#ff5555}[GOLD] Рядом нет машины.');
	if (veh.getVariable('hasEngine')) return notify(player, '!{0,#aaaaaa}[GOLD] Двигатель уже установлен.');
	const inventory = require('./inventory');
	if (!inventory.hasItem(inventory.getList(player), 'engine', 1)) {
		return notify(player, '!{0,#ff5555}[GOLD] Нужен предмет «Двигатель» (военные зоны / гаражи).');
	}
	inventory.removeItem(player, 'engine', 1);
	veh.setVariable('hasEngine', true);
	veh.engine = false;
	veh.bodyHealth = 1000;
	refreshNearby(player, veh);
	notify(player, '!{0,#55ff55}[GOLD] Двигатель установлен. Осталось: колёса и бензин.');
}

function installWheels(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return notify(player, '!{0,#ff5555}[GOLD] Рядом нет машины.');
	if (veh.getVariable('hasWheels')) return notify(player, '!{0,#aaaaaa}[GOLD] Колёса уже установлены.');
	const inventory = require('./inventory');
	if (!inventory.hasItem(inventory.getList(player), 'wheels', 1)) {
		return notify(player, '!{0,#ff5555}[GOLD] Нужен предмет «Колёса (комплект)».');
	}
	inventory.removeItem(player, 'wheels', 1);
	veh.setVariable('hasWheels', true);
	refreshNearby(player, veh);
	notify(player, '!{0,#55ff55}[GOLD] Колёса установлены.');
}

function refuel(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return notify(player, '!{0,#ff5555}[GOLD] Рядом нет машины.');
	const inventory = require('./inventory');
	if (!inventory.hasItem(inventory.getList(player), 'jerrycan', 1)) {
		return notify(player, '!{0,#ff5555}[GOLD] Нужна канистра бензина.');
	}
	const fuel = veh.getVariable('fuel') || 0;
	if (fuel >= config.vehicleConfig.fuelTank) return notify(player, '!{0,#aaaaaa}[GOLD] Бак полный.');
	inventory.removeItem(player, 'jerrycan', 1);
	const nf = Math.min(config.vehicleConfig.fuelTank, fuel + config.vehicleConfig.jerrycanFuel);
	veh.setVariable('fuel', Math.round(nf));
	notify(player, '!{0,#55ff55}[GOLD] Заправлено: +' + config.vehicleConfig.jerrycanFuel + ' л.');
}

function startEngine(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return notify(player, '!{0,#ff5555}[GOLD] Рядом нет машины.');
	const d = require('./stats').ensureData(player);
	if (!(player.vehicle === veh && d.seat === 0)) {
		return notify(player, '!{0,#ff5555}[GOLD] Сядьте на место водителя.');
	}
	if (!veh.getVariable('hasEngine')) return notify(player, '!{0,#ff5555}[GOLD] Нет двигателя.');
	if (!veh.getVariable('hasWheels')) return notify(player, '!{0,#ff5555}[GOLD] Нет колёс.');
	if ((veh.getVariable('fuel') || 0) <= 0) return notify(player, '!{0,#ff5555}[GOLD] Пустой бак — нужна канистра.');

	veh.setVariable('engStarted', true);
	veh.engine = true;
	notify(player, '!{0,#55ff55}[GOLD] Двигатель заведён.');
	require('./inventory').refreshOpen(player);
}

function stopEngine(player) {
	const veh = nearest(player, config.vehicleConfig.panelDistance);
	if (!veh) return notify(player, '!{0,#ff5555}[GOLD] Рядом нет машины.');
	veh.setVariable('engStarted', false);
	veh.engine = false;
	notify(player, '!{0,#ffaa00}[GOLD] Двигатель заглушен.');
	require('./inventory').refreshOpen(player);
}

/** Обновить визуал у всех игроков рядом (после установки деталей). */
function refreshNearby(player, veh) {
	player.call('veh:refresh', [veh.id]);
	mp.players.forEachInRange(veh.position, 30, (p) => {
		if (p.id !== player.id) p.call('veh:refresh', [veh.id]);
	});
}

/* --------------------------------- Места в машине --------------------------------- */

mp.events.add('playerEnterVehicle', (player, vehicle, seat) => {
	const d = require('./stats').ensureData(player);
	d.seat = seat; // 0 = водитель
});

mp.events.add('playerExitVehicle', (player, vehicle, seat) => {
	const d = require('./stats').ensureData(player);
	d.seat = null;
	require('./inventory').refreshOpen(player);
});

function onPlayerQuit(player) {
	// место в машине сбрасывается автоматически вместе с data в stats
}

/* ---------------------------------- Сохранение ---------------------------------- */

function saveAll() {
	if (db.isMemoryOnly()) return;
	for (const rec of vehMap.values()) {
		const v = rec.veh;
		if (!v) continue;
		const fuel = Math.round(v.getVariable('fuel') || 0);
		const he = v.getVariable('hasEngine') ? 1 : 0;
		const hw = v.getVariable('hasWheels') ? 1 : 0;
		const storage = JSON.stringify(v.getVariable('storage') || []);

		if (rec.rowId) {
			db.query('UPDATE vehicles SET fuel=?, has_engine=?, has_wheels=?, storage=? WHERE id=?',
				[fuel, he, hw, storage, rec.rowId]).catch(() => {});
		} else {
			db.query(
				'INSERT INTO vehicles (model, pos_x, pos_y, pos_z, heading, fuel, has_engine, has_wheels, storage) VALUES (?,?,?,?,?,?,?,?,?)',
				[v.getVariable('model'), v.position.x, v.position.y, v.position.z, v.heading,
					fuel, he, hw, storage]
			).then(r => { rec.rowId = r.insertId; }).catch(() => {});
		}
	}
}

module.exports = {
	init, nearest, panelFor,
	storageAdd, storageRemove,
	installEngine, installWheels, refuel, startEngine, stopEngine,
	onPlayerQuit, saveAll
};
