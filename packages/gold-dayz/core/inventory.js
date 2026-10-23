'use strict';

/**
 * Инвентарь: стаки, вес (30 кг), слоты по категориям, использование предметов,
 * экипировка оружия, перемещение между землёй/багажником/себе.
 * Данные хранятся в stats-данных игрока: массив [{key, count}].
 */

const config = require('../config');
const items = config.inventory.items;

/* --------------------------------- Утилиты --------------------------------- */

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function getList(player) {
	const stats = require('./stats');
	return stats.ensureData(player).inv || (stats.ensureData(player).inv = []);
}

function getEquipped(player) {
	const stats = require('./stats');
	const d = stats.ensureData(player);
	return d.equipped || (d.equipped = []);
}

function itemDef(key) { return items[key]; }

function totalWeight(list) {
	let w = 0;
	for (const it of list) {
		const def = items[it.key];
		if (def) w += def.weight * it.count;
	}
	return Math.round(w * 100) / 100;
}

/** Слоты: 1 стак = 1 слот, считаем по категории. */
function slotUsage(list) {
	const use = { weapon: 0, ammo: 0, tool: 0, medical: 0, food: 0, part: 0 };
	for (const it of list) {
		const def = items[it.key];
		if (def && use[def.cat] !== undefined) use[def.cat] += 1;
	}
	return use;
}

function hasItem(list, key, count) {
	count = count || 1;
	const it = list.find(x => x.key === key);
	return !!it && it.count >= count;
}

/** Положить предмет. false — нет места (вес/слоты/стак). */
function addItem(player, key, count) {
	count = count || 1;
	const def = items[key];
	if (!def) return false;
	const list = getList(player);
	const inv = config.inventory;

	// слоты категории
	const use = slotUsage(list);
	const it0 = list.find(x => x.key === key);
	if (!it0 && inv.limits[def.cat] !== undefined && use[def.cat] >= inv.limits[def.cat]) {
		return false;
	}
	// вес
	const addWeight = def.weight * count;
	if (totalWeight(list) + addWeight > inv.maxWeight + 0.001) return false;

	const it = list.find(x => x.key === key);
	if (it) {
		if (it.count + count > def.stack) return false; // стак переполнен
		it.count += count;
	} else {
		list.push({ key, count });
	}
	return true;
}

function removeItem(player, key, count) {
	count = count || 1;
	const list = getList(player);
	const idx = list.findIndex(x => x.key === key);
	if (idx === -1 || list[idx].count < count) return false;
	list[idx].count -= count;
	if (list[idx].count <= 0) list.splice(idx, 1);
	// если оружие выкинули — снимаем экипировку
	if (items[key] && items[key].use === 'equip') unequip(player, key);
	return true;
}

/* ------------------------------ Экипировка оружия ------------------------------ */

function giveEquipped(player) {
	for (const key of getEquipped(player)) {
		const def = items[key];
		if (def && def.weapon) {
			player.giveWeapon(mp.joaat(def.weapon), def.ammo || 1);
		}
	}
}

function equip(player, key) {
	const def = items[key];
	if (!def || def.use !== 'equip') return false;
	const eq = getEquipped(player);
	if (eq.includes(key)) return true;
	if (eq.length >= config.inventory.equipLimit) {
		player.outputChatBox('!{0,#ff5555}[GOLD] Слишком много оружия в руках (лимит ' + config.inventory.equipLimit + ').');
		return false;
	}
	eq.push(key);
	player.giveWeapon(mp.joaat(def.weapon), def.ammo || 1);
	return true;
}

function unequip(player, key) {
	const eq = getEquipped(player);
	const idx = eq.indexOf(key);
	if (idx === -1) return false;
	eq.splice(idx, 1);
	const def = items[key];
	if (def && def.weapon) player.removeWeapon(mp.joaat(def.weapon));
	return true;
}

function onDeath(player) {
	const d = require('./stats').getData(player);
	if (!d) return;
	const eq = getEquipped(player);
	for (const key of eq.slice()) {
		const def = items[key];
		if (def && def.weapon) player.removeWeapon(mp.joaat(def.weapon));
	}
	d.equipped = [];
	d.inv = []; // весь лут уже дропнут в stats.kill()
}

/** Список предметов для дропа при смерти. */
function buildDropList(player) {
	const list = getList(player);
	return list.map(it => ({ key: it.key, count: it.count }));
}

/* ------------------------------- Использование ------------------------------- */

function useItem(player, key) {
	const stats = require('./stats');
	const def = items[key];
	if (!def || !hasItem(getList(player), key)) return false;
	const d = stats.ensureData(player);
	const s = d.stats;
	const S = config.survival;

	switch (def.use) {
		case 'bandage': {
			if (s.bleeding === 0) {
				player.outputChatBox('!{0,#aaaaaa}[GOLD] Кровотечения нет.');
				return false;
			}
			removeItem(player, key, 1);
			s.bleeding = 0;
			player.outputChatBox('!{0,#55ff55}[GOLD] Вы остановили кровотечение бинтом.');
			break;
		}
		case 'painkiller': {
			if (s.shock <= 0) {
				player.outputChatBox('!{0,#aaaaaa}[GOLD] Шока нет.');
				return false;
			}
			removeItem(player, key, 1);
			s.shock = Math.max(0, s.shock - 50);
			player.outputChatBox('!{0,#55ff55}[GOLD] Обезболивающее сняло шок (-50).');
			break;
		}
		case 'morphine': {
			if (!s.fracture) {
				player.outputChatBox('!{0,#aaaaaa}[GOLD] Перелома нет.');
				return false;
			}
			removeItem(player, key, 1);
			s.fracture = false;
			player.outputChatBox('!{0,#55ff55}[GOLD] Морфин введён. Нога вылечена — можно бегать.');
			player.call('medical:morphine', []); // клиент снимает режим ползания
			break;
		}
		case 'eat': {
			if (s.food >= S.FOOD_MAX) return false;
			removeItem(player, key, 1);
			s.food = clamp(s.food + (def.food || 30), 0, S.FOOD_MAX);
			player.outputChatBox('!{0,#55ff55}[GOLD] Вы съели: ' + def.name);
			break;
		}
		case 'drink': {
			if (s.water >= S.WATER_MAX) return false;
			removeItem(player, key, 1);
			s.water = clamp(s.water + (def.water || 30), 0, S.WATER_MAX);
			player.outputChatBox('!{0,#55ff55}[GOLD] Вы выпили: ' + def.name);
			break;
		}
		case 'equip': {
			if (!equip(player, key)) return false;
			player.outputChatBox('!{0,#ffaa00}[GOLD] Экипировано: ' + def.name + ' (снять — использовать предмет ещё раз)');
			break;
		}
		case 'ammo': {
			// докладываем патроны в любое экипированное оружие из списка def.for
			const eq = getEquipped(player);
			let loaded = false;
			for (const wk of eq) {
				const wdef = items[wk];
				if (wdef && wdef.weapon && def.for && def.for.includes(wdef.weapon)) {
					const hash = mp.joaat(wdef.weapon);
					const cur = player.getWeaponAmmo(hash) || 0;
					player.setWeaponAmmo(hash, cur + def.add);
					loaded = true;
					break;
				}
			}
			if (!loaded) {
				player.outputChatBox('!{0,#aaaaaa}[GOLD] Сначала экипируйте подходящее оружие.');
				return false;
			}
			removeItem(player, key, 1);
			player.outputChatBox('!{0,#55ff55}[GOLD] Патроны дозаряжены (+' + def.add + ').');
			break;
		}
		default:
			return false;
	}
	stats.push(player);
	refreshOpen(player);
	return true;
}

/* --------------------------------- Панель/сборка --------------------------------- */

function payload(player, tabHint) {
	const loot = require('./loot');
	const vehicles = require('./vehicles');
	const inv = config.inventory;
	const list = getList(player);

	return {
		tab: tabHint || 'ground',
		self: {
			items: list.map(it => {
				const def = items[it.key];
				return {
					key: it.key,
					name: def ? def.name : it.key,
					count: it.count,
					weight: def ? def.weight : 0,
					totalWeight: def ? Math.round(def.weight * it.count * 100) / 100 : 0,
					cat: def ? def.cat : 'tool',
					use: def && def.use ? def.use : null,
					equipped: getEquipped(player).includes(it.key)
				};
			}),
			weight: totalWeight(list),
			maxWeight: inv.maxWeight,
			limits: inv.limits,
			slots: slotUsage(list),
			equippedCount: getEquipped(player).length,
			equipLimit: inv.equipLimit,
			stats: {
				blood: Math.round(require('./stats').getData(player).stats.blood),
				bleeding: require('./stats').getData(player).stats.bleeding,
				fracture: require('./stats').getData(player).stats.fracture,
				shock: Math.round(require('./stats').getData(player).stats.shock)
			}
		},
		ground: loot.groundList(player),
		vehicle: vehicles.panelFor(player)
	};
}

const openMap = new Map(); // player.id -> tab (для авто-обновления панели)

function open(player, tab) {
	openMap.set(player.id, tab || 'ground');
	player.call('inv:open', [JSON.stringify(payload(player, tab || 'ground'))]);
}

function refreshOpen(player) {
	if (!openMap.has(player.id)) return;
	player.call('inv:open', [JSON.stringify(payload(player, openMap.get(player.id)))]);
}

function close(player) {
	openMap.delete(player.id);
}

/* --------------------------------- Действия из CEF --------------------------------- */

mp.events.add('inv:open', (player, tabHint) => {
	const tab = (tabHint === 'auto') ? detectTab(player) : (tabHint || 'ground');
	open(player, tab);
});

/** E: открываем с нужной вкладкой — машина рядом → багажник, иначе земля. */
function detectTab(player) {
	const vehicles = require('./vehicles');
	if (vehicles.nearest(player, config.vehicleConfig.panelDistance)) return 'vehicle';
	return 'ground';
}

mp.events.add('inv:action', (player, json) => {
	let data;
	try { data = JSON.parse(json); } catch (e) { return; }
	if (!data || !data.action) return;
	const loot = require('./loot');
	const vehicles = require('./vehicles');
	const stats = require('./stats');
	const list = getList(player);

	switch (data.action) {
		case 'close':
			close(player);
			break;

		case 'take': {
			const ground = loot.groundList(player);
			const entry = ground.find(g => g.id === data.id);
			if (!entry) return; // слишком далеко / уже взяли
			if (!addItem(player, entry.key, entry.count)) {
				player.outputChatBox('!{0,#ff5555}[GOLD] Нет места в инвентаре (вес/слоты).');
			} else {
				loot.take(player, entry.id);
			}
			break;
		}

		case 'drop': {
			const it = list.find(x => x.key === data.key);
			if (!it) return;
			const count = clamp(parseInt(data.count) || it.count, 1, it.count);
			if (removeItem(player, data.key, count)) {
				loot.spawnDrop(player.position, [{ key: data.key, count }]);
			}
			break;
		}

		case 'use':
			useItem(player, data.key);
			break;

		case 'toVehicle': {
			const veh = vehicles.nearest(player, config.vehicleConfig.panelDistance);
			if (!veh) return;
			const it = list.find(x => x.key === data.key);
			if (!it) return;
			const count = clamp(parseInt(data.count) || it.count, 1, it.count);
			if (vehicles.storageAdd(veh, data.key, count)) {
				removeItem(player, data.key, count);
				player.outputChatBox('!{0,#55ff55}[GOLD] В багажник: ' + (items[data.key] ? items[data.key].name : data.key));
			} else {
				player.outputChatBox('!{0,#ff5555}[GOLD] В багажнике нет места.');
			}
			break;
		}

		case 'fromVehicle': {
			const veh = vehicles.nearest(player, config.vehicleConfig.panelDistance);
			if (!veh) return;
			const storage = veh.getVariable('storage') || [];
			const it = storage.find(x => x.key === data.key);
			if (!it) return;
			const count = clamp(parseInt(data.count) || it.count, 1, it.count);
			if (addItem(player, data.key, count)) {
				vehicles.storageRemove(veh, data.key, count);
			} else {
				player.outputChatBox('!{0,#ff5555}[GOLD] Нет места в инвентаре.');
			}
			break;
		}

		/* --- Машинные действия (вкладка багажника) --- */
		case 'installEngine':
			vehicles.installEngine(player);
			break;
		case 'installWheels':
			vehicles.installWheels(player);
			break;
		case 'refuel':
			vehicles.refuel(player);
			break;
		case 'startEngine':
			vehicles.startEngine(player);
			break;
		case 'stopEngine':
			vehicles.stopEngine(player);
			break;

		default:
			break;
	}

	stats.push(player);
	refreshOpen(player);
});

module.exports = {
	getList, getEquipped, addItem, removeItem, hasItem,
	giveEquipped, onDeath, buildDropList,
	useItem, open, refreshOpen, close, payload
};
