'use strict';

/** Small shared helpers. */

function log(message) {
    console.log(`[gold] ${message}`);
}

function warn(message) {
    console.warn(`[gold] ${message}`);
}

/**
 * Wraps a command handler so a thrown error cannot take the whole server down
 * and always answers the player with something readable.
 */
function safeCommand(name, handler) {
    mp.events.addCommand(name, (player, ...args) => {
        try {
            handler(player, ...args);
        } catch (error) {
            warn(`command /${name} failed: ${error && error.stack ? error.stack : error}`);
            player.outputChatBox(`!{#FF6B6B}/${name} failed:{/} ${error.message || 'unknown error'}`);
        }
    });
}

/** Parses a finite number or returns null. */
function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Returns the vehicle a player is currently in, or null. */
function currentVehicle(player) {
    return player.vehicle || null;
}

module.exports = { log, warn, safeCommand, toNumber, currentVehicle };
