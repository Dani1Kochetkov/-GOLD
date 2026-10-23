'use strict';

/**
 * HUD: CEF-браузер с классическим столбцом иконок справа
 * (Кровь 12000 / Еда / Вода / Температура / Шум / Видимость)
 * + чёрно-белый эффект экрана при низкой крови (timecycle 'blackNwhite').
 */

const bus = mp.__goldBus;

let hudBrowser = null;
let hudReady = false;
let pendingStats = null;
let lastBlood = 12000;

function createBrowser() {
	if (hudBrowser) return;
	hudBrowser = mp.browsers.new('package://gold-dayz/cef/hud/index.html');
}

mp.events.add('playerSpawn', () => {
	createBrowser(); // браузер переживает респавн — ready-флаг НЕ сбрасываем
	lastBlood = 12000;
	clearDesat();
	// DayZ-атмосфера: без ников над головами
	mp.nametags.enabled = false;
	mp.game.ui.displayRadar(false);
});

mp.events.add('browserDomReady', (browser) => {
	if (browser !== hudBrowser) return;
	hudReady = true;
	if (pendingStats !== null) {
		hudBrowser.call('updateStats', pendingStats);
		pendingStats = null;
	}
});

/* ---------------------- Чёрно-белый экран при потере крови ---------------------- */

const BLOOD_BW_START = 4000; // ниже — начинает уходить цвет
let desatActive = false;

function clearDesat() {
	try { mp.game.graphics.clearTimecycleModifier(); } catch (e) {}
	desatActive = false;
}

function applyDesat(stats) {
	try {
		if (!stats.alive) {
			if (!desatActive) {
				mp.game.graphics.setTimecycleModifier('blackNwhite');
				desatActive = true;
			}
			mp.game.graphics.setTimecycleModifierStrength(1.0);
			return;
		}
		if (stats.blood < BLOOD_BW_START) {
			const k = 1 - stats.blood / BLOOD_BW_START;       // 0..1
			if (!desatActive) {
				// мягкий вход в ч/б, дальше только крутим силу — без рестарта перехода
				mp.game.graphics.setTransitionTimecycleModifier('blackNwhite', 0.6);
				desatActive = true;
			}
			mp.game.graphics.setTimecycleModifierStrength(Math.min(1, k * 0.9));
		} else if (desatActive) {
			clearDesat();
		}
	} catch (e) {}
}

/* -------------------------------- Приём статов -------------------------------- */

mp.events.add('hud:stats', (json) => {
	let stats;
	try { stats = JSON.parse(json); } catch (e) { return; }

	// вспышка при резкой потере крови (красный оверлей отрисует CEF)
	if (lastBlood - stats.blood > 25 && stats.alive) {
		if (hudReady && hudBrowser) hudBrowser.call('damageFlash');
	}
	lastBlood = stats.blood;

	applyDesat(stats);
	bus.emit('stats', stats); // medical/vehicles/inventory слушают отсюда

	if (hudReady && hudBrowser) {
		hudBrowser.call('updateStats', json);
	} else {
		pendingStats = json;
	}
});

module.exports = {};
