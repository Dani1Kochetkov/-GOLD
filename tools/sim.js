#!/usr/bin/env node
'use strict';

/**
 * Headless-симулятор GOLD DAYZ.
 *
 * Гоняет настоящий server/game.js без RAGE и без Windows:
 *   node tools/sim.js --players 8 --seconds 120 --seed 42 --verbose
 *
 * Проверяет: тик, спавн зомби, ИИ, выстрелы, лут, смерть/респавн
 * и главное — размеры снапшотов (лимит player.call 8192 байта).
 */

const path = require('path');
const fs = require('fs');
const { loadData } = require('../server/core/data');
const { Game } = require('../server/game');
const V = require('../shared/vec3');
const { Rng } = require('../shared/rng');
const { byteLength } = require('../shared/netcode');

const ROOT = path.resolve(__dirname, '..');
const PAYLOAD_LIMIT = 7800;

function parseArgs(argv) {
  const args = {
    players: 6,
    seconds: 60,
    seed: 42,
    verbose: false,
    json: false,
    report: null
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--players') args.players = Number(argv[++i]) || args.players;
    else if (arg === '--seconds') args.seconds = Number(argv[++i]) || args.seconds;
    else if (arg === '--seed') args.seed = Number(argv[++i]) || args.seed;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--report') args.report = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Использование: node tools/sim.js [--players N] [--seconds N] [--seed N] [--verbose] [--json] [--report file.json]');
      process.exit(0);
    }
  }
  args.players = Math.max(1, Math.min(64, Math.floor(args.players)));
  args.seconds = Math.max(5, Math.min(1800, Math.floor(args.seconds)));
  return args;
}

function createNet() {
  const stats = {
    messages: 0,
    bytes: 0,
    byEvent: {},
    maxBytes: {},
    violations: []
  };
  const record = (event, payload, playerId) => {
    const bytes = payload === undefined ? 0 : byteLength(typeof payload === 'string' ? payload : JSON.stringify(payload));
    stats.messages += 1;
    stats.bytes += bytes;
    stats.byEvent[event] = (stats.byEvent[event] || 0) + 1;
    stats.maxBytes[event] = Math.max(stats.maxBytes[event] || 0, bytes);
    if (bytes > PAYLOAD_LIMIT) stats.violations.push({ event, bytes, playerId });
  };
  return {
    stats,
    send(playerId, event, payload) { record(event, payload, playerId); },
    broadcast(event, payload) { record(event, payload, null); },
    chat() {},
    log() {}
  };
}

function createLogger(verbose, errors) {
  return {
    info(message) { if (verbose) console.log(`  · ${message}`); },
    warn(message) { if (verbose) console.log(`  ⚠ ${message}`); },
    error(message) { errors.push(String(message)); console.error(`  ❌ ${message}`); },
    debug(message) { if (verbose) console.log(`  · ${message}`); }
  };
}

function equipPistol(game, playerId) {
  game.adminGive(playerId, 'pistol', 1);
  game.adminGive(playerId, 'ammo_9mm', 60);
  const player = game.players.get(playerId);
  if (!player) return false;
  const index = player.inventory.slots.findIndex((slot) => slot && slot.itemId === 'pistol');
  if (index < 0) return false;
  game.handleInventoryAction(playerId, JSON.stringify({ a: 'equip', slot: index }));
  game.handleInventoryAction(playerId, JSON.stringify({ a: 'reload' }));
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const data = loadData(ROOT);
  const errors = [];
  const net = createNet();
  const logger = createLogger(args.verbose, errors);
  const rng = new Rng(args.seed);
  const game = new Game({ data, net, seed: args.seed, logger });

  const tickMs = Number(data.config.server.tickMs) || 100;
  const totalTicks = Math.floor((args.seconds * 1000) / tickMs);
  let now = Date.now();

  // Ставим игроков в Палето-Бей: рядом и зомби, и лут.
  const center = { x: -275, y: 6450, z: 32 };
  const players = [];
  for (let i = 0; i < args.players; i += 1) {
    const id = 100 + i;
    const player = game.addPlayer({ id, name: `Sim_${i + 1}`, authenticated: true });
    if (!player) continue;
    const pos = {
      x: center.x + rng.float(-25, 25),
      y: center.y + rng.float(-25, 25),
      z: center.z
    };
    game.setPlayerState(id, { pos, flags: { moving: false, sprinting: false } });
    game.lastTickAt = now;
    players.push({
      id,
      pos,
      target: { x: pos.x, y: pos.y, z: pos.z },
      nextTargetAt: 0,
      nextShotAt: 0,
      sprinting: rng.chance(0.3),
      // Часть ботов идёт на зомби — иначе симуляция почти не проверяет бой.
      fighter: i % 2 === 0
    });
    if (i % 2 === 0) equipPistol(game, id);
  }

  const tickDurations = [];
  let hits = 0;
  let deaths = 0;
  let respawns = 0;
  let pendingRespawn = null;
  let lootPicked = 0;
  let shotsAttempted = 0;
  let maxZombies = 0;
  let zombieSamples = 0;

  const startedAt = process.hrtime.bigint();

  for (let tick = 0; tick < totalTicks; tick += 1) {
    now += tickMs;

    for (let i = 0; i < players.length; i += 1) {
      const sim = players[i];
      const state = game.players.get(sim.id);
      if (!state) continue;

      if (!state.alive) continue;

      // «Бойцы» идут к ближайшему зомби в 25 м, остальные блуждают.
      if (sim.fighter) {
        let prey = null;
        let preyDist = 90;
        for (let z = 0; z < game.zombies.length; z += 1) {
          const zombie = game.zombies[z];
          if (!zombie.alive) continue;
          const dist = V.distance(sim.pos, zombie.pos);
          if (dist < preyDist) {
            preyDist = dist;
            prey = zombie;
          }
        }
        if (prey) sim.target = { x: prey.pos.x, y: prey.pos.y, z: prey.pos.z };
      }

      // Случайное блуждание вокруг точки.
      if (now >= sim.nextTargetAt || V.distance2d(sim.pos, sim.target) < 2.5) {
        sim.nextTargetAt = now + rng.int(4000, 12000);
        sim.target = {
          x: clamp(center.x + rng.float(-120, 120), center.x - 140, center.x + 140),
          y: clamp(center.y + rng.float(-120, 120), center.y - 140, center.y + 140),
          z: center.z
        };
      }
      const speed = sim.sprinting ? 3.4 : 1.4;
      const step = (speed * tickMs) / 1000;
      const next = V.moveTowards(sim.pos, sim.target, step);
      sim.pos = next;
      game.setPlayerState(sim.id, {
        pos: next,
        heading: V.headingTo(sim.pos, sim.target),
        flags: { moving: true, sprinting: sim.sprinting }
      });

      // Стрельба по ближайшему зомби в пределах дальности текущего оружия.
      if (now >= sim.nextShotAt) {
        sim.nextShotAt = now + rng.int(500, 2000);
        let nearest = null;
        const equipped = state.inventory.equipment.primary || state.inventory.equipment.melee;
        const equippedDef = equipped ? game.getItemDef(equipped.itemId) : null;
        const reach = equippedDef && equippedDef.weapon ? Number(equippedDef.weapon.range) || 1.2 : 1.2;
        // Запас 1 м: клиент целится с камеры, сервер допускает погрешность.
        let bestDist = reach + 1;
        for (let z = 0; z < game.zombies.length; z += 1) {
          const zombie = game.zombies[z];
          if (!zombie.alive) continue;
          const dist = V.distance(next, zombie.pos);
          if (dist < bestDist) {
            bestDist = dist;
            nearest = zombie;
          }
        }
        if (nearest) {
          const origin = { x: next.x, y: next.y, z: next.z + 1.6 };
          const target = {
            x: nearest.pos.x + rng.float(-0.4, 0.4),
            y: nearest.pos.y + rng.float(-0.4, 0.4),
            z: nearest.pos.z + rng.float(0.3, 1.5)
          };
          game.handleShot(sim.id, JSON.stringify({
            o: [origin.x, origin.y, origin.z],
            t: [target.x, target.y, target.z]
          }));
          shotsAttempted += 1;
        }
      }

      // Подбор лута.
      if (tick % 20 === i % 20) {
        const before = game.groundItems.length;
        game.handleInteract(sim.id, JSON.stringify({}));
        if (game.groundItems.length < before) lootPicked += 1;
      }

      // Перезарядка раз в ~15 секунд.
      if (tick % 150 === 0) game.handleInventoryAction(sim.id, JSON.stringify({ a: 'reload' }));
    }

    // Возрождение жертвы, у которой истёк таймер (проверяем каждый тик).
    if (pendingRespawn !== null) {
      const dead = game.players.get(pendingRespawn);
      if (!dead || dead.alive) {
        pendingRespawn = null;
      } else if (game.lastTickAt >= dead.respawnAt) {
        game.handleRespawnRequest(dead.id);
        if (dead.alive) respawns += 1;
        pendingRespawn = null;
      }
    }

    // Один игрок раз в 25 секунд погибает — проверяем цикл смерть → таймер → респавн.
    if (tick > 0 && tick % 250 === 0 && players.length > 1) {
      const victim = players[tick % players.length];
      const state = game.players.get(victim.id);
      if (state && state.alive) {
        game.killPlayer(state, 'zombie', null);
        deaths += 1;
        pendingRespawn = state.id;
      }
    }

    const before = Date.now();
    game.tick(now);
    tickDurations.push(Date.now() - before);

    let aliveZombies = 0;
    for (let z = 0; z < game.zombies.length; z += 1) if (game.zombies[z].alive) aliveZombies += 1;
    maxZombies = Math.max(maxZombies, aliveZombies);
    zombieSamples += aliveZombies;

    if (tick % 100 === 0) {
      // Даём игрокам «отдышаться»: иначе зомби съедят их за минуту.
      for (let i = 0; i < players.length; i += 1) {
        const state = game.players.get(players[i].id);
        if (state && state.alive) {
          state.stats.health = Math.min(100, state.stats.health + 12);
          state.stats.hunger = Math.max(20, state.stats.hunger);
          state.stats.thirst = Math.max(20, state.stats.thirst);
          state.stats.bleeding = 0;
        }
      }
    }
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const metrics = game.getMetrics();
  const avgTick = tickDurations.reduce((a, b) => a + b, 0) / Math.max(1, tickDurations.length);
  const sorted = tickDurations.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

  const result = {
    seed: args.seed,
    players: players.length,
    simulatedSeconds: args.seconds,
    wallMs: Math.round(elapsedMs),
    ticks: totalTicks,
    tickAvgMs: Math.round(avgTick * 1000) / 1000,
    tickP95Ms: p95,
    tickMaxMs: Math.max.apply(null, tickDurations.concat([0])),
    zombies: {
      aliveNow: metrics.zombiesAlive,
      maxAlive: maxZombies,
      avgAlive: Math.round((zombieSamples / Math.max(1, totalTicks)) * 10) / 10,
      spawned: metrics.zombiesSpawned,
      killed: metrics.zombiesKilled
    },
    combat: {
      shots: metrics.shots,
      hits: metrics.hits,
      accuracy: metrics.accuracy
    },
    loot: {
      spawned: metrics.itemsSpawned,
      picked: metrics.itemsPicked,
      onGround: metrics.groundItems,
      pickupsBySim: lootPicked
    },
    deaths: {
      playerDeaths: metrics.playerDeaths,
      respawns
    },
    messages: {
      total: net.stats.messages,
      snapshotAvgBytes: metrics.snapshotAvgBytes,
      maxBytesByEvent: net.stats.maxBytes,
      violations: net.stats.violations.slice(0, 10),
      violationCount: net.stats.violations.length
    },
    errors
  };

  const problems = [];
  if (result.messages.violationCount > 0) problems.push(`превышен лимит payload в ${result.messages.violationCount} сообщениях`);
  if (result.messages.snapshotAvgBytes > PAYLOAD_LIMIT) problems.push('средний снапшот больше лимита');
  if (result.zombies.spawned === 0) problems.push('зомби не спавнились');
  if (result.combat.shots === 0) problems.push('не было выстрелов');
  if (result.combat.hits === 0) problems.push('ни один выстрел не зарегистрировал попадание');
  if (result.errors.length) problems.push('в игре были ошибки (см. errors)');
  result.problems = problems;
  result.ok = problems.length === 0;

  if (args.report) {
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(path.resolve(args.report), JSON.stringify(result, null, 2), 'utf8');
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n  GOLD DAYZ — симуляция мира\n');
    console.log(`  seed ${result.seed} | игроков ${result.players} | ${result.simulatedSeconds} с игрового времени | ${result.wallMs} мс CPU`);
    console.log(`  тик: средний ${result.tickAvgMs} мс, p95 ${result.tickP95Ms} мс, максимум ${result.tickMaxMs} мс`);
    console.log(`  зомби: сейчас ${result.zombies.aliveNow}, максимум ${result.zombies.maxAlive}, в среднем ${result.zombies.avgAlive}, заспавнено ${result.zombies.spawned}, убито ${result.zombies.killed}`);
    console.log(`  бой: выстрелов ${result.combat.shots}, попаданий ${result.combat.hits} (${result.combat.accuracy}%)`);
    console.log(`  лут: заспавнено ${result.loot.spawned}, подобрано ${result.loot.picked}, на земле ${result.loot.onGround}`);
    console.log(`  смерти: ${result.deaths.playerDeaths}, респавнов ${result.deaths.respawns}`);
    console.log(`  сеть: сообщений ${result.messages.total}, средний снапшот ${result.messages.snapshotAvgBytes} байт, нарушений лимита ${result.messages.violationCount}`);
    const biggest = Object.keys(result.messages.maxBytesByEvent)
      .map((key) => [key, result.messages.maxBytesByEvent[key]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    console.log(`  крупнейшие payload: ${biggest.map(([key, bytes]) => `${key}=${bytes}B`).join(', ')}`);
    if (result.problems.length) {
      console.log('\n  ПРОБЛЕМЫ:');
      result.problems.forEach((problem) => console.log(`   ❌ ${problem}`));
      if (result.messages.violations.length) console.log('   ', JSON.stringify(result.messages.violations, null, 2));
    } else {
      console.log('\n  ✅ симуляция прошла без проблем\n');
    }
  }

  process.exit(result.ok ? 0 : 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

main().catch((err) => {
  console.error(`[sim] фатальная ошибка: ${err.stack || err.message}`);
  process.exit(2);
});
