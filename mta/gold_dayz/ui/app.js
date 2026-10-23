/* GOLD DAYZ — CEF UI.
   Общается с Lua через mta.triggerEvent('dz:ui', JSON) и window.dzUI.push(obj). */
(function () {
  "use strict";

  var hasMta = !!window.mta;
  var mta = window.mta || { triggerEvent: function () {} };
  if (!hasMta) window.mta = mta;

  var RARITY = {
    common: { label: "Обычный", color: "#9ea091" },
    uncommon: { label: "Необычный", color: "#7aa860" },
    rare: { label: "Редкий", color: "#6096c4" },
    epic: { label: "Эпический", color: "#9a7ab8" },
    legendary: { label: "Легендарный", color: "#d8a33c" }
  };

  var state = {
    items: {},
    itemList: [],
    map: null,
    version: "1.0.0",
    loginMin: 4,
    loginName: "",
    loginBusy: false,
    char: null,
    selectedSpawn: null,
    selectedSkin: null,
    panel: null,
    panelData: null,
    selInv: null,
    selEquip: null,
    moveFrom: null,
    death: null,
    deathTimer: null,
    respawnSpawn: null,
    clock: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmt(value) {
    var n = Number(value) || 0;
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function money(value) { return "$" + fmt(value); }

  /* В браузере демо-режим подменяет сервер: send() всё равно формирует пакет,
     поэтому видно, что именно уйдёт в игру, и следом отвечает локальный макет. */
  var demoHandler = null;

  function send(payload) {
    try { mta.triggerEvent("dz:ui", JSON.stringify(payload)); } catch (e) { /* вне MTA */ }
    if (demoHandler) {
      try { demoHandler(payload); } catch (e) { if (window.console) console.error("[GOLD UI демо]", e); }
    }
  }

  function closePanel() {
    send({ a: "close" });
    hidePanel();
  }

  function itemDef(id) { return state.items[id] || null; }

  function itemName(id) {
    var def = itemDef(id);
    return def ? def.name : String(id || "?");
  }

  function itemIcon(id) {
    var def = itemDef(id);
    if (!def) return "·";
    return def.icon || (def.name ? def.name.charAt(0) : "·");
  }

  function rarityOf(id) {
    var def = itemDef(id);
    return RARITY[(def && def.rarity) || "common"] || RARITY.common;
  }

  function kindLabel(kind) {
    var map = {
      medical: "Медицина", food: "Еда", drink: "Питьё", weapon: "Оружие", ammo: "Патроны",
      backpack: "Рюкзак", armor: "Броня", mask: "Маска", tool: "Инструмент",
      material: "Материал", valuable: "Ценность", gear: "Снаряжение"
    };
    return map[kind] || "Предмет";
  }

  /* ------------------------------------------------------------- экраны */

  var SCREENS = ["scr-login", "scr-char", "scr-death"];

  function hideScreens() {
    SCREENS.forEach(function (id) { var el = $("#" + id); if (el) el.classList.add("hidden"); });
  }

  function showScreen(id) {
    hideScreens();
    hidePanel();
    var el = $("#" + id);
    if (el) el.classList.remove("hidden");
  }

  function showPanelLayer() {
    hideScreens();
    var layer = $("#panel-layer");
    if (layer) layer.classList.remove("hidden");
  }

  function hidePanel() {
    var layer = $("#panel-layer");
    if (layer) layer.classList.add("hidden");
    state.panel = null;
    state.panelData = null;
    state.selInv = null;
    state.selEquip = null;
    state.moveFrom = null;
  }

  function setPanelChrome(kicker, title, foot) {
    var k = $("#panel-kicker"), t = $("#panel-title"), f = $("#panel-foot");
    if (k) k.textContent = kicker || "";
    if (t) t.textContent = title || "";
    if (f) f.innerHTML = foot || "";
  }

  /* --------------------------------------------------------------- табло */

  function toast(text, kind) {
    var box = $("#toasts");
    if (!box || !text) return;
    var el = document.createElement("div");
    el.className = "toast " + (kind || "info");
    el.textContent = String(text);
    box.appendChild(el);
    while (box.children.length > 5) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.classList.add("fade");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, 3600);
  }

  /* --------------------------------------------------------------- логин */

  function openLogin(data) {
    state.version = data.version || state.version;
    state.loginMin = Number(data.minPassword) || 4;
    state.loginName = data.name || "";
    state.loginBusy = false;
    var ver = $("#ver"); if (ver) ver.textContent = state.version;
    var user = $("#login-user");
    var pass = $("#login-pass");
    var err = $("#login-error");
    if (err) err.textContent = "";
    if (user) user.value = state.loginName;
    if (pass) pass.value = "";
    setLoginBusy(false);
    var reg = $("#btn-register");
    if (reg) reg.disabled = data.allowRegister === false;
    showScreen("scr-login");
    setTimeout(function () {
      var target = (user && !user.value) ? user : pass;
      if (target) target.focus();
    }, 120);
  }

  function setLoginBusy(busy) {
    state.loginBusy = busy;
    var form = $("#login-form");
    if (!form) return;
    $$("button", form).forEach(function (btn) { btn.disabled = busy; });
  }

  function submitLogin(register) {
    if (state.loginBusy) return;
    var err = $("#login-error");
    var user = ($("#login-user").value || "").trim();
    var pass = $("#login-pass").value || "";
    if (user.length < 3 || user.length > 24) {
      if (err) err.textContent = "Позывной: 3–24 символа, буквы/цифры/подчёркивание.";
      return;
    }
    if (pass.length < state.loginMin) {
      if (err) err.textContent = "Пароль минимум " + state.loginMin + " символа.";
      return;
    }
    if (err) err.textContent = "";
    setLoginBusy(true);
    send({ a: "login", user: user, pass: pass, register: !!register });
  }

  /* ------------------------------------------------------------ персонаж */

  function openChar(data) {
    state.char = data;
    state.selectedSpawn = data.spawns && data.spawns.length ? data.spawns[0].id : null;
    state.selectedSkin = Number(data.savedSkin) || (data.skins && data.skins[0]) || 29;

    var name = $("#char-name");
    if (name) name.textContent = data.name || "Выживший";

    var spawnBox = $("#spawn-list");
    if (spawnBox) {
      spawnBox.innerHTML = (data.spawns || []).map(function (spawn, i) {
        return '<div class="choice' + (i === 0 ? " active" : "") + '" data-act="pick-spawn" data-id="' + esc(spawn.id) + '">' +
          "<b>" + esc(spawn.name) + "</b>" +
          "<span>" + Math.round(spawn.x) + " / " + Math.round(spawn.y) + "</span></div>";
      }).join("");
    }

    var skinBox = $("#skin-list");
    if (skinBox) {
      skinBox.innerHTML = (data.skins || []).map(function (skin) {
        return '<div class="choice skin' + (Number(skin) === state.selectedSkin ? " active" : "") + '" data-act="pick-skin" data-skin="' + Number(skin) + '">' +
          '<div class="num">' + Number(skin) + "</div><span>модель</span></div>";
      }).join("");
    }

    showScreen("scr-char");
  }

  /* --------------------------------------------------------------- смерть */

  function openDeath(data) {
    state.death = data;
    state.respawnSpawn = data.respawns && data.respawns.length ? data.respawns[0].id : null;
    var cause = $("#death-cause");
    if (cause) {
      var parts = [];
      if (data.cause) parts.push(data.cause);
      if (data.killer) parts.push("убийца: " + data.killer);
      if (data.weapon) parts.push("оружие: " + data.weapon);
      cause.textContent = parts.join(" · ") || "Пустошь забрала ещё одного.";
    }
    var stats = $("#death-stats");
    if (stats) {
      stats.innerHTML =
        cell(fmt(data.survived || 0) + " c", "прожито") +
        cell(fmt(data.kills || 0), "убийств") +
        cell(fmt(data.zk || 0), "зомби") +
        cell(fmt(data.deaths || 0), "смертей");
    }
    var box = $("#death-spawns");
    if (box) {
      box.innerHTML = (data.respawns || []).map(function (spawn, i) {
        return '<div class="choice' + (i === 0 ? " active" : "") + '" data-act="pick-respawn" data-id="' + esc(spawn.id) + '">' +
          "<b>" + esc(spawn.name) + "</b><span>" + Math.round(spawn.x) + " / " + Math.round(spawn.y) + "</span></div>";
      }).join("");
    }
    startDeathCountdown(Number(data.respawnDelay) || 8);
    showScreen("scr-death");
  }

  function cell(value, label) {
    return "<div><b>" + esc(value) + "</b><span>" + esc(label) + "</span></div>";
  }

  function startDeathCountdown(seconds) {
    if (state.deathTimer) clearInterval(state.deathTimer);
    var left = Math.max(0, Math.round(seconds));
    var btn = $("#btn-respawn");
    var label = $("#death-timer");
    function tick() {
      if (left > 0) {
        if (label) label.textContent = "Возрождение через " + left + " с";
        if (btn) btn.disabled = true;
        left -= 1;
      } else {
        if (label) label.textContent = "Можно возвращаться в пустошь";
        if (btn) btn.disabled = false;
        clearInterval(state.deathTimer);
        state.deathTimer = null;
      }
    }
    tick();
    if (left > 0) state.deathTimer = setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------- панели */

  function openPanel(panel, data) {
    var samePanel = state.panel === panel;
    state.panel = panel;
    state.panelData = data || {};
    if (!samePanel) state.moveFrom = null;
    if (panel !== "inventory") { state.selInv = null; state.selEquip = null; state.moveFrom = null; }
    showPanelLayer();
    var body = $("#panel-body");
    if (!body) return;
    body.scrollTop = 0;

    if (panel === "inventory") renderInventory(body, state.panelData);
    else if (panel === "trade") renderTrade(body, state.panelData);
    else if (panel === "corpse") renderCorpse(body, state.panelData);
    else if (panel === "base") renderBase(body, state.panelData);
    else if (panel === "craft") renderCraft(body, state.panelData);
    else if (panel === "map") renderMapPanel(body, state.panelData);
    else if (panel === "help") renderHelp(body);
    else {
      setPanelChrome("Панель", panel, "");
      body.innerHTML = '<div class="empty-state">Нет данных</div>';
    }
  }

  /* ---------------------------------------------------------- инвентарь */

  function slotHtml(entry, index, opts) {
    opts = opts || {};
    if (!entry || entry.empty) {
      return '<div class="slot empty" data-act="slot" data-index="' + index + '">' +
        '<span class="empty-label">' + (opts.label || "пусто") + "</span></div>";
    }
    var def = itemDef(entry.item);
    var rarity = rarityOf(entry.item);
    var selected = state.selInv === index && !opts.equip;
    var moving = state.moveFrom !== null && state.moveFrom !== undefined;
    return '<div class="slot' + (selected ? " selected" : "") + (moving ? " move-target" : "") + '" data-rarity="' +
      esc((def && def.rarity) || "common") + '" data-act="slot" data-index="' + index + '"' +
      (opts.equip ? ' data-equip="' + esc(opts.equip) + '"' : "") +
      ' title="' + esc(itemName(entry.item)) + '">' +
      '<span class="ico" style="color:' + rarity.color + '">' + esc(itemIcon(entry.item)) + "</span>" +
      '<span class="nm">' + esc(itemName(entry.item)) + "</span>" +
      (Number(entry.count) > 1 ? '<span class="cnt">×' + fmt(entry.count) + "</span>" : "") +
      "</div>";
  }

  function renderInventory(body, data) {
    var slots = data.slots || [];
    var total = Number(data.slotsTotal) || slots.length || 18;
    var weight = Number(data.weight) || 0;
    var capacity = Number(data.capacity) || 30;
    var equip = data.equip || {};

    setPanelChrome("Инвентарь", data.name || "Выживший",
      "<span>Вес: <b class=\"gold\">" + weight.toFixed(1) + " / " + capacity.toFixed(1) + " кг</b></span>" +
      "<span>Деньги: <b class=\"gold\">" + money(data.money) + "</b></span>" +
      "<span>ЛКМ — выбрать · Esc — закрыть</span>");

    var equipBox = "";
    var equipSlots = [
      { key: "weapon", label: "Оружие", icon: "🔫" },
      { key: "backpack", label: "Рюкзак", icon: "🎒" },
      { key: "armor", label: "Броня", icon: "🛡" },
      { key: "mask", label: "Маска", icon: "😷" }
    ];
    equipSlots.forEach(function (slot) {
      var entry = equip[slot.key];
      if (entry && entry.item) {
        equipBox += slotHtml(entry, -1, { equip: slot.key });
      } else {
        equipBox += '<div class="slot empty" data-act="noop">' +
          '<span class="ico" style="opacity:.4">' + slot.icon + "</span>" +
          '<span class="empty-label">' + slot.label + "</span></div>";
      }
    });

    var gridBox = "";
    for (var i = 1; i <= total; i++) {
      gridBox += slotHtml(slots[i - 1], i);
    }

    var selected = null;
    if (state.selInv !== null && state.selInv !== undefined) selected = slots[state.selInv - 1];
    if (state.selEquip) selected = equip[state.selEquip];
    if (selected && selected.empty) selected = null;

    var detail = "";
    if (selected) {
      var def = itemDef(selected.item) || {};
      var rarity = rarityOf(selected.item);
      var actions = [];
      var isEquip = !!state.selEquip;
      if (isEquip) {
        actions.push('<button class="btn tiny" data-act="unequip" data-slot="' + esc(state.selEquip) + '">Снять</button>');
      } else {
        if (def.use) actions.push('<button class="btn tiny ok" data-act="use">Использовать</button>');
        if (def.slot) actions.push('<button class="btn tiny" data-act="equip">Надеть</button>');
        actions.push('<button class="btn tiny" data-act="move">Переместить</button>');
        actions.push('<button class="btn tiny danger" data-act="drop">Выбросить</button>');
      }
      var ammo = selected.meta && selected.meta.ammo ? selected.meta.ammo : null;
      detail = '<div class="detail">' +
        '<div class="ico" style="color:' + rarity.color + '">' + esc(itemIcon(selected.item)) + "</div>" +
        "<h3>" + esc(itemName(selected.item)) + "</h3>" +
        '<div class="rarity" style="color:' + rarity.color + '">' + esc(rarity.label) + "</div>" +
        '<div class="desc">' + esc(def.desc || "Без описания.") + "</div>" +
        '<div class="meta">' +
          "<span>Тип</span><b>" + esc(kindLabel(def.kind)) + "</b>" +
          "<span>Вес</span><b>" + (Number(def.weight) || 0).toFixed(2) + " кг</b>" +
          "<span>Кол-во</span><b>×" + fmt(selected.count || 1) + "</b>" +
          "<span>Цена</span><b>" + money(def.value || 0) + "</b>" +
          (ammo !== null ? "<span>Патроны</span><b>" + fmt(ammo) + "</b>" : "") +
        "</div>" +
        '<div class="actions">' + actions.join("") + "</div>" +
        (state.moveFrom !== null && state.moveFrom !== undefined
          ? '<p class="hint">Выберите пустой слот или слот для обмена.</p>' : "") +
        "</div>";
    } else {
      detail = '<div class="detail"><div class="empty-state">Выберите предмет слева,<br />чтобы увидеть детали.</div></div>';
    }

    body.innerHTML =
      '<div class="inv-layout">' +
        '<div class="equip-col"><div class="label">Экипировка</div>' + equipBox +
          '<div class="weight-line"><div class="bar"><i style="width:' + Math.min(100, capacity ? weight / capacity * 100 : 0) + '%"></i></div>' +
          '<div class="txt"><span>' + weight.toFixed(1) + " кг</span><span>" + capacity.toFixed(0) + " кг</span></div></div>" +
        "</div>" +
        '<div><div class="label" style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Карманы и рюкзак</div>' +
          '<div class="inv-grid">' + gridBox + "</div></div>" +
        detail +
      "</div>";
  }

  function refreshInventory() {
    if (state.panel === "inventory") openPanel("inventory", state.panelData);
  }

  /* -------------------------------------------------------------- торговля */

  function renderTrade(body, data) {
    var trader = data.trader || { name: "Торговец" };
    setPanelChrome("Торговля", trader.name || "Торговец",
      "<span>Ваш баланс: <b class=\"gold\">" + money(data.money) + "</b></span><span>Цены зависят от редкости</span><span>Esc — закрыть</span>");

    var stock = data.stock || [];
    var sell = data.sell || [];

    var stockRows = stock.length ? stock.map(function (row) {
      var rarity = RARITY[(row.rarity || "common")] || RARITY.common;
      return '<div class="line">' +
        '<div class="ico" style="color:' + rarity.color + '">' + esc(row.icon || itemIcon(row.item)) + "</div>" +
        '<div><div class="nm">' + esc(row.name || itemName(row.item)) + "</div>" +
        '<div class="sub">' + esc(rarity.label) + " · в наличии " + fmt(row.left) + "</div></div>" +
        '<div class="price">' + money(row.price) + "</div>" +
        '<div class="row gap"><button class="btn tiny" data-act="trade-buy" data-item="' + esc(row.item) + '" data-count="1">×1</button>' +
        '<button class="btn tiny" data-act="trade-buy" data-item="' + esc(row.item) + '" data-count="5">×5</button></div>' +
        "</div>";
    }).join("") : '<div class="empty-state">Товар закончился. Загляните позже.</div>';

    var sellRows = sell.length ? sell.map(function (row) {
      var rarity = RARITY[(row.rarity || "common")] || RARITY.common;
      return '<div class="line">' +
        '<div class="ico" style="color:' + rarity.color + '">' + esc(row.icon || itemIcon(row.item)) + "</div>" +
        '<div><div class="nm">' + esc(row.name || itemName(row.item)) + "</div>" +
        '<div class="sub">у вас ' + fmt(row.count) + " шт.</div></div>" +
        '<div class="price">' + money(row.price) + "</div>" +
        '<div class="row gap"><button class="btn tiny" data-act="trade-sell" data-item="' + esc(row.item) + '" data-count="1">×1</button>' +
        '<button class="btn tiny" data-act="trade-sell" data-item="' + esc(row.item) + '" data-count="' + Number(row.count) + '">всё</button></div>' +
        "</div>";
    }).join("") : '<div class="empty-state">Нечего продавать.</div>';

    body.innerHTML =
      '<div class="trade-layout">' +
        '<div><div class="list-head"><h3>Купить</h3><span class="muted small">' + stock.length + " позиций</span></div>" +
          '<div class="list-scroll">' + stockRows + "</div></div>" +
        '<div><div class="list-head"><h3>Продать</h3><span class="muted small">выкуп ~45%</span></div>' +
          '<div class="list-scroll">' + sellRows + "</div></div>" +
      "</div>";
  }

  /* ------------------------------------------------------------------ труп */

  function renderCorpse(body, data) {
    setPanelChrome("Тело", data.name || "Неизвестный",
      "<span>Забирайте быстро: тело исчезнет</span><button class=\"btn tiny\" data-act=\"corpse-all\">Забрать всё</button>");

    var slots = data.slots || [];
    var rows = [];
    slots.forEach(function (entry, i) {
      if (!entry || entry.empty) return;
      var rarity = rarityOf(entry.item);
      rows.push('<div class="line">' +
        '<div class="ico" style="color:' + rarity.color + '">' + esc(itemIcon(entry.item)) + "</div>" +
        '<div><div class="nm">' + esc(itemName(entry.item)) + "</div>" +
        '<div class="sub">' + esc(rarity.label) + "</div></div>" +
        '<div class="price">×' + fmt(entry.count || 1) + "</div>" +
        '<div class="row gap"><button class="btn tiny" data-act="corpse-take" data-index="' + (i + 1) + '" data-count="1">1</button>' +
        '<button class="btn tiny" data-act="corpse-take" data-index="' + (i + 1) + '" data-count="' + Number(entry.count || 1) + '">всё</button></div>' +
        "</div>");
    });

    body.innerHTML = rows.length ? '<div class="list-scroll">' + rows.join("") + "</div>"
      : '<div class="empty-state">Тело пусто.</div>';
  }

  /* ------------------------------------------------------------------ база */

  function renderBase(body, data) {
    var base = data.base || {};
    var access = data.access === true;
    setPanelChrome("Убежище", base.name || "База",
      "<span>" + (base.owner ? "владелец: " + esc(base.owner) : "свободное убежище") + "</span>" +
      "<span>Радиус " + Math.round(base.radius || 28) + " м</span>");

    var head = '<div class="base-head"><div class="mark">⌂</div><div><h3>' + esc(base.name || "Убежище") + "</h3>" +
      '<div class="sub">' + (base.owner ? "PIN " + (base.codeSet ? "установлен" : "нет") : "никем не занято") + "</div></div></div>";

    if (!base.owner) {
      body.innerHTML = head +
        '<p class="muted">Занять убежище можно один раз. Склад защищён PIN-кодом, зона безопасна для вас и вашей группы.</p>' +
        '<div class="pin-row"><input id="base-pin" maxlength="8" inputmode="numeric" placeholder="PIN" value="1234" />' +
        '<button class="btn primary" data-act="base-claim">Занять базу</button></div>' +
        '<p class="hint">PIN: 3–8 цифр. Не сообщайте его посторонним — это ключ к вашему складу.</p>';
      return;
    }

    if (!access) {
      body.innerHTML = head +
        '<p class="muted">Убежище занято. Если вы знаете PIN, введите его, чтобы получить доступ к складу.</p>' +
        '<div class="pin-row"><input id="base-pin" maxlength="8" inputmode="numeric" placeholder="PIN" />' +
        '<button class="btn primary" data-act="base-code">Ввести PIN</button></div>';
      return;
    }

    var stash = data.stash || [];
    var bag = data.bag || [];

    var stashRows = [];
    stash.forEach(function (entry, i) {
      if (!entry || entry.empty) return;
      stashRows.push('<div class="line">' +
        '<div class="ico">' + esc(itemIcon(entry.item)) + "</div>" +
        '<div><div class="nm">' + esc(itemName(entry.item)) + "</div>" +
        '<div class="sub">×' + fmt(entry.count || 1) + "</div></div>" +
        '<div class="price"></div>' +
        '<div class="row gap"><button class="btn tiny" data-act="base-take" data-index="' + (i + 1) + '" data-count="1">1</button>' +
        '<button class="btn tiny" data-act="base-take" data-index="' + (i + 1) + '" data-count="' + Number(entry.count || 1) + '">всё</button></div>' +
        "</div>");
    });

    var bagRows = bag.length ? bag.map(function (row) {
      return '<div class="line">' +
        '<div class="ico">' + esc(row.icon || itemIcon(row.item)) + "</div>" +
        '<div><div class="nm">' + esc(row.name || itemName(row.item)) + "</div>" +
        '<div class="sub">×' + fmt(row.count) + "</div></div>" +
        '<div class="price"></div>' +
        '<div class="row gap"><button class="btn tiny" data-act="base-store" data-item="' + esc(row.item) + '" data-count="1">1</button>' +
        '<button class="btn tiny" data-act="base-store" data-item="' + esc(row.item) + '" data-count="' + Number(row.count) + '">всё</button></div>' +
        "</div>";
    }).join("") : '<div class="empty-state">Инвентарь пуст.</div>';

    body.innerHTML =
      '<div class="base-grid">' +
        "<div>" + head +
          '<div class="list-head"><h3>Склад</h3><span class="muted small">' + fmt(data.stashTotal || 0) + " слотов</span></div>" +
          '<div class="list-scroll">' + (stashRows.length ? stashRows.join("") : '<div class="empty-state">Склад пуст.</div>') + "</div>" +
        "</div>" +
        "<div>" +
          '<div class="list-head"><h3>Положить</h3><span class="muted small">из инвентаря</span></div>' +
          '<div class="list-scroll">' + bagRows + "</div>" +
          '<div class="pin-row"><input id="base-pin" maxlength="8" inputmode="numeric" placeholder="Новый PIN" />' +
          '<button class="btn" data-act="base-code">Сменить PIN</button></div>' +
          '<button class="btn danger" data-act="base-unclaim">Снять базу</button>' +
        "</div>" +
      "</div>";
  }

  /* ----------------------------------------------------------------- крафт */

  function renderCraft(body, data) {
    var bench = data.nearBench === true;
    setPanelChrome("Крафт", "Верстак пустоши",
      "<span>" + (bench ? "Верстак: " + esc(data.place || "рядом") : "Верстак: <b style=\"color:var(--orange)\">далеко</b>") + "</span>" +
      "<span>Esc — закрыть</span>");

    var recipes = data.recipes || [];
    body.innerHTML = '<div class="craft-grid">' + recipes.map(function (recipe) {
      var ready = recipe.can === true && (!recipe.bench || bench);
      var chips = (recipe.items || []).map(function (need) {
        return '<span class="chip ' + (need.enough ? "ok" : "bad") + '">' +
          esc(need.name) + " " + fmt(need.have) + "/" + fmt(need.count) + "</span>";
      }).join("");
      return '<div class="craft-card' + (ready ? " ready" : "") + '">' +
        '<div class="top"><div class="ico">' + esc(recipe.outIcon || "?") + "</div>" +
        "<div><h4>" + esc(recipe.outName) + "</h4>" +
        '<div class="sub">' + (recipe.bench ? "нужен верстак" : "в любом месте") + " · ×" + fmt(recipe.count || 1) + "</div></div></div>" +
        '<div class="ingredients">' + chips + "</div>" +
        '<button class="btn tiny' + (ready ? " primary" : "") + '" data-act="craft" data-id="' + esc(recipe.id) + '"' +
          (ready ? "" : " disabled") + ">Создать</button>" +
        "</div>";
    }).join("") + "</div>";
  }

  /* ------------------------------------------------------------------ карта */

  var ZONE_STYLE = {
    safe: { color: "#94b36a", label: "Безопасная зона" },
    radiation: { color: "#cf7a3e", label: "Радиация" },
    loot: { color: "#c9a24b", label: "Лут" },
    zombie: { color: "#be4634", label: "Зомби" },
    base: { color: "#e1e6d7", label: "Убежище" },
    trader: { color: "#6d9bb5", label: "Торговец" },
    vehicle: { color: "#8a937c", label: "Авто" }
  };

  function renderMapPanel(body, data) {
    var player = data.player || {};
    setPanelChrome("Карта", "Остров Сан-Андреас",
      "<span>Вы: " + Math.round(player.x || 0) + " / " + Math.round(player.y || 0) + "</span>" +
      "<span>M — закрыть · зоны видны по цвету</span>");

    body.innerHTML =
      '<div class="map-wrap"><canvas id="map-canvas"></canvas></div>' +
      '<div class="map-legend">' +
        Object.keys(ZONE_STYLE).map(function (key) {
          return '<span><i style="background:' + ZONE_STYLE[key].color + '"></i>' + ZONE_STYLE[key].label + "</span>";
        }).join("") +
      "</div>";

    var canvas = $("#map-canvas");
    if (!canvas) return;
    requestAnimationFrame(function () { drawMap(canvas, data); });
  }

  function drawMap(canvas, data) {
    var zones = data.zones || [];
    var player = data.player || null;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    var w = rect.width, h = rect.height;
    ctx.fillStyle = "#080b07";
    ctx.fillRect(0, 0, w, h);

    var minX = -3000, maxX = 3000, minY = -3000, maxY = 3000;
    var pts = zones.concat(player ? [{ x: player.x, y: player.y }] : []);
    pts.forEach(function (p) {
      if (typeof p.x !== "number" || typeof p.y !== "number") return;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    minX -= 250; maxX += 250; minY -= 250; maxY += 250;

    var pad = 24;
    var scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    var ox = (w - (maxX - minX) * scale) / 2;
    var oy = (h - (maxY - minY) * scale) / 2;
    var px = function (x) { return ox + (x - minX) * scale; };
    var py = function (y) { return h - (oy + (y - minY) * scale); };

    ctx.strokeStyle = "rgba(201,162,75,0.08)";
    ctx.lineWidth = 1;
    for (var gx = Math.ceil(minX / 500) * 500; gx <= maxX; gx += 500) {
      ctx.beginPath(); ctx.moveTo(px(gx), py(minY)); ctx.lineTo(px(gx), py(maxY)); ctx.stroke();
    }
    for (var gy = Math.ceil(minY / 500) * 500; gy <= maxY; gy += 500) {
      ctx.beginPath(); ctx.moveTo(px(minX), py(gy)); ctx.lineTo(px(maxX), py(gy)); ctx.stroke();
    }

    zones.forEach(function (zone) {
      var style = ZONE_STYLE[zone.kind] || ZONE_STYLE.loot;
      if (typeof zone.x !== "number" || typeof zone.y !== "number") return;
      var radius = Math.max(2, (Number(zone.radius) || 30) * scale);
      ctx.beginPath();
      ctx.arc(px(zone.x), py(zone.y), radius, 0, Math.PI * 2);
      ctx.fillStyle = hexA(style.color, zone.kind === "radiation" ? 0.18 : 0.12);
      ctx.fill();
      ctx.strokeStyle = hexA(style.color, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    ctx.font = "11px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    zones.forEach(function (zone) {
      if (!zone.name) return;
      if (zone.kind === "vehicle" || zone.kind === "loot" || zone.kind === "zombie") return;
      var style = ZONE_STYLE[zone.kind] || ZONE_STYLE.loot;
      ctx.fillStyle = hexA(style.color, 0.9);
      ctx.fillText(zone.name, px(zone.x), py(zone.y) - 6);
    });

    if (player && typeof player.x === "number") {
      var x = px(player.x), y = py(player.y);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#e2c377";
      ctx.fill();
      ctx.strokeStyle = "rgba(226,195,119,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#e2c377";
      ctx.font = "10px 'Segoe UI', Arial, sans-serif";
      ctx.fillText("ВЫ", x, y - 16);
    }
  }

  function hexA(hex, alpha) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var num = parseInt(h, 16);
    return "rgba(" + ((num >> 16) & 255) + "," + ((num >> 8) & 255) + "," + (num & 255) + "," + alpha + ")";
  }

  /* ----------------------------------------------------------------- помощь */

  function renderHelp(body) {
    setPanelChrome("Помощь", "Как выжить",
      "<span>F1 — закрыть</span><span>Чаты и подсказки — в левом нижнем углу</span>");
    body.innerHTML =
      '<div class="help-grid">' +
        "<div><h3>Управление</h3>" +
          keyrow("W A S D", "движение") +
          keyrow("Shift", "бег (тратит стамину)") +
          keyrow("E", "взаимодействие: лут, трупы, торговцы, базы") +
          keyrow("I", "инвентарь и экипировка") +
          keyrow("M", "карта острова") +
          keyrow("C", "крафт") +
          keyrow("F1", "эта подсказка") +
          keyrow("Esc", "закрыть панель") +
        "</div>" +
        "<div><h3>Правила пустоши</h3>" +
          '<ul class="tips">' +
            "<li>Следите за голодом, жаждой и кровью: при нуле вы теряете HP.</li>" +
            "<li>Кровотечение останавливают бинт и тряпки, инфекцию — антибиотики, радиацию — противогаз и антирад.</li>" +
            "<li>Оружие достаётся из инвентаря и экипируется в слот «Оружие»; патроны подходят по типу.</li>" +
            "<li>Торговцы стоят в безопасных лагерях: там нет зомби и PvP.</li>" +
            "<li>Убежище даёт безопасную зону и склад с PIN-кодом. Одна база на игрока.</li>" +
            "<li>Транспорт нужно заправлять и ремонтировать: ищите канистры и ремкомплекты.</li>" +
            "<li>Трупы игроков и зомби содержат лут — но за него придётся драться.</li>" +
          "</ul>" +
        "</div>" +
      "</div>";
  }

  function keyrow(key, text) {
    return '<div class="keyrow"><span>' + esc(text) + "</span><kbd>" + esc(key) + "</kbd></div>";
  }

  /* ---------------------------------------------------------- сообщения из Lua */

  function handlePush(payload) {
    if (!payload || typeof payload !== "object") return;
    var kind = payload.t;
    var data = payload.d || {};

    switch (kind) {
      case "login": openLogin(data); break;
      case "loginError": {
        var err = $("#login-error");
        if (err) { err.textContent = data.text || "Ошибка входа"; err.style.color = ""; }
        setLoginBusy(false);
        var pass = $("#login-pass");
        if (pass) pass.focus();
        break;
      }
      case "loginOk": {
        setLoginBusy(true);
        var err2 = $("#login-error");
        if (err2) { err2.textContent = "Вход выполнен. Загрузка персонажа…"; err2.style.color = "var(--green)"; }
        break;
      }
      case "char": openChar(data); break;
      case "death": openDeath(data); break;
      case "welcome": {
        state.itemList = data.items || [];
        state.items = {};
        state.itemList.forEach(function (def) { if (def && def.id) state.items[def.id] = def; });
        state.map = data.map || state.map;
        state.version = data.version || state.version;
        if (state.deathTimer) { clearInterval(state.deathTimer); state.deathTimer = null; }
        hideScreens();
        hidePanel();
        break;
      }
      case "spawned": {
        hideScreens();
        hidePanel();
        break;
      }
      case "panel": openPanel(data.panel, data.data); break;
      case "mapPos": {
        if (state.panel === "map" && state.panelData) {
          state.panelData.player = data;
          var canvas = $("#map-canvas");
          if (canvas) drawMap(canvas, state.panelData);
        }
        break;
      }
      case "kill": toast(data.line || "Кто-то погиб", "danger"); break;
      case "bossSpawn": toast("Исполин: " + (data.name || "пустошь"), "warn"); break;
      case "close": {
        if (!data.panel || data.panel === state.panel) hidePanel();
        break;
      }
      case "help": openPanel("help", {}); break;
      case "toast": toast(data.text, data.kind); break;
      default: break;
    }
  }

  window.dzUI = {
    push: function (payload) {
      try {
        handlePush(typeof payload === "string" ? JSON.parse(payload) : payload);
      } catch (e) {
        if (window.console) console.error("[GOLD UI]", e);
      }
    }
  };

  /* ------------------------------------------------------------- действия */

  function sendInventory(op, extra) {
    var index = null;
    if (state.selEquip) {
      send(Object.assign({ a: "inv", op: "unequip", slot: state.selEquip }, extra || {}));
      state.selEquip = null;
      return;
    }
    index = state.selInv;
    if (!index) return;
    send(Object.assign({ a: "inv", op: op, index: index }, extra || {}));
  }

  document.addEventListener("click", function (event) {
    var btn = event.target.closest ? event.target.closest("[data-act]") : null;
    if (!btn) return;
    var act = btn.getAttribute("data-act");
    var data = btn.dataset || {};

    switch (act) {
      case "close": closePanel(); break;
      case "noop": break;
      case "pick-spawn":
        state.selectedSpawn = data.id;
        $$("#spawn-list .choice").forEach(function (el) { el.classList.toggle("active", el.dataset.id === data.id); });
        break;
      case "pick-skin":
        state.selectedSkin = Number(data.skin);
        $$("#skin-list .choice").forEach(function (el) { el.classList.toggle("active", Number(el.dataset.skin) === state.selectedSkin); });
        break;
      case "pick-respawn":
        state.respawnSpawn = data.id;
        $$("#death-spawns .choice").forEach(function (el) { el.classList.toggle("active", el.dataset.id === data.id); });
        break;
      case "slot": {
        var index = Number(data.index) || null;
        if (data.equip) {
          state.selEquip = data.equip;
          state.selInv = null;
          refreshInventory();
          break;
        }
        if (index) {
          if (state.moveFrom !== null && state.moveFrom !== undefined && index !== state.moveFrom) {
            send({ a: "inv", op: "move", from: state.moveFrom, to: index });
            state.moveFrom = null;
            state.selInv = index;
          } else {
            state.selInv = index;
            state.selEquip = null;
          }
          refreshInventory();
        }
        break;
      }
      case "use": sendInventory("use"); break;
      case "equip": sendInventory("equip"); break;
      case "unequip": send({ a: "inv", op: "unequip", slot: data.slot }); state.selEquip = null; refreshInventory(); break;
      case "drop": sendInventory("drop", { count: 1 }); break;
      case "move": state.moveFrom = state.selInv; refreshInventory(); break;
      case "trade-buy": send({ a: "trade", op: "buy", item: data.item, count: Number(data.count) || 1 }); break;
      case "trade-sell": send({ a: "trade", op: "sell", item: data.item, count: Number(data.count) || 1 }); break;
      case "corpse-take": send({ a: "corpse", op: "take", id: state.panelData.id, index: Number(data.index), count: Number(data.count) || 1 }); break;
      case "corpse-all": send({ a: "corpse", op: "takeAll", id: state.panelData.id }); break;
      case "base-claim": send({ a: "base", op: "claim", id: state.panelData.base.id, code: pinValue() }); break;
      case "base-code": send({ a: "base", op: "code", id: state.panelData.base.id, code: pinValue() }); break;
      case "base-store": send({ a: "base", op: "store", id: state.panelData.base.id, item: data.item, count: Number(data.count) || 1 }); break;
      case "base-take": send({ a: "base", op: "take", id: state.panelData.base.id, index: Number(data.index), count: Number(data.count) || 1 }); break;
      case "base-unclaim": send({ a: "base", op: "unclaim", id: state.panelData.base.id }); break;
      case "craft": send({ a: "craft", op: "craft", id: data.id }); break;
      default: break;
    }
  });

  function pinValue() {
    var input = $("#base-pin");
    return input ? String(input.value || "").trim() : "";
  }

  /* ---------------------------------------------------------------- формы */

  var form = $("#login-form");
  if (form) {
    form.addEventListener("submit", function (e) { e.preventDefault(); submitLogin(false); });
  }
  var regBtn = $("#btn-register");
  if (regBtn) regBtn.addEventListener("click", function () { submitLogin(true); });

  var spawnBtn = $("#btn-spawn");
  if (spawnBtn) {
    spawnBtn.addEventListener("click", function () {
      if (!state.selectedSpawn) return;
      spawnBtn.disabled = true;
      send({ a: "spawn", spawn: state.selectedSpawn, skin: state.selectedSkin });
      setTimeout(function () { spawnBtn.disabled = false; }, 2000);
    });
  }

  var respawnBtn = $("#btn-respawn");
  if (respawnBtn) {
    respawnBtn.addEventListener("click", function () {
      if (respawnBtn.disabled) return;
      respawnBtn.disabled = true;
      send({ a: "respawn", spawn: state.respawnSpawn });
      setTimeout(function () { respawnBtn.disabled = false; }, 2500);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var layer = $("#panel-layer");
      if (layer && !layer.classList.contains("hidden")) {
        e.preventDefault();
        closePanel();
      }
    }
    if (e.key === "Enter" && !$("#scr-login").classList.contains("hidden")) {
      var active = document.activeElement;
      if (active && active.tagName === "INPUT") {
        e.preventDefault();
        submitLogin(false);
      }
    }
  });

  window.addEventListener("resize", function () {
    if (state.panel === "map" && state.panelData) {
      var canvas = $("#map-canvas");
      if (canvas) drawMap(canvas, state.panelData);
    }
  });

  /* Демо-режим для просмотра UI в обычном браузере (ui/index.html).
     В MTA этот блок не выполняется: window.mta существует. */
  if (!hasMta) startDemo();

  function startDemo() {
    var ITEMS = [
      { id: "bandage", name: "Бинт", kind: "medical", weight: 0.1, stack: 10, rarity: "common", icon: "🩹", value: 25 },
      { id: "medkit", name: "Аптечка", kind: "medical", weight: 0.6, stack: 3, rarity: "rare", icon: "💊", value: 180 },
      { id: "soda", name: "Газировка", kind: "drink", weight: 0.33, stack: 8, rarity: "common", icon: "🥤", value: 15 },
      { id: "canned_food", name: "Консервы", kind: "food", weight: 0.4, stack: 8, rarity: "common", icon: "🥫", value: 20 },
      { id: "rags", name: "Тряпки", kind: "medical", weight: 0.05, stack: 20, rarity: "common", icon: "🧵", value: 5 },
      { id: "scrap", name: "Металлолом", kind: "material", weight: 0.5, stack: 20, rarity: "common", icon: "🔩", value: 12 },
      { id: "wood", name: "Доска", kind: "material", weight: 0.7, stack: 10, rarity: "common", icon: "🪵", value: 10 },
      { id: "ammo_rifle", name: "Патроны 7.62", kind: "ammo", weight: 0.35, stack: 60, rarity: "uncommon", icon: "📦", value: 40 },
      { id: "ak47", name: "AK-47", kind: "weapon", weight: 3.6, stack: 1, rarity: "rare", icon: "🔫", value: 1200, slot: "weapon" },
      { id: "knife", name: "Нож", kind: "weapon", weight: 0.5, stack: 1, rarity: "common", icon: "🔪", value: 60, slot: "weapon" },
      { id: "armor_light", name: "Лёгкий бронежилет", kind: "armor", weight: 3.5, stack: 1, rarity: "uncommon", icon: "🦺", value: 350, slot: "armor" },
      { id: "backpack_small", name: "Старый рюкзак", kind: "backpack", weight: 0.8, stack: 1, rarity: "uncommon", icon: "🎒", value: 250, slot: "backpack", storage: 6, capacity: 5 },
      { id: "gas_mask", name: "Противогаз", kind: "mask", weight: 0.7, stack: 1, rarity: "rare", icon: "😷", value: 300, slot: "mask" },
      { id: "repair_kit", name: "Ремкомплект", kind: "tool", weight: 1.2, stack: 5, rarity: "uncommon", icon: "🧰", value: 120, tool: "repair" },
      { id: "jerrycan", name: "Канистра", kind: "tool", weight: 2.0, stack: 3, rarity: "common", icon: "⛽", value: 90, tool: "refuel" },
      { id: "map", name: "Карта штата", kind: "gear", weight: 0.1, stack: 1, rarity: "common", icon: "🗺", value: 40 },
      { id: "gold_bar", name: "Золотой слиток", kind: "valuable", weight: 0.9, stack: 5, rarity: "legendary", icon: "🏆", value: 3200 }
    ];

    handlePush({ t: "welcome", d: { version: "1.0.0", items: ITEMS } });

    function charData() {
      return { name: "Кочующий", spawns: spawns(), skins: [7, 12, 14, 20, 29, 31], savedSkin: 29 };
    }

    function describeAction(payload) {
      if (payload.a === "inv") return "инвентарь: " + payload.op;
      if (payload.a === "trade") return "торговля: " + payload.op;
      if (payload.a === "corpse") return "труп: " + payload.op;
      if (payload.a === "base") return "база: " + payload.op;
      if (payload.a === "craft") return "крафт";
      return String(payload.a || "?");
    }

    demoHandler = function (payload) {
      if (payload.a === "login") {
        window.setTimeout(function () {
          if (/^fail/i.test(String(payload.user || ""))) {
            handlePush({ t: "loginError", d: { text: "Демо: неверный позывной или пароль." } });
            return;
          }
          handlePush({ t: "loginOk" });
          window.setTimeout(function () { handlePush({ t: "char", d: charData() }); }, 400);
        }, 400);
        return;
      }
      if (payload.a === "spawn") {
        handlePush({ t: "spawned" });
        toast("Демо: спавн «" + (spawnName(payload.spawn) || payload.spawn) + "». В игре здесь загружается мир.", "ok");
        return;
      }
      if (payload.a === "respawn") {
        handlePush({ t: "char", d: charData() });
        toast("Демо: возрождение — в игре экран выбора точки", "ok");
        return;
      }
      if (payload.a === "close") { hidePanel(); return; }
      toast("Демо: «" + describeAction(payload) + "» уйдёт на сервер", "info");
    };

    var bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = '<span class="demo-label">ДЕМО UI</span>' +
      ["login", "char", "inventory", "trade", "corpse", "base", "craft", "map", "death"]
        .map(function (name) { return '<button class="btn tiny" data-demo="' + name + '">' + name + "</button>"; })
        .join("");
    document.body.appendChild(bar);
    bar.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-demo]");
      if (btn) demoScene(btn.getAttribute("data-demo"));
    });

    function spawns() {
      return [
        { id: "ls_grove", name: "Лос-Сантос, Гроув-Стрит", x: 2495, y: -1687 },
        { id: "sf_doherty", name: "Сан-Фиерро, Догерти", x: -2050, y: 340 },
        { id: "lv_strip", name: "Лас-Вентурас, Стрип", x: 2050, y: 1400 },
        { id: "fort_carson", name: "Форт-Карсон", x: -160, y: 990 }
      ];
    }

    function spawnName(id) {
      var found = null;
      spawns().forEach(function (s) { if (s.id === id) found = s.name; });
      return found;
    }

    function demoScene(name) {
      if (name === "login") {
        openLogin({ name: "", version: "1.0.0", allowRegister: true, minPassword: 4 });
      } else if (name === "char") {
        openChar(charData());
      } else if (name === "death") {
        openDeath({ cause: "Растерзан зомби", survived: 1840, kills: 7, zk: 23, deaths: 4, respawnDelay: 8, respawns: spawns() });
      } else if (name === "inventory") {
        var slots = [];
        [["knife", 1], ["bandage", 8], ["ammo_rifle", 45], ["canned_food", 3], ["soda", 2], ["rags", 12], ["scrap", 9], ["wood", 4]]
          .forEach(function (row, i) { slots[i] = { item: row[0], count: row[1] }; });
        for (var i = slots.length; i < 24; i++) slots[i] = { empty: true };
        openPanel("inventory", {
          name: "Кочующий", money: 2450, slots: slots, slotsTotal: 24, weight: 14.2, capacity: 35,
          equip: {
            weapon: { item: "ak47", count: 1, meta: { ammo: 30 } },
            backpack: { item: "backpack_small", count: 1 },
            armor: { item: "armor_light", count: 1, meta: { armor: 50 } },
            mask: { item: "gas_mask", count: 1 }
          }
        });
      } else if (name === "trade") {
        openPanel("trade", {
          trader: { id: "trader_ls", name: "Торговец Лагеря" }, money: 2450,
          stock: [
            { item: "bandage", price: 25, left: 40 }, { item: "medkit", price: 180, left: 6 },
            { item: "ammo_rifle", price: 40, left: 25 }, { item: "ak47", price: 1200, left: 2 },
            { item: "backpack_small", price: 250, left: 4 }
          ],
          sell: [
            { item: "gold_bar", price: 1440, count: 2 }, { item: "rags", price: 2, count: 12 },
            { item: "scrap", price: 5, count: 9 }, { item: "canned_food", price: 9, count: 3 }
          ]
        });
      } else if (name === "corpse") {
        openPanel("corpse", {
          id: 1, name: "Тело: Кочующий",
          slots: [{ item: "ak47", count: 1 }, { item: "bandage", count: 4 }, { item: "ammo_rifle", count: 30 }],
          slotsTotal: 18
        });
      } else if (name === "base") {
        openPanel("base", {
          base: { id: "base_dillimore", name: "Убежище Диллмор", x: 600, y: -500, z: 20, radius: 28, owner: "Кочующий", codeSet: true },
          access: true, canClaim: false, stashTotal: 40, stashWeight: 8.4,
          bag: [{ item: "bandage", count: 8 }, { item: "scrap", count: 9 }, { item: "repair_kit", count: 1 }],
          stash: [
            { item: "medkit", count: 2 }, { item: "ammo_rifle", count: 60 }, { item: "jerrycan", count: 1 },
            { item: "armor_light", count: 1 }, { item: "gold_bar", count: 1 }
          ]
        });
      } else if (name === "craft") {
        openPanel("craft", {
          nearBench: true, place: "Убежище Диллмор",
          recipes: [
            { id: "craft_bandage", name: "Бинты", out: "bandage", outName: "Бинт", outIcon: "🩹", count: 1, can: true, missing: [], items: [{ item: "rags", name: "Тряпки", count: 3, have: 12, enough: true }] },
            { id: "craft_medkit", name: "Аптечка", out: "medkit", outName: "Аптечка", outIcon: "💊", count: 1, can: false, missing: ["Бинт"], items: [{ item: "bandage", name: "Бинт", count: 3, have: 1, enough: false }] },
            { id: "craft_repair_kit", name: "Ремкомплект", out: "repair_kit", outName: "Ремкомплект", outIcon: "🧰", count: 1, can: true, missing: [], items: [{ item: "scrap", name: "Металлолом", count: 3, have: 9, enough: true }] },
            { id: "craft_armor", name: "Бронежилет", out: "armor_light", outName: "Лёгкий бронежилет", outIcon: "🦺", count: 1, can: false, missing: ["Металлолом"], items: [{ item: "scrap", name: "Металлолом", count: 6, have: 2, enough: false }] }
          ]
        });
      } else if (name === "map") {
        var zones = [
          { id: "ls_hospital", name: "ЛС: больница", kind: "loot", x: 1179, y: -1324, radius: 28, tier: 2 },
          { id: "ls_docks", name: "ЛС: доки", kind: "loot", x: 2782, y: -1850, radius: 28, tier: 2 },
          { id: "sf_airport", name: "СФ: аэропорт", kind: "loot", x: -1300, y: -200, radius: 30, tier: 2 },
          { id: "lv_area69", name: "ЛВ: Зона 69", kind: "zombie", x: 240, y: 1900, radius: 90 },
          { id: "camp_ls", name: "Лагерь ЛС", kind: "safe", x: 2495, y: -1687, radius: 40 },
          { id: "camp_sf", name: "Лагерь СФ", kind: "safe", x: -2050, y: 340, radius: 40 },
          { id: "nuclear", name: "Радиация: АЭС", kind: "radiation", x: -1500, y: 2500, radius: 120 },
          { id: "base_dillimore", name: "Диллмор", kind: "base", x: 600, y: -500, radius: 28 },
          { id: "base_angel", name: "Ангел-Пайн", kind: "base", x: -2100, y: -2400, radius: 28 },
          { id: "trader_ls", name: "Торговец", kind: "trader", x: 2500, y: -1670, radius: 6 },
          { id: "veh_ls", name: "Авто", kind: "vehicle", x: 2520, y: -1700, radius: 5 }
        ];
        openPanel("map", { zones: zones, spawns: spawns(), player: { x: 2495, y: -1687, z: 13.5 } });
      }
    }

    openLogin({ name: "", version: "1.0.0", allowRegister: true, minPassword: 4 });
    toast("Демо-режим: MTA не найден", "warn");
    demoScene("login");
    if (window.console) console.info("[GOLD UI] демо: переключайте экраны панелью сверху");
  }
})();
