'use strict';

/**
 * Машины (клиент): визуал «разбитой» машины (лопнутые колёса, мёртвый мотор),
 * принудительная блокировка двигателя без деталей/бензина.
 */

function burstTyres(v) {
	try {
		// 0,1 = передние; 4,5 = задние (стандартная раскладка колёс седанов)
		for (const idx of [0, 1, 4, 5]) {
			mp.game.vehicle.setTyreBurst(v.handle, idx, true, 1000.0);
		}
	} catch (e) {}
}

function fixTyres(v) {
	try {
		for (const idx of [0, 1, 4, 5]) {
			mp.game.invoke('0x6E13FC662B882D1D', v.handle, idx); // SET_VEHICLE_TYRE_FIXED
		}
	} catch (e) {}
}

function applyEngineState(v, hasEngine) {
	try {
		mp.game.vehicle.setEngineHealth(v.handle, hasEngine ? 1000.0 : -4000.0);
	} catch (e) {}
}

/** Синхронизированное состояние разбитости (переменные приходят со стрима). */
function applyBroken(v) {
	const hasWheels = v.getVariable('hasWheels');
	const hasEngine = v.getVariable('hasEngine');
	if (hasWheels === false) burstTyres(v);
	else if (hasWheels === true) fixTyres(v);
	if (hasEngine === false || hasEngine === true) applyEngineState(v, hasEngine === true);
}

mp.events.add('entityStreamIn', (entity) => {
	if (!entity || entity.type !== 'vehicle') return;
	applyBroken(entity);
	// переменные стримятся чуть позже объекта — перепроверяем
	setTimeout(() => { try { applyBroken(entity); } catch (e) {} }, 700);
	setTimeout(() => { try { applyBroken(entity); } catch (e) {} }, 2000);
});

mp.events.addDataHandler('hasWheels', (entity, value) => {
	if (!entity || entity.type !== 'vehicle') return;
	if (value === true) fixTyres(entity);
	else if (value === false) burstTyres(entity);
});

mp.events.addDataHandler('hasEngine', (entity, value) => {
	if (!entity || entity.type !== 'vehicle') return;
	applyEngineState(entity, value === true);
});

// сервер переслал состояние после установки деталей
mp.events.add('veh:refresh', (vehId) => {
	const v = mp.vehicles.atRemoteId(Number(vehId));
	if (v) applyBroken(v);
});

mp.events.add('veh:engineOff', () => {
	const v = mp.players.local.vehicle;
	if (v) mp.game.vehicle.setEngineOn(v.handle, false, true, true);
});

/* --------------------- Блокировка мотора без двигателя/бензина --------------------- */

mp.events.add('render', () => {
	const v = mp.players.local.vehicle;
	if (!v) return;
	const started = v.getVariable('engStarted');
	const fuel = v.getVariable('fuel');

	if (started === true && Number(fuel) > 0) {
		mp.game.vehicle.setEngineOn(v.handle, true, false, false);
	} else {
		// двигатель не заводится: детали не стоят или бак пуст
		mp.game.vehicle.setEngineOn(v.handle, false, true, true);
	}
});

module.exports = {};
