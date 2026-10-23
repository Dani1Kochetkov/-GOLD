'use strict';

class InventoryStore {
  constructor(itemConfig, initialState) {
    this.itemConfig = itemConfig;
    this.state = initialState || {};
  }

  get(key) {
    if (!this.state[key]) this.state[key] = {};
    const inventory = {};
    for (const itemId of Object.keys(this.itemConfig)) {
      const count = Number(this.state[key][itemId]);
      inventory[itemId] = Number.isFinite(count)
        ? Math.max(0, Math.min(this.itemConfig[itemId].max, Math.floor(count)))
        : 0;
    }
    return inventory;
  }

  add(key, itemId, amount) {
    const item = this.itemConfig[itemId];
    if (!item || !Number.isInteger(amount) || amount <= 0) return false;
    const inventory = this.get(key);
    if (inventory[itemId] + amount > item.max) return false;
    inventory[itemId] += amount;
    this.state[key] = inventory;
    return true;
  }

  consume(key, itemId, amount) {
    if (!this.itemConfig[itemId] || !Number.isInteger(amount) || amount <= 0) return false;
    const inventory = this.get(key);
    if (inventory[itemId] < amount) return false;
    inventory[itemId] -= amount;
    this.state[key] = inventory;
    return true;
  }
}

class ZombieDirector {
  constructor(config, random) {
    this.config = config;
    this.random = random || Math.random;
    this.zombies = new Map();
    this.nextId = 1;
  }

  seed() {
    for (const zone of this.config.zones) {
      const count = Math.ceil(this.config.maxAlive / this.config.zones.length);
      for (let i = 0; i < count && this.zombies.size < this.config.maxAlive; i += 1) {
        const angle = this.random() * Math.PI * 2;
        const radius = Math.sqrt(this.random()) * zone.radius;
        this.spawn({
          x: zone.x + Math.cos(angle) * radius,
          y: zone.y + Math.sin(angle) * radius,
          z: zone.z
        });
      }
    }
  }

  spawn(position) {
    if (this.zombies.size >= this.config.maxAlive) return null;
    const id = String(this.nextId++);
    const zombie = { id, x: position.x, y: position.y, z: position.z, health: this.config.health };
    this.zombies.set(id, zombie);
    return zombie;
  }

  snapshot() {
    return Array.from(this.zombies.values()).map((zombie) => ({
      id: zombie.id, x: zombie.x, y: zombie.y, z: zombie.z, health: zombie.health
    }));
  }

  damage(id, amount) {
    const zombie = this.zombies.get(String(id));
    if (!zombie || !Number.isFinite(amount) || amount <= 0) return null;
    zombie.health = Math.max(0, zombie.health - Math.floor(amount));
    const result = { id: zombie.id, health: zombie.health, dead: zombie.health === 0 };
    if (result.dead) this.zombies.delete(zombie.id);
    return result;
  }
}

function distance3d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

module.exports = { InventoryStore, ZombieDirector, distance3d };
