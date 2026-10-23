'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryStore, ZombieDirector, distance3d } = require('../packages/gold-dayz/src/game');
const settings = require('../shared/settings.json');

test('inventory rejects unknown items and enforces configured capacity', () => {
  const inventory = new InventoryStore(settings.inventory, {});
  assert.equal(inventory.add('tester', 'food', 2), true);
  assert.equal(inventory.add('tester', 'food', 19), false);
  assert.equal(inventory.add('tester', 'not-an-item', 1), false);
  assert.equal(inventory.consume('tester', 'food', 1), true);
  assert.equal(inventory.get('tester').food, 1);
});

test('zombie director seeds bounded count and removes dead zombies', () => {
  const director = new ZombieDirector(settings.zombie, () => 0.5);
  director.seed();
  assert.equal(director.zombies.size, settings.zombie.maxAlive);
  const id = director.snapshot()[0].id;
  assert.equal(director.damage(id, settings.zombie.health).dead, true);
  assert.equal(director.zombies.has(id), false);
});

test('distance helper includes vertical separation', () => {
  assert.equal(distance3d({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }), 13);
});
