'use strict';

/** Простой логгер с уровнями и записью в файл (без внешних зависимостей). */

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor(options) {
    const opts = options || {};
    this.level = LEVELS[opts.level] || LEVELS.info;
    this.prefix = opts.prefix || 'GOLD';
    this.file = opts.file || null;
    this.stream = null;
    this.buffer = [];
    if (this.file) {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.stream = fs.createWriteStream(this.file, { flags: 'a' });
      } catch (err) {
        this.stream = null;
      }
    }
  }

  write(level, args) {
    if (LEVELS[level] < this.level) return;
    const stamp = new Date().toISOString();
    const text = Array.prototype.slice.call(args).map((value) => {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }).join(' ');
    const line = `[${stamp}] [${level.toUpperCase()}] [${this.prefix}] ${text}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    if (this.stream) this.stream.write(`${line}\n`);
  }

  debug() { this.write('debug', arguments); }
  info() { this.write('info', arguments); }
  warn() { this.write('warn', arguments); }
  error() { this.write('error', arguments); }
}

module.exports = { Logger, LEVELS };
