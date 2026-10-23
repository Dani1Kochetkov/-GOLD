'use strict';

const ZOMBIE_MODEL = 'u_m_y_zombie_01';
const HIT_RANGE = 2.7;
const HIT_COOLDOWN_MS = 900;
const zombies = new Map();
let lastHitAt = 0;
let modelRequested = false;

function createOrUpdate(zombie) {
  if (!zombie || !zombie.id) return;
  let entry = zombies.get(String(zombie.id));
  if (entry) {
    entry.health = zombie.health;
    if (entry.ped && entry.ped.handle !== 0) entry.ped.health = zombie.health;
    return;
  }
  zombies.set(String(zombie.id), { data: zombie, health: zombie.health, ped: null });
}

function spawnPendingPeds() {
  const model = mp.game.joaat(ZOMBIE_MODEL);
  if (!modelRequested) {
    mp.game.streaming.requestModel(model);
    modelRequested = true;
  }
  if (!mp.game.streaming.hasModelLoaded(model)) return;

  zombies.forEach((entry) => {
    if (entry.ped) return;
    const position = new mp.Vector3(entry.data.x, entry.data.y, entry.data.z);
    try {
      entry.ped = mp.peds.new(model, position, 0, mp.players.local.dimension);
      entry.ped.health = entry.health;
      // Урон/смерть подтверждает сервер, чтобы локальный клиент не мог
      // рассинхронизировать общее состояние заражённого.
      mp.game.entity.setEntityCanBeDamaged(entry.ped.handle, false);
    } catch (error) {
      mp.console.logError(`[GOLD DAYZ] Не удалось создать локальную модель заражённого: ${error.message}`);
    }
  });
}

function removeZombie(id) {
  const entry = zombies.get(String(id));
  if (!entry) return;
  if (entry.ped) {
    try { entry.ped.destroy(); } catch (error) { /* entity already streamed out */ }
  }
  zombies.delete(String(id));
}

mp.events.add('playerReady', () => mp.events.callRemote('gold:ready'));
mp.events.add('gold:zombies:snapshot', (snapshot) => {
  if (!Array.isArray(snapshot)) return;
  const current = new Set(snapshot.map((zombie) => String(zombie.id)));
  zombies.forEach((entry, id) => { if (!current.has(id)) removeZombie(id); });
  snapshot.forEach(createOrUpdate);
});
mp.events.add('gold:zombies:update', (update) => {
  if (!update || update.id === undefined) return;
  if (update.dead) removeZombie(update.id);
  else {
    const entry = zombies.get(String(update.id));
    if (entry) {
      entry.health = update.health;
      if (entry.ped) entry.ped.health = update.health;
    }
  }
});

mp.keys.bind(0x45, true, () => {
  const now = Date.now();
  if (now - lastHitAt < HIT_COOLDOWN_MS) return;
  const playerPosition = mp.players.local.position;
  let nearest = null;
  let nearestDistance = HIT_RANGE;
  zombies.forEach((entry, id) => {
    const p = entry.data;
    const dx = playerPosition.x - p.x;
    const dy = playerPosition.y - p.y;
    const dz = playerPosition.z - p.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < nearestDistance) {
      nearest = id;
      nearestDistance = distance;
    }
  });
  if (nearest !== null) {
    lastHitAt = now;
    mp.events.callRemote('gold:zombie:hit', nearest);
  }
});

mp.events.add('render', spawnPendingPeds);
