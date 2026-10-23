'use strict';

/**
 * Простое хранилище профилей игроков (JSON-файлы).
 * Специально без базы данных: на домашней машине это лишний риск,
 * а перенос на VDS не требует миграций. Формат — обычный JSON.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeName(name) {
  const base = String(name || 'player')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '_')
    .replace(/_+/g, '_')
    .slice(0, 32) || 'player';
  const hash = crypto.createHash('sha1').update(String(name || 'player')).digest('hex').slice(0, 8);
  return `${base}.${hash}.json`;
}

class ProfileStore {
  constructor(options) {
    const opts = options || {};
    this.enabled = opts.enabled !== false;
    this.directory = opts.directory || path.join(process.cwd(), 'storage', 'players');
    this.logger = opts.logger || console;
    this.cache = new Map();
    if (this.enabled) {
      try {
        fs.mkdirSync(this.directory, { recursive: true });
      } catch (err) {
        this.enabled = false;
        this.logger.warn(`[store] Не удалось создать ${this.directory}: ${err.message}. Сохранения отключены.`);
      }
    }
  }

  fileFor(name) {
    return path.join(this.directory, safeName(name));
  }

  load(name) {
    if (!this.enabled) return null;
    const key = String(name || '');
    if (this.cache.has(key)) return this.cache.get(key);
    try {
      const raw = fs.readFileSync(this.fileFor(key), 'utf8');
      const parsed = JSON.parse(raw);
      this.cache.set(key, parsed);
      return parsed;
    } catch (err) {
      return null;
    }
  }

  save(name, profile) {
    if (!this.enabled) return false;
    const payload = Object.assign({}, profile, {
      name: String(name || ''),
      savedAt: new Date().toISOString()
    });
    this.cache.set(String(name || ''), payload);
    const file = this.fileFor(name);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      this.logger.warn(`[store] Ошибка сохранения профиля ${name}: ${err.message}`);
      return false;
    }
  }

  remove(name) {
    this.cache.delete(String(name || ''));
    if (!this.enabled) return;
    try {
      fs.unlinkSync(this.fileFor(name));
    } catch (err) {
      // файла нет — это нормально
    }
  }

  list() {
    if (!this.enabled) return [];
    try {
      return fs.readdirSync(this.directory).filter((file) => file.endsWith('.json'));
    } catch (err) {
      return [];
    }
  }
}

module.exports = { ProfileStore, safeName };
