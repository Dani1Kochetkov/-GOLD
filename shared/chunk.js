'use strict';

const { byteLength } = require('./netcode');

/**
 * Режет список на части так, чтобы JSON каждой части влезал в лимит
 * одного player.call() (RAGE:MP — 8192 байта на payload).
 *
 * Считаем именно байты UTF-8, а не длину строки: русские описания предметов
 * занимают по 2 байта на символ, из-за этого «строковый» расчёт врёт почти вдвое.
 */
function chunkByBytes(list, maxBytes, overhead) {
  const limit = Math.max(256, Number(maxBytes) || 7800);
  const base = Math.max(0, Number(overhead) || 0);
  const chunks = [];
  let current = [];
  let bytes = base;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    let size = 0;
    try {
      size = byteLength(JSON.stringify(item)) + 1;
    } catch (err) {
      continue;
    }
    if (current.length && bytes + size > limit) {
      chunks.push(current);
      current = [];
      bytes = base;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

module.exports = { chunkByBytes };
