'use strict';

/**
 * Server-side entry point.
 *
 * RAGE:MP loads this file when the server starts. Every game mode module is
 * pulled in from here, so this is the only place that decides what runs.
 *
 * Folder layout (all inside server-data/packages):
 *   index.js      this file
 *   core/         example freeroam game mode
 *   <your-mod>/   add your own module and require('./<your-mod>') below
 */

require('./core');
