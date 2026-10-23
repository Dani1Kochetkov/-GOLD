'use strict';

/**
 * Мини pub/sub внутри клиента: hud публикует статы, остальные модули слушают.
 */
const handlers = Object.create(null);

module.exports = {
	on(eventName, fn) {
		if (!handlers[eventName]) handlers[eventName] = [];
		handlers[eventName].push(fn);
	},
	emit(eventName, ...args) {
		(handlers[eventName] || []).forEach(fn => {
			try { fn(...args); } catch (e) { console.log('[GOLD bus]', eventName, e); }
		});
	}
};
