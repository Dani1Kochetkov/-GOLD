'use strict';

/**
 * Чистая модель инвентаря GOLD DAYZ (без RAGE API).
 *
 * Контейнер: { id, slots: (Slot|null)[], equipment: { primary, melee, ... } }
 * Слот:      { itemId: string, count: number, meta: object|null }
 *
 * Вся логика — функции над обычными объектами: её можно прогонять в тестах,
 * в симуляторе и на сервере RAGE без изменений.
 */

const { INVENTORY, ITEM_SLOTS } = require('./constants');

function emptyEquipment() {
  const eq = {};
  for (let i = 0; i < ITEM_SLOTS.length; i += 1) eq[ITEM_SLOTS[i]] = null;
  return eq;
}

function createInventory(id, size) {
  const base = Math.max(1, Math.floor(size || INVENTORY.BASE_SLOTS));
  return {
    id: id || 'player',
    // base — количество слотов без экипировки. Бонус рюкзака считается сверху.
    base,
    slots: new Array(base).fill(null),
    equipment: emptyEquipment()
  };
}

function indexItems(list) {
  const map = Object.create(null);
  for (let i = 0; i < list.length; i += 1) {
    const def = list[i];
    if (!def || !def.id) continue;
    map[def.id] = def;
  }
  return map;
}

function itemDef(items, itemId) {
  if (!items || !itemId) return null;
  return items[itemId] || null;
}

function isStackable(def) {
  return !!def && (Number(def.stack) || 1) > 1;
}

function metaKey(meta) {
  if (!meta) return '';
  return JSON.stringify(meta);
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  if (Number.isFinite(Number(meta.ammo))) out.ammo = Math.max(0, Math.floor(Number(meta.ammo)));
  if (Number.isFinite(Number(meta.durability))) out.durability = Math.max(0, Math.min(100, Number(meta.durability)));
  return Object.keys(out).length ? out : null;
}

/** Сколько слотов должно быть у контейнера с учётом рюкзака/разгрузки. */
function slotCount(container, items) {
  let bonus = 0;
  const eq = container.equipment || {};
  for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
    const equipped = eq[ITEM_SLOTS[i]];
    if (!equipped) continue;
    const def = itemDef(items, equipped.itemId);
    if (def && def.storage) bonus += Number(def.storage) || 0;
  }
  const base = Math.max(1, Math.floor(Number(container.base) || INVENTORY.BASE_SLOTS));
  return Math.min(INVENTORY.MAX_SLOTS, base + bonus);
}

/** Доращивает массив слотов до актуального размера (никогда не уменьшает). */
function ensureSlots(container, items) {
  const target = slotCount(container, items);
  while (container.slots.length < target) container.slots.push(null);
  return container.slots.length;
}

function weightOfEntry(def, count) {
  if (!def) return 0;
  return (Number(def.weight) || 0) * Math.max(1, Number(count) || 1);
}

function totalWeight(container, items) {
  let weight = 0;
  for (let i = 0; i < container.slots.length; i += 1) {
    const slot = container.slots[i];
    if (!slot) continue;
    weight += weightOfEntry(itemDef(items, slot.itemId), slot.count);
  }
  const eq = container.equipment || {};
  for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
    const equipped = eq[ITEM_SLOTS[i]];
    if (!equipped) continue;
    weight += weightOfEntry(itemDef(items, equipped.itemId), 1);
  }
  return Math.round(weight * 100) / 100;
}

function capacityKg(container, extra) {
  return INVENTORY.BASE_CAPACITY_KG + (Number(extra) || 0);
}

function countItem(container, itemId) {
  let total = 0;
  for (let i = 0; i < container.slots.length; i += 1) {
    const slot = container.slots[i];
    if (slot && slot.itemId === itemId) total += slot.count;
  }
  return total;
}

function findSlot(container, itemId) {
  for (let i = 0; i < container.slots.length; i += 1) {
    const slot = container.slots[i];
    if (slot && slot.itemId === itemId) return i;
  }
  return -1;
}

function getSlot(container, index) {
  if (!Number.isInteger(index) || index < 0 || index >= container.slots.length) return null;
  return container.slots[index];
}

/**
 * Добавляет предметы.
 * @param {object} opts { maxWeight?: number, preferStack?: boolean }
 * @returns {{added:number, leftover:number, reason:string|null}}
 */
function addItem(container, items, itemId, count, meta, opts) {
  const def = itemDef(items, itemId);
  const options = opts || {};
  const requested = Math.floor(Number(count) || 0);
  let remaining = requested;
  if (!def || requested <= 0) {
    return { added: 0, leftover: Math.max(0, requested), reason: def ? 'bad-count' : 'unknown-item' };
  }

  // Ограничение по весу: сколько единиц вообще помещается.
  let overweight = false;
  if (Number.isFinite(options.maxWeight)) {
    const free = Math.max(0, Number(options.maxWeight) - totalWeight(container, items));
    const unit = Number(def.weight) || 0;
    if (unit > 0) {
      const allowedByWeight = Math.floor((free + 1e-9) / unit);
      if (allowedByWeight < remaining) {
        remaining = Math.max(0, Math.min(remaining, allowedByWeight));
        overweight = true;
      }
    }
  }

  ensureSlots(container, items);
  const maxStack = Math.max(1, Math.floor(Number(def.stack) || 1));
  const normalizedMeta = normalizeMeta(meta);
  const stackable = maxStack > 1 && !normalizedMeta;
  let added = 0;

  if (stackable) {
    for (let i = 0; i < container.slots.length && remaining > 0; i += 1) {
      const slot = container.slots[i];
      if (!slot || slot.itemId !== itemId || slot.meta) continue;
      const space = maxStack - slot.count;
      if (space <= 0) continue;
      const put = Math.min(space, remaining);
      slot.count += put;
      remaining -= put;
      added += put;
    }
  }

  for (let i = 0; i < container.slots.length && remaining > 0; i += 1) {
    if (container.slots[i]) continue;
    const put = Math.min(maxStack, remaining);
    container.slots[i] = { itemId, count: put, meta: normalizedMeta };
    remaining -= put;
    added += put;
  }

  return {
    added,
    leftover: Math.max(0, requested - added),
    reason: added < requested ? (overweight ? 'overweight' : 'no-space') : null
  };
}

/**
 * Удаляет предметы. Начинает с последних слотов, чтобы не рвать первый стак.
 * @returns {{removed:number, leftover:number}}
 */
function removeItem(container, items, itemId, count) {
  let remaining = Math.floor(Number(count) || 0);
  let removed = 0;
  if (remaining <= 0) return { removed: 0, leftover: 0 };
  for (let i = container.slots.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const slot = container.slots[i];
    if (!slot || slot.itemId !== itemId) continue;
    const take = Math.min(slot.count, remaining);
    slot.count -= take;
    remaining -= take;
    removed += take;
    if (slot.count <= 0) container.slots[i] = null;
  }
  return { removed, leftover: remaining };
}

function removeFromSlot(container, index, count) {
  const slot = getSlot(container, index);
  if (!slot) return { removed: null, leftover: 0 };
  const take = Math.max(1, Math.floor(Number(count) || slot.count));
  if (take >= slot.count) {
    container.slots[index] = null;
    return { removed: { itemId: slot.itemId, count: slot.count, meta: slot.meta }, leftover: 0 };
  }
  slot.count -= take;
  return { removed: { itemId: slot.itemId, count: take, meta: slot.meta }, leftover: 0 };
}

function moveSlot(container, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || to < 0 || from >= container.slots.length || to >= container.slots.length) return false;
  if (from === to) return true;
  const a = container.slots[from];
  const b = container.slots[to];
  container.slots[from] = b;
  container.slots[to] = a;
  return true;
}

function equippedSlotFor(def) {
  if (!def || !def.slot || def.slot === 'none') return null;
  return ITEM_SLOTS.indexOf(def.slot) >= 0 ? def.slot : null;
}

/**
 * Проверяет, не окажутся ли предметы «за пределами» инвентаря,
 * если снять экипировку (например, снять рюкзак с полным верхним слотом).
 */
function wouldOrphanSlots(container, items, equipSlot) {
  const saved = container.equipment[equipSlot];
  if (!saved) return false;
  const def = itemDef(items, saved.itemId);
  if (!def || !def.storage) return false;
  container.equipment[equipSlot] = null;
  const target = slotCount(container, items);
  container.equipment[equipSlot] = saved;
  for (let i = target; i < container.slots.length; i += 1) {
    if (container.slots[i]) return true;
  }
  return false;
}

/** Убирает пустые хвостовые слоты, если бонус к слотам пропал. */
function trimSlots(container, items) {
  let target = slotCount(container, items);
  for (let i = container.slots.length - 1; i >= 0; i -= 1) {
    if (container.slots[i]) {
      target = Math.max(target, i + 1);
      break;
    }
  }
  while (container.slots.length > target) container.slots.pop();
  return container.slots.length;
}

function equip(container, items, index) {
  const slot = getSlot(container, index);
  if (!slot) return { ok: false, reason: 'empty-slot' };
  const def = itemDef(items, slot.itemId);
  const targetSlot = equippedSlotFor(def);
  if (!def || !targetSlot) return { ok: false, reason: 'not-equipable' };
  if (!def.equipable) return { ok: false, reason: 'not-equipable' };

  ensureSlots(container, items);
  const previous = container.equipment[targetSlot];
  if (previous) {
    const back = addItem(container, items, previous.itemId, 1, previous.meta, {});
    if (!back.added) return { ok: false, reason: 'no-space' };
  }
  container.equipment[targetSlot] = { itemId: slot.itemId, count: 1, meta: slot.meta || null };
  container.slots[index] = null;
  ensureSlots(container, items);
  return { ok: true, equipSlot: targetSlot };
}

function unequip(container, items, equipSlot) {
  if (ITEM_SLOTS.indexOf(equipSlot) < 0) return { ok: false, reason: 'bad-slot' };
  const equipped = container.equipment[equipSlot];
  if (!equipped) return { ok: false, reason: 'empty' };
  ensureSlots(container, items);
  const def = itemDef(items, equipped.itemId);
  if (def && def.storage) {
    // Сначала кладём саму экипировку в рюкзак: это может занять верхний слот.
    const res = addItem(container, items, equipped.itemId, 1, equipped.meta, {});
    if (!res.added) return { ok: false, reason: 'no-space' };
    container.equipment[equipSlot] = null;
    const base = slotCount(container, items);
    for (let i = base; i < container.slots.length; i += 1) {
      if (container.slots[i]) {
        // Возврат рюкзака обратно — состояние остаётся консистентным.
        container.equipment[equipSlot] = equipped;
        removeItem(container, items, equipped.itemId, 1);
        return { ok: false, reason: 'storage-busy' };
      }
    }
    trimSlots(container, items);
    return { ok: true };
  }
  const res = addItem(container, items, equipped.itemId, 1, equipped.meta, {});
  if (!res.added) return { ok: false, reason: 'no-space' };
  container.equipment[equipSlot] = null;
  return { ok: true };
}

function getEquipped(container, equipSlot) {
  return (container.equipment && container.equipment[equipSlot]) || null;
}

function hasEquipped(container, itemId) {
  const eq = container.equipment || {};
  for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
    const item = eq[ITEM_SLOTS[i]];
    if (item && item.itemId === itemId) return true;
  }
  return false;
}

function equipBonuses(container, items) {
  const bonus = { storage: 0, damageReduction: 0, gasProtection: 0, radio: false, flashlight: false };
  const eq = container.equipment || {};
  for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
    const equipped = eq[ITEM_SLOTS[i]];
    if (!equipped) continue;
    const def = itemDef(items, equipped.itemId);
    if (!def) continue;
    bonus.storage += Number(def.storage) || 0;
    bonus.damageReduction += Number(def.damageReduction) || 0;
    bonus.gasProtection += Number(def.gasProtection) || 0;
    if (def.radio) bonus.radio = true;
  }
  return bonus;
}

/** Загружает оружие патронами из инвентаря. Возвращает {loaded, ammo}. */
function loadWeapon(container, items, weaponSlot, ammoItemId) {
  const slot = getSlot(container, weaponSlot);
  if (!slot) return { ok: false, reason: 'empty-slot' };
  const def = itemDef(items, slot.itemId);
  if (!def || !def.weapon || !def.weapon.ammoType) return { ok: false, reason: 'not-firearm' };
  if (ammoItemId && ammoItemId !== def.weapon.ammoType) return { ok: false, reason: 'wrong-ammo' };
  const magSize = Math.max(0, Number(def.weapon.mag) || 0);
  const meta = slot.meta || {};
  const current = Math.max(0, Math.min(magSize, Number(meta.ammo) || 0));
  const need = magSize - current;
  if (need <= 0) return { ok: true, loaded: 0, ammo: current };
  const available = countItem(container, def.weapon.ammoType);
  const take = Math.min(need, available);
  if (take <= 0) return { ok: false, reason: 'no-ammo' };
  removeItem(container, items, def.weapon.ammoType, take);
  slot.meta = { ammo: current + take };
  return { ok: true, loaded: take, ammo: current + take };
}

/** Снимает N патронов из магазина оружия (вызывается по выстрелу). */
function consumeAmmo(slot, count) {
  if (!slot || !slot.meta || !Number.isFinite(Number(slot.meta.ammo))) return 0;
  const take = Math.max(0, Math.min(slot.meta.ammo, Math.floor(Number(count) || 1)));
  slot.meta.ammo -= take;
  return take;
}

/** Валидация инвентаря, пришедшего из storage/сети. */
function sanitizeInventory(raw, items, fallbackSize) {
  const inv = createInventory((raw && raw.id) || 'player', fallbackSize || INVENTORY.BASE_SLOTS);
  if (!raw || !Array.isArray(raw.slots)) return inv;
  // Сохраняем позиции слотов из файла (там мог быть надет рюкзак),
  // но базой остаётся стандартный инвентарь: лишние слоты требуют экипировки.
  while (inv.slots.length < Math.min(INVENTORY.MAX_SLOTS, raw.slots.length)) inv.slots.push(null);
  for (let i = 0; i < raw.slots.length && i < INVENTORY.MAX_SLOTS; i += 1) {
    const slot = raw.slots[i];
    if (!slot || typeof slot !== 'object') continue;
    const def = itemDef(items, slot.itemId);
    if (!def) continue;
    const maxStack = Math.max(1, Math.floor(Number(def.stack) || 1));
    const count = Math.max(1, Math.min(maxStack, Math.floor(Number(slot.count) || 1)));
    inv.slots[i] = { itemId: def.id, count, meta: normalizeMeta(slot.meta) };
  }
  if (raw.equipment && typeof raw.equipment === 'object') {
    for (let i = 0; i < ITEM_SLOTS.length; i += 1) {
      const key = ITEM_SLOTS[i];
      const entry = raw.equipment[key];
      if (!entry || typeof entry !== 'object') continue;
      const def = itemDef(items, entry.itemId);
      if (!def || def.slot !== key || !def.equipable) continue;
      inv.equipment[key] = { itemId: def.id, count: 1, meta: normalizeMeta(entry.meta) };
    }
  }
  ensureSlots(inv, items);
  return inv;
}

function usedSlots(container) {
  let used = 0;
  for (let i = 0; i < container.slots.length; i += 1) if (container.slots[i]) used += 1;
  return used;
}

function isFull(container, items) {
  ensureSlots(container, items);
  return usedSlots(container) >= container.slots.length;
}

module.exports = {
  createInventory,
  indexItems,
  itemDef,
  isStackable,
  slotCount,
  ensureSlots,
  totalWeight,
  capacityKg,
  countItem,
  findSlot,
  getSlot,
  addItem,
  removeItem,
  removeFromSlot,
  moveSlot,
  equippedSlotFor,
  equip,
  unequip,
  getEquipped,
  hasEquipped,
  equipBonuses,
  loadWeapon,
  consumeAmmo,
  sanitizeInventory,
  usedSlots,
  isFull,
  wouldOrphanSlots,
  trimSlots,
  normalizeMeta,
  emptyEquipment
};
