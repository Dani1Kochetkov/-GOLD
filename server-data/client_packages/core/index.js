'use strict';

/**
 * Example client script: greets the player once the world is ready and shows
 * how the server talks to the client.
 */

mp.events.add('playerReady', () => {
    mp.gui.chat.push('!{#FFD166}Welcome to GOLD.{/} Type !{#FFFFFF}/help{/} for commands.');
    mp.events.callRemote('gold:playerReady');
});

mp.events.add('gold:welcome', (playerName, serverName) => {
    mp.gui.chat.push(`!{#FFD166}${serverName}{/} — hello, ${playerName}.`);
    mp.gui.chat.push('Server-side scripts are running. Customise client_packages/core/index.js.');
});

mp.events.add('gold:notify', (text) => {
    mp.gui.chat.push(`!{#FF6B6B}${text}{/}`);
});

// Basic client-side guard: keep the chat line length sane for foreign events.
mp.events.add('gold:announce', (text) => {
    if (typeof text === 'string' && text.length <= 512) {
        mp.gui.chat.push(`!{#7BD389}[ANNOUNCE]{/} ${text}`);
    }
});
