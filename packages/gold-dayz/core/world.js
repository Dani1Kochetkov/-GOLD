'use strict';

/**
 * Мир: режимы «Медленные зомби / светлая ночь» и «Быстрые зомби / тёмная ночь»,
 * погода, время суток, рассылка режима клиентам.
 */

const config = require('../config');

let mode = config.world.defaultMode;

function apply() {
	const m = config.world.modes[mode];
	if (!m) return;
	mp.world.time.set(m.hour, m.minute, 0);
	mp.world.weather = m.weather;
	console.log(`[GOLD] Мировой режим: ${mode} (время ${m.hour}:${String(m.minute).padStart(2, '0')}, погода ${m.weather})`);
}

function pushMode(player) {
	player.call('world:mode', [mode]);
}

function broadcast() {
	mp.players.forEach(p => pushMode(p));
}

/* ---------------- Кастомная карта: заросший Лос-Сантос (mp.objects.new) ---------------- */
// Образцы зелени вдоль Грув-стрит. Для серьёзного маппинга положите YMAP/DLC в
// client_packages/game_resources/dlcpacks/<dlc_name>/ — RAGE подхватит его сам.
const overgrowth = [
	{ model: 'prop_bush_lrg_01', x: 74.2, y: -1940.5, z: 21.2 },
	{ model: 'prop_bush_lrg_01', x: 101.8, y: -1973.1, z: 21.1 },
	{ model: 'prop_bush_lrg_01', x: 60.5, y: -1957.6, z: 21.1 },
	{ model: 'prop_bush_lrg_01', x: 120.4, y: -1935.2, z: 20.9 },
	{ model: 'prop_bush_med_01', x: 89.9, y: -1950.0, z: 21.1 },
	{ model: 'prop_bush_med_01', x: 70.1, y: -1968.4, z: 21.2 }
];

function plantOvergrowth() {
	let ok = 0;
	for (const p of overgrowth) {
		try {
			mp.objects.new(mp.joaat(p.model), new mp.Vector3(p.x, p.y, p.z), {
				alpha: 255,
				dimension: 0,
				rotation: { x: 0, y: 0, z: Math.floor(Math.random() * 360) }
			});
			ok++;
		} catch (e) {
			console.log('[GOLD] проп не создан (проверьте модель):', p.model, e.message);
		}
	}
	console.log(`[GOLD] Заросли Лос-Сантоса расставлены: ${ok}/${overgrowth.length}`);
}

function init() {
	apply();
	plantOvergrowth();

	mp.events.addCommand('zmode', (player, args) => {
		const raw = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim().toLowerCase();
		if (raw !== 'slow' && raw !== 'fast') {
			if (player) player.outputChatBox('!{0,#ff5555}Использование: !{0,ffffff}/zmode slow|fast');
			return;
		}
		setMode(raw);
		const label = raw === 'slow'
			? 'Медленные зомби / светлая ночь'
			: 'Быстрые зомби / тёмная ночь';
		mp.players.broadcast(`!{0,#ff5555}[GOLD DAYZ] !{0,ffffff}Режим мира: !{0,#ffaa00}${label}`);
	});
}

function setMode(next) {
	if (next !== 'slow' && next !== 'fast') return;
	mode = next;
	apply();
	broadcast();
}

function getMode() { return mode; }
function isFast() { return mode === 'fast'; }

module.exports = { init, getMode, setMode, isFast, pushMode };
