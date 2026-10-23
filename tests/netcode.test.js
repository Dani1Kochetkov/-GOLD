'use strict';

const test = require('node:test');
const assert = require('node:assert');
const NET = require('../shared/netcode');
const { chunkByBytes } = require('../shared/chunk');

test('сеть: byteLength считает UTF-8, а не символы', () => {
  assert.strictEqual(NET.byteLength('hello'), 5);
  assert.strictEqual(NET.byteLength('Привет'), 12);
  assert.strictEqual(NET.byteLength(''), 0);
  assert.strictEqual(NET.byteLength(null), 0);
});

test('сеть: safeJsonParse отбрасывает мусор и слишком большие payload', () => {
  assert.deepStrictEqual(NET.safeJsonParse('{"a":1}'), { a: 1 });
  assert.strictEqual(NET.safeJsonParse('не json'), null);
  assert.strictEqual(NET.safeJsonParse('{"a":"' + 'x'.repeat(200) + '"}', 50), null);
});

test('сеть: sanitizeText вырезает управляющие символы и обрезает длину', () => {
  assert.strictEqual(NET.sanitizeText('  hello\u0000world \n', 20), 'hello world');
  assert.strictEqual(NET.sanitizeText('abcdef', 3), 'abc');
  assert.strictEqual(NET.sanitizeText(null, 10), '');
});

test('сеть: clampNumber и clampInt', () => {
  assert.strictEqual(NET.clampNumber('42', 0, 100, 5), 42);
  assert.strictEqual(NET.clampNumber('abc', 0, 100, 5), 5);
  assert.strictEqual(NET.clampNumber(1e9, 0, 100, 5), 100);
  assert.strictEqual(NET.clampInt(3.9, 0, 10, 0), 3);
});

test('сеть: RateLimiter работает окнами', () => {
  const limiter = new NET.RateLimiter();
  const start = 1000000;
  for (let i = 0; i < 5; i += 1) assert.strictEqual(limiter.allow('a', 5, 1000, start + i), true);
  assert.strictEqual(limiter.allow('a', 5, 1000, start + 10), false, 'лимит исчерпан');
  assert.strictEqual(limiter.allow('b', 5, 1000, start + 10), true, 'другой ключ не затронут');
  assert.strictEqual(limiter.allow('a', 5, 1000, start + 1100), true, 'окно сброшено');
});

test('сеть: guard не пробрасывает исключения', () => {
  let caught = null;
  const fn = NET.guard(() => { throw new Error('boom'); }, (err) => { caught = err; });
  assert.strictEqual(fn(), undefined);
  assert.strictEqual(caught.message, 'boom');
});

test('чанки: русский текст укладывается в лимит байт', () => {
  const items = [];
  for (let i = 0; i < 200; i += 1) {
    items.push({ id: `item_${i}`, d: 'Очень длинное русское описание предмета для проверки лимита' });
  }
  const chunks = chunkByBytes(items, 7800, 64);
  assert.ok(chunks.length > 1, 'должно получиться несколько частей');
  let total = 0;
  chunks.forEach((chunk, index) => {
    const payload = JSON.stringify({ part: index, total: chunks.length, items: chunk });
    const bytes = NET.byteLength(payload);
    assert.ok(bytes <= 7800, `часть ${index}: ${bytes} байт`);
    total += chunk.length;
  });
  assert.strictEqual(total, items.length, 'ни один предмет не потерян');
});

test('чанки: пустой список', () => {
  assert.deepStrictEqual(chunkByBytes([], 7800, 0), []);
});
