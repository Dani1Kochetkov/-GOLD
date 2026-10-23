'use strict';

/**
 * Лут: зоны (военные базы, больницы, города), спавн контейнеров (mp.objects.new)
 * с подписью (mp.labels.new), взятие по E/панели, респавн, дроп с убитых зомби.
 */

const config = require('../config');

let nextId = 1;
const lootMap = new Map(); // id -> { id, key, count, pos, zone, obj, label }

function rand(a, b) { return a + Math.random() * (b - a); }

function weightedPick(table) {
	let total = 0;
	for (const [, w] of table) total += w;
	let r = Math.random() * total;
	for (const [key, w] of table) {
		r -= w;
		if (r <= 0) return key;
	}
	return table[0][0];
}

/* --------------------------------- Создание --------------------------------- */

function spawnItem(pos, key, count, zone) {
	const def = config.inventory.items[key];
	if (!def) return null;
	const id = nextId++;
	const p = { x: pos.x, y: pos.y, z: pos.z };

	let obj = null;
	let label = null;
	try {
		obj = mp.objects.new(mp.joaat(config.lootConfig.lootModel), new mp.Vector3(p.x, p.y, p.z), {
			alpha: 255,
			dimension: 0,
			rotation: { x: 0, y: 0, z: rand(0, 360) }
		});
	} catch (e) {
		console.log('[GOLD] loot object error:', e.message);
	}
	try {
		label = mp.labels.new(`${def.name} ×${count}`, new mp.Vector3(p.x, p.y, p.z + 0.35), {
			color: { r: 255, g: 210, b: 90, a: 230 },
			dimension: 0,
			drawDistance: 18,
			font: 4,
			los: false
		});
	} catch (e) {
		console.log('[GOLD] loot label error:', e.message);
	}

	const entry = { id, key, count, pos: p, zone: zone || null, obj, label };
	lootMap.set(id, entry);
	return entry;
}

function spawnZoneItem(zone) {
	const table = config.lootTables[zone.table] || config.lootTables.city;
	const key = weightedPick(table);
	const angle = rand(0, Math.PI * 2);
	const dist = rand(2, zone.radius);
	const pos = {
		x: zone.center.x + Math.cos(angle) * dist,
		y: zone.center.y + Math.sin(angle) * dist,
		z: zone.center.z
	};
	spawnItem(pos, key, 1, zone.id);
}

function destroyEntry(entry) {
	if (!entry) return;
	try { if (entry.obj) entry.obj.destroy(); } catch (e) {}
	try { if (entry.label) entry.label.destroy(); } catch (e) {}
	lootMap.delete(entry.id);
}

/* --------------------------------- Дропы --------------------------------- */

/** Выбросить предметы на землю (смерть, /drop из инвентаря). */
function spawnDrop(pos, dropList) {
	const created = [];
	for (const item of dropList) {
		if (!config.inventory.items[item.key]) continue;
		// раскладываем по одному стаку рядом, чтобы было видно
		const p = {
			x: pos.x + rand(-0.8, 0.8),
			y: pos.y + rand(-0.8, 0.8),
			z: (pos.z !== undefined && pos.z !== null) ? pos.z : 20
		};
		const entry = spawnItem(p, item.key, item.count, null);
		if (entry) created.push(entry);
	}
	return created;
}

/** Лут с убитого зомби: шанс + случайный предмет из таблицы. */
function spawnZombieDrop(pos) {
	if (Math.random() > config.lootConfig.zombieDropChance) return;
	const table = config.lootTables.zombieDrop;
	const key = weightedPick(table);
	spawnItem({ x: pos.x, y: pos.y, z: pos.z }, key, 1, null);
}

/* --------------------------------- Запросы --------------------------------- */

/** Предметы рядом с игроком (для левой панели инвентаря). */
function groundList(player) {
	const out = [];
	const maxD = config.lootConfig.groundTakeDistance;
	for (const e of lootMap.values()) {
		const dx = e.pos.x - player.position.x;
		const dy = e.pos.y - player.position.y;
		const dz = e.pos.z - player.position.z;
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (d <= maxD) {
			const def = config.inventory.items[e.key];
			out.push({
				id: e.id,
				key: e.key,
				name: def ? def.name : e.key,
				count: e.count,
				weight: def ? def.weight : 0,
				cat: def ? def.cat : 'tool',
				dist: Math.round(d * 10) / 10
			});
		}
	}
	out.sort((a, b) => a.dist - b.dist);
	return out;
}

/** Взять предмет. Повторная проверка дистанции — анти-чит. */
function take(player, id) {
	const entry = lootMap.get(id);
	if (!entry) return false;
	const dx = entry.pos.x - player.position.x;
	const dy = entry.pos.y - player.position.y;
	const dz = entry.pos.z - player.position.z;
	const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
	if (d > config.lootConfig.groundTakeDistance + 1.0) return false;

	const zoneId = entry.zone;
	destroyEntry(entry);

	// возврат предмета в зону через respawnMs
	if (zoneId) {
		const zone = config.lootZones.find(z => z.id === zoneId);
		if (zone) {
			setTimeout(() => {
				if (lootMap.size < 400) spawnZoneItem(zone);
			}, config.lootConfig.respawnMs);
		}
	}
	return true;
}

/* --------------------------------- Инициализация --------------------------------- */

function init() {
	let total = 0;
	for (const zone of config.lootZones) {
		for (let i = 0; i < zone.count; i++) {
			spawnZoneItem(zone);
			total++;
		}
	}
	console.log(`[GOLD] Лут разложен: ${total} предметов в ${config.lootZones.length} зонах`);

	// периодический доброс в зоны, если лут весь выгребли
	setInterval(() => {
		for (const zone of config.lootZones) {
			let inZone = 0;
			for (const e of lootMap.values()) if (e.zone === zone.id) inZone++;
			if (inZone < zone.count) spawnZoneItem(zone);
		}
	}, 60 * 1000);
}

module.exports = { init, spawnItem, spawnDrop, spawnZombieDrop, groundList, take };
