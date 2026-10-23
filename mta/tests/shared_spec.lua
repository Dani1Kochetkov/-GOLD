--[[
  shared_spec.lua — тесты общей логики GOLD DAYZ.

  Запускается tools/luacheck.js в fengari (Lua 5.2) после загрузки
  shared/*.lua. MTA-функции здесь недоступны, поэтому проверяется только
  чистая логика: инвентарь, выживание, лут и ИИ зомби.
]]

TEST_REPORT = { passed = 0, failed = 0, errors = {} }

local function ok(condition, name)
  if condition then
    TEST_REPORT.passed = TEST_REPORT.passed + 1
  else
    TEST_REPORT.failed = TEST_REPORT.failed + 1
    TEST_REPORT.errors[#TEST_REPORT.errors + 1] = name
  end
end

local function eq(got, want, name)
  ok(got == want, name .. " (получено " .. tostring(got) .. ", ожидалось " .. tostring(want) .. ")")
end

local function near(got, want, delta, name)
  ok(math.abs((got or 0) - want) <= delta, name .. " (получено " .. tostring(got) .. ", ожидалось ~" .. tostring(want) .. ")")
end

local catalog = {
  bandage = { id = "bandage", name = "Бинт", kind = "medical", weight = 0.1, stack = 10, value = 25, use = { blood = 15 } },
  chainsaw = { id = "chainsaw", name = "Бензопила", kind = "weapon", slot = "weapon", weapon = 9, weight = 6, stack = 1, value = 800 },
  backpack = { id = "backpack_large", name = "Рюкзак", kind = "backpack", slot = "backpack", storage = 15, capacity = 12, weight = 1.6, stack = 1, value = 900 },
  armor = { id = "armor_light", name = "Броня", kind = "armor", slot = "armor", armor = 50, weight = 3.5, stack = 1, value = 350 },
  rifle = { id = "ak47", name = "AK-47", kind = "weapon", slot = "weapon", weapon = 30, ammoKind = "rifle", startAmmo = 30, weight = 3.6, stack = 1, value = 1200 },
  knife = { id = "knife", name = "Нож", kind = "weapon", slot = "weapon", weapon = 4, weight = 0.5, stack = 1, value = 60 },
  mask = { id = "gas_mask", name = "Противогаз", kind = "mask", slot = "mask", weight = 0.7, stack = 1, value = 300 },
  ammo = { id = "ammo_rifle", name = "Патроны 7.62", kind = "ammo", ammoKind = "rifle", ammoCount = 30, weight = 0.35, stack = 60, value = 40 },
  soda = { id = "soda", name = "Газировка", kind = "drink", weight = 0.33, stack = 8, value = 15, use = { thirst = 22, hunger = 5 } }
}


--------------------------------------------------------------------- ядро

eq(DZ.VERSION, "1.0.0", "версия ресурса")
eq(DZ.INVENTORY.BASE_SLOTS, 18, "базовые слоты")
eq(DZ.INVENTORY.BASE_CAPACITY, 30, "базовая вместимость")
eq(DZ.WEAPON_DAMAGE[34], 85, "урон снайперки")
eq(DZ.HEADSHOT_MULTIPLIER, 2.35, "множитель хедшота")

local rngA = DZ.Rng.new(42)
local rngB = DZ.Rng.new(42)
eq(rngA:int(1, 1000), rngB:int(1, 1000), "RNG детерминирован")
local rngC = DZ.Rng.new(7)
local roll = rngC:int(1, 6)
ok(roll >= 1 and roll <= 6, "RNG int в диапазоне")

eq(DZ.Util.dist2d(0, 0, 3, 4), 5, "dist2d")
eq(DZ.Util.round(1.2345, 2), 1.23, "round")
eq(DZ.Util.cleanName("  Иван  ", 24), "Иван", "cleanName")
eq(DZ.Util.timeString(3671), "1 ч 01 мин", "timeString")

--------------------------------------------------------------- инвентарь

local inv = DZ.Inv.new("test")
eq(DZ.Inv.slotCount(inv, catalog), 18, "новый инвентарь: 18 слотов")
eq(DZ.Inv.capacity(inv, catalog), 30, "новый инвентарь: 30 кг")

local added = DZ.Inv.add(inv, catalog, "bandage", 25)
eq(added, 25, "бинты добавлены")
eq(DZ.Inv.count(inv, "bandage"), 25, "25 бинтов в инвентаре")
local used = 0
for i = 1, DZ.Inv.slotCount(inv, catalog) do
  if inv.slots[i] then used = used + 1 end
end
eq(used, 3, "бинты заняли 3 стака")
near(DZ.Inv.weight(inv, catalog), 2.5, 0.001, "вес бинтов")

local addedAgain, leftover = DZ.Inv.add(inv, catalog, "bandage", 5)
eq(addedAgain, 5, "добавление в существующий стак")
eq(leftover, 0, "без остатка")

local removed = DZ.Inv.remove(inv, catalog, "bandage", 10)
eq(removed, 10, "удаление 10 бинтов")
eq(DZ.Inv.count(inv, "bandage"), 20, "осталось 20")

local bagAdded = DZ.Inv.add(inv, catalog, "backpack", 1)
eq(bagAdded, 1, "рюкзак добавлен")
local bagIndex = DZ.Inv.find(inv, "backpack")
ok(bagIndex ~= nil, "рюкзак найден")
local equipped, slot = DZ.Inv.equip(inv, catalog, bagIndex)
eq(equipped, true, "рюкзак надет")
eq(slot, "backpack", "слот рюкзака")
eq(DZ.Inv.slotCount(inv, catalog), 33, "рюкзак добавил 15 слотов")
eq(DZ.Inv.capacity(inv, catalog), 42, "рюкзак добавил 12 кг")

local weightInv = DZ.Inv.new("weight")
local heavies, heavyLeft, reason = DZ.Inv.add(weightInv, catalog, "chainsaw", 6, nil, 30)
eq(heavies, 5, "по весу влезло 5 бензопил")
eq(heavyLeft, 1, "одна бензопила не влезла")
eq(reason, "overweight", "причина: перегруз")

local data = DZ.Inv.toData(inv)
local restored = DZ.Inv.fromData("test", data)
eq(DZ.Inv.count(restored, "bandage"), 20, "сохранение/загрузка: бинты")
eq(DZ.Inv.equipped(restored, "backpack") ~= false, true, "сохранение/загрузка: рюкзак")

local unequipped = DZ.Inv.unequip(inv, catalog, "backpack")
eq(unequipped, true, "рюкзак снят")

---------------------------------------------------------------- выживание

local stats = DZ.Survival.new()
eq(stats.hunger, 100, "стартовый голод")
eq(stats.thirst, 100, "стартовая жажда")

local tickResult = DZ.Survival.tick(stats, {}, 5, DZ.Rng.new(1))
local tickResult2 = DZ.Survival.tick(stats, {}, 5, DZ.Rng.new(1))
eq(tickResult.damage + tickResult2.damage, 0, "на полных статах нет урона")
near(stats.hunger, 99.7, 0.01, "голод падает")
near(stats.thirst, 99.55, 0.01, "жажда падает")

local bleeding = DZ.Survival.new()
DZ.Survival.addBleeding(bleeding, 1)
local beforeBlood = bleeding.blood
local bleedResult = DZ.Survival.tick(bleeding, { sprinting = true }, 5, DZ.Rng.new(2))
ok(bleeding.blood < beforeBlood, "кровотечение уменьшает кровь")
ok(bleedResult.damage > 0, "кровотечение наносит урон")

local hungry = DZ.Survival.new({ hunger = 0 })
local hungerResult = DZ.Survival.tick(hungry, {}, 10, DZ.Rng.new(3))
ok(hungerResult.damage > 0, "голод наносит урон")

local starving = DZ.Survival.new({ hunger = 0, thirst = 0 })
local dead = false
for _ = 1, 60 do
  local r = DZ.Survival.tick(starving, {}, 5, DZ.Rng.new(4))
  if r.dead then dead = true break end
end
ok(dead, "от голода и жажды наступает смерть")

local fed = DZ.Survival.new({ hunger = 50 })
DZ.Survival.consume(fed, { hunger = 35 })
eq(fed.hunger, 85, "еда восстанавливает голод")

local radNoMask = DZ.Survival.new()
DZ.Survival.tick(radNoMask, { radiation = 2, mask = false }, 10, DZ.Rng.new(5))
local radMask = DZ.Survival.new()
DZ.Survival.tick(radMask, { radiation = 2, mask = true }, 10, DZ.Rng.new(5))
ok(radNoMask.radiation > 0, "радиация накапливается")
ok(radMask.radiation < radNoMask.radiation, "противогаз снижает радиацию")

--------------------------------------------------------------------- лут

local tableLoot = {
  { item = "bandage", weight = 10, min = 1, max = 3 },
  { item = "canned_food", weight = 5, min = 1, max = 1 }
}
local lootRng = DZ.Rng.new(99)
local itemId, count = DZ.Loot.roll(tableLoot, lootRng)
ok(itemId == "bandage" or itemId == "canned_food", "лут выбран из таблицы")
ok(count >= 1 and count <= 3, "количество лута в диапазоне")
eq(DZ.Loot.value({ value = 42 }), 42, "цена предмета из value")
eq(DZ.Loot.value({ weight = 2 }), 16, "цена по весу")

local many = DZ.Loot.rollMany(tableLoot, DZ.Rng.new(5), 4)
eq(#many, 4, "rollMany вернул 4 записи")

----------------------------------------------------------------- зомби ИИ

local spec = {
  id = "walker", name = "Ходячий", health = 90, speed = 2, damage = 9,
  attackRange = 1.9, attackInterval = 1500, detectRange = 30, chaseRange = 80,
  leash = 120, skins = { 7, 12 }
}
local zombie = DZ.ZA.new(1, spec, { x = 0, y = 0, z = 0 }, { x = 0, y = 0, z = 0 }, DZ.Rng.new(11))
ok(zombie.skin == 7 or zombie.skin == 12, "скин зомби из spec.skins")
eq(zombie.hp, 90, "HP зомби")
eq(#DZ.ZA.snapshot(zombie), 11, "снапшот: 11 полей")
eq(DZ.ZA.snapshot(zombie)[1], 1, "снапшот: id первым")

local players = {
  { id = "player1", x = 20, y = 0, z = 0, alive = true, safe = false, invulnerable = false }
}
local startX = zombie.x
local events = DZ.ZA.think(zombie, players, 1000, 0.5)
ok(zombie.x > startX, "зомби движется к игроку")
ok(zombie.state == "chase" or zombie.state == "attack", "состояние погони")
ok(zombie.x <= 21, "зомби не телепортируется дальше игрока")
eq(type(events), "table", "think возвращает события")

local killed, damageDone = DZ.ZA.damage(zombie, 1000)
eq(killed, true, "зомби умирает от большого урона")
ok(damageDone >= 1000, "урон зафиксирован")
eq(DZ.ZA.stateCode(zombie.state), 3, "код состояния: мёртв")

local bite = DZ.ZA.new(2, spec, { x = 0, y = 0, z = 0 }, { x = 0, y = 0, z = 0 }, DZ.Rng.new(3))
local closePlayers = { { id = "p", x = 0.5, y = 0, z = 0, alive = true, safe = false, invulnerable = false } }
DZ.ZA.think(bite, closePlayers, 5000, 0.25)
local attackEvents = DZ.ZA.think(bite, closePlayers, 7000, 0.25)
local hasAttack = false
for i = 1, #attackEvents do
  if attackEvents[i].type == "attack" then hasAttack = true end
end
ok(hasAttack, "зомби атакует вблизи")


---------------------------------------------------- инвентарь: расширенно

local weaponInv = DZ.Inv.new("weapon")
DZ.Inv.add(weaponInv, catalog, "knife", 1)
local knifeIndex = DZ.Inv.find(weaponInv, "knife")
ok(knifeIndex ~= nil, "нож найден в слотах")
local armed, weaponSlot, weaponEntry = DZ.Inv.equip(weaponInv, catalog, knifeIndex)
eq(armed, true, "нож надет")
eq(weaponSlot, "weapon", "слот оружия")
eq(weaponEntry.item, "knife", "в руке нож")
eq(DZ.Inv.find(weaponInv, "knife"), nil, "слот освободился после экипировки")
eq(DZ.Inv.count(weaponInv, "knife"), 1, "count учитывает экипировку")
local disarmed = DZ.Inv.unequip(weaponInv, catalog, "weapon")
eq(disarmed, true, "нож снят")
ok(DZ.Inv.find(weaponInv, "knife") ~= nil, "нож вернулся в слот")

local maskInv = DZ.Inv.new("mask")
DZ.Inv.add(maskInv, catalog, "mask", 1)
local maskOk = DZ.Inv.equip(maskInv, catalog, DZ.Inv.find(maskInv, "mask"))
eq(maskOk, true, "противогаз надет")
ok(DZ.Inv.equipped(maskInv, "mask") ~= false, "equipped(mask)")

local backpackInv = DZ.Inv.new("bag")
DZ.Inv.add(backpackInv, catalog, "backpack", 1)
DZ.Inv.equip(backpackInv, catalog, DZ.Inv.find(backpackInv, "backpack"))
for i = 19, 30 do
  backpackInv.slots[i] = { item = "bandage", count = 1 }
end
local bagOff, bagReason = DZ.Inv.unequip(backpackInv, catalog, "backpack")
eq(bagOff, false, "рюкзак не снимается с вещами за базовыми слотами")
eq(bagReason, "backpack-full", "причина: слоты рюкзака заняты")
for i = 19, 30 do backpackInv.slots[i] = nil end
eq(DZ.Inv.unequip(backpackInv, catalog, "backpack"), true, "пустой рюкзак снимается")

local moveInv = DZ.Inv.new("move")
DZ.Inv.add(moveInv, catalog, "bandage", 8)
DZ.Inv.set(moveInv, 15, { item = "bandage", count = 7 })
local beforeMove = DZ.Inv.count(moveInv, "bandage")
eq(DZ.Inv.move(moveInv, catalog, 1, 15), true, "перекладывание стопки")
eq(DZ.Inv.count(moveInv, "bandage"), beforeMove, "при перекладывании ничего не потеряно")
eq(moveInv.slots[15].count, 10, "стак долит до лимита")
eq(moveInv.slots[1].count, 5, "остаток остался в исходном слоте")
eq(DZ.Inv.move(moveInv, catalog, 1, 1), true, "перемещение в тот же слот — no-op")
eq(DZ.Inv.move(moveInv, catalog, 1, 99), false, "перемещение за пределы — отказ")

local canAddInv = DZ.Inv.new("canadd")
eq((DZ.Inv.canAdd(canAddInv, catalog, "ammo", 200)), true, "canAdd: патроны влезают")
local serialized = DZ.Inv.serialize(canAddInv, catalog)
eq(serialized.slotsTotal, 18, "serialize: слоты")
eq(serialized.capacity, 30, "serialize: вместимость")
eq(type(serialized.equip), "table", "serialize: экипировка")

-------------------------------------------------------- выживание: расширенно

local regen = DZ.Survival.new({ blood = 40 })
DZ.Survival.tick(regen, {}, 10, DZ.Rng.new(1))
ok(regen.blood > 40, "кровь восстанавливается без кровотечения")

local cold = DZ.Survival.new()
local coldDamage = false
for _ = 1, 200 do
  local result = DZ.Survival.tick(cold, { ambient = -15, night = true, inWater = true }, 5, DZ.Rng.new(2))
  if result.damage > 0 then coldDamage = true break end
end
ok(coldDamage, "переохлаждение наносит урон")
ok(cold.temperature < 36, "температура падает в холоде")

local infection = DZ.Survival.new({ infection = 50 })
local infectedDamage = DZ.Survival.tick(infection, {}, 5, DZ.Rng.new(3)).damage
ok(infectedDamage > 0, "инфекция наносит урон")
DZ.Survival.heal(infection, { infection = 60 })
eq(infection.infection, 0, "лекарство снимает инфекцию")

local healed = DZ.Survival.new({ health = 40, blood = 50, bleeding = 2 })
DZ.Survival.heal(healed, { health = 30, blood = 30, bleeding = 2 })
eq(healed.health, 70, "бинт восстанавливает здоровье")
eq(healed.bleeding, 0, "бинт останавливает кровотечение")

local drunk = DZ.Survival.new({ thirst = 50 })
DZ.Survival.consume(drunk, catalog.soda.use)
eq(drunk.thirst, 72, "напиток утоляет жажду")

local statsData = DZ.Survival.toData(DZ.Survival.new({ hunger = 12 }))
eq(DZ.Survival.fromData(statsData).hunger, 12, "статы переживают сохранение")

---------------------------------------------------------- зомби ИИ: расширенно

local listener = DZ.ZA.new(3, spec, { x = 10, y = 10, z = 0 }, { x = 10, y = 10, z = 0 }, DZ.Rng.new(4))
DZ.ZA.hearNoise(listener, 40, 10, 0, 30, 1000)
eq(listener.state, "investigate", "зомби идёт на шум")
DZ.ZA.hearNoise(listener, 500, 500, 0, 30, 1000)
ok(listener.x < 20, "далёкий шум не телепортирует зомби")

local snap = DZ.ZA.snapshot(bite)
ok(snap[2] == math.floor(snap[2] * 100 + 0.5) / 100, "снапшот: x округлён до 2 знаков")

local armoured = DZ.ZA.new(4, spec, { x = 0, y = 0, z = 0 }, { x = 0, y = 0, z = 0 }, DZ.Rng.new(5))
DZ.ZA.think(armoured, { { id = "s", x = 5, y = 0, z = 0, alive = true, safe = true, invulnerable = false } }, 2000, 0.5)
eq(armoured.state, "wander", "в безопасной зоне зомби не атакует")

TEST_SUMMARY = string.format("%d passed, %d failed", TEST_REPORT.passed, TEST_REPORT.failed)
if TEST_REPORT.failed > 0 then
  error("ТЕСТЫ ПРОВАЛЕНЫ: " .. table.concat(TEST_REPORT.errors, " | "), 0)
end
