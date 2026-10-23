'use strict';

/**
 * Апокалипсис: убираем трафик, пешеходов-GTA, миникарту GTA.
 * + образцы «заросшего Лос-Сантоса» (ваша кастомная карта подключается так же).
 */

let nightMode = 'slow';

/* ---------------------- Персистентное уничтожение популяции ---------------------- */

mp.events.add('render', () => {
	// пешёбный трафик и сценарные NPC → 0
	mp.game.peds.setPedDensityMultiplierThisFrame(0);
	mp.game.vehicle.setVehicleDensityMultiplierThisFrame(0);
	mp.game.vehicle.setParkedVehicleDensityMultiplierThisFrame(0);
	mp.game.vehicle.setRandomVehicleDensityMultiplierThisFrame(0);

	// жёсткие лимиты бюджета популяции (нативы, дублируют мультаплайеры)
	mp.game.invoke('0x8C95333CFC3340F3', 0); // SET_PED_POPULATION_BUDGET  = 0
	mp.game.invoke('0xCB9E1EB3BE2AF4E9', 0); // SET_VEHICLE_POPULATION_BUDGET = 0
	mp.game.invoke('0x34AD89078831A4BC', false); // SET_ALL_VEHICLE_GENERATORS_ACTIVE = false

	// миникарта GTA — убрана (требование №6)
	mp.game.ui.displayRadar(false);

	// розыск не нужен в выживании
	mp.game.player.setWantedLevel(0, false);
});

/* --------------------------------- Режим ночи --------------------------------- */

mp.events.add('world:mode', (mode) => {
	nightMode = mode === 'fast' ? 'fast' : 'slow';
	console.log('[GOLD] Режим мира:', nightMode);
});

/* ---------------------- Кастомная карта: заросший Лос-Сантос ---------------------- */
/**
 * Здесь подключается ваше маппирование:
 *  1) YMAP/DLC кладём в client_packages/game_resources/dlcpacks/<ваша_dlc>/common/data/levels/gta5/
 *     — RAGE MP сам подхватит ресурсы при старте клиента;
 *  2) или спавним пропы сервером (mp.objects.new) — пример в packages/gold-dayz/core/world.js.
 */

mp.events.add('playerSpawn', () => {
	// доп. страховка для случая, если HUD-модуль пережил респавн позже нас
	mp.game.ui.displayRadar(false);
});

module.exports = {};
