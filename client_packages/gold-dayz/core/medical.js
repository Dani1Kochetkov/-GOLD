'use strict';

/**
 * Медицина (клиент):
 *  - перелом → запрет бега/прыжка + ПОЛЗАНИЕ (move_crawl), пока не вколят морфин;
 *  - морфин снимает режим (событие с сервера).
 */

const bus = mp.__goldBus;

let fracture = false;
let alive = true;

bus.on('stats', (s) => {
	fracture = !!s.fracture;
	alive = s.alive !== false;
	if (!fracture) stopCrawlAnim();
});

mp.events.add('medical:morphine', () => {
	fracture = false;
	stopCrawlAnim();
	mp.gui.chat.push('Морфин: нога вылечена.');
});

/* ------------------------------ Ползание при переломе ------------------------------ */

const CRAWL_DICT = 'move_crawl';
const CRAWL_CLIPS = ['onfront_fwd', 'onfront_bwd', 'onback_fwd', 'onback_bwd'];
// контролы, которые отключаем: 21 спринт, 22 прыжок, 30/31 оси, 32-35 стрейф
const DISABLED = [21, 22, 30, 31, 32, 33, 34, 35, 266, 267, 268, 269];

let crawlClipIndex = 0;
let crawlClipChangedAt = 0;
let crawlingActive = false;
let lastFrameAt = Date.now();

function local() { return mp.players.local; }

function stopCrawlAnim() {
	if (!crawlingActive) return;
	crawlingActive = false;
	crawlClipIndex = 0;
	try { local().clearTasks(); } catch (e) {}
}

function isPlayingCrawl() {
	try {
		return mp.game.invoke('0x1F0B79228E461EC9', // IS_ENTITY_PLAYING_ANIM
			local().handle, CRAWL_DICT, CRAWL_CLIPS[crawlClipIndex], 3);
	} catch (e) { return false; }
}

function ensureCrawlAnim(now) {
	if (!mp.game.streaming.hasAnimDictLoaded(CRAWL_DICT)) {
		mp.game.streaming.requestAnimDict(CRAWL_DICT);
		return;
	}
	if (isPlayingCrawl()) return;
	// каждый 1.5 сек пробуем следующий клип — если словарь не содержит текущий
	if (now - crawlClipChangedAt > 1500) {
		crawlClipChangedAt = now;
		crawlClipIndex = (crawlClipIndex + 1) % CRAWL_CLIPS.length;
	}
	try {
		mp.game.task.taskPlayAnim(local().handle, CRAWL_DICT, CRAWL_CLIPS[crawlClipIndex],
			8.0, -8.0, -1, 1 /* loop */, 0.0, false, false, false);
		crawlingActive = true;
	} catch (e) {}
}

function moveWhileCrawling(dt) {
	const controls = mp.game.controls;
	// выключенными нормалями читаем «зажатые» оси движения
	const strafe = controls.getDisabledControlNormal(0, 30);  // A/D
	const fwd = controls.getDisabledControlNormal(0, 31);     // W/S

	if (Math.abs(fwd) < 0.05 && Math.abs(strafe) < 0.05) return;

	const rot = mp.game.cam.getGameplayCamRot(2);
	const yaw = rot.z * Math.PI / 180;
	const fx = -Math.sin(yaw), fy = Math.cos(yaw);   // вперёд по камере
	const rx = Math.cos(yaw), ry = Math.sin(yaw);    // вправо по камере

	const speed = 0.85; // м/с — только ползком
	const p = local().position;
	const nx = p.x + (fx * fwd + rx * -strafe) * speed * dt;
	const ny = p.y + (fy * fwd + ry * -strafe) * speed * dt;
	local().position = new mp.Vector3(nx, ny, p.z);
}

/* --------------------------------- Render цикл --------------------------------- */

mp.events.add('render', () => {
	const now = Date.now();
	const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
	lastFrameAt = now;

	// пока мёртв — руками не управляем
	if (!alive) {
		mp.game.controls.disableAllControlActions(0);
		return;
	}

	if (!fracture) return;

	const controls = mp.game.controls;
	for (const c of DISABLED) controls.disableControlAction(0, c, true);

	ensureCrawlAnim(now);
	moveWhileCrawling(dt);
});

module.exports = {};
