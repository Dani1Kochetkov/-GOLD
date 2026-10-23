'use strict';

/**
 * Example freeroam game mode.
 *
 * Purpose: prove the pipeline works (server -> client events, chat, commands)
 * and give a sane starting point instead of an empty folder. Replace or extend
 * it with your own roleplay/custom mode.
 */

const settings = require('./settings');
const utils = require('./utils');

mp.events.add('playerJoin', (player) => {
    utils.log(`${player.name} connected (${player.ip})`);
    mp.players.broadcast(`!{#FFD166}${player.name}{/} joined the server`);
    mp.players.broadcast(`Players online: ${mp.players.length}/${settings.maxPlayers()}`);
});

mp.events.add('playerQuit', (player) => {
    utils.log(`${player.name} disconnected`);
});

// Sent by the client script once the CEF/game world is ready.
mp.events.add('gold:playerReady', (player) => {
    if (player.getVariable('gold:spawned')) {
        return;
    }
    player.setVariable('gold:spawned', true);

    player.spawn(new mp.Vector3(settings.spawn.x, settings.spawn.y, settings.spawn.z));
    player.heading = settings.spawn.heading;
    player.call('gold:welcome', [player.name, settings.serverName]);
});

mp.events.add('playerDeath', (player, reason, killer) => {
    const by = killer && killer.type === 'player' ? killer.name : 'the world';
    player.call('gold:notify', [`You died (${by}). Respawning in 3s...`]);
    setTimeout(() => {
        if (mp.players.exists(player)) {
            player.spawn(new mp.Vector3(settings.spawn.x, settings.spawn.y, settings.spawn.z));
            player.health = 100;
        }
    }, 3000);
});

require('./commands');
