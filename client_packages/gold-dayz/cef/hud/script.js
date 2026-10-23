'use strict';

/* GOLD DAYZ — CEF HUD скрипт: получает JSON статов от клиента и рисует столбец. */

const $ = (id) => document.getElementById(id);

const els = {
	root: $('stats'),
	night: $('night'),
	shock: $('shock'),
	flash: $('flash'),
	death: $('death'),
	blood: $('v-blood'), bloodBar: $('b-blood'), bloodStat: $('st-blood'),
	food: $('v-food'), foodBar: $('b-food'), foodStat: $('st-food'),
	water: $('v-water'), waterBar: $('b-water'), waterStat: $('st-water'),
	temp: $('v-temp'), tempBar: $('b-temp'), tempStat: $('st-temp'),
	noise: $('v-noise'), noiseBar: $('b-noise'), noiseStat: $('st-noise'),
	vis: $('v-vis'), visBar: $('b-vis'), visStat: $('st-vis'),
	bdBleed: $('bd-bleed'), bdFract: $('bd-fract'), bdShock: $('bd-shock'),
	vehchip: $('vehchip'),
	vcEngine: $('vc-engine'), vcWheels: $('vc-wheels'), vcFuel: $('vc-fuel')
};

let shown = false;

/* --------------------------- Цвет по проценту (MTA-тирность) --------------------------- */
function pctColor(p) {
	if (p > 60) return '#4caf50';
	if (p > 30) return '#ff9800';
	return '#f44336';
}

function setBar(barEl, statEl, pct) {
	pct = Math.max(0, Math.min(100, pct));
	barEl.style.width = pct + '%';
	barEl.style.backgroundColor = pctColor(pct);
	statEl.style.borderLeftColor = pctColor(pct);
}

/* ------------------------------ Температура: цвет ------------------------------ */
function tempColor(t) {
	if (t >= 41) return '#f44336';              // перегрев
	if (t > 37) {                                // 37..41 — норма/жар
		const g = 200 - (t - 37) * 40;
		return `rgb(80, ${Math.max(80, g)}, 60)`;
	}
	// <=37: от синего (холод) к зелёному (норма)
	const v = Math.min(255, Math.max(0, (37 - t) * 60));
	return `rgb(${Math.round(30 + v * 0.2)}, ${Math.round(160 - v * 0.4)}, 255)`;
}

/* -------------------------------- Главный рендер -------------------------------- */

function render(s) {
	if (!shown) {
		shown = true;
		els.root.classList.remove('hidden');
	}

	/* кровь ровно 12000 максимум */
	const blood = Math.max(0, Math.min(12000, s.blood | 0));
	els.blood.textContent = blood + ' / 12000';
	setBar(els.bloodBar, els.bloodStat, blood / 12000 * 100);

	els.food.textContent = s.food | 0;
	setBar(els.foodBar, els.foodStat, s.food);

	els.water.textContent = s.water | 0;
	setBar(els.waterBar, els.waterStat, s.water);

	const t = Number(s.temperature) || 36.6;
	els.temp.textContent = t.toFixed(1) + '°';
	const tPct = Math.max(0, Math.min(100, (t - 30) / 12 * 100));
	els.tempBar.style.width = tPct + '%';
	els.tempBar.style.backgroundColor = tempColor(t);
	els.tempStat.style.borderLeftColor = tempColor(t);

	els.noise.textContent = s.noise | 0;
	setBar(els.noiseBar, els.noiseStat, s.noise);

	els.vis.textContent = s.visibility | 0;
	setBar(els.visBar, els.visStat, s.visibility);

	/* бейджи состояний */
	els.bdBleed.classList.toggle('on', (s.bleeding | 0) > 0);
	if ((s.bleeding | 0) > 0) els.bdBleed.textContent = `🩸 КРОВОТЕЧЕНИЕ ×${s.bleeding | 0} — БИНТ`;
	els.bdFract.classList.toggle('on', !!s.fracture);
	els.bdShock.classList.toggle('on', (s.shock | 0) >= 60);

	/* ночь: лёгкая (slow) / тёмная (fast) */
	els.night.style.opacity = s.nightMode === 'fast' ? '0.42' : '0.10';

	/* шок — красная виньетка */
	els.shock.style.opacity = String(Math.min(0.75, (s.shock | 0) / 100));

	/* смерть */
	els.death.classList.toggle('hidden', s.alive !== false);

	/* чип машины */
	if (s.inVehicle) {
		els.vehchip.classList.remove('hidden');
		els.vcEngine.classList.toggle('off', !s.inVehicle.hasEngine || !s.inVehicle.started);
		els.vcWheels.classList.toggle('off', !s.inVehicle.hasWheels);
		els.vcFuel.textContent = Math.round(s.inVehicle.fuel) + ' л';
	} else {
		els.vehchip.classList.add('hidden');
	}
}

/* ---------------------- События от клиентского модуля hud.js ---------------------- */

mp.events.add('updateStats', (json) => {
	let s;
	try { s = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
	render(s);
});

mp.events.add('damageFlash', () => {
	els.flash.classList.remove('on');
	void els.flash.offsetWidth; // перезапуск CSS-анимации
	els.flash.classList.add('on');
});
