/* GOLD DAYZ — CEF UI (inventory, map, HUD). Работает внутри RAGE CEF. */
(function () {
  'use strict';

  var S = {
    catalog: new Map(),
    catalogList: [],
    inventory: null,
    map: null,
    hud: null,
    welcome: null,
    panel: null,
    dead: false,
    deathData: null,
    deathUntil: 0,
    selected: null,
    ammo: null,
    loadingHidden: false
  };

  var SLOT_LABELS = {
    primary: 'Оружие',
    melee: 'Ближний бой',
    back: 'Рюкзак',
    armor: 'Разгрузка',
    mask: 'Маска',
    hands: 'В руках'
  };

  var KIND_LABELS = {
    weapon: 'Оружие',
    medical: 'Медицина',
    food: 'Еда / вода',
    gear: 'Снаряжение',
    ammo: 'Боеприпасы'
  };

  var $ = function (id) { return document.getElementById(id); };

  function trigger(obj) {
    try {
      if (typeof mp !== 'undefined' && mp.trigger) mp.trigger('goldui:action', JSON.stringify(obj));
    } catch (err) {
      log('trigger: ' + err.message);
    }
  }

  function log(message) {
    try {
      if (typeof mp !== 'undefined' && mp.trigger) mp.trigger('goldui:log', String(message));
    } catch (err) {
      // ignore
    }
  }

  function defOf(id) {
    return S.catalog.get(id) || null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // ------------------------------------------------------------------ HUD

  function setBar(key, value, max) {
    var bar = $('bar-' + key);
    var val = $('val-' + key);
    if (!bar || !val) return;
    var pct = clamp((Number(value) || 0) / (max || 100), 0, 1) * 100;
    bar.style.width = pct.toFixed(1) + '%';
    if (pct < 25) bar.classList.add('low');
    else bar.classList.remove('low');
    val.textContent = Math.round(Number(value) || 0);
  }

  function formatClock(hour) {
    var h = Math.floor(hour + 24) % 24;
    var m = Math.floor(((hour + 24) % 1) * 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function renderHUD(hud) {
    S.hud = hud;
    setBar('health', hud.h, 100);
    setBar('blood', hud.b, 100);
    setBar('hunger', hud.hu, 100);
    setBar('thirst', hud.t, 100);
    setBar('stamina', hud.s, 100);

    $('clock-hour').textContent = formatClock(hud.hour || 0);
    if (S.welcome && S.welcome.weather) $('clock-weather').textContent = S.welcome.weather;

    $('stat-zombies').textContent = hud.z || 0;
    $('stat-players').textContent = hud.p || 0;
    $('stat-score').textContent = hud.sc || 0;

    var weight = Number(hud.w) || 0;
    var cap = Number(hud.cap) || 30;
    $('weight-text').textContent = weight.toFixed(1) + ' / ' + cap + ' кг';
    var wb = $('bar-weight');
    wb.style.width = clamp(weight / cap, 0, 1) * 100 + '%';
    if (weight > cap) wb.classList.add('over');
    else wb.classList.remove('over');

    $('status-bleed').classList.toggle('hidden', !(hud.bl > 0));
    $('status-rad').classList.toggle('hidden', !(hud.r > 5));
    $('status-safe').classList.toggle('hidden', !hud.safe);
    $('status-night').classList.toggle('hidden', !hud.night);

    var vignette = $('vignette');
    vignette.classList.toggle('bleed', hud.bl > 0);

    if (typeof hud.nz === 'number') {
      var near = $('nearby-zombies');
      near.textContent = hud.nz > 0 ? ('ЗОМБИ РЯДОМ: ' + hud.nz) : '';
    }

    renderWeaponCard();
  }

  function renderWeaponCard() {
    var inv = S.inventory;
    var name = 'Без оружия';
    var ammoText = '—';
    var mag = '';
    if (inv && inv.eq) {
      var entry = inv.eq.primary || inv.eq.melee;
      if (entry) {
        var def = defOf(entry[0]);
        name = def ? def.n : entry[0];
        if (def && def.wp && def.wp.ammoType) {
          ammoText = String(S.ammo && S.ammo.itemId === entry[0] && S.ammo.ammo !== null ? S.ammo.ammo : Math.max(0, Number(entry[1]) || 0));
          mag = '/ ' + (Number(def.wp.mag) || 0);
        } else {
          ammoText = '';
        }
      }
    }
    $('weapon-name').textContent = name;
    $('weapon-ammo').textContent = ammoText;
    $('weapon-mag').textContent = mag;
  }

  // ------------------------------------------------------------------ toasts

  function toast(text, kind) {
    var host = $('toasts');
    if (!host || !text) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = text;
    host.appendChild(el);
    while (host.children.length > 6) host.removeChild(host.firstChild);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, kind === 'debug' ? 9000 : 5000);
  }

  // ------------------------------------------------------------------ inventory

  function renderInventory() {
    var inv = S.inventory;
    if (!inv) return;
    var size = Number(inv.size) || (inv.slots ? inv.slots.length : 18);
    var used = Number(inv.used) || 0;
    var weight = Number(inv.w) || 0;
    var cap = Number(inv.cap) || 30;

    $('inv-subtitle').textContent = (S.welcome && S.welcome.name ? S.welcome.name : 'Выживший') +
      (inv.alive === false ? ' — мёртв' : '');
    $('inv-weight-text').textContent = weight.toFixed(1) + ' / ' + cap + ' кг';
    $('inv-weight-bar').style.width = clamp(weight / cap, 0, 1) * 100 + '%';
    $('inv-weight-bar').classList.toggle('over', weight > cap);
    $('inv-slots-text').textContent = used + ' / ' + size + ' слотов';

    var grid = $('inv-grid');
    grid.innerHTML = '';
    for (var i = 0; i < size; i += 1) {
      var entry = inv.slots[i] || null;
      var slot = document.createElement('div');
      slot.className = 'slot' + (entry ? '' : ' empty');
      slot.dataset.index = String(i);
      slot.dataset.kind = 'bag';
      if (entry) {
        var def = defOf(entry[0]);
        slot.classList.add('rarity-' + ((def && def.r) || 'common'));
        slot.draggable = true;
        slot.innerHTML = slotInner(entry, def);
        if (S.selected && S.selected.kind === 'bag' && S.selected.index === i) slot.classList.add('selected');
      } else {
        slot.innerHTML = '';
      }
      grid.appendChild(slot);
    }

    renderEquipment(inv);
    renderTotals(inv);
    renderDetails();
    renderWeaponCard();
  }

  function slotInner(entry, def) {
    var icon = def ? def.i : '▪';
    var html = '<span class="icon">' + escapeHtml(icon) + '</span>';
    if (entry[1] > 1) html += '<span class="count">' + entry[1] + '</span>';
    if (entry[2] !== null && entry[2] !== undefined && def && def.wp && def.wp.ammoType) {
      html += '<span class="ammo">' + entry[2] + '</span>';
    }
    return html;
  }

  function renderEquipment(inv) {
    var host = $('equipment-slots');
    host.innerHTML = '';
    Object.keys(SLOT_LABELS).forEach(function (key) {
      var entry = inv.eq ? inv.eq[key] : null;
      var def = entry ? defOf(entry[0]) : null;
      var el = document.createElement('div');
      el.className = 'eq-slot' + (entry ? ' filled' : '');
      el.dataset.kind = 'eq';
      el.dataset.slot = key;
      var name = entry ? (def ? def.n : entry[0]) : '—';
      var extra = '';
      if (entry && def && def.wp && def.wp.ammoType) extra = (Number(entry[1]) || 0) + ' / ' + (Number(def.wp.mag) || 0);
      if (entry && def && def.w && def.w > 0) extra = Number(def.w).toFixed(1) + ' кг';
      el.innerHTML =
        '<span class="icon">' + escapeHtml(def ? def.i : '·') + '</span>' +
        '<div><div class="eq-label">' + SLOT_LABELS[key] + '</div><div class="eq-name">' + escapeHtml(name) + '</div></div>' +
        '<span class="eq-extra">' + escapeHtml(extra) + '</span>';
      if (S.selected && S.selected.kind === 'eq' && S.selected.slot === key) el.style.borderColor = 'var(--gold)';
      host.appendChild(el);
    });
  }

  function renderTotals(inv) {
    var weight = Number(inv.w) || 0;
    var cap = Number(inv.cap) || 30;
    var used = Number(inv.used) || 0;
    var size = Number(inv.size) || 18;
    var lines = [
      'Слотов: <b>' + used + '</b> из <b>' + size + '</b>',
      'Вес: <b>' + weight.toFixed(1) + '</b> / ' + cap + ' кг',
      weight > cap ? '<span style="color:var(--red)">Перегруз: нельзя брать лут</span>' : 'Свободно: <b>' + Math.max(0, cap - weight).toFixed(1) + '</b> кг',
      'Рюкзак/разгрузка добавляют слоты'
    ];
    $('inv-totals').innerHTML = lines.join('<br>');
  }

  function renderDetails() {
    var body = $('details-body');
    var actions = $('details-actions');
    actions.innerHTML = '';
    if (!S.selected) {
      body.className = 'details-body empty';
      body.textContent = 'Выберите предмет';
      return;
    }
    var entry = null;
    var def = null;
    var isEq = S.selected.kind === 'eq';
    if (isEq) {
      var eqEntry = S.inventory && S.inventory.eq ? S.inventory.eq[S.selected.slot] : null;
      if (eqEntry) {
        entry = [eqEntry[0], 1, eqEntry[1]];
        def = defOf(eqEntry[0]);
      }
    } else {
      entry = S.inventory && S.inventory.slots ? S.inventory.slots[S.selected.index] : null;
      if (entry) def = defOf(entry[0]);
    }
    if (!entry || !def) {
      S.selected = null;
      body.className = 'details-body empty';
      body.textContent = 'Выберите предмет';
      return;
    }

    body.className = 'details-body';
    var kind = def.am ? 'ammo' : (def.wp ? 'weapon' : (def.he ? 'medical' : (def.fo ? 'food' : (def.e ? 'gear' : 'material'))));
    var html = '';
    html += '<div class="item-title">' + escapeHtml(def.n) + '</div>';
    html += '<div class="item-kind">' + (KIND_LABELS[kind] || 'Предмет') + ' · ' + escapeHtml(def.r || 'common') + '</div>';
    html += '<div class="item-desc">' + escapeHtml(def.d || '') + '</div>';
    html += '<div class="item-stats">';
    html += row('Вес', (Number(def.w) || 0).toFixed(2) + ' кг');
    if (def.st && def.st > 1) html += row('В стаке', 'до ' + def.st);
    if (entry[1] > 1) html += row('Количество', entry[1]);
    if (def.wp) {
      html += row('Урон', def.wp.damage || '-');
      html += row('Дистанция', (def.wp.range || '-') + ' м');
      if (def.wp.mag) {
        html += row('Магазин', (Number(entry[2]) || 0) + ' / ' + def.wp.mag);
        html += row('Патроны', def.wp.ammoType || '-');
      }
      html += row('Скорость', Math.round(60000 / Math.max(60, def.wp.rate || 600)) + ' выстр/мин');
    }
    if (def.he) {
      if (def.he.blood) html += row('Лечит кровь', '+' + def.he.blood);
      if (def.he.health) html += row('Здоровье', '+' + def.he.health);
      if (def.he.radiation) html += row('Радиация', '-' + def.he.radiation);
      html += row('Время', ((def.he.time || 2000) / 1000).toFixed(1) + ' с');
    }
    if (def.fo) {
      if (def.fo.calories) html += row('Калории', '+' + def.fo.calories);
      if (def.fo.water) html += row('Вода', (def.fo.water > 0 ? '+' : '') + def.fo.water);
    }
    if (def.stg) html += row('Слоты', '+' + def.stg);
    if (def.dr) html += row('Защита', '-' + Math.round(def.dr * 100) + '% урона');
    if (def.gp) html += row('Противогаз', Math.round(def.gp * 100) + '%');
    html += '</div>';
    body.innerHTML = html;

    var buttons = [];
    var bagSlot = (!isEq && S.selected) ? S.selected.index : null;

    if (def.e && !isEq) buttons.push({ label: 'Экипировать', action: { t: 'equip', slot: bagSlot } });
    if (def.u && !isEq) buttons.push({ label: 'Использовать', action: { t: 'use', slot: bagSlot } });
    if (isEq) buttons.push({ label: 'Снять', action: { t: 'unequip', eq: S.selected.slot } });
    if (def.wp && def.wp.ammoType && (isEq ? S.selected.slot === 'primary' : true)) {
      buttons.push({ label: 'Перезарядить', action: { t: 'reload' } });
    }
    if (!isEq) {
      buttons.push({ label: 'Выбросить', action: { t: 'drop', slot: bagSlot, count: entry[1] } });
      if (entry[1] > 1) buttons.push({ label: 'Выбросить 1', action: { t: 'drop', slot: bagSlot, count: 1 } });
    }

    buttons.forEach(function (btn) {
      var el = document.createElement('button');
      el.textContent = btn.label;
      if (btn.label.indexOf('Выбросить') === 0) el.className = 'danger';
      el.addEventListener('click', function () {
        trigger(btn.action);
        if (btn.action.t === 'drop') S.selected = null;
      });
      actions.appendChild(el);
    });
  }

  function row(label, value) {
    return '<div class="row"><span>' + escapeHtml(String(label)) + '</span><b>' + escapeHtml(String(value)) + '</b></div>';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------------ map

  var MAP_BOUNDS = { minX: -4300, maxX: 4700, minY: -4300, maxY: 8300 };
  var mapGeometry = null;

  function renderMap() {
    var canvas = $('map-canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var dx = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
    var dy = MAP_BOUNDS.maxY - MAP_BOUNDS.minY;
    var scale = Math.min(W / dx, H / dy);
    var ox = (W - dx * scale) / 2;
    var oy = (H - dy * scale) / 2;
    mapGeometry = { scale: scale, ox: ox, oy: oy };

    function px(x) { return ox + (x - MAP_BOUNDS.minX) * scale; }
    function py(y) { return oy + (MAP_BOUNDS.maxY - y) * scale; }
    mapGeometry.px = px;
    mapGeometry.py = py;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0e0a';
    ctx.fillRect(0, 0, W, H);

    // сетка
    ctx.strokeStyle = 'rgba(148,163,124,0.08)';
    ctx.lineWidth = 1;
    for (var gx = -4000; gx <= 4500; gx += 1000) {
      ctx.beginPath();
      ctx.moveTo(px(gx), oy);
      ctx.lineTo(px(gx), H - oy);
      ctx.stroke();
    }
    for (var gy = -4000; gy <= 8000; gy += 1000) {
      ctx.beginPath();
      ctx.moveTo(ox, py(gy));
      ctx.lineTo(W - ox, py(gy));
      ctx.stroke();
    }

    var data = S.map || { lootZones: [], zombieZones: [], safeZones: [], toxinZones: [], spawnPoints: [] };

    function circle(zone, fill, stroke, dash) {
      ctx.beginPath();
      ctx.arc(px(zone.x), py(zone.y), Math.max(3, (zone.r || 20) * scale), 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (dash) ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    (data.zombieZones || []).forEach(function (zone) {
      circle(zone, 'rgba(160,60,50,0.10)', 'rgba(180,80,60,0.45)', true);
    });
    (data.lootZones || []).forEach(function (zone) {
      var tier = Number(zone.tier) || 1;
      var fill = tier === 3 ? 'rgba(182,74,55,0.30)' : tier === 2 ? 'rgba(201,162,75,0.28)' : 'rgba(148,179,106,0.28)';
      circle(zone, fill, 'rgba(220,230,200,0.35)', false);
    });
    (data.safeZones || []).forEach(function (zone) {
      circle(zone, 'rgba(109,155,181,0.25)', 'rgba(109,155,181,0.8)', false);
      label(zone, 'rgba(190,220,235,0.9)');
    });
    (data.toxinZones || []).forEach(function (zone) {
      circle(zone, 'rgba(154,122,184,0.22)', 'rgba(154,122,184,0.8)', false);
    });
    (data.spawnPoints || []).forEach(function (point) {
      var p = point.pos || point;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(215,221,201,0.8)';
      ctx.fill();
    });

    function label(zone, color) {
      if (!zone || !zone.name) return;
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = color || 'rgba(215,221,201,0.75)';
      ctx.textAlign = 'center';
      ctx.fillText(zone.name, px(zone.x), py(zone.y) - Math.max(3, (zone.r || 20) * scale) - 6);
    }

    // игрок
    var hud = S.hud;
    if (hud && typeof hud.px === 'number') {
      var x = px(hud.px);
      var y = py(hud.py);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#f2f5e8';
      ctx.fill();
      ctx.strokeStyle = '#0b0d0a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = '#f2f5e8';
      ctx.textAlign = 'left';
      ctx.fillText('ВЫ', x + 8, y + 4);
    } else {
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(138,147,124,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('Позиция игрока появится после первого HUD-пакета', W / 2, 24);
    }
  }

  function mapEventToWorld(evt) {
    if (!mapGeometry) return null;
    var canvas = $('map-canvas');
    var rect = canvas.getBoundingClientRect();
    var cx = (evt.clientX - rect.left) * (canvas.width / rect.width);
    var cy = (evt.clientY - rect.top) * (canvas.height / rect.height);
    var x = MAP_BOUNDS.minX + (cx - mapGeometry.ox) / mapGeometry.scale;
    var y = MAP_BOUNDS.maxY - (cy - mapGeometry.oy) / mapGeometry.scale;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function mapHover(evt) {
    var world = mapEventToWorld(evt);
    if (!world || !S.map) return;
    var nearest = null;
    var bestDist = Infinity;
    ['lootZones', 'zombieZones', 'safeZones', 'toxinZones'].forEach(function (key) {
      (S.map[key] || []).forEach(function (zone) {
        var dx = zone.x - world.x;
        var dy = zone.y - world.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= (zone.r || 20) && dist < bestDist) {
          bestDist = dist;
          nearest = zone;
        }
      });
    });
    $('map-hint').textContent = nearest
      ? nearest.name + ' — ' + Math.round(nearest.r) + ' м'
      : 'Координаты: ' + world.x + ', ' + world.y + ' (клик — метка)';
  }

  // ------------------------------------------------------------------ panels

  function setPanel(name, open) {
    S.panel = open ? name : null;
    $('inventory').classList.toggle('hidden', !(open && name === 'inventory'));
    $('map').classList.toggle('hidden', !(open && name === 'map'));
    if (open && name === 'inventory') renderInventory();
    if (open && name === 'map') renderMap();
  }

  function showDeath(data) {
    S.dead = true;
    S.deathData = data || {};
    S.deathUntil = Date.now() + (Number(data && data.respawnInMs) || 12000);
    $('death').classList.remove('hidden');
    $('death-cause').textContent = (data && data.label) ? data.label : 'Причина неизвестна';
    $('death-by').textContent = data && data.by ? ('Убит: ' + data.by) : '';
    updateDeathTimer();
  }

  function hideDeath() {
    S.dead = false;
    S.deathData = null;
    $('death').classList.add('hidden');
    $('respawn-btn').disabled = true;
  }

  function updateDeathTimer() {
    if (!S.dead) return;
    var left = Math.max(0, S.deathUntil - Date.now());
    var btn = $('respawn-btn');
    if (left > 0) {
      $('death-timer').textContent = 'Возрождение через ' + Math.ceil(left / 1000) + ' с';
      btn.disabled = true;
    } else {
      $('death-timer').textContent = 'Можно возродиться';
      btn.disabled = false;
    }
  }

  setInterval(updateDeathTimer, 250);
  setInterval(function () {
    if (S.panel === 'map') renderMap();
  }, 1000);

  // ------------------------------------------------------------------ события UI

  document.addEventListener('click', function (evt) {
    var target = evt.target;
    var actionBtn = target.closest ? target.closest('[data-action]') : null;
    if (actionBtn) {
      var action = actionBtn.getAttribute('data-action');
      if (action === 'close') trigger({ t: 'close' });
      if (action === 'pickup') trigger({ t: 'pickup' });
      return;
    }

    var slot = target.closest ? target.closest('.slot') : null;
    if (slot && !slot.classList.contains('empty')) {
      S.selected = { kind: 'bag', index: Number(slot.dataset.index) };
      renderInventory();
      return;
    }

    var eq = target.closest ? target.closest('.eq-slot') : null;
    if (eq && eq.classList.contains('filled')) {
      S.selected = { kind: 'eq', slot: eq.dataset.slot };
      renderInventory();
      return;
    }
  });

  document.addEventListener('dblclick', function (evt) {
    var target = evt.target;
    var slot = target.closest ? target.closest('.slot') : null;
    if (slot && !slot.classList.contains('empty')) {
      var index = Number(slot.dataset.index);
      var entry = S.inventory && S.inventory.slots ? S.inventory.slots[index] : null;
      if (!entry) return;
      var def = defOf(entry[0]);
      if (!def) return;
      if (def.e) trigger({ t: 'equip', slot: index });
      else if (def.u) trigger({ t: 'use', slot: index });
      return;
    }
    var eq = target.closest ? target.closest('.eq-slot') : null;
    if (eq && eq.classList.contains('filled')) {
      trigger({ t: 'unequip', eq: eq.dataset.slot });
    }
  });

  document.addEventListener('dragstart', function (evt) {
    var slot = evt.target.closest ? evt.target.closest('.slot') : null;
    if (!slot || slot.classList.contains('empty')) return;
    evt.dataTransfer.setData('text/plain', slot.dataset.index);
    evt.dataTransfer.effectAllowed = 'move';
  });

  document.addEventListener('dragover', function (evt) {
    var slot = evt.target.closest ? evt.target.closest('.slot') : null;
    var eq = evt.target.closest ? evt.target.closest('.eq-slot') : null;
    if (slot || eq) {
      evt.preventDefault();
      if (slot) slot.classList.add('dragover');
    }
  });

  document.addEventListener('dragleave', function (evt) {
    var slot = evt.target.closest ? evt.target.closest('.slot') : null;
    if (slot) slot.classList.remove('dragover');
  });

  document.addEventListener('drop', function (evt) {
    var slot = evt.target.closest ? evt.target.closest('.slot') : null;
    var eq = evt.target.closest ? evt.target.closest('.eq-slot') : null;
    if (!slot && !eq) return;
    evt.preventDefault();
    if (slot) slot.classList.remove('dragover');
    var from = Number(evt.dataTransfer.getData('text/plain'));
    if (!Number.isFinite(from)) return;
    if (slot) {
      trigger({ t: 'move', from: from, to: Number(slot.dataset.index) });
    } else if (eq) {
      trigger({ t: 'equip', slot: from });
    }
  });

  document.addEventListener('contextmenu', function (evt) {
    var slot = evt.target.closest ? evt.target.closest('.slot') : null;
    if (!slot || slot.classList.contains('empty')) return;
    evt.preventDefault();
    trigger({ t: 'drop', slot: Number(slot.dataset.index), count: 1 });
  });

  var canvas = $('map-canvas');
  if (canvas) {
    canvas.addEventListener('mousemove', mapHover);
    canvas.addEventListener('click', function (evt) {
      var world = mapEventToWorld(evt);
      if (!world) return;
      trigger({ t: 'waypoint', x: world.x, y: world.y });
    });
  }

  var respawnBtn = $('respawn-btn');
  if (respawnBtn) {
    respawnBtn.addEventListener('click', function () {
      if (respawnBtn.disabled) return;
      trigger({ t: 'respawn' });
      respawnBtn.disabled = true;
      $('death-timer').textContent = 'Ожидание сервера…';
    });
  }

  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape') trigger({ t: 'close' });
  });

  // ------------------------------------------------------------------ приём сообщений

  function receive(raw) {
    var msg = null;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      return;
    }
    if (!msg || !msg.t) return;

    switch (msg.t) {
      case 'catalog':
        S.catalog = new Map();
        S.catalogList = msg.items || [];
        for (var i = 0; i < S.catalogList.length; i += 1) S.catalog.set(S.catalogList[i].id, S.catalogList[i]);
        if (S.inventory) renderInventory();
        hideLoadingSoon();
        break;
      case 'map':
        S.map = msg.data;
        if (S.panel === 'map') renderMap();
        hideLoadingSoon();
        break;
      case 'welcome':
        S.welcome = msg.data;
        break;
      case 'inventory':
        S.inventory = msg.data;
        if (S.panel === 'inventory') renderInventory();
        renderWeaponCard();
        hideLoadingSoon();
        break;
      case 'hud':
        renderHUD(msg.data);
        break;
      case 'toast':
        toast(msg.text, msg.kind);
        break;
      case 'panel':
        setPanel(msg.name, msg.open);
        break;
      case 'hit':
        showHitMarker(msg.data);
        break;
      case 'damage':
        showDamage(msg.data);
        break;
      case 'death':
        showDeath(msg.data);
        break;
      case 'respawn':
        hideDeath();
        break;
      case 'hudReset':
        hideDeath();
        break;
      case 'ammo':
        S.ammo = { itemId: msg.itemId, ammo: msg.ammo, mag: msg.mag };
        renderWeaponCard();
        break;
      case 'debug':
        var dbg = $('debug-line');
        if (dbg) dbg.textContent = msg.text || '';
        break;
      case 'visible':
        document.getElementById('app').style.display = msg.visible ? 'block' : 'none';
        break;
      default:
        break;
    }
  }

  var damageTimer = null;
  function showDamage(data) {
    var v = $('vignette');
    v.classList.add('show');
    if (damageTimer) clearTimeout(damageTimer);
    damageTimer = setTimeout(function () { v.classList.remove('show'); }, 220);
    if (data && data.amount >= 10) {
      toast('-' + Math.round(data.amount) + ' HP' + (data.bleeding ? ' · кровотечение' : ''), 'danger');
    }
  }

  function showHitMarker(hit) {
    var el = $('hitmarker');
    if (!el) return;
    el.textContent = hit && hit.head ? '✕' : '✕';
    el.style.color = hit && hit.kill ? '#d9604a' : '#ffffff';
    el.classList.remove('hidden');
    // перезапуск анимации
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    setTimeout(function () { el.classList.add('hidden'); }, 160);
  }

  function hideLoadingSoon() {
    if (S.loadingHidden) return;
    S.loadingHidden = true;
    setTimeout(function () {
      var loading = $('loading');
      if (loading) loading.classList.add('gone');
    }, 600);
  }

  window.goldUI = {
    receive: receive,
    setVisible: function (visible) {
      document.getElementById('app').style.display = visible ? 'block' : 'none';
    }
  };

  // Сообщаем клиенту, что CEF готов принимать данные.
  function ready() {
    try {
      if (typeof mp !== 'undefined' && mp.trigger) mp.trigger('goldui:ready');
    } catch (err) {
      // ignore
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(ready, 0);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(ready, 0); });

  setTimeout(hideLoadingSoon, 6000);
})();
