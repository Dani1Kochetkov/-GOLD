'use strict';

/**
 * Ядро GOLD DAYZ.
 *
 * Здесь живёт вся игровая логика: игроки, зомби, лут, инвентарь, выживание,
 * сетевые снапшоты. Класс не обращается к глобальному `mp` — общение с клиентом
 * идёт через адаптер `net`:
 *
 *   net.send(playerId, eventName, payload)
 *   net.broadcast(eventName, payload)
 *   net.chat(text, playerId?)       // playerId === null -> всем
 *   net.log(level, message)
 *
 * Спасибо этому адаптеру игру можно целиком прогонять в Node:
 *   node tools/sim.js --players 8 --seconds 120
 */

const V = require('../shared/vec3');
const { Rng } = require('../shared/rng');
const INV = require('../shared/inventory');
const SURVIVAL_MOD = require('../shared/survival');
const AI = require('../shared/zombie-ai');
const SYNC = require('../shared/sync');
const { SURVIVAL, ZOMBIE, RATE, ITEM_SLOTS, INVENTORY } = require('../shared/constants');
const { RateLimiter, sanitizeText, safeJsonParse, byteLength } = require('../shared/netcode');
const { chunkByBytes } = require('../shared/chunk');

const EVENTS = {
  CATALOG: 'gold:catalog',
  MAP: 'gold:map',
  INVENTORY: 'gold:inventory',
  HUD: 'gold:hud',
  TOAST: 'gold:toast',
  CHAT: 'gold:chat',
  DEATH: 'gold:death',
  RESPAWN: 'gold:respawn',
  DAMAGE: 'gold:damage',
  HIT: 'gold:hit',
  ZOMBIES: 'gold:zombies',
  ZOMBIE_KILLED: 'gold:zombieKilled',
  SCREAM: 'gold:scream',
  SHOT: 'gold:shot',
  MELEE: 'gold:melee',
  INV_ACTION: 'gold:inv',
  INTERACT: 'gold:interact',
  MOVE_STATE: 'gold:moveState',
  RESPAWN_REQUEST: 'gold:respawnRequest',
  RADIO: 'gold:radio',
  TELEPORT: 'gold:teleport',
  STATS: 'gold:stats',
  WELCOME: 'gold:welcome'
};

function segmentDistance(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const apz = point.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  if (abLenSq <= 1e-8) return V.distance(point, a);
  let t = (apx * abx + apy * aby + apz * abz) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  return V.distance(point, { x: a.x + abx * t, y: a.y + aby * t, z: a.z + abz * t });
}

function nowMs() {
  return Date.now();
}

class Game {
  constructor(options) {
    const opts = options || {};
    this.data = opts.data;
    this.config = this.data.config;
    this.net = opts.net || { send() {}, broadcast() {}, chat() {}, log() {} };
    this.store = opts.store || null;
    this.logger = opts.logger;
    this.rng = new Rng(opts.seed || 20260101);
    this.seed = opts.seed || 20260101;
    this.startedAt = opts.now || nowMs();
    this.lastTickAt = this.startedAt;
    this.worldHour = Number((this.data.map.world && this.data.map.world.time) || 10);
    this.dayLengthMs = Number((this.data.map.world && this.data.map.world.dayLengthMs) || 2400000);

    this.players = new Map();
    this.zombies = [];
    this.zombieById = new Map();
    this.groundItems = [];
    this.noiseEvents = [];
    this.limiter = new RateLimiter();
    this.counters = { zombie: 0, item: 0, noise: 0 };
    this.nextSpawnAt = 0;
    this.nextLootTopUpAt = 0;
    this.nextPersistAt = 0;

    this.zombieTypeCodes = new Map();
    for (let i = 0; i < this.data.zombieTypes.length; i += 1) {
      this.zombieTypeCodes.set(this.data.zombieTypes[i].id, i);
    }

    this.zones = {
      loot: this.data.map.lootZones || [],
      zombies: this.data.map.zombieZones || [],
      safe: this.data.map.safeZones || [],
      toxin: this.data.map.toxinZones || []
    };
    this.zoneRuntime = new Map();
    for (let i = 0; i < this.zones.loot.length; i += 1) {
      const zone = this.zones.loot[i];
      this.zoneRuntime.set(zone.id, {
        zone,
        itemIds: [],
        nextTopUpAt: 0
      });
    }

    this.metrics = {
      ticks: 0,
      tickTimeTotal: 0,
      tickTimeMax: 0,
      snapshotsSent: 0,
      snapshotBytes: 0,
      zombiesSpawned: 0,
      zombiesKilled: 0,
      playerDeaths: 0,
      shots: 0,
      hits: 0,
      itemsSpawned: 0,
      itemsPicked: 0,
      startedAt: this.startedAt
    };
  }

  // ---------------------------------------------------------------- утилиты

  log(level, message) {
    if (this.logger && typeof this.logger[level] === 'function') this.logger[level](message);
    if (this.net && typeof this.net.log === 'function') this.net.log(level, message);
  }

  isNight() {
    const hour = this.worldHour;
    return hour < 6 || hour >= 21;
  }

  getItemDef(itemId) {
    return this.data.itemsIndex[itemId] || null;
  }

  itemName(itemId) {
    const def = this.getItemDef(itemId);
    return def ? def.name : itemId;
  }

  allPlayers() {
    return Array.from(this.players.values());
  }

  alivePlayers() {
    return this.allPlayers().filter((player) => player.alive);
  }

  playerPosition(player) {
    return player.pos;
  }

  distanceToPlayer(pos) {
    let best = Infinity;
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const dist = V.distance(pos, player.pos);
      if (dist < best) best = dist;
    }
    return best;
  }

  findSafeZone(pos) {
    for (let i = 0; i < this.zones.safe.length; i += 1) {
      if (V.isInside2d(pos, this.zones.safe[i].pos, Number(this.zones.safe[i].radius) || 0)) return this.zones.safe[i];
    }
    return null;
  }

  findToxinZone(pos) {
    for (let i = 0; i < this.zones.toxin.length; i += 1) {
      if (V.isInside2d(pos, this.zones.toxin[i].pos, Number(this.zones.toxin[i].radius) || 0)) return this.zones.toxin[i];
    }
    return null;
  }

  // ---------------------------------------------------------------- игроки

  createPlayerRecord(id, name) {
    return {
      id,
      name,
      alive: true,
      pos: { x: 0, y: 0, z: 0 },
      heading: 0,
      dimension: 0,
      stats: SURVIVAL_MOD.createStats(),
      inventory: INV.createInventory(`player:${id}`, INVENTORY.BASE_SLOTS),
      kills: { zombies: 0, players: 0 },
      deaths: 0,
      score: 0,
      joinedAt: this.lastTickAt,
      playtimeMs: 0,
      flags: { moving: false, sprinting: false, inWater: false, nearFire: false },
      lastMoveStateAt: 0,
      lastHudAt: 0,
      lastSnapshotAt: 0,
      lastSnapshotCount: -1,
      lastInventoryAt: 0,
      lastUseAt: 0,
      lastDeathAt: 0,
      lastDamageAt: 0,
      lastPositionAt: 0,
      invulnerableUntil: 0,
      respawnAt: 0,
      safeZoneId: null,
      godMode: false,
      lastChatAt: 0
    };
  }

  addPlayer(options) {
    const opts = options || {};
    const id = opts.id;
    if (id === undefined || id === null) return null;
    if (this.players.has(id)) return this.players.get(id);

    const name = sanitizeText(opts.name || `Survivor_${id}`, 24) || `Survivor_${id}`;
    const player = this.createPlayerRecord(id, name);

    const profile = this.store && this.config.persistence.enabled ? this.store.load(name) : null;
    const now = this.lastTickAt;
    if (profile && profile.stats) {
      player.inventory = INV.sanitizeInventory(profile.inventory, this.data.itemsIndex, INVENTORY.BASE_SLOTS);
      const stats = SURVIVAL_MOD.createStats(profile.stats);
      stats.alive = profile.stats.alive !== false;
      player.stats = stats;
      if (profile.kills) player.kills = { zombies: Number(profile.kills.zombies) || 0, players: Number(profile.kills.players) || 0 };
      player.deaths = Number(profile.deaths) || 0;
      player.score = Number(profile.score) || 0;
      player.playtimeMs = Number(profile.playtimeMs) || 0;
      if (stats.alive && profile.pos) player.pos = V.copy(profile.pos);
      else player.stats = SURVIVAL_MOD.createStats();
    } else {
      this.giveStarterKit(player);
    }

    if (!player.stats.alive) {
      player.stats = SURVIVAL_MOD.createStats();
      player.inventory = INV.createInventory(`player:${id}`, INVENTORY.BASE_SLOTS);
      this.giveStarterKit(player);
    }

    if (!player.pos || (!player.pos.x && !player.pos.y && !player.pos.z)) {
      player.pos = this.findSpawnPosition();
    }

    player.invulnerableUntil = now + (Number(this.config.spawn.invulnerableAfterSpawnMs) || 0);
    this.players.set(id, player);

    this.sendCatalog(player);
    this.sendMap(player);
    this.sendInventory(player);
    this.sendHud(player, now);
    this.net.send(id, EVENTS.WELCOME, JSON.stringify({
      name: player.name,
      server: (this.config.server && this.config.server.name) || 'GOLD DAYZ',
      pvp: !!this.config.world.pvp,
      worldHour: this.worldHour,
      night: this.isNight(),
      weather: (this.data.map.world && this.data.map.world.weather) || 'OVERCAST',
      zombies: this.data.zombieTypes.map((type, index) => ({
        c: index, m: type.model, t: type.tint || 0, n: type.name
      }))
    }));
    this.sendToast(player, `GOLD DAYZ: ${player.name}, выживи. Нажми I — инвентарь, M — карта, E — подобрать.`, 'info');
    this.log('info', `[game] + ${name} (id ${id}) в ${Math.round(player.pos.x)}, ${Math.round(player.pos.y)}`);
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    this.persistPlayer(player);
    this.players.delete(id);
    this.log('info', `[game] - ${player.name} (id ${id})`);
  }

  giveStarterKit(player) {
    const starter = (this.config.spawn && this.config.spawn.starterItems) || [];
    for (let i = 0; i < starter.length; i += 1) {
      const entry = starter[i];
      if (!entry || !entry.item) continue;
      const def = this.getItemDef(entry.item);
      if (!def) continue;
      INV.addItem(player.inventory, this.data.itemsIndex, entry.item, Number(entry.count) || 1, null, {
        maxWeight: this.config.inventory.maxWeightKg
      });
    }
  }

  findSpawnPosition() {
    const points = this.data.map.spawnPoints || [];
    if (!points.length) return { x: 0, y: 0, z: 72 };
    const candidates = this.rng.shuffle(points);
    for (let i = 0; i < candidates.length; i += 1) {
      const point = candidates[i].pos;
      if (this.distanceToPlayer(point) < 8) continue;
      if (this.nearestZombieDistance(point) < Number(this.config.spawn.minDistanceFromZombies || 40)) continue;
      return V.copy(point);
    }
    return V.copy(points[this.rng.int(0, points.length - 1)].pos);
  }

  nearestZombieDistance(pos) {
    let best = Infinity;
    for (let i = 0; i < this.zombies.length; i += 1) {
      const zombie = this.zombies[i];
      if (!zombie.alive) continue;
      const dist = V.distance(pos, zombie.pos);
      if (dist < best) best = dist;
    }
    return best;
  }

  /** Данные о позиции/движении приходят от RAGE-адаптера (или симулятора). */
  setPlayerState(id, state) {
    const player = this.players.get(id);
    if (!player || !state) return;
    const now = this.lastTickAt;
    if (state.pos) {
      const next = V.copy(state.pos);
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.z)) return;
      // Анти-телепорт: за один тик больше 500 м — отбрасываем (кроме админ-телепорта).
      if (now - player.lastPositionAt < 2000) {
        const moved = V.distance(player.pos, next);
        if (moved > 500 && !state.force) {
          this.log('warn', `[game] ${player.name}: подозрительный прыжок на ${Math.round(moved)} м, позиция отклонена`);
          return;
        }
      }
      player.pos = next;
      player.lastPositionAt = now;
    }
    if (Number.isFinite(Number(state.heading))) player.heading = Number(state.heading);
    if (Number.isFinite(Number(state.dimension))) player.dimension = Math.floor(Number(state.dimension));
    if (state.flags) {
      if (typeof state.flags.moving === 'boolean') player.flags.moving = state.flags.moving;
      if (typeof state.flags.sprinting === 'boolean') player.flags.sprinting = state.flags.sprinting;
      if (typeof state.flags.inWater === 'boolean') player.flags.inWater = state.flags.inWater;
      if (typeof state.flags.nearFire === 'boolean') player.flags.nearFire = state.flags.nearFire;
    }
  }

  handleMoveState(id, raw) {
    const idNum = Number(id);
    const payload = typeof raw === 'string' ? safeJsonParse(raw, 256) : raw;
    if (!payload) return;
    if (!this.limiter.allow(`move:${idNum}`, RATE.MOVE_EVENTS_PER_SEC * 3, 1000, this.lastTickAt)) return;
    const player = this.players.get(idNum);
    if (!player) return;
    player.flags.moving = !!payload.m;
    player.flags.sprinting = !!payload.s;
    player.flags.inWater = !!payload.w;
    player.flags.nearFire = !!payload.f;
    player.lastMoveStateAt = this.lastTickAt;
  }

  weightRatio(player) {
    const weight = INV.totalWeight(player.inventory, this.data.itemsIndex);
    const capacity = INV.capacityKg(player.inventory, 0) || Number(this.config.inventory.maxWeightKg) || INVENTORY.BASE_CAPACITY_KG;
    return capacity > 0 ? weight / capacity : 0;
  }

  // ---------------------------------------------------------------- тик

  tick(now) {
    const time = Number(now) || nowMs();
    const tickMs = Number(this.config.server.tickMs) || 100;
    if (time - this.lastTickAt < tickMs) return;
    const dt = Math.min(2000, time - this.lastTickAt);
    const started = time;
    this.lastTickAt = time;
    this.worldHour = (Number((this.data.map.world && this.data.map.world.time) || 10) + ((time - this.startedAt) / this.dayLengthMs) * 24) % 24;

    for (const player of this.players.values()) {
      player.playtimeMs += dt;
      this.tickPlayerSurvival(player, time, dt);
    }

    this.tickZombies(time, dt);
    this.tickZombieSpawning(time);
    this.tickLoot(time);
    this.tickNoise(time);

    for (const player of this.players.values()) {
      this.tickPlayerNetwork(player, time);
    }

    if (time >= this.nextPersistAt) {
      this.nextPersistAt = time + (Number(this.config.server.persistIntervalMs) || 60000);
      this.persistAll();
    }

    this.metrics.ticks += 1;
    const spent = nowMs() - started;
    this.metrics.tickTimeTotal += spent;
    if (spent > this.metrics.tickTimeMax) this.metrics.tickTimeMax = spent;
  }

  tickPlayerSurvival(player, now, dt) {
    if (!player.alive) {
      // По умолчанию ждём кнопку «Возродиться» на экране смерти.
      // autoRespawn: true — сервер возродит сам по истечении таймера.
      if (this.config.spawn.autoRespawn === true && player.respawnAt && now >= player.respawnAt) {
        this.respawnPlayer(player.id);
      }
      return;
    }
    if (player.godMode) {
      player.stats.health = SURVIVAL.MAX_HEALTH;
      return;
    }

    const safeZone = this.findSafeZone(player.pos);
    player.safeZoneId = safeZone ? safeZone.id : null;
    const toxin = this.findToxinZone(player.pos);

    const ctx = {
      sprinting: player.flags.sprinting,
      moving: player.flags.moving,
      inWater: player.flags.inWater,
      nearFire: player.flags.nearFire,
      weightRatio: this.weightRatio(player),
      night: this.isNight(),
      ambientC: this.isNight() ? 6 : 22,
      radiation: toxin ? (player.inventory && INV.hasEquipped(player.inventory, 'gas_mask') ? 2 : 14) : 0
    };

    const result = SURVIVAL_MOD.tick(player.stats, ctx, dt);
    player.stats = result.stats;
    if (result.dead) {
      this.killPlayer(player, player.stats.deathCause || 'unknown', null);
      return;
    }

    if (toxin && !INV.hasEquipped(player.inventory, 'gas_mask')) {
      if (!player.toxinWarnedAt || now - player.toxinWarnedAt > 5000) {
        player.toxinWarnedAt = now;
        this.sendToast(player, `Токсичная зона: ${toxin.name}. Нужен противогаз!`, 'danger');
      }
      this.applyDamage(player, (Number(toxin.damagePerSecond) || 5) * (dt / 1000), {
        cause: 'toxin',
        ignoreArmor: true
      });
    }

    if (this.config.survival.syncHealthToGame && player.stats.health <= SURVIVAL.MAX_HEALTH) {
      player.gameHealth = Math.max(1, Math.round(player.stats.health));
    }
  }

  tickPlayerNetwork(player, now) {
    // HUD
    const hudInterval = Number(this.config.server.hudIntervalMs) || 500;
    if (now - player.lastHudAt >= hudInterval) {
      player.lastHudAt = now;
      this.sendHud(player, now);
    }

    // Снапшоты зомби
    const radius = Number(this.config.zombies.snapshotRadius) || 320;
    let visible = 0;
    for (let i = 0; i < this.zombies.length; i += 1) {
      const zombie = this.zombies[i];
      if (!zombie.alive || zombie.dimension !== player.dimension) continue;
      if (V.distance(player.pos, zombie.pos) <= radius) visible += 1;
    }
    const interval = SYNC.chooseInterval(this.players.size, visible || player.lastSnapshotCount);
    if (now - player.lastSnapshotAt < interval) return;
    player.lastSnapshotAt = now;

    if (!visible && player.lastSnapshotCount === 0) return;
    const snapshot = SYNC.buildSnapshot(this.zombies, {
      position: player.pos,
      dimension: player.dimension,
      radius,
      maxBytes: SYNC.MAX_PAYLOAD_BYTES,
      maxEntities: SYNC.SNAPSHOT_MAX_ZOMBIES,
      now
    });
    player.lastSnapshotCount = snapshot.count;
    const packed = SYNC.packSnapshot(snapshot);
    this.net.send(player.id, EVENTS.ZOMBIES, packed);
    this.metrics.snapshotsSent += 1;
    this.metrics.snapshotBytes += byteLength(packed);
    if (this.config.debug.logSnapshots) {
      this.log('debug', `[snapshot] ${player.name}: ${snapshot.count}/${snapshot.total} зомби, ${snapshot.bytes} байт`);
    }
  }

  // ---------------------------------------------------------------- зомби

  zombiesForZone(zoneId) {
    let count = 0;
    for (let i = 0; i < this.zombies.length; i += 1) {
      if (this.zombies[i].alive && this.zombies[i].zoneId === zoneId) count += 1;
    }
    return count;
  }

  tickZombieSpawning(now) {
    if (now < this.nextSpawnAt) return;
    this.nextSpawnAt = now + (Number(this.config.zombies.spawnIntervalMs) || 2200);
    if (!this.players.size) return;

    const globalCap = Math.min(
      Number(this.config.world.zombieGlobalCap) || ZOMBIE.GLOBAL_CAP,
      Number((this.data.map.world && this.data.map.world.zombieGlobalCap)) || ZOMBIE.GLOBAL_CAP
    );
    const nightFactor = this.isNight() ? Number(this.config.world.nightZombieMultiplier) || 1.5 : 1;
    const aliveCount = this.zombies.reduce((sum, zombie) => sum + (zombie.alive ? 1 : 0), 0);
    if (aliveCount >= globalCap) return;

    const attempts = Math.max(1, Number(this.config.zombies.spawnAttemptsPerTick) || 3);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const zone = this.pickSpawnZone(nightFactor);
      if (!zone) return;
      const max = Math.round((Number(zone.max) || 10) * nightFactor);
      if (this.zombiesForZone(zone.id) >= max) continue;
      if (!this.spawnZombieInZone(zone, now)) continue;
      if (this.zombies.reduce((sum, zombie) => sum + (zombie.alive ? 1 : 0), 0) >= globalCap) return;
    }
  }

  pickSpawnZone(nightFactor) {
    const zones = this.zones.zombies.filter((zone) => this.zombiesForZone(zone.id) < Math.round((Number(zone.max) || 10) * nightFactor));
    if (!zones.length) return null;
    // Приоритет зонам рядом с игроками, но не в упор.
    const players = this.alivePlayers();
    if (!players.length) return this.rng.pick(zones);
    const weights = zones.map((zone) => {
      let minDist = Infinity;
      for (let i = 0; i < players.length; i += 1) {
        const dist = V.distance2d(zone.pos, players[i].pos);
        if (dist < minDist) minDist = dist;
      }
      if (minDist > Number(this.config.zombies.despawnDistance || 420)) return { zone, weight: 0 };
      return { zone, weight: Math.max(1, 400 - minDist) };
    }).filter((entry) => entry.weight > 0);
    if (!weights.length) return null;
    const picked = this.rng.weighted(weights);
    return picked ? picked.zone : null;
  }

  spawnZombieInZone(zone, now) {
    const def = AI.pickType(this.data.zombieTypes, this.rng, this.isNight());
    if (!def) return null;
    let pos = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = V.randomPointInCircle(zone.pos, (Number(zone.radius) || 80) * 0.9, this.rng);
      if (this.findSafeZone(candidate)) continue;
      const playerDist = this.distanceToPlayer(candidate);
      if (playerDist < Number(this.config.zombies.minSpawnDistanceFromPlayers || 35)) continue;
      if (playerDist > Number(this.config.zombies.maxSpawnDistanceFromPlayers || 300)) continue;
      pos = candidate;
      break;
    }
    if (!pos) return null;
    const zombie = AI.createZombie({
      id: ++this.counters.zombie,
      def,
      pos,
      heading: this.rng.float(0, 360),
      zone,
      zoneId: zone.id,
      dimension: 0,
      typeCode: this.zombieTypeCodes.get(def.id) || 0,
      rng: this.rng
    });
    zombie.nextThinkAt = now + this.rng.int(0, ZOMBIE.THINK_INTERVAL_MS);
    this.zombies.push(zombie);
    this.zombieById.set(zombie.id, zombie);
    this.metrics.zombiesSpawned += 1;
    return zombie;
  }

  buildZombieContext(now) {
    const players = [];
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      players.push({
        id: player.id,
        pos: player.pos,
        alive: player.alive,
        dimension: player.dimension,
        inSafeZone: !!player.safeZoneId
      });
    }
    return { now, players, rng: this.rng, night: this.isNight() };
  }

  tickZombies(now, dt) {
    const ctx = this.buildZombieContext(now);
    const deadTtl = Number(this.config.zombies.corpseTtlMs) || ZOMBIE.CORPSE_TTL_MS;
    const despawnDistance = Number(this.config.zombies.despawnDistance) || 420;
    const survivors = [];

    for (let i = 0; i < this.zombies.length; i += 1) {
      const zombie = this.zombies[i];
      const def = this.data.zombieIndex[zombie.typeId] || this.data.zombieTypes[0];

      if (!zombie.alive) {
        if (now - zombie.deathAt < deadTtl) survivors.push(zombie);
        else this.zombieById.delete(zombie.id);
        continue;
      }

      const near = this.nearestPlayerDistance(zombie.pos, zombie.dimension);
      if (near > despawnDistance) {
        zombie.idleSince = zombie.idleSince || now;
        if (now - zombie.idleSince > (Number(this.config.zombies.despawnIdleMs) || 120000)) {
          this.zombieById.delete(zombie.id);
          continue;
        }
      } else {
        zombie.idleSince = 0;
      }

      if (near <= 400) {
        const actions = AI.stepZombie(zombie, def, ctx, dt);
        for (let a = 0; a < actions.length; a += 1) {
          const action = actions[a];
          if (action.type === 'attack') this.handleZombieAttack(zombie, action, now);
          if (action.type === 'scream') {
            this.registerNoise({ pos: zombie.pos, radius: action.radius, at: now, dimension: zombie.dimension });
            this.net.broadcast(EVENTS.SCREAM, JSON.stringify({ id: zombie.id, pos: zombie.pos }));
          }
        }
      }
      survivors.push(zombie);
    }
    this.zombies = survivors;
  }

  nearestPlayerDistance(pos, dimension) {
    let best = Infinity;
    for (const player of this.players.values()) {
      if (!player.alive || player.dimension !== (dimension || 0)) continue;
      const dist = V.distance(pos, player.pos);
      if (dist < best) best = dist;
    }
    return best;
  }

  handleZombieAttack(zombie, action, now) {
    const player = this.players.get(action.playerId);
    if (!player || !player.alive) return;
    const ddef = this.data.zombieIndex[zombie.typeId];
    if (!ddef) return;
    if (V.distance(zombie.pos, player.pos) > (Number(ddef.attackRange) || 1.6) + 1.5) return;
    if (player.safeZoneId && this.zones.safe.some((zone) => zone.id === player.safeZoneId && zone.pvp === false)) {
      // В безопасной зоне зомби не наносят урон.
      return;
    }
    this.applyDamage(player, Number(action.damage) || 5, {
      cause: 'zombie',
      sourceId: zombie.id,
      bleedingChance: Number(this.config.survival.bleedingChanceZombie) || 0.35,
      now
    });
  }

  applyDamage(player, amount, options) {
    const opts = options || {};
    if (!player || !player.alive) return { dead: false };
    if (player.godMode) return { dead: false };
    const now = Number(opts.now) || this.lastTickAt;
    if (player.invulnerableUntil && now < player.invulnerableUntil && !opts.ignoreInvulnerable) {
      return { dead: false, ignored: true };
    }

    const bonuses = INV.equipBonuses(player.inventory, this.data.itemsIndex);
    const reduction = opts.ignoreArmor ? 0 : bonuses.damageReduction;
    const result = SURVIVAL_MOD.applyDamage(player.stats, amount, {
      reduction,
      cause: opts.cause || 'damage',
      bleedingChance: Number(opts.bleedingChance) || 0,
      rng: this.rng,
      now
    });
    player.lastDamageAt = now;
    player.lastDamageFrom = { cause: opts.cause || 'damage', sourceId: opts.sourceId || null, at: now };

    const feedbackReady = now - (player.lastDamageFeedbackAt || 0) > 400;
    if (feedbackReady) player.lastDamageFeedbackAt = now;
    if (!opts.silent && feedbackReady) {
      this.net.send(player.id, EVENTS.DAMAGE, JSON.stringify({
        amount: Math.round((Number(amount) || 0) * (1 - reduction) * 10) / 10,
        cause: opts.cause || 'damage',
        bleeding: result.bleedingStarted === true,
        health: Math.round(player.stats.health)
      }));
    }
    if (result.dead) this.killPlayer(player, opts.cause || 'damage', opts.killer || null);
    return result;
  }

  killPlayer(player, cause, killer) {
    if (!player.alive) return;
    player.alive = false;
    player.stats.alive = false;
    player.stats.deathCause = cause;
    player.deaths += 1;
    player.lastDeathAt = this.lastTickAt;
    player.respawnAt = this.lastTickAt + (Number(this.config.spawn.respawnDelayMs) || SURVIVAL.RESPAWN_DELAY_MS);
    player.flags = { moving: false, sprinting: false, inWater: false, nearFire: false };
    this.metrics.playerDeaths += 1;

    const dropped = this.dropPlayerItems(player);
    this.log('info', `[game] ${player.name} погиб (${SURVIVAL_MOD.causeLabel(cause)}), выпало предметов: ${dropped}`);

    this.net.send(player.id, EVENTS.DEATH, JSON.stringify({
      cause,
      label: SURVIVAL_MOD.causeLabel(cause),
      by: killer ? killer.name : null,
      respawnInMs: Math.max(0, player.respawnAt - this.lastTickAt)
    }));
    this.sendInventory(player);

    if (killer && killer !== player) {
      killer.kills.players += 1;
      killer.score += 100;
      this.sendToast(killer, `Вы убили ${player.name} (+100)`, 'warning');
    }
    this.net.chat(`${player.name} — ${SURVIVAL_MOD.causeLabel(cause)}`, null);
  }

  respawnPlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.alive) return false;
    player.pos = this.findSpawnPosition();
    player.heading = this.rng.float(0, 360);
    player.stats = SURVIVAL_MOD.createStats();
    player.alive = true;
    player.respawnAt = 0;
    player.inventory = INV.createInventory(`player:${playerId}`, INVENTORY.BASE_SLOTS);
    if (this.config.inventory.starterOnRespawn) this.giveStarterKit(player);
    player.invulnerableUntil = this.lastTickAt + (Number(this.config.spawn.invulnerableAfterSpawnMs) || 4000);
    player.flags = { moving: false, sprinting: false, inWater: false, nearFire: false };

    this.net.send(playerId, EVENTS.RESPAWN, JSON.stringify({
      pos: player.pos,
      heading: player.heading
    }));
    this.sendInventory(player);
    this.sendHud(player, this.lastTickAt);
    this.sendToast(player, 'Новая жизнь. Удачи.', 'info');
    return true;
  }

  dropPlayerItems(player) {
    if (!this.config.inventory.dropOnDeath) return 0;
    const drops = [];
    for (let i = 0; i < player.inventory.slots.length; i += 1) {
      const slot = player.inventory.slots[i];
      if (slot) drops.push(slot);
    }
    for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
      const equipped = player.inventory.equipment[ITEM_SLOTS[i]];
      if (equipped) drops.push(equipped);
    }
    player.inventory.slots = new Array(INVENTORY.BASE_SLOTS).fill(null);
    player.inventory.equipment = INV.emptyEquipment();

    for (let i = 0; i < drops.length; i += 1) {
      const slot = drops[i];
      this.spawnGroundItem({
        itemId: slot.itemId,
        count: slot.count,
        meta: slot.meta,
        pos: {
          x: player.pos.x + this.rng.float(-1.2, 1.2),
          y: player.pos.y + this.rng.float(-1.2, 1.2),
          z: player.pos.z
        },
        dimension: player.dimension,
        despawnMs: Number(this.config.world.corpseDespawnMs) || 600000,
        source: 'corpse'
      });
    }
    return drops.length;
  }

  // ---------------------------------------------------------------- лут

  spawnGroundItem(options) {
    const opts = options || {};
    const def = this.getItemDef(opts.itemId);
    if (!def) return null;
    if (this.groundItems.length >= (Number(this.config.loot.maxGroundItems) || 900)) {
      this.groundItems.shift();
    }
    const item = {
      id: `gi:${++this.counters.item}`,
      itemId: def.id,
      count: Math.max(1, Math.floor(Number(opts.count) || 1)),
      meta: opts.meta || null,
      pos: V.copy(opts.pos),
      dimension: opts.dimension || 0,
      zoneId: opts.zoneId || null,
      source: opts.source || 'loot',
      spawnedAt: this.lastTickAt,
      // despawnMs <= 0 — предмет лежит, пока его не подберут (лут в зонах).
      despawnAt: Number(opts.despawnMs) > 0 ? this.lastTickAt + Number(opts.despawnMs) : 0
    };
    this.groundItems.push(item);
    if (item.zoneId && this.zoneRuntime.has(item.zoneId)) {
      this.zoneRuntime.get(item.zoneId).itemIds.push(item.id);
    }
    this.metrics.itemsSpawned += 1;
    return item;
  }

  rollLoot(tableId) {
    const table = this.data.lootTables[tableId];
    if (!table || !table.length) return null;
    const picked = this.rng.weighted(table);
    if (!picked) return null;
    const count = this.rng.int(Number(picked.min) || 1, Number(picked.max) || 1);
    return { itemId: picked.item, count: Math.max(1, count) };
  }

  tickLoot(now) {
    // Удаление просроченного лута.
    if (this.groundItems.length) {
      const kept = [];
      for (let i = 0; i < this.groundItems.length; i += 1) {
        const item = this.groundItems[i];
        if (!item.despawnAt || now < item.despawnAt) kept.push(item);
        else if (item.zoneId && this.zoneRuntime.has(item.zoneId)) {
          const runtime = this.zoneRuntime.get(item.zoneId);
          runtime.itemIds = runtime.itemIds.filter((id) => id !== item.id);
        }
      }
      this.groundItems = kept;
    }

    if (now < this.nextLootTopUpAt) return;
    this.nextLootTopUpAt = now + (Number(this.config.world.lootTopUpMs) || 20000);

    for (const runtime of this.zoneRuntime.values()) {
      const zone = runtime.zone;
      runtime.itemIds = runtime.itemIds.filter((id) => this.groundItems.some((item) => item.id === id));
      const target = Number(zone.count) || 8;
      if (runtime.itemIds.length >= target) continue;
      if (this.distanceToPlayer(zone.pos) > 260) continue; // не плодим лут в пустых зонах

      const roll = this.rollLoot(zone.lootTable);
      if (!roll) continue;
      const pos = V.randomPointInCircle(zone.pos, (Number(zone.radius) || 30) * 0.85, this.rng);
      const item = this.spawnGroundItem({
        itemId: roll.itemId,
        count: roll.count,
        pos,
        zoneId: zone.id,
        despawnMs: 0
      });
      if (item) runtime.itemIds.push(item.id);
    }
  }

  nearestGroundItem(player, range) {
    const maxDist = Number(range) || Number(this.config.loot.pickupRange) || 3;
    let best = null;
    let bestDist = maxDist;
    for (let i = 0; i < this.groundItems.length; i += 1) {
      const item = this.groundItems[i];
      if ((item.dimension || 0) !== (player.dimension || 0)) continue;
      const dist = V.distance(player.pos, item.pos);
      if (dist <= bestDist) {
        best = item;
        bestDist = dist;
      }
    }
    return best;
  }

  handleInteract(playerId, raw) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    if (!this.limiter.allow(`interact:${playerId}`, 8, 1000, this.lastTickAt)) return;
    const payload = typeof raw === 'string' ? safeJsonParse(raw, 512) : raw || {};
    let item = null;
    if (payload && payload.id) {
      item = this.groundItems.find((entry) => entry.id === payload.id) || null;
      if (item && V.distance(player.pos, item.pos) > (Number(this.config.loot.pickupRange) || 3) + 0.5) item = null;
    } else {
      item = this.nearestGroundItem(player);
    }
    if (!item) {
      this.sendToast(player, 'Рядом ничего нет', 'muted');
      return;
    }
    this.pickupGroundItem(player, item);
  }

  pickupGroundItem(player, item) {
    const capacity = INV.capacityKg(player.inventory, 0) || Number(this.config.inventory.maxWeightKg);
    const result = INV.addItem(player.inventory, this.data.itemsIndex, item.itemId, item.count, item.meta, {
      maxWeight: capacity
    });
    if (result.added <= 0) {
      this.sendToast(player, result.reason === 'no-space' ? 'Нет места или слишком тяжело' : 'Не удалось подобрать', 'warning');
      return;
    }
    this.metrics.itemsPicked += result.added;
    if (result.leftover > 0) {
      item.count = result.leftover;
      this.sendToast(player, `Подобрано ${result.added} × ${this.itemName(item.itemId)} (осталось ${result.leftover})`, 'info');
    } else {
      this.groundItems = this.groundItems.filter((entry) => entry.id !== item.id);
      if (item.zoneId && this.zoneRuntime.has(item.zoneId)) {
        const runtime = this.zoneRuntime.get(item.zoneId);
        runtime.itemIds = runtime.itemIds.filter((id) => id !== item.id);
      }
      this.sendToast(player, `+ ${result.added} × ${this.itemName(item.itemId)}`, 'success');
    }
    this.sendInventory(player);
  }

  // ---------------------------------------------------------------- бой

  resolveAttack(player, def, origin, target, options) {
    const opts = options || {};
    const weapon = (def && def.weapon) || null;
    const range = weapon ? Number(weapon.range) || 2 : 1.2;
    const isFirearm = !!(weapon && weapon.ammoType);
    // Для ближнего боя допуск меньше: удар «по воздуху» с 3 метров невозможен.
    const rangeTolerance = isFirearm ? 2 : 0.6;
    const damage = weapon ? Number(weapon.damage) || 5 : 6;
    const from = V.copy(origin);
    const to = V.copy(target);
    const rayLength = V.distance(from, to);
    if (!Number.isFinite(rayLength) || rayLength <= 0 || rayLength > 260) {
      return null;
    }

    let best = null;
    let bestDist = Infinity;

    // Зомби.
    for (let i = 0; i < this.zombies.length; i += 1) {
      const zombie = this.zombies[i];
      if (!zombie.alive || zombie.dimension !== player.dimension) continue;
      const center = { x: zombie.pos.x, y: zombie.pos.y, z: zombie.pos.z + 0.95 };
      const distToRay = segmentDistance(center, from, to);
      if (distToRay > 0.9) continue;
      const playerDist = V.distance(player.pos, center);
      if (playerDist > range + rangeTolerance) continue;
      if (playerDist < bestDist) {
        bestDist = playerDist;
        best = { type: 'zombie', zombie, headshot: (to.z - zombie.pos.z) > 1.35 };
      }
    }

    // Игроки (PvP).
    if (this.config.world.pvp) {
      for (const other of this.players.values()) {
        if (other.id === player.id || !other.alive) continue;
        if (other.dimension !== player.dimension) continue;
        if (other.safeZoneId || player.safeZoneId) continue;
        const center = { x: other.pos.x, y: other.pos.y, z: other.pos.z + 0.9 };
        const distToRay = segmentDistance(center, from, to);
        if (distToRay > 0.8) continue;
        const shooterDist = V.distance(player.pos, center);
        if (shooterDist > range + rangeTolerance) continue;
        if (shooterDist < bestDist) {
          bestDist = shooterDist;
          best = { type: 'player', player: other, headshot: (to.z - other.pos.z) > 1.5 };
        }
      }
    }

    if (!best) return null;

    // Только серверная геометрия: клиентский флаг h не повышает урон (античит).
    const headshot = !!best.headshot;
    const multiplier = (headshot ? 2 : 1) * (best.type === 'player' ? Number(this.config.world.pvpDamageMultiplier) || 1 : 1);

    if (best.type === 'zombie') {
      const result = AI.damageZombie(best.zombie, damage * multiplier, {
        now: this.lastTickAt,
        sourceType: 'player',
        sourceId: player.id
      });
      this.metrics.hits += 1;
      this.net.send(player.id, EVENTS.HIT, JSON.stringify({
        type: 'zombie',
        id: best.zombie.id,
        dmg: Math.round(damage * multiplier),
        head: headshot,
        kill: result.dead,
        hp: best.zombie.hp
      }));
      if (result.dead) this.onZombieDeath(best.zombie, player);
      return { type: 'zombie', id: best.zombie.id, damage: damage * multiplier, kill: result.dead };
    }

    this.applyDamage(best.player, damage * multiplier, {
      cause: 'player',
      sourceId: player.id,
      killer: player,
      bleedingChance: Number(this.config.survival.bleedingChanceBullet) || 0.25,
      now: this.lastTickAt
    });
    this.metrics.hits += 1;
    this.net.send(player.id, EVENTS.HIT, JSON.stringify({
      type: 'player',
      id: best.player.id,
      dmg: Math.round(damage * multiplier),
      head: headshot,
      kill: !best.player.alive
    }));
    this.net.send(best.player.id, EVENTS.TOAST, JSON.stringify({
      text: `Вас ранил ${player.name}`,
      kind: 'danger'
    }));
    return { type: 'player', id: best.player.id, damage: damage * multiplier, kill: !best.player.alive };
  }

  onZombieDeath(zombie, killer) {
    this.metrics.zombiesKilled += 1;
    const def = this.data.zombieIndex[zombie.typeId] || {};
    if (killer) {
      killer.kills.zombies += 1;
      killer.score += Number(def.score) || 10;
    }
    if (this.rng.chance(Number(this.config.loot.zombieLootChance) || 0.45)) {
      const roll = this.rollLoot(def.lootTable || 'zombie_common');
      if (roll) {
        this.spawnGroundItem({
          itemId: roll.itemId,
          count: roll.count,
          pos: { x: zombie.pos.x + this.rng.float(-0.6, 0.6), y: zombie.pos.y + this.rng.float(-0.6, 0.6), z: zombie.pos.z },
          dimension: zombie.dimension,
          despawnMs: Number(this.config.loot.dropDespawnMs) || 600000,
          source: 'zombie'
        });
      }
    }
    this.net.broadcast(EVENTS.ZOMBIE_KILLED, JSON.stringify({
      id: zombie.id,
      pos: zombie.pos,
      by: killer ? killer.name : null
    }));
  }

  handleShot(playerId, raw) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    if (!this.limiter.allow(`shot:${playerId}`, RATE.SHOT_EVENTS_PER_SEC, 1000, this.lastTickAt)) return;
    const payload = typeof raw === 'string' ? safeJsonParse(raw, 512) : raw;
    if (!payload || !Array.isArray(payload.o) || !Array.isArray(payload.t)) return;
    const origin = { x: Number(payload.o[0]), y: Number(payload.o[1]), z: Number(payload.o[2]) };
    const target = { x: Number(payload.t[0]), y: Number(payload.t[1]), z: Number(payload.t[2]) };
    if (![origin.x, origin.y, origin.z, target.x, target.y, target.z].every(Number.isFinite)) return;

    const equipped = INV.getEquipped(player.inventory, 'primary') || INV.getEquipped(player.inventory, 'melee');
    const def = equipped ? this.getItemDef(equipped.itemId) : null;
    const weapon = def && def.weapon ? def.weapon : null;
    const now = this.lastTickAt;

    if (weapon && weapon.ammoType) {
      const meta = equipped.meta || { ammo: 0 };
      const ammo = Math.max(0, Number(meta.ammo) || 0);
      if (ammo <= 0) {
        this.sendToast(player, 'Нет патронов в магазине. Перезарядка — R', 'warning');
        this.net.send(player.id, EVENTS.SHOT, JSON.stringify({ dry: true }));
        return;
      }
      const rate = Math.max(60, Number(weapon.rate) || 250);
      if (now - (player.lastShotAt || 0) < rate) return;
      player.lastShotAt = now;
      equipped.meta = { ammo: ammo - 1 };
      this.net.send(player.id, EVENTS.SHOT, JSON.stringify({ fired: true, ammo: equipped.meta.ammo }));
      this.metrics.shots += 1;
      this.registerNoise({
        pos: player.pos,
        radius: Number(weapon.noise) || 100,
        at: now,
        dimension: player.dimension
      });
    } else if (weapon) {
      const rate = Math.max(120, Number(weapon.rate) || 700);
      if (now - (player.lastShotAt || 0) < rate) return;
      player.lastShotAt = now;
      this.metrics.shots += 1;
    } else {
      const rate = 800;
      if (now - (player.lastShotAt || 0) < rate) return;
      player.lastShotAt = now;
      this.metrics.shots += 1;
      this.registerNoise({ pos: player.pos, radius: 12, at: now, dimension: player.dimension });
    }

    this.resolveAttack(player, def, origin, target, { headshot: !!payload.h });
  }

  handleMelee(playerId, raw) {
    // Ближний бой используем тем же резолвером, но с клиентским таргетом.
    this.handleShot(playerId, raw);
  }

  registerNoise(event) {
    if (!event || !event.pos) return;
    const noise = {
      id: ++this.counters.noise,
      pos: V.copy(event.pos),
      radius: Number(event.radius) || 80,
      at: Number(event.at) || this.lastTickAt,
      dimension: event.dimension || 0
    };
    this.noiseEvents.push(noise);
    if (this.noiseEvents.length > 120) this.noiseEvents.shift();
    for (let i = 0; i < this.zombies.length; i += 1) {
      const zombie = this.zombies[i];
      if (!zombie.alive || zombie.dimension !== noise.dimension) continue;
      const def = this.data.zombieIndex[zombie.typeId];
      if (def) AI.hearNoise(zombie, def, noise);
    }
  }

  tickNoise(now) {
    if (!this.noiseEvents.length) return;
    this.noiseEvents = this.noiseEvents.filter((noise) => now - noise.at < 3000);
  }

  // ---------------------------------------------------------------- инвентарь

  inventoryPayload(player) {
    const size = INV.slotCount(player.inventory, this.data.itemsIndex);
    INV.ensureSlots(player.inventory, this.data.itemsIndex);
    const slots = [];
    for (let i = 0; i < size; i += 1) {
      const slot = player.inventory.slots[i];
      slots.push(slot ? [slot.itemId, slot.count, slot.meta && Number.isFinite(slot.meta.ammo) ? slot.meta.ammo : null] : null);
    }
    const equipment = {};
    for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
      const key = ITEM_SLOTS[i];
      const equipped = player.inventory.equipment[key];
      equipment[key] = equipped ? [equipped.itemId, equipped.meta && Number.isFinite(equipped.meta.ammo) ? equipped.meta.ammo : null] : null;
    }
    return {
      slots,
      size,
      eq: equipment,
      w: INV.totalWeight(player.inventory, this.data.itemsIndex),
      cap: INV.capacityKg(player.inventory, 0),
      used: INV.usedSlots(player.inventory),
      alive: player.alive
    };
  }

  sendInventory(player) {
    const payload = JSON.stringify(this.inventoryPayload(player));
    this.net.send(player.id, EVENTS.INVENTORY, payload);
    player.lastInventoryAt = this.lastTickAt;
    player.lastInventoryPayload = payload;
  }

  sendHud(player, now) {
    const stats = player.stats;
    const weight = INV.totalWeight(player.inventory, this.data.itemsIndex);
    const payload = JSON.stringify({
      h: Math.round(stats.health),
      b: Math.round(stats.blood),
      hu: Math.round(stats.hunger),
      t: Math.round(stats.thirst),
      s: Math.round(stats.stamina),
      r: Math.round(stats.radiation * 10) / 10,
      bl: stats.bleeding,
      temp: Math.round(stats.temperature * 10) / 10,
      w: weight,
      cap: INV.capacityKg(player.inventory, 0),
      z: player.kills.zombies,
      p: player.kills.players,
      sc: player.score,
      d: player.deaths,
      night: this.isNight(),
      hour: Math.round(this.worldHour * 10) / 10,
      px: Math.round(player.pos.x),
      py: Math.round(player.pos.y),
      nz: player.lastSnapshotCount > 0 ? player.lastSnapshotCount : 0,
      safe: player.safeZoneId || null,
      alive: player.alive,
      respawnIn: player.alive ? 0 : Math.max(0, player.respawnAt - (now || this.lastTickAt))
    });
    this.net.send(player.id, EVENTS.HUD, payload);
  }

  sendToast(player, text, kind) {
    if (!this.config.debug.chatFeedback && kind !== 'danger') return;
    this.net.send(player.id, EVENTS.TOAST, JSON.stringify({ text: String(text).slice(0, 220), kind: kind || 'info' }));
  }

  /** Каталог предметов шлём частями: player.call ограничен 8192 байтами. */
  sendCatalog(player) {
    const compact = this.data.items.map((def) => ({
      id: def.id,
      n: def.name,
      i: def.icon || '▪',
      d: def.desc || '',
      s: def.slot || 'none',
      w: Number(def.weight) || 0,
      st: Number(def.stack) || 1,
      r: def.rarity || 'common',
      e: !!def.equipable,
      u: !!def.usable,
      wp: def.weapon || null,
      he: def.heal || null,
      fo: def.food || null,
      stg: def.storage || 0,
      dr: def.damageReduction || 0,
      gp: def.gasProtection || 0,
      rad: !!def.radio,
      um: !!def.unlocksMap,
      am: !!def.ammo
    }));
    // 64 байта — запас на обёртку {"part":0,"total":1,"items":[]}.
    const chunks = chunkByBytes(compact, SYNC.MAX_PAYLOAD_BYTES, 64);
    for (let i = 0; i < chunks.length; i += 1) {
      const payload = JSON.stringify({
        part: i,
        total: chunks.length,
        items: chunks[i]
      });
      if (byteLength(payload) > SYNC.MAX_PAYLOAD_BYTES) {
        // Защита от неверной оценки: режем ещё раз, если предметы слишком тяжёлые.
        this.log('error', `[catalog] часть ${i} слишком большая (${byteLength(payload)} B) — проверьте descriptions в items.json`);
      }
      this.net.send(player.id, EVENTS.CATALOG, payload);
    }
  }

  sendMap(player) {
    const payload = {
      spawnPoints: this.data.map.spawnPoints || [],
      lootZones: this.zones.loot.map((zone) => ({
        id: zone.id, name: zone.name, x: zone.pos.x, y: zone.pos.y, r: zone.radius, tier: zone.tier
      })),
      zombieZones: this.zones.zombies.map((zone) => ({
        id: zone.id, name: zone.name, x: zone.pos.x, y: zone.pos.y, r: zone.radius
      })),
      safeZones: this.zones.safe.map((zone) => ({
        id: zone.id, name: zone.name, x: zone.pos.x, y: zone.pos.y, r: zone.radius
      })),
      toxinZones: this.zones.toxin.map((zone) => ({
        id: zone.id, name: zone.name, x: zone.pos.x, y: zone.pos.y, r: zone.radius
      }))
    };
    this.net.send(player.id, EVENTS.MAP, JSON.stringify(payload));
  }

  handleInventoryAction(playerId, raw) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (!this.limiter.allow(`inv:${playerId}`, RATE.INVENTORY_ACTIONS_PER_SEC, 1000, this.lastTickAt)) return;
    const action = typeof raw === 'string' ? safeJsonParse(raw, 1024) : raw;
    if (!action || typeof action.a !== 'string') return;
    if (!player.alive && action.a !== 'close') {
      this.sendToast(player, 'Вы мертвы', 'danger');
      return;
    }

    let changed = false;
    const now = this.lastTickAt;

    switch (action.a) {
      case 'move': {
        changed = INV.moveSlot(player.inventory, Number(action.from), Number(action.to));
        break;
      }
      case 'equip': {
        const res = INV.equip(player.inventory, this.data.itemsIndex, Number(action.slot));
        changed = res.ok;
        if (!res.ok) this.sendToast(player, this.equipError(res.reason), 'warning');
        break;
      }
      case 'unequip': {
        const res = INV.unequip(player.inventory, this.data.itemsIndex, String(action.eq));
        changed = res.ok;
        if (!res.ok) this.sendToast(player, res.reason === 'storage-busy' ? 'Сначала освободите слоты рюкзака' : 'Не удалось снять', 'warning');
        break;
      }
      case 'use': {
        const res = this.useItem(player, Number(action.slot), now);
        changed = res.ok;
        break;
      }
      case 'drop': {
        changed = this.dropItem(player, Number(action.slot), Number(action.count) || 1);
        break;
      }
      case 'reload': {
        const res = this.reloadWeapon(player);
        changed = res.ok;
        break;
      }
      case 'close':
        break;
      default:
        break;
    }

    if (changed) this.sendInventory(player);
  }

  equipError(reason) {
    const map = {
      'empty-slot': 'Слот пуст',
      'not-equipable': 'Этот предмет нельзя экипировать',
      'no-space': 'Нет места в инвентаре'
    };
    return map[reason] || 'Действие невозможно';
  }

  useItem(player, slotIndex, now) {
    const slot = INV.getSlot(player.inventory, slotIndex);
    if (!slot) return { ok: false };
    const def = this.getItemDef(slot.itemId);
    if (!def) return { ok: false };
    if (now - (player.lastUseAt || 0) < (Number(this.config.inventory.useCooldownMs) || 900)) {
      this.sendToast(player, 'Подождите немного', 'muted');
      return { ok: false };
    }

    if (def.weapon || def.equipable) {
      const res = INV.equip(player.inventory, this.data.itemsIndex, slotIndex);
      if (!res.ok) this.sendToast(player, this.equipError(res.reason), 'warning');
      return { ok: res.ok };
    }

    if (def.heal) {
      const result = SURVIVAL_MOD.heal(player.stats, def.heal);
      if (!result.healed) return { ok: false };
      player.lastUseAt = now;
      INV.removeItem(player.inventory, this.data.itemsIndex, slot.itemId, 1);
      this.sendToast(player, `Использовано: ${def.name}`, 'success');
      return { ok: true };
    }

    if (def.food) {
      SURVIVAL_MOD.applyFood(player.stats, def.food);
      player.lastUseAt = now;
      if (!def.reusable) INV.removeItem(player.inventory, this.data.itemsIndex, slot.itemId, 1);
      this.sendToast(player, `${def.reusable ? 'Использовано' : 'Съедено'}: ${def.name}`, 'success');
      return { ok: true };
    }

    if (def.unlocksMap) {
      this.sendToast(player, 'Карта открыта (M)', 'info');
      return { ok: false };
    }

    this.sendToast(player, `Предмет «${def.name}» нельзя использовать`, 'muted');
    return { ok: false };
  }

  dropItem(player, slotIndex, count) {
    const slot = INV.getSlot(player.inventory, slotIndex);
    if (!slot) return false;
    const requested = Number.isFinite(Number(count)) ? Number(count) : slot.count;
    const take = Math.max(1, Math.min(slot.count, Math.floor(requested)));
    const result = INV.removeFromSlot(player.inventory, slotIndex, take);
    if (!result.removed) return false;
    this.spawnGroundItem({
      itemId: result.removed.itemId,
      count: result.removed.count,
      meta: result.removed.meta,
      pos: {
        x: player.pos.x + this.rng.float(0.6, 1.6),
        y: player.pos.y + this.rng.float(0.6, 1.6),
        z: player.pos.z
      },
      dimension: player.dimension,
      despawnMs: Number(this.config.loot.dropDespawnMs) || 900000,
      source: 'drop'
    });
    this.sendToast(player, `Выброшено: ${this.itemName(result.removed.itemId)} × ${result.removed.count}`, 'muted');
    return true;
  }

  reloadWeapon(player) {
    const equipped = INV.getEquipped(player.inventory, 'primary');
    if (!equipped) {
      this.sendToast(player, 'В руках нет оружия', 'muted');
      return { ok: false };
    }
    const def = this.getItemDef(equipped.itemId);
    if (!def || !def.weapon || !def.weapon.ammoType) {
      this.sendToast(player, 'Это оружие не требует патронов', 'muted');
      return { ok: false };
    }
    const magSize = Math.max(0, Number(def.weapon.mag) || 0);
    const current = Math.max(0, Math.min(magSize, Number((equipped.meta && equipped.meta.ammo) || 0)));
    const need = magSize - current;
    if (need <= 0) {
      this.sendToast(player, 'Магазин полон', 'muted');
      return { ok: false };
    }
    const available = INV.countItem(player.inventory, def.weapon.ammoType);
    if (available <= 0) {
      this.sendToast(player, `Нет патронов (${this.itemName(def.weapon.ammoType)})`, 'warning');
      return { ok: false };
    }
    const take = Math.min(need, available);
    INV.removeItem(player.inventory, this.data.itemsIndex, def.weapon.ammoType, take);
    equipped.meta = { ammo: current + take };
    this.sendToast(player, `Перезаряжено: ${current + take}/${magSize}`, 'success');
    this.net.send(player.id, EVENTS.SHOT, JSON.stringify({ reload: true, ammo: current + take }));
    return { ok: true, ammo: current + take };
  }

  // ---------------------------------------------------------------- чат/прочее

  handleRadio(playerId, text) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    if (!this.limiter.allow(`chat:${playerId}`, RATE.CHAT_MESSAGES_PER_10S, 10000, this.lastTickAt)) {
      this.sendToast(player, 'Не так быстро', 'muted');
      return;
    }
    const message = sanitizeText(text, 140);
    if (!message) return;
    const hasRadio = INV.hasEquipped(player.inventory, 'radio');
    if (!hasRadio) {
      this.sendToast(player, 'Нужна рация', 'warning');
      return;
    }
    this.net.chat(`[ЭФИР] ${player.name}: ${message}`, null);
  }

  handleRespawnRequest(playerId) {
    const player = this.players.get(playerId);
    if (!player || player.alive) return;
    if (this.lastTickAt < player.respawnAt) {
      this.sendToast(player, 'Ещё рано', 'muted');
      return;
    }
    this.respawnPlayer(playerId);
  }

  handleSuicide(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.alive) return;
    this.killPlayer(player, 'suicide', null);
  }

  // ---------------------------------------------------------------- админ/отладка

  adminSpawnZombies(count, pos, playerId) {
    const target = pos || (this.players.get(playerId) && this.players.get(playerId).pos);
    if (!target) return 0;
    const amount = Math.max(1, Math.min(40, Math.floor(Number(count) || 1)));
    let spawned = 0;
    for (let i = 0; i < amount; i += 1) {
      const def = AI.pickType(this.data.zombieTypes, this.rng, this.isNight());
      const spawnPos = {
        x: target.x + this.rng.float(-12, 12),
        y: target.y + this.rng.float(-12, 12),
        z: target.z
      };
      const zombie = AI.createZombie({
        id: ++this.counters.zombie,
        def,
        pos: spawnPos,
        heading: this.rng.float(0, 360),
        zone: { pos: spawnPos, radius: 40 },
        zoneId: 'admin',
        rng: this.rng,
        dimension: 0,
        typeCode: this.zombieTypeCodes.get(def.id) || 0
      });
      this.zombies.push(zombie);
      this.zombieById.set(zombie.id, zombie);
      spawned += 1;
    }
    return spawned;
  }

  adminClearZombies() {
    let cleared = 0;
    for (let i = 0; i < this.zombies.length; i += 1) {
      if (this.zombies[i].alive) {
        this.zombies[i].alive = false;
        this.zombies[i].deathAt = 0;
        cleared += 1;
      }
    }
    this.zombies = [];
    this.zombieById.clear();
    return cleared;
  }

  adminSpawnLoot(zoneId, count) {
    const runtime = this.zoneRuntime.get(zoneId);
    if (!runtime) return 0;
    let spawned = 0;
    for (let i = 0; i < Math.max(1, Math.min(50, Number(count) || 1)); i += 1) {
      const roll = this.rollLoot(runtime.zone.lootTable);
      if (!roll) continue;
      const pos = V.randomPointInCircle(runtime.zone.pos, (Number(runtime.zone.radius) || 30) * 0.85, this.rng);
      const item = this.spawnGroundItem({ itemId: roll.itemId, count: roll.count, pos, zoneId: runtime.zone.id, despawnMs: 0 });
      if (item) {
        runtime.itemIds.push(item.id);
        spawned += 1;
      }
    }
    return spawned;
  }

  adminGive(playerId, itemId, count) {
    const player = this.players.get(playerId);
    if (!player || !this.getItemDef(itemId)) return false;
    const res = INV.addItem(player.inventory, this.data.itemsIndex, itemId, Math.max(1, Number(count) || 1), null, {
      maxWeight: 999
    });
    if (res.added > 0) this.sendInventory(player);
    return res.added > 0;
  }

  adminTeleport(playerId, x, y, z) {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.pos = { x: Number(x), y: Number(y), z: Number(z) };
    player.lastPositionAt = this.lastTickAt;
    this.net.send(playerId, EVENTS.TELEPORT, JSON.stringify({ x: player.pos.x, y: player.pos.y, z: player.pos.z }));
    this.sendToast(player, 'Телепорт', 'info');
    return true;
  }

  adminStats(playerId) {
    const player = this.players.get(playerId);
    if (!player) return {};
    const stats = player.stats;
    return {
      hp: Math.round(stats.health),
      blood: Math.round(stats.blood),
      hunger: Math.round(stats.hunger),
      thirst: Math.round(stats.thirst),
      stamina: Math.round(stats.stamina),
      radiation: Math.round(stats.radiation),
      bleeding: stats.bleeding,
      weight: INV.totalWeight(player.inventory, this.data.itemsIndex),
      zombies: this.zombies.filter((zombie) => zombie.alive).length,
      items: this.groundItems.length
    };
  }

  setStat(playerId, key, value) {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (key === 'god') {
      player.godMode = !!value;
      return true;
    }
    if (key in player.stats) {
      player.stats[key] = Number(value);
      SURVIVAL_MOD.clampStats(player.stats);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- сохранения

  profileOf(player) {
    return {
      version: 1,
      name: player.name,
      stats: player.stats,
      inventory: { slots: player.inventory.slots, equipment: player.inventory.equipment },
      pos: player.pos,
      kills: player.kills,
      deaths: player.deaths,
      score: player.score,
      playtimeMs: player.playtimeMs
    };
  }

  persistPlayer(player) {
    if (!this.store || !this.config.persistence.enabled || !player) return false;
    return this.store.save(player.name, this.profileOf(player));
  }

  persistAll() {
    for (const player of this.players.values()) this.persistPlayer(player);
  }

  getMetrics() {
    const avg = this.metrics.ticks ? this.metrics.tickTimeTotal / this.metrics.ticks : 0;
    return {
      uptimeSec: Math.round((this.lastTickAt - this.metrics.startedAt) / 1000),
      players: this.players.size,
      zombiesAlive: this.zombies.filter((zombie) => zombie.alive).length,
      zombiesTotal: this.zombies.length,
      groundItems: this.groundItems.length,
      ticks: this.metrics.ticks,
      tickAvgMs: Math.round(avg * 100) / 100,
      tickMaxMs: this.metrics.tickTimeMax,
      snapshotsSent: this.metrics.snapshotsSent,
      snapshotAvgBytes: this.metrics.snapshotsSent ? Math.round(this.metrics.snapshotBytes / this.metrics.snapshotsSent) : 0,
      zombiesSpawned: this.metrics.zombiesSpawned,
      zombiesKilled: this.metrics.zombiesKilled,
      playerDeaths: this.metrics.playerDeaths,
      shots: this.metrics.shots,
      hits: this.metrics.hits,
      accuracy: this.metrics.shots ? Math.round((this.metrics.hits / this.metrics.shots) * 1000) / 10 : 0,
      itemsSpawned: this.metrics.itemsSpawned,
      itemsPicked: this.metrics.itemsPicked,
      worldHour: Math.round(this.worldHour * 10) / 10
    };
  }

  /** Горячая перезагрузка data/*.json без перезапуска сервера. */
  reloadData(data) {
    this.data = data;
    this.config = data.config;
    this.zones = {
      loot: data.map.lootZones || [],
      zombies: data.map.zombieZones || [],
      safe: data.map.safeZones || [],
      toxin: data.map.toxinZones || []
    };
    this.zoneRuntime.clear();
    for (let i = 0; i < this.zones.loot.length; i += 1) {
      const zone = this.zones.loot[i];
      this.zoneRuntime.set(zone.id, { zone, itemIds: [], nextTopUpAt: 0 });
    }
    for (const player of this.players.values()) {
      this.sendCatalog(player);
      this.sendMap(player);
      this.sendInventory(player);
    }
    this.log('info', `[game] данные перезагружены: предметов ${data.items.length}, типов зомби ${data.zombieTypes.length}`);
  }
}

module.exports = { Game, EVENTS };
