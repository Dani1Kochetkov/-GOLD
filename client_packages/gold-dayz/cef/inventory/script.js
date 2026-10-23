'use strict';

/* GOLD DAYZ — CEF инвентарь: левая панель (земля/багажник), правая (себе). */

const $ = (id) => document.getElementById(id);

const ui = {
	wrap: $('wrap'),
	close: $('btn-close'),
	tabGround: $('tab-ground'),
	tabVehicle: $('tab-vehicle'),
	leftList: $('left-list'),
	rightList: $('right-list'),
	weightGround: $('weight-ground'),
	weightSelf: $('w-text'),
	wFill: $('w-fill'),
	slots: $('slots'),
	charStats: $('char-stats'),
	vehActions: $('veh-actions')
};

let payload = null;
let tab = 'ground';

/* ------------------------------- Утилиты ------------------------------- */

function send(action, extra) {
	const data = Object.assign({ action }, extra || {});
	if (window.mp && mp.trigger) mp.trigger('ui:invAction', JSON.stringify(data));
}

function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
	}[c]));
}

const CAT_LABEL = {
	weapon: 'Оружие', ammo: 'Патроны', tool: 'Инструм.',
	medical: 'Медиц.', food: 'Еда', part: 'Детали'
};

/* --------------------------------- Рендер --------------------------------- */

function render(p) {
	payload = p;
	ui.wrap.classList.remove('hidden');

	if (!p.vehicle && tab === 'vehicle') tab = 'ground';
	ui.tabVehicle.disabled = !p.vehicle;
	ui.tabVehicle.classList.toggle('active', tab === 'vehicle');
	ui.tabGround.classList.toggle('active', tab === 'ground');

	renderCharStats(p);
	renderSelf(p.self);
	if (tab === 'vehicle') renderVehicleSide(p);
	else renderGroundSide(p);
}

function renderCharStats(p) {
	const s = p.self.stats || {};
	const parts = [
		`Кровь <b>${s.blood | 0}</b>/12000`,
		(s.bleeding | 0) > 0 ? `<span class="bad">🩸 ×${s.bleeding}</span>` : '🩸 нет',
		s.fracture ? '<span class="bad">🦴 перелом</span>' : '🦴 нога цела',
		`⚡ шок ${s.shock | 0}`
	];
	ui.charStats.innerHTML = parts.join('');
}

/* ------------------------------ Правая панель ------------------------------ */

function renderSelf(self) {
	const w = self.weight, max = self.maxWeight;
	ui.weightSelf.textContent = w + ' / ' + max + ' кг';
	const pct = Math.min(100, w / max * 100);
	ui.wFill.style.width = pct + '%';
	ui.wFill.style.backgroundColor = pct > 90 ? '#f44336' : (pct > 70 ? '#ff9800' : '#4caf50');

	// чипы слотов по категориям
	let chips = '';
	for (const cat of Object.keys(self.limits)) {
		const used = (self.slots && self.slots[cat]) || 0;
		const lim = self.limits[cat];
		chips += `<span class="chip ${used >= lim ? 'full' : ''}">${CAT_LABEL[cat] || cat} ${used}/${lim}</span>`;
	}
	chips += `<span class="chip ${self.equippedCount >= self.equipLimit ? 'full' : ''}">В РУКАХ ${self.equippedCount}/${self.equipLimit}</span>`;
	ui.slots.innerHTML = chips;

	if (!self.items.length) {
		ui.rightList.innerHTML = '<div class="empty">Пусто.<br>Ищите лут в зонах: военные базы, больницы, города.</div>';
		return;
	}

	ui.rightList.innerHTML = self.items.map(it => {
		const btns = [];
		if (it.use) btns.push(`<button class="btn" data-act="use" data-key="${esc(it.key)}">${it.use === 'equip' ? (it.equipped ? 'Снять' : 'Взять в руки') : 'Использовать'}</button>`);
		if (payload.vehicle) btns.push(`<button class="btn" data-act="toVehicle" data-key="${esc(it.key)}">→ Багажник</button>`);
		btns.push(`<button class="btn warn" data-act="drop" data-key="${esc(it.key)}">Выбросить</button>`);

		return `<div class="item">
			<div class="cat cat-${esc(it.cat)}"></div>
			<div class="info">
				<div class="nm">${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ''}</div>
				<div class="sub">${it.totalWeight} кг${it.equipped ? ' · <span class="eq">в руках</span>' : ''}</div>
			</div>
			${btns.join('')}
		</div>`;
	}).join('');
}

/* ------------------------------ Левая: земля ------------------------------ */

function renderGroundSide(p) {
	const list = p.ground || [];
	ui.weightGround.textContent = list.length
		? `Предметы рядом (до ${3.5} м): ${list.length} шт.`
		: 'Рядом на земле ничего нет.';
	ui.vehActions.classList.add('hidden');

	if (!list.length) {
		ui.leftList.innerHTML = '<div class="empty">Здесь пусто.<br>Лут ищите у военных, в больницах и городах.<br>Нажмите <b>E</b> возле машины — откроется багажник.</div>';
		return;
	}

	ui.leftList.innerHTML = list.map(g => `<div class="item">
		<div class="cat cat-${esc(g.cat)}"></div>
		<div class="info">
			<div class="nm">${esc(g.name)}${g.count > 1 ? ` ×${g.count}` : ''}</div>
			<div class="sub">${g.weight} кг · ${g.dist} м</div>
		</div>
		<button class="btn go" data-act="take" data-id="${g.id}">Взять</button>
	</div>`).join('');
}

/* ----------------------------- Левая: машина ----------------------------- */

function renderVehicleSide(p) {
	const v = p.vehicle;
	ui.weightGround.textContent = `${v.model} · слоты: ${v.storage.length}/${v.storageSlots}`;
	ui.vehActions.classList.remove('hidden');

	const eng = v.hasEngine
		? '<span class="ok">Двигатель ✓</span>' : '<span class="no">Двигатель ✗</span>';
	const whl = v.hasWheels
		? '<span class="ok">Колёса ✓</span>' : '<span class="no">Колёса ✗</span>';
	const fuel = v.fuel > 0
		? `<span class="ok">Бензин ${Math.round(v.fuel)} л</span>` : '<span class="no">Бак пуст</span>';

	ui.vehActions.innerHTML =
		`<div class="veh-status">${eng} &nbsp;|&nbsp; ${whl} &nbsp;|&nbsp; ${fuel} &nbsp;|&nbsp; ${v.started ? '<span class="ok">МОТОР РАБОТАЕТ</span>' : 'мотор заглушен'}</div>` +
		`<button class="btn" data-act="installEngine" ${v.hasEngine ? 'disabled' : ''}>Установить двигатель</button>` +
		`<button class="btn" data-act="installWheels" ${v.hasWheels ? 'disabled' : ''}>Установить колёса</button>` +
		`<button class="btn" data-act="refuel">Заправить (канистра)</button>` +
		(v.started
			? `<button class="btn warn" data-act="stopEngine">Заглушить</button>`
			: `<button class="btn go" data-act="startEngine">Завести</button>`);

	if (!v.storage.length) {
		ui.leftList.innerHTML = '<div class="empty">Багажник пуст.<br>Кладите предметы кнопкой «→ Багажник» справа.</div>';
		return;
	}

	ui.leftList.innerHTML = v.storage.map(it => `<div class="item">
		<div class="cat cat-${esc(it.cat)}"></div>
		<div class="info">
			<div class="nm">${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ''}</div>
			<div class="sub">${it.weight} кг</div>
		</div>
		<button class="btn go" data-act="fromVehicle" data-key="${esc(it.key)}">Забрать</button>
	</div>`).join('');
}

/* -------------------------------- События -------------------------------- */

// пришёл полный payload с клиента
mp.events.add('renderInventory', (json) => {
	let p;
	try { p = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return; }
	render(p);
});

// обновления вкладки машины после действий (payload приходит целиком)
function rerender() { if (payload) render(payload); }

ui.tabGround.addEventListener('click', () => { tab = 'ground'; rerender(); });
ui.tabVehicle.addEventListener('click', () => { if (payload && payload.vehicle) { tab = 'vehicle'; rerender(); } });
ui.close.addEventListener('click', () => send('close'));

// делегирование кнопок списков и действий машины
document.addEventListener('click', (ev) => {
	const btn = ev.target.closest('button[data-act]');
	if (!btn) return;
	const act = btn.getAttribute('data-act');
	const key = btn.getAttribute('data-key');
	const id = btn.getAttribute('data-id');

	if (act === 'take') send('take', { id: Number(id) });
	else if (act === 'use') send('use', { key });
	else if (act === 'drop') send('drop', { key });
	else if (act === 'toVehicle') send('toVehicle', { key });
	else if (act === 'fromVehicle') send('fromVehicle', { key });
	else send(act); // installEngine / installWheels / refuel / startEngine / stopEngine
});
