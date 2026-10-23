'use strict';

/**
 * GOLD DAYZ — главный конфиг сервера.
 * Все числа и таблицы баланса подобраны под классику MTA DayZ (TOP-GTA.RU).
 */

/* ---------------------------------- MySQL ---------------------------------- */
const db = {
	host: '127.0.0.1',
	port: 3306,
	user: 'root',
	password: 'password', // ← пароль от MySQL/MariaDB
	database: 'gold_dayz',
	charset: 'utf8mb4'
};

/* --------------------------------- Выживание -------------------------------- */
const survival = {
	BLOOD_MAX: 12000,          // кровь — ровно 12000 (как в MTA DayZ)
	FOOD_MAX: 100,
	WATER_MAX: 100,

	FOOD_DECAY_PER_SEC: 0.045, // голод: 100 ед. ~ 35 минут
	WATER_DECAY_PER_SEC: 0.06, // жажда: 100 ед. ~ 28 минут

	BLOOD_LOSS_STARVING: 2,    // -2 крови/сек, когда голод = 0
	BLOOD_LOSS_THIRST: 3,      // -3 крови/сек, когда жажда = 0

	REGEN_INTERVAL_MS: 5000,   // реген каждые 5 сек
	REGEN_AMOUNT: 15,          // +15 крови, если еда>50, вода>50, нет кровотечения
	REGEN_FOOD_MIN: 50,
	REGEN_WATER_MIN: 50,

	BLEEDING_DAMAGE_PER_LVL: 2.5, // кровотечение: урон в сек на уровень (1..3)
	TEMP_MIN_SAFE: 34,
	TEMP_MAX_SAFE: 41,
	TEMP_DAMAGE_LOW: 1.5,      // -крови/сек при переохлаждении
	TEMP_DAMAGE_HIGH: 2,       // -крови/сек при перегреве

	SHOCK_DECAY_PER_SEC: 1,
	SHOCK_MAX: 100,
	SHOCK_DAMAGE_THRESHOLD: 85,   // шок > 85 → паника, -крови/сек
	SHOCK_DAMAGE_PER_SEC: 0.5,

	DAMAGE_TO_BLOOD: 12,       // множитель: 1 ед. GTA-урона = 12 крови DayZ
	FALL_FRACTURE_THRESHOLD: 35,  // падение с таким уроном → риск перелома
	FALL_FRACTURE_CHANCE: 0.15,

	ZOMBIE_DAMAGE: 220,        // крови за укус/удар зомби
	ZOMBIE_ATTACK_CD_MS: 1600, // пауза между ударами
	ZOMBIE_BLEED_CHANCE: 0.3,  // шанс кровотечения от зомби
	ZOMBIE_FRACTURE_CHANCE: 0.08
};

/* ---------------------------------- Инвентарь -------------------------------- */
const inventory = {
	maxWeight: 30, // кг
	limits: {      // слоты по категориям (1 стак = 1 слот)
		weapon: 2,
		ammo: 4,
		tool: 4,
		medical: 4,
		food: 4,
		part: 3
	},
	equipLimit: 3, // сколько стволов можно экипировать одновременно

	items: {
		/* --- Медицина (хардкор) --- */
		bandage:     { name: 'Бинт',              cat: 'medical', weight: 0.3,  stack: 20, use: 'bandage' },
		painkillers: { name: 'Обезболивающие',    cat: 'medical', weight: 0.1,  stack: 20, use: 'painkiller' },
		morphine:    { name: 'Морфин',            cat: 'medical', weight: 0.2,  stack: 10, use: 'morphine' },

		/* --- Еда/вода --- */
		canned_food: { name: 'Консервы',          cat: 'food', weight: 0.4, stack: 20, use: 'eat',   food: 45 },
		water_bottle:{ name: 'Бутылка воды',      cat: 'food', weight: 0.5, stack: 20, use: 'drink', water: 45 },
		soda:        { name: 'Газировка',         cat: 'food', weight: 0.35, stack: 20, use: 'drink', water: 25 },

		/* --- Оружие (ставить/снимать через «Использовать») --- */
		knife:        { name: 'Нож',          cat: 'weapon', weight: 0.3, stack: 3, use: 'equip', weapon: 'WEAPON_KNIFE',       ammo: 1 },
		crowbar:      { name: 'Лом',          cat: 'weapon', weight: 1.6, stack: 3, use: 'equip', weapon: 'WEAPON_CROWBAR',     ammo: 1 },
		machete:      { name: 'Мачете',       cat: 'weapon', weight: 1.0, stack: 3, use: 'equip', weapon: 'WEAPON_MACHETE',     ammo: 1 },
		flashlight:   { name: 'Фонарик',      cat: 'tool',   weight: 0.4, stack: 5, use: 'equip', weapon: 'WEAPON_FLASHLIGHT',  ammo: 1 },
		pistol:       { name: 'Пистолет',     cat: 'weapon', weight: 1.1, stack: 3, use: 'equip', weapon: 'WEAPON_PISTOL',      ammo: 60 },
		microsmg:     { name: 'Micro SMG',    cat: 'weapon', weight: 2.6, stack: 2, use: 'equip', weapon: 'WEAPON_MICROSMG',    ammo: 120 },
		pumpshotgun:  { name: 'Дробовик',     cat: 'weapon', weight: 3.4, stack: 2, use: 'equip', weapon: 'WEAPON_PUMPSHOTGUN', ammo: 40 },

		/* --- Патроны (докладываются в экипированное оружие) --- */
		ammo_9mm:  { name: 'Патроны 9мм',    cat: 'ammo', weight: 0.02, stack: 60, use: 'ammo', add: 60,  for: ['WEAPON_PISTOL', 'WEAPON_MICROSMG'] },
		ammo_12g:  { name: 'Патроны 12 кал.', cat: 'ammo', weight: 0.04, stack: 40, use: 'ammo', add: 24,  for: ['WEAPON_PUMPSHOTGUN'] },

		/* --- Детали для машин --- */
		engine:  { name: 'Двигатель',          cat: 'part', weight: 12, stack: 2 },
		wheels:  { name: 'Колёса (комплект)',  cat: 'part', weight: 8,  stack: 2 },
		jerrycan:{ name: 'Канистра бензина',   cat: 'part', weight: 5,  stack: 3 }
	}
};

/* ------------------------------ Зомби / режимы ночи ------------------------------ */
const zombies = {
	model: 'u_m_y_zombie_01',   // проверенная модель; запасные: 'g_m_m_zombie_04', 'g_m_m_zombie_05'
	maxPerPlayer: 25,           // лимит стрим-зоны: 20–30 на игрока
	maxSpawnPerTick: 4,         // сколько заспавнить за один тик менеджмента
	spawnRadiusMin: 45,         // кольцо спавна вокруг игрока
	spawnRadiusMax: 130,        // не дальше (stream-distance ~400, зомби в радиусе видимости)
	despawnRadius: 170,         // дальше — деспавн
	manageIntervalMs: 3000,    // тик менеджмента (спавн/деспавн/владелец)
	aiIntervalMs: 1000,         // тик агро/атаки
	attackRange: 1.7,           // дистанция удара
	aggroBaseSlow: 16,          // «Медленные зомби / светлая ночь»
	aggroBaseFast: 28,          // «Быстрые зомби / тёмная ночь»
	aggroNoiseFactor: 0.45,     // + радиус от шума бега
	aggroShotPulse: 55,         // + радиус в течение 8 сек после выстрела
	shotPulseMs: 8000,
	speedRateSlow: 0.6,         // множитель скорости бега (натив SET_PED_MOVE_RATE_OVERRIDE)
	speedRateFast: 1.65
};

/* --------------------------------- Режимы мира --------------------------------- */
const world = {
	defaultMode: 'slow',        // 'slow' — Медленные зомби / светлая ночь
	modes: {
		slow: { hour: 21, minute: 30, weather: 'CLEAR',       nightOverlay: 0.10 }, // лёгкая ночь
		fast: { hour: 2,  minute: 0,  weather: 'CLEAR',       nightOverlay: 0.42 }  // тёмная ночь, зомби бегают
	}
};

/* ---------------------------------- Спавн игрока ---------------------------------- */
// Примерные координаты — замените на свои (удобно искать через /pos в игре)
const spawnPoints = [
	{ x: 195.7,  y: -933.1,  z: 30.7 },   // Легион-сквер (центр LS)
	{ x: 87.0,   y: -1959.4, z: 21.1 },   // Грув-стрит
	{ x: -1180.6,y: -1511.5, z: 3.8 },    // Пляж Веспуччи
	{ x: 1839.6, y: 3672.9,  z: 34.3 },   // Сэнди-Шорс
	{ x: -108.6, y: 6469.6,  z: 31.6 },   // Палето-Бэй
	{ x: 285.4,  y: 143.5,   z: 104.2 }   // Вайнвуд
];

/* ---------------------------------- Машины ---------------------------------- */
// Все машины спавнятся БРОКНИМИ: нет двигателя, нет колёс, бак пуст.
const vehicleSpawns = [
	{ model: 'asea',    pos: { x: 214.6,  y: -810.4,  z: 30.7 },  heading: 160.0 },
	{ model: 'sultan',  pos: { x: 100.6,  y: -1975.5, z: 21.1 },  heading: 320.0 },
	{ model: 'blista',  pos: { x: -1193.4,y: -1495.6, z: 4.4 },   heading: 85.0 },
	{ model: 'granger', pos: { x: 1847.7, y: 3678.9,  z: 34.3 },  heading: 30.0 },
	{ model: 'sadler',  pos: { x: -458.9, y: -886.6,  z: 23.4 },  heading: 90.0 },
	{ model: 'mule',    pos: { x: -108.3, y: 6468.9,  z: 31.6 },  heading: 45.0 }
];

const vehicleConfig = {
	fuelTank: 100,          // литров
	fuelBurnPerSec: 0.08,   // расход при заведённом моторе
	jerrycanFuel: 20,       // сколько литров даёт одна канистра
	panelDistance: 4.0,     // радиус доступа к машине
	saveIntervalMs: 30000
};

/* ----------------------------------- Лут ----------------------------------- */
// Зоны: военные базы, больницы, города. z фиксирован — улицы ровные.
const lootZones = [
	{ id: 'zancudo', name: 'Форт-Занкудо',   center: { x: -2047.0, y: 3132.0, z: 32.8 }, radius: 110, count: 18, table: 'military' },
	{ id: 'hospital',name: 'Больница',       center: { x: 298.6,   y: -584.6, z: 43.3 }, radius: 35,  count: 10, table: 'medical' },
	{ id: 'grove',   name: 'Грув-стрит',     center: { x: 87.0,    y: -1959.4, z: 21.1 }, radius: 120, count: 14, table: 'city' },
	{ id: 'legion',  name: 'Легион-сквер',   center: { x: 195.7,   y: -933.1,  z: 30.7 }, radius: 120, count: 14, table: 'city' },
	{ id: 'sandy',   name: 'Сэнди-Шорс',     center: { x: 1839.6,  y: 3672.9,  z: 34.3 }, radius: 110, count: 12, table: 'town' },
	{ id: 'paleto',  name: 'Палето-Бэй',     center: { x: -108.6,  y: 6469.6,  z: 31.6 }, radius: 100, count: 12, table: 'town' }
];

// Таблицы лута: [ключ предмета, вес выпадения]
const lootTables = {
	military: [
		['ammo_9mm', 20], ['ammo_12g', 12], ['pistol', 6], ['microsmg', 4],
		['pumpshotgun', 4], ['engine', 4], ['wheels', 6], ['jerrycan', 8],
		['flashlight', 8], ['bandage', 8], ['painkillers', 6], ['morphine', 3],
		['knife', 5], ['crowbar', 6]
	],
	medical: [
		['bandage', 30], ['painkillers', 22], ['morphine', 12],
		['water_bottle', 10], ['soda', 10], ['canned_food', 8]
	],
	city: [
		['canned_food', 20], ['water_bottle', 18], ['soda', 14], ['bandage', 10],
		['painkillers', 8], ['crowbar', 6], ['flashlight', 6], ['jerrycan', 6],
		['wheels', 3], ['engine', 2], ['knife', 5], ['ammo_9mm', 5]
	],
	town: [
		['canned_food', 22], ['water_bottle', 18], ['soda', 12], ['bandage', 12],
		['painkillers', 8], ['crowbar', 6], ['flashlight', 6], ['jerrycan', 7],
		['wheels', 4], ['knife', 5], ['ammo_9mm', 4]
	],
	zombieDrop: [
		['canned_food', 25], ['water_bottle', 20], ['bandage', 15],
		['ammo_9mm', 12], ['soda', 12], ['painkillers', 8], ['knife', 4], ['crowbar', 4]
	]
};

const lootConfig = {
	groundTakeDistance: 3.5,  // радиус «Взять» с земли
	respawnMs: 8 * 60 * 1000, // респавн лута в зонах: 8 минут
	zombieDropChance: 0.45,   // шанс дропа с убитого зомби
	lootModel: 'prop_cs_cardbox_01' // визуал контейнера (можно заменить на свой проп)
};

/* ---------------------------------- Сохранение ---------------------------------- */
const save = {
	intervalMs: 60000,        // автосейв персонажей
	respawnDelayMs: 5000      // респавн через 5 сек после смерти
};

module.exports = {
	db, survival, inventory, zombies, world,
	spawnPoints, vehicleSpawns, vehicleConfig,
	lootZones, lootTables, lootConfig, save
};
