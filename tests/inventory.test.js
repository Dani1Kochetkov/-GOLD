'use strict';

const test = require('node:test');
const assert = require('node:assert');
const INV = require('../shared/inventory');

function makeItems() {
  return INV.indexItems([
    { id: 'bandage', name: 'Бинт', stack: 10, weight: 0.1 },
    { id: 'pistol', name: 'Пистолет', stack: 1, weight: 1.4, slot: 'primary', equipable: true, weapon: { hash: 1, ammoType: 'ammo9', mag: 12, damage: 20, range: 30, rate: 200 } },
    { id: 'ammo9', name: '9мм', stack: 120, weight: 0.02, ammo: true },
    { id: 'backpack', name: 'Рюкзак', stack: 1, weight: 0.5, slot: 'back', equipable: true, storage: 6 },
    { id: 'vest', name: 'Разгрузка', stack: 1, weight: 2, slot: 'armor', equipable: true, storage: 2, damageReduction: 0.15 },
    { id: 'map', name: 'Карта', stack: 1, weight: 0.2 },
    { id: 'heavy', name: 'Тяжёлый', stack: 1, weight: 20 }
  ]);
}

test('инвентарь: базовый размер и стаки', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  assert.strictEqual(inv.slots.length, 18);
  const res = INV.addItem(inv, items, 'bandage', 7, null, {});
  assert.strictEqual(res.added, 7);
  assert.strictEqual(INV.countItem(inv, 'bandage'), 7);

  INV.addItem(inv, items, 'bandage', 8, null, {});
  assert.strictEqual(INV.countItem(inv, 'bandage'), 15);
  // 10 в первом стаке + 5 во втором
  const stacks = inv.slots.filter((slot) => slot && slot.itemId === 'bandage').map((slot) => slot.count);
  assert.deepStrictEqual(stacks.sort((a, b) => b - a), [10, 5]);
});

test('инвентарь: переполнение по слотам возвращает leftover', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1', 3);
  INV.addItem(inv, items, 'map', 1, null, {});
  INV.addItem(inv, items, 'heavy', 1, null, {});
  INV.addItem(inv, items, 'vest', 1, null, {});
  const res = INV.addItem(inv, items, 'bandage', 5, null, {});
  assert.strictEqual(res.added, 0);
  assert.strictEqual(res.leftover, 5);
  assert.strictEqual(res.reason, 'no-space');
});

test('инвентарь: ограничение по весу', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  const res = INV.addItem(inv, items, 'heavy', 3, null, { maxWeight: 30 });
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.leftover, 2);
  assert.strictEqual(INV.totalWeight(inv, items), 20);
});

test('инвентарь: экипировка добавляет слоты и бонусы', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  INV.addItem(inv, items, 'backpack', 1, null, {});
  const backpackIndex = INV.findSlot(inv, 'backpack');
  const equip = INV.equip(inv, items, backpackIndex);
  assert.strictEqual(equip.ok, true);
  assert.strictEqual(equip.equipSlot, 'back');
  assert.strictEqual(INV.slotCount(inv, items), 24);
  INV.ensureSlots(inv, items);
  assert.strictEqual(inv.slots.length, 24);

  INV.addItem(inv, items, 'vest', 1, null, {});
  const vestIndex = INV.findSlot(inv, 'vest');
  assert.strictEqual(INV.equip(inv, items, vestIndex).ok, true);
  const bonus = INV.equipBonuses(inv, items);
  assert.strictEqual(bonus.storage, 8);
  assert.ok(Math.abs(bonus.damageReduction - 0.15) < 1e-9);
});

test('инвентарь: нельзя снять рюкзак с занятыми верхними слотами', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  INV.addItem(inv, items, 'backpack', 1, null, {});
  INV.equip(inv, items, INV.findSlot(inv, 'backpack'));
  INV.ensureSlots(inv, items);
  // Забиваем последний слот (23) предметом.
  inv.slots[23] = { itemId: 'map', count: 1, meta: null };
  const res = INV.unequip(inv, items, 'back');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'storage-busy');
  assert.ok(inv.equipment.back, 'рюкзак должен остаться надетым');
});

test('инвентарь: перемещение и удаление предметов', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  INV.addItem(inv, items, 'bandage', 3, null, {});
  INV.addItem(inv, items, 'map', 1, null, {});
  assert.strictEqual(inv.slots[0].itemId, 'bandage');
  assert.strictEqual(inv.slots[1].itemId, 'map');
  assert.strictEqual(INV.moveSlot(inv, 0, 1), true);
  assert.strictEqual(inv.slots[0].itemId, 'map');
  assert.strictEqual(inv.slots[1].itemId, 'bandage');

  const removed = INV.removeItem(inv, items, 'bandage', 2);
  assert.strictEqual(removed.removed, 2);
  assert.strictEqual(INV.countItem(inv, 'bandage'), 1);
  const rest = INV.removeItem(inv, items, 'bandage', 5);
  assert.strictEqual(rest.removed, 1);
  assert.strictEqual(rest.leftover, 4);
});

test('инвентарь: перезарядка оружия', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  INV.addItem(inv, items, 'pistol', 1, null, {});
  INV.addItem(inv, items, 'ammo9', 30, null, {});
  const slot = INV.findSlot(inv, 'pistol');
  const loaded = INV.loadWeapon(inv, items, slot, 'ammo9');
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.ammo, 12);
  assert.strictEqual(INV.countItem(inv, 'ammo9'), 18);

  const repeat = INV.loadWeapon(inv, items, slot, 'ammo9');
  assert.strictEqual(repeat.loaded, 0);

  INV.consumeAmmo(INV.getSlot(inv, slot), 5);
  assert.strictEqual(INV.getSlot(inv, slot).meta.ammo, 7);
  const reload = INV.loadWeapon(inv, items, slot, 'ammo9');
  assert.strictEqual(reload.loaded, 5);
  assert.strictEqual(reload.ammo, 12);
});

test('инвентарь: санитайзер отбрасывает неизвестные предметы', () => {
  const items = makeItems();
  const inv = INV.sanitizeInventory({
    id: 'x',
    slots: [
      { itemId: 'hack', count: 999, meta: null },
      { itemId: 'bandage', count: 999, meta: null },
      null,
      { itemId: 'pistol', count: 1, meta: { ammo: 5 } }
    ],
    equipment: { primary: { itemId: 'hack' }, melee: { itemId: 'pistol' } }
  }, items);
  assert.strictEqual(INV.countItem(inv, 'hack'), 0);
  assert.strictEqual(INV.countItem(inv, 'bandage'), 10, 'стак обрезан до максимума');
  assert.strictEqual(inv.equipment.primary, null, 'несуществующий предмет снят');
  assert.strictEqual(inv.equipment.melee, null, 'оружие не в том слоте снято');
});

test('инвентарь: вес экипировки учитывается', () => {
  const items = makeItems();
  const inv = INV.createInventory('p1');
  INV.addItem(inv, items, 'vest', 1, null, {});
  INV.equip(inv, items, INV.findSlot(inv, 'vest'));
  assert.strictEqual(INV.totalWeight(inv, items), 2);
});
