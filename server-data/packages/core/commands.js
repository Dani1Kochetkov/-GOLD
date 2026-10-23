'use strict';

/**
 * Example server-side commands. Copy the pattern for your own commands.
 * Everything here is intentionally harmless: no economy, no admin rights.
 */

const settings = require('./settings');
const { safeCommand, toNumber, currentVehicle } = require('./utils');

safeCommand('help', (player) => {
    player.outputChatBox('!{#FFD166}Available commands');
    player.outputChatBox('!{#FFFFFF}/pos{/} — your coordinates');
    player.outputChatBox('!{#FFFFFF}/players{/} — who is online');
    player.outputChatBox('!{#FFFFFF}/veh <model>{/} — spawn a vehicle (e.g. /veh sultan)');
    player.outputChatBox('!{#FFFFFF}/tp <x> <y> <z>{/} — teleport');
    player.outputChatBox('!{#FFFFFF}/heal{/} — restore health of player and vehicle');
});

safeCommand('pos', (player) => {
    const { x, y, z } = player.position;
    player.outputChatBox(`Position: ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
});

safeCommand('players', (player) => {
    const names = mp.players.toArray().map((p) => `${p.name} (${p.id})`).join(', ');
    player.outputChatBox(`Online (${mp.players.length}): ${names || 'nobody'}`);
});

safeCommand('veh', (player, modelName) => {
    if (!modelName) {
        player.outputChatBox('Usage: /veh <model>, e.g. /veh sultan');
        return;
    }

    const vehicle = mp.vehicles.new(mp.joaat(modelName.toLowerCase()), player.position, {
        heading: player.heading,
        numberPlate: 'GOLD'
    });
    vehicle.setVariable('gold:temp', true);

    // Put the player behind the wheel only if the vehicle actually spawned.
    setTimeout(() => {
        if (mp.vehicles.exists(vehicle) && mp.players.exists(player)) {
            player.putIntoVehicle(vehicle, 0);
        }
    }, 250);
});

safeCommand('tp', (player, x, y, z) => {
    const coords = [x, y, z].map(toNumber);
    if (coords.some((value) => value === null)) {
        player.outputChatBox('Usage: /tp <x> <y> <z>');
        return;
    }
    const [px, py, pz] = coords;
    player.position = new mp.Vector3(px, py, pz + 1);
});

safeCommand('heal', (player) => {
    player.health = 100;
    const vehicle = currentVehicle(player);
    if (vehicle) {
        vehicle.repair();
    }
    player.outputChatBox('!{#7BD389}Healed.{/}');
});

// Keep the spawn point reachable from a single command as well.
safeCommand('spawn', (player) => {
    player.spawn(new mp.Vector3(settings.spawn.x, settings.spawn.y, settings.spawn.z));
    player.heading = settings.spawn.heading;
});
