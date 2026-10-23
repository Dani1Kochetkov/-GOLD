'use strict';

/**
 * Зомби (клиент):
 *  - server просит посчитать Z грунта (zombie:groundZ) → отвечаем zombie:spawnResult;
 *  - «владелец» зомби (ownerId == мой серверный id) крутит ИИ: бродяжничество /
 *    преследование (combatPed / taskFollowNavMeshToCoord);
 *  - в тёмной ночи ('fast') владельцы крутят SET_PED_MOVE_RATE_OVERRIDE — зомби бегут;
 *  - смерть зомби репортим серверу (zombie:died).
 */

let nightMode = 'slow';
mp.events.add('world:mode', (mode) => { nightMode = mode === 'fast' ? 'fast' : 'slow'; });

function isZombie(e) {
	return e && e.type === 'ped' && e.getVariable && e.getVariable('isZombie') === true;
}

function myId() { return mp.players.local.remoteId; }

/* ------------------------- Z грунта для спавна (шейп-тест) ------------------------- */

mp.events.add('zombie:groundZ', (seq, x, y, baseZ) => {
	let z = baseZ;
	try {
		const handle = mp.game.shapetest.startShapeTestLosProbe(
			x, y, baseZ + 100, x, y, baseZ - 300,
			1 /* World */, 0, 0
		);
		// результат асинхронный — ждём до 1 сек, иначе fallback на Z игрока
		mp.game.shapetest.waitForCompletionAsync(handle, 1000).then(() => {
			const res = mp.game.shapetest.getShapeTestResult(handle);
			if (res && res.hit && res.endCoords) z = res.endCoords.z;
			mp.events.callRemote('zombie:spawnResult', Number(seq), x, y, z);
		}).catch(() => {
			mp.events.callRemote('zombie:spawnResult', Number(seq), x, y, baseZ);
		});
	} catch (e) {
		mp.events.callRemote('zombie:spawnResult', Number(seq), x, y, baseZ);
	}
});

/* --------------------------------- Появление --------------------------------- */

mp.events.add('entityStreamIn', (entity) => {
	if (!isZombie(entity)) return;
	try {
		// зомби не паникуют от выстрелов рядом и не разбегаются
		mp.game.ped.setBlockingOfNonTemporaryEvents(entity.handle, true);
	} catch (e) {}
	// подстраховка: переменные могли прийти чуть позже
	setTimeout(() => {
		try { if (isZombie(entity)) mp.game.ped.setBlockingOfNonTemporaryEvents(entity.handle, true); }
		catch (e) {}
	}, 800);
});

/* ---------------------------------- Тик ИИ ---------------------------------- */

const lastTaskAt = new Map();  // ped remoteId -> timestamp
const owned = [];              // кэш моих зомби для render-скорости

function dist(a, b) {
	const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function aiTick() {
	owned.length = 0;
	const me = myId();
	const now = Date.now();

	mp.peds.forEach((ped) => {
		if (!isZombie(ped)) return;

		// смерть: любой клиент, где зомби стримится, следит за здоровьем
		try {
			if (mp.game.entity.isDead(ped.handle, false)) {
				mp.events.callRemote('zombie:died', ped.remoteId);
				return;
			}
		} catch (e) {}

		const ownerId = ped.getVariable('ownerId');
		if (ownerId === me) owned.push(ped);
		else return;

		const last = lastTaskAt.get(ped.remoteId) || 0;
		const aggroId = ped.getVariable('aggro');

		if (aggroId) {
			const target = mp.players.atRemoteId(Number(aggroId));
			if (!target) return;
			const d = dist(ped.position, target.position);
			// целимся/идём за жертвой; перезаходим задачу каждые 2.5 с
			if (now - last > 2500) {
				lastTaskAt.set(ped.remoteId, now);
				if (d < 2.8) {
					mp.game.task.combatPed(ped.handle, target.handle, 0, 16);
				} else {
					mp.game.task.taskFollowNavMeshToCoord(
						ped.handle,
						target.position.x, target.position.y, target.position.z,
						1.0,   // speed (реальная скорость задаёт move-rate override)
						-1,    // timeout
						0.5,   // stoppingRange
						true,  // persistFollowing
						1
					);
				}
			}
		} else if (now - last > 12000) {
			// без цели — бродим вокруг точки спавна
			lastTaskAt.set(ped.remoteId, now);
			const sp = ped.position;
			try { mp.game.task.taskWanderStandard(ped.handle, 10.0, 10); } catch (e) {}
		}
	});
}

let aiStarted = false;
mp.events.add('playerSpawn', () => {
	if (aiStarted) return;
	aiStarted = true;
	setInterval(aiTick, 1000);
	setTimeout(aiTick, 1500);
});

/* ---------------------- Скорость зомби (кадровый натив) ---------------------- */

mp.events.add('render', () => {
	const fast = nightMode === 'fast';
	const rate = fast ? 1.65 : 0.6;
	for (const ped of owned) {
		try {
			mp.game.invoke('0x085BF80FA50A39D1', ped.handle, rate); // SET_PED_MOVE_RATE_OVERRIDE
		} catch (e) {}
	}
});

/* ------------------- Шум: бег/выстрелы ради агро зомби ------------------- */

let noise = 0;
let shotPulseAt = 0;

mp.events.add('playerWeaponShot', (targetPosition, targetEntity) => {
	noise = 100;
	shotPulseAt = Date.now();
	try { mp.events.callRemote('noise:shot'); } catch (e) {}
});

setInterval(() => {
	const me = mp.players.local;
	let gain = -15; // рассасывается
	try {
		if (me.isSprinting && me.isSprinting()) gain = 28;
		else if (mp.game.invoke('0xDE4C184B2B9B071A', me.handle)) gain = 8; // IS_PED_WALKING
	} catch (e) {}
	if (Date.now() - shotPulseAt < 8000) gain = Math.max(gain, 40);
	noise = Math.max(0, Math.min(100, noise + gain));

	// видимость: поза + ночь (чисто для HUD-шкалы)
	let visibility = 70;
	try {
		const prone = mp.game.invoke('0xD6A86331A537A7B9', me.handle); // IS_PED_PRONE
		const ducking = mp.game.invoke('0xD125AE748725C6BC', me.handle); // IS_PED_DUCKING
		if (prone) visibility = 15;
		else if (ducking) visibility = 40;
	} catch (e) {}
	try {
		const hour = mp.game.clock.getHours();
		if (hour >= 21 || hour < 6) visibility -= 18;
	} catch (e) {}
	visibility = Math.max(0, Math.min(100, visibility));

	try { mp.events.callRemote('hud:clientStats', noise, visibility); } catch (e) {}
}, 1000);

module.exports = {};
