'use strict';

/**
 * Game mode settings. Keep tunables here instead of scattering magic numbers
 * across modules. Server identity (name, port, max players) still lives in
 * .env -> conf.json; these values are read from there when available.
 */

const config = {
    get serverName() {
        try {
            // RAGE:MP exposes the parsed conf.json as mp.config in recent builds.
            return (mp.config && mp.config.name) || 'GOLD';
        } catch (error) {
            return 'GOLD';
        }
    },
    maxPlayers() {
        try {
            return (mp.config && mp.config.maxplayers) || 32;
        } catch (error) {
            return 32;
        }
    },
    spawn: {
        x: -269.4,
        y: -955.9,
        z: 31.2,
        heading: 205.0
    },
    // Vehicle spawn appears in front of the player at this offset (metres).
    vehicleSpawnDistance: 3.5
};

module.exports = config;
