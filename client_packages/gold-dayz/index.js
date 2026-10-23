'use strict';

/**
 * Порядок загрузки клиентских модулей GOLD DAYZ.
 * Все require — от корня client_packages.
 */
require('./gold-dayz/core/bus.js');
require('./gold-dayz/core/world.js');
require('./gold-dayz/core/hud.js');
require('./gold-dayz/core/medical.js');
require('./gold-dayz/core/inventory.js');
require('./gold-dayz/core/vehicles.js');
require('./gold-dayz/core/zombies.js');

mp.gui.chat.push('GOLD DAYZ загружен. J — инвентарь, E — взять/машина.');
