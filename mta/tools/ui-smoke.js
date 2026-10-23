#!/usr/bin/env node
/*
 * ui-smoke.js — проверка CEF-интерфейса без MTA и без браузера.
 *
 * Поднимает статический сервер над gold_dayz/ui, загружает страницу в jsdom,
 * переключает все демо-экраны, проверяет отправку пакетов в mta.triggerEvent
 * и падение JS-ошибок. Демо-режим включается сам: в браузере window.mta нет.
 *
 *   cd mta && npm install && npm run ui
 *
 * Зависимость только для разработчика: на сервере MTA и в самой сборке
 * jsdom не нужен.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const UI_DIR = path.resolve(__dirname, "..", "gold_dayz", "ui");

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.error("Нужен jsdom: cd mta && npm install (или npm install --no-save jsdom)");
  process.exit(2);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serve() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split("?")[0]);
    const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
    const file = path.resolve(UI_DIR, rel);
    if (!file.startsWith(UI_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const problems = [];
const results = [];
const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra: extra || "" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function visible(doc, sel) {
  const el = doc.querySelector(sel);
  if (!el) return false;
  for (let n = el; n && n.classList; n = n.parentElement) {
    if (n.classList.contains("hidden")) return false;
  }
  return true;
}

const SCREENS = ["scr-login", "scr-char", "scr-death"];

function activeScreen(doc) {
  return SCREENS.filter((id) => visible(doc, "#" + id)).join(",") || "-";
}

(async () => {
  const server = await serve();
  const url = "http://127.0.0.1:" + server.address().port + "/";

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    const msg = String((e && e.message) || e);
    // В песочнице нет canvas: подмена getContext не должна считаться провалом.
    if (/Not implemented: HTMLCanvasElement|getContext/.test(msg)) return;
    problems.push("jsdomError: " + msg);
  });
  vc.on("error", (...args) => {
    const msg = args.join(" ");
    // Ниже мы намеренно шлём битый JSON: UI обязан его отклонить и залогировать.
    if (/^\[GOLD UI\] SyntaxError/.test(msg)) return;
    problems.push("console.error: " + msg);
  });

  let dom;
  try {
    dom = await JSDOM.fromURL(url, {
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      virtualConsole: vc,
    });
    await wait(1500);

    const w = dom.window;
    const d = w.document;

    check("index.html загрузился", d.title.length > 0, d.title);
    check("app.js выполнился (window.dzUI)", !!w.dzUI, typeof w.dzUI);
    check("стили подхватились", d.styleSheets.length > 0, d.styleSheets.length + " таблиц");
    check("стартовый экран — вход", activeScreen(d) === "scr-login", activeScreen(d));

    const buttons = Array.from(d.querySelectorAll("[data-demo]"));
    check("демо-панель с кнопками", buttons.length >= 8, buttons.length + " кнопок");

    const scenes = {
      login: () => activeScreen(d) === "scr-login",
      char: () => activeScreen(d) === "scr-char",
      death: () => activeScreen(d) === "scr-death",
      inventory: () => visible(d, "#panel-layer") && /инвентар/i.test(d.querySelector("#panel-layer").textContent),
      trade: () => visible(d, "#panel-layer") && /торгов/i.test(d.querySelector("#panel-layer").textContent),
      corpse: () => visible(d, "#panel-layer") && /тело|труп/i.test(d.querySelector("#panel-layer").textContent),
      base: () => visible(d, "#panel-layer") && /убежище|склад/i.test(d.querySelector("#panel-layer").textContent),
      craft: () => visible(d, "#panel-layer") && /крафт|рецепт/i.test(d.querySelector("#panel-layer").textContent),
      map: () => visible(d, "#panel-layer") && /карта/i.test(d.querySelector("#panel-layer").textContent),
    };

    for (const [name, assert] of Object.entries(scenes)) {
      const btn = d.querySelector('[data-demo="' + name + '"]');
      if (!btn) { check("сцена " + name, false, "нет кнопки"); continue; }
      btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
      await wait(100);
      let ok = false, err = "";
      try { ok = assert(); } catch (e) { err = String((e && e.message) || e); }
      check("сцена " + name, ok, err);
    }

    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(80);
    check("Esc закрывает панель", !visible(d, "#panel-layer"));

    // Перехватываем пакеты: всё, что UI шлёт в игру, видно как JSON.
    const packets = [];
    if (w.mta && typeof w.mta.triggerEvent === "function") {
      const orig = w.mta.triggerEvent;
      w.mta.triggerEvent = function (event, json) {
        packets.push({ event, json });
        return orig.apply(w.mta, arguments);
      };
    }
    const lastOf = (re) => packets.filter((p) => re.test(p.json || "")).pop();

    d.querySelector('[data-demo="login"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await wait(100);
    const user = d.querySelector("#login-user");
    const pass = d.querySelector("#login-pass");
    if (user && pass) {
      user.value = "tester";
      user.dispatchEvent(new w.Event("input", { bubbles: true }));
      pass.value = "secret123";
      pass.dispatchEvent(new w.Event("input", { bubbles: true }));
      const form = d.querySelector("#login-form");
      if (form) form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
      await wait(1100);
    }
    const login = lastOf(/"a":"login"/);
    check("вход отправляет пакет dz:ui", !!login && login.event === "dz:ui", login ? login.json : "нет пакета");
    check("демо отвечает экраном персонажа", activeScreen(d) === "scr-char", activeScreen(d));

    const spawnBtn = d.querySelector("#btn-spawn");
    if (spawnBtn) {
      spawnBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await wait(150);
    }
    const spawn = lastOf(/"a":"spawn"/);
    check("спавн отправляет выбранную точку и скин", !!spawn && /"spawn":"[a-z_]+"/.test(spawn.json), spawn ? spawn.json : "нет пакета");
    check("после спавна экраны скрыты", activeScreen(d) === "-", activeScreen(d));
    check("тост появился", !!d.querySelector("#toasts .toast"));

    // Битые пакеты не должны ронять интерфейс.
    let survived = true;
    try {
      w.dzUI.push("{это не json}");
      w.dzUI.push(null);
      w.dzUI.push({ t: "panel", d: { panel: "inventory", data: {} } });
    } catch (e) { survived = false; }
    await wait(80);
    check("мусорные пакеты не роняют UI", survived);
  } finally {
    try { if (dom) dom.window.close(); } catch (e) { /* ignore */ }
    server.close();
  }

  let failed = 0;
  for (const r of results) {
    console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.extra ? "  [" + r.extra + "]" : ""));
    if (!r.ok) failed++;
  }
  if (problems.length) {
    console.log("\nJS-ошибки:");
    problems.forEach((p) => console.log("  " + p));
  }
  console.log("\nUI: " + (results.length - failed) + " ok, " + failed + " fail, " + problems.length + " JS-ошибок");
  if (failed || problems.length) process.exit(1);
  console.log("Интерфейс в порядке.");
})().catch((e) => {
  console.error("UI-смоук упал:", e);
  process.exit(2);
});
