'use strict';

/**
 * Зомби: серверный менеджер на mp.peds.new.
 *  - спавн только в стрим-зоне вокруг игрока (кольцо 45–130 м), лимит 25 на игрока;
 *  - два режима: 'slow' (медленные, светлая ночь) / 'fast' (бегают в темноте);
 *  - агро от шума бега и выстрелов (данные приходят с клиента);
 *  - «владелец»-клиент крутит ИИ (задачи/скорость), здесь — спавн, агро, укусы.
 */

const config = require('../config');
const world = require('./world');
const stats = require('./stats');

const zMap = new Map();   // server ped id -> { ped, ownerId, aggroId, attackAt, seq }
let pendingSpawns = new Map(); // seq -> { playerPos, x, y, baseZ, playerId }
let seqCounter = 1;
const attackCd = new Map();    // victim player id -> timestamp

function dist3(ax, ay, az, bx, by, bz) {
	const dx = ax - bx, dy = ay - by, dz = az - bz;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nearestPlayer(x, y, z, maxDist) {
	let best = null;
	let bestD = maxDist;
	mp.players.forEach(p => {
		if (p.dimension !== 0) return;
		const d = dist3(p.position.x, p.position.y, p.position.z, x, y, z);
		if (d < bestD) { bestD = d; best = p; }
	});
	return { player: best, dist: bestD };
}

/* ---------------------------------- Спавн ---------------------------------- */

function requestSpawn(player) {
	const angle = Math.random() * Math.PI * 2;
	const radius = config.zombies.spawnRadiusMin +
		Math.random() * (config.zombies.spawnRadiusMax - config.zombies.spawnRadiusMin);
	const x = player.position.x + Math.cos(angle) * radius;
	const y = player.position.y + Math.sin(angle) * radius;
	const seq = seqCounter++;
	pendingSpawns.set(seq, {
		playerId: player.id,
		baseZ: player.position.z,
		at: Date.now()
	});
	// клиент посчитает Z грунта формой-тестом и вернёт результат
	player.call('zombie:groundZ', [seq, x, y, player.position.z]);
	setTimeout(() => pendingSpawns.delete(seq), 5000);
}

mp.events.add('zombie:spawnResult', (player, seq, x, y, z) => {
	const req = pendingSpawns.get(Number(seq));
	if (!req) return;
	pendingSpawns.delete(Number(seq));
	if (req.playerId !== player.id) return; // это его запрос
	if (player.dimension !== 0) return;
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) z = req.baseZ;

	// Z из клиента: проверяем, что не улетел далеко от игрока (анти-чит/глюки рейкаста)
	if (dist3(player.position.x, player.position.y, player.position.z, x, y, z) > 220) {
		z = req.baseZ;
	}

	let ped = null;
	try {
		ped = mp.peds.new(mp.joaat(config.zombies.model), new mp.Vector3(x, y, z), {
			heading: Math.random() * 360,
			dimension: 0,
			dynamic: true,
			frozen: false,
			invincible: false
		});
	} catch (e) {
		console.log('[GOLD] zombie spawn error:', e.message);
		return;
	}
	if (!ped) {
		console.log('[GOLD] Не удалось заспавнить зомби, модель: ' + config.zombies.model);
		return;
	}

	ped.setVariable('isZombie', true);
	ped.setVariable('ownerId', player.id);
	ped.setVariable('speed', world.getMode());
	ped.setVariable('aggro', 0);
	try { ped.controller = player; } catch (e) {}

	zMap.set(ped.id, {
		ped,
		ownerId: player.id,
		aggroId: 0,
		attackAt: 0,
		spawn: { x, y, z }
	});
});

/* --------------------------------- Смерть --------------------------------- */

mp.events.add('zombie:died', (player, remoteId) => {
	const rec = zMap.get(Number(remoteId));
	if (!rec || !mp.peds.exists(rec.ped)) return;
	const pos = rec.ped.position;
	try { rec.ped.destroy(); } catch (e) {}
	zMap.delete(Number(remoteId));

	// дроп лута
	const loot = require('./loot');
	loot.spawnZombieDrop(pos);
});

/* ---------------------------------- Тик: спавн/деспавн/владелец ---------------------------------- */

function manageTick() {
	const Z = config.zombies;

	// 1) деспавн далёких + переназначение владельца
	for (const [id, rec] of Array.from(zMap.entries())) {
		if (!mp.peds.exists(rec.ped)) { zMap.delete(id); continue; }
		const near = nearestPlayer(rec.ped.position.x, rec.ped.position.y, rec.ped.position.z, Z.despawnRadius);
		if (!near.player) {
			try { rec.ped.destroy(); } catch (e) {}
			zMap.delete(id);
			continue;
		}
		if (rec.ownerId !== near.player.id) {
			rec.ownerId = near.player.id;
			rec.ped.setVariable('ownerId', near.player.id);
			rec.ped.setVariable('speed', world.getMode());
			try { rec.ped.controller = near.player; } catch (e) {}
		}
	}

	// 2) дозаспавн вокруг каждого игрока до лимита
	mp.players.forEach(player => {
		if (player.dimension !== 0) return;
		const d = stats.getData(player);
		if (!d || !d.stats.alive) return;

		let nearCount = 0;
		for (const rec of zMap.values()) {
			if (dist3(rec.ped.position.x, rec.ped.position.y, rec.ped.position.z,
				player.position.x, player.position.y, player.position.z) < Z.spawnRadiusMax + 20) nearCount++;
		}
		const deficit = Math.min(Z.maxPerPlayer - nearCount, Z.maxSpawnPerTick);
		for (let i = 0; i < deficit; i++) requestSpawn(player);
	});
}

/* ---------------------------------- Тик: агро/укусы ---------------------------------- */

function aiTick() {
	const Z = config.zombies;
	const fast = world.isFast();

	for (const rec of zMap.values()) {
		if (!mp.peds.exists(rec.ped)) continue;
		const owner = mp.players.at(rec.ownerId);
		if (!owner) continue;

		const pos = rec.ped.position;
		const near = nearestPlayer(pos.x, pos.y, pos.z, 200);
		const target = near.player;
		if (!target) { setAggro(rec, 0); continue; }

		const d = stats.getData(target);
		if (!d || !d.stats.alive) { setAggro(rec, 0); continue; }

		// радиус слуха: база режима + шум бега + пульс выстрела
		let hear = (fast ? Z.aggroBaseFast : Z.aggroBaseSlow) + d.noise * Z.aggroNoiseFactor;
		if (stats.shotHearing(target)) hear += Z.aggroShotPulse;
		hear = Math.min(hear, 120);

		if (near.dist <= hear) {
			setAggro(rec, target.id);
		} else if (near.dist > hear + 25) {
			setAggro(rec, 0);
		}

		// укус: агрессивная цель вплотную
		if (rec.aggroId) {
			const victim = mp.players.at(rec.aggroId);
			if (victim) {
				const vd = victim.position;
				const dd = dist3(pos.x, pos.y, pos.z, vd.x, vd.y, vd.z);
				const now = Date.now();
				const last = attackCd.get(victim.id) || 0;
				if (dd <= Z.attackRange && now - last >= config.survival.ZOMBIE_ATTACK_CD_MS) {
					attackCd.set(victim.id, now);
					stats.applyDamage(victim, config.survival.ZOMBIE_DAMAGE, { zombie: true });
				}
			} else {
				setAggro(rec, 0);
			}
		}
	}
}

function setAggro(rec, playerId) {
	if (rec.aggroId === playerId) return;
	rec.aggroId = playerId;
	try { rec.ped.setVariable('aggro', playerId || 0); } catch (e) {}
}

/* --------------------------------- Внешние хуки --------------------------------- */

function isNearZombie(player, radius) {
	for (const rec of zMap.values()) {
		if (!mp.peds.exists(rec.ped)) continue;
	 const pos = rec.ped.position;
		if (dist3(pos.x, pos.y, pos.z, player.position.x, player.position.y, player.position.z) <= radius) {
			return true;
		}
	}
	return false;
}

function onPlayerQuit(player) {
	// ближайший игрок станет владельцем уже на следующем manage-тике
	for (const rec of zMap.values()) {
		if (rec.ownerId === player.id) rec.ownerId = -1;
	}
	attackCd.delete(player.id);
	pendingSpawns.forEach((req, seq) => { if (req.playerId === player.id) pendingSpawns.delete(seq); });
}

function init() {
	setInterval(manageTick, config.zombies.manageIntervalMs);
	setInterval(aiTick, config.zombies.aiIntervalMs);
	setTimeout(manageTick, 2000);
	console.log(`[GOLD] Зомби-менеджер запущен: модель ${config.zombies.model}, лимит ${config.zombies.maxPerPlayer}/игрок`);
}

module.exports = { init, isNearZombie, onPlayerQuit };
