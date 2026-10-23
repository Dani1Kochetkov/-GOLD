'use strict';

/**
 * GOLD DAYZ — корневой загрузчик клиентских модулей.
 *
 * Все require выполняются ТОЛЬКО из этого корневого файла:
 * для корневого index.js путь «от корня client_packages» и путь «от файла»
 * совпадают, поэтому загрузка не зависит от трактовки путей в версии RAGE MP.
 * Модули общаются через шину mp.__goldBus — вложенных require нет.
 */

// Внутренняя шина событий клиента (замена core/bus.js)
mp.__goldBus = (function () {
	const handlers = Object.create(null);
	return {
		on(eventName, fn) {
			if (!handlers[eventName]) handlers[eventName] = [];
			handlers[eventName].push(fn);
		},
		emit(eventName) {
			const args = Array.prototype.slice.call(arguments, 1);
			(handlers[eventName] || []).forEach(fn => {
				try { fn.apply(null, args); }
				catch (e) { console.log('[GOLD bus] ' + eventName, e); }
			});
		}
	};
})();

function loadModule(fileName) {
	try {
		require('./gold-dayz/core/' + fileName + '.js');
		return true;
	} catch (e) {
		const msg = 'Ошибка клиент-модуля ' + fileName + ': ' + (e && e.message ? e.message : e);
		console.log('[GOLD] ' + msg);
		try { mp.gui.chat.push('[GOLD] ' + msg); } catch (e2) {}
		return false;
	}
}

// Порядок важен: world → hud (владеет статами) → medical/inventory (слушают шину)
['world', 'hud', 'medical', 'inventory', 'vehicles', 'zombies'].forEach(loadModule);

try {
	mp.gui.chat.push('GOLD DAYZ загружен. J — инвентарь, E — взять/машина. T — чат (/register).');
} catch (e) {}
