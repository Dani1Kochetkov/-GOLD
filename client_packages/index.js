'use strict';

// Единственный файл, который RAGE:MP грузит автоматически.
// Всё остальное лежит в client_packages/gold/ и собирается командой: npm run build
require('./gold/goldclient.js');
