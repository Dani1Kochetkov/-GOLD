'use strict';

/**
 * Мост клиент ⇄ CEF-интерфейс.
 * Все сообщения — JSON; CEF отвечает событиями goldui:action.
 */
class UIBridge {
  constructor() {
    this.browser = null;
    this.ready = false;
    this.queue = [];
    this.onAction = null;
    this.visible = false;
    this.failed = false;
  }

  init(onAction) {
    this.onAction = onAction;
    // Слушатели регистрируем ДО создания браузера: CEF может загрузиться
    // и прислать goldui:ready раньше, чем мы успеем подписаться.
    mp.events.add('goldui:ready', () => {
      this.ready = true;
      this.flush();
    });
    try {
      this.browser = mp.browsers.new('package://gold/ui/index.html');
    } catch (err) {
      this.failed = true;
      mp.gui.chat.push('! GOLD DAYZ: не удалось открыть UI (gold/ui/index.html). Соберите клиент: npm run build');
      return;
    }
    // Страховка: если CEF не прислал ready (например, ошибка JS в app.js),
    // всё равно пробуем отправлять сообщения, чтобы HUD не остался пустым.
    setTimeout(() => {
      if (!this.ready && !this.failed) {
        this.ready = true;
        this.flush();
        mp.gui.chat.push('! GOLD DAYZ: UI не ответил вовремя — проверьте client_packages/gold/ui/app.js');
      }
    }, 5000);
    mp.events.add('goldui:action', (payload) => {
      let action = null;
      try {
        action = typeof payload === 'string' ? JSON.parse(payload) : payload;
      } catch (err) {
        return;
      }
      if (action && typeof this.onAction === 'function') this.onAction(action);
    });
    mp.events.add('goldui:log', (message) => {
      mp.gui.chat.push(`[UI] ${message}`);
    });
  }

  post(message) {
    if (this.failed) return;
    if (!this.ready) {
      if (this.queue.length < 200) this.queue.push(message);
      return;
    }
    const json = JSON.stringify(message);
    try {
      this.browser.execute(`window.goldUI && window.goldUI.receive(${JSON.stringify(json)})`);
    } catch (err) {
      // CEF мог перезагрузиться — попробуем ещё раз после goldui:ready.
      this.ready = false;
      this.queue.push(message);
    }
  }

  flush() {
    const list = this.queue.splice(0, this.queue.length);
    for (let i = 0; i < list.length; i += 1) this.post(list[i]);
  }

  execute(code) {
    if (!this.ready || this.failed) return;
    try {
      this.browser.execute(code);
    } catch (err) {
      // игнорируем
    }
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.post({ t: 'visible', visible: this.visible });
  }

  toast(text, kind) {
    this.post({ t: 'toast', text: String(text || ''), kind: kind || 'info' });
  }
}

module.exports = new UIBridge();
