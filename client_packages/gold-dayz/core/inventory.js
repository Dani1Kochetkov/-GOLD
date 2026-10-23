'use strict';

/**
 * Инвентарь (клиент): клавиша J — открыть/закрыть, E — авто-вкладка
 * (машина рядом → багажник, иначе земля), ESC — закрыть.
 * Панели рисуют CEF; действия приходят сюда через mp.trigger('ui:invAction').
 */

const bus = require('./gold-dayz/core/bus.js');

let invBrowser = null;
let invReady = false;
let pendingPayload = null;
let open = false;
let alive = true;

const KEY_J = 0x4A;
const KEY_E = 0x45;
const KEY_ESC = 0x1B;

bus.on('stats', (s) => {
	alive = s.alive !== false;
	if (!alive && open) closeUI();
});

function createBrowser() {
	if (invBrowser) return;
	invBrowser = mp.browsers.new('package://gold-dayz/cef/inventory/index.html');
}

function showUI(json) {
	createBrowser();
	if (invReady && invBrowser) {
		invBrowser.call('renderInventory', json);
	} else {
		pendingPayload = json;
	}
	open = true;
	mp.gui.cursor.show(true, true);
	mp.gui.chat.activate(false);
}

function closeUI() {
	if (!open) return;
	open = false;
	pendingPayload = null;
	mp.gui.cursor.show(false, false);
	mp.gui.chat.activate(true);
	try { mp.events.callRemote('inv:action', JSON.stringify({ action: 'close' })); } catch (e) {}
}

function requestOpen(tab) {
	if (open || !alive) return;
	try { mp.events.callRemote('inv:open', tab); } catch (e) {}
}

/* --------------------------------- События --------------------------------- */

mp.events.add('playerSpawn', () => {
	createBrowser(); // браузер переживает респавн: ready-флаг НЕ сбрасываем
	if (open) {
		open = false;
		mp.gui.cursor.show(false, false);
		mp.gui.chat.activate(true);
	}
});

mp.events.add('browserDomReady', (browser) => {
	if (browser !== invBrowser) return;
	invReady = true;
	if (pendingPayload !== null && invBrowser) {
		invBrowser.call('renderInventory', pendingPayload);
		pendingPayload = null;
	}
});

// сервер прислал/обновил содержимое панелей
mp.events.add('inv:open', (json) => {
	showUI(json);
});

// действия из CEF: take/drop/use/toVehicle/fromVehicle/установки/завод
mp.events.add('ui:invAction', (json) => {
	let data;
	try { data = JSON.parse(json); } catch (e) { return; }
	if (!data) return;
	if (data.action === 'close') { closeUI(); return; }
	try { mp.events.callRemote('inv:action', json); } catch (e) {}
});

/* ---------------------------------- Клавиши ---------------------------------- */

mp.keys.bind(KEY_J, true, () => {
	if (open) closeUI();
	else requestOpen('ground');
});

mp.keys.bind(KEY_E, true, () => {
	if (open) return;
	requestOpen('auto');
});

mp.keys.bind(KEY_ESC, true, () => {
	if (open) closeUI();
});

module.exports = {};
