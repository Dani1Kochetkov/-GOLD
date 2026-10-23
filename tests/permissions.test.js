'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isAdmin, isWhitelisted } = require('../server/core/permissions');

function config(extra) {
  return Object.assign(
    {
      admin: { enabled: true, commandsFromLocalhostOnly: true, names: ['Boss'] },
      access: { whitelistEnabled: false, nicknames: [], socialClubIds: [], ips: [] }
    },
    extra || {}
  );
}

test('права: консоль и ник из admin.names', () => {
  assert.strictEqual(isAdmin(null, config()), true, 'консоль всегда админ');
  assert.strictEqual(isAdmin({ name: 'boss', ip: '8.8.8.8' }, config()), true, 'ник без учёта регистра');
  assert.strictEqual(isAdmin({ name: 'Player', ip: '8.8.8.8' }, config()), false, 'обычный игрок');
});

test('права: localhost-политика и выключенная админка', () => {
  assert.strictEqual(isAdmin({ name: 'Player', ip: '127.0.0.1' }, config()), true);
  assert.strictEqual(isAdmin({ name: 'Player', ip: '::1' }, config()), true);
  assert.strictEqual(isAdmin({ name: 'Player', ip: '192.168.1.2' }, config()), false);
  assert.strictEqual(
    isAdmin({ name: 'Player', ip: '127.0.0.1' }, config({ admin: { enabled: false, commandsFromLocalhostOnly: true, names: [] } })),
    false,
    'выключенная админка закрыта даже для localhost'
  );
  assert.strictEqual(
    isAdmin({ name: 'Player', ip: '10.0.0.1' }, config({ admin: { enabled: true, commandsFromLocalhostOnly: false, names: ['Boss'] } })),
    false,
    'без localhost и без совпадения ника — нет прав'
  );
});

test('вайтлист: выключен — пускаем всех', () => {
  assert.strictEqual(isWhitelisted({ name: 'Anyone', ip: '8.8.8.8' }, config()), true);
  assert.strictEqual(isWhitelisted(null, config()), true);
});

test('вайтлист: ник, Social Club ID и IP', () => {
  const cfg = config({
    access: {
      whitelistEnabled: true,
      nicknames: ['Friend'],
      socialClubIds: ['12345678'],
      ips: ['10.1.2.3']
    }
  });
  assert.strictEqual(isWhitelisted({ name: 'friend', ip: '8.8.8.8' }, cfg), true, 'ник без учёта регистра');
  assert.strictEqual(isWhitelisted({ name: 'Other', socialClub: '12345678', ip: '8.8.8.8' }, cfg), true, 'socialClub');
  assert.strictEqual(isWhitelisted({ name: 'Other', rgscId: 12345678, ip: '8.8.8.8' }, cfg), true, 'rgscId числом');
  assert.strictEqual(isWhitelisted({ name: 'Other', ip: '10.1.2.3' }, cfg), true, 'IP');
  assert.strictEqual(isWhitelisted({ name: 'Stranger', socialClub: '999', ip: '8.8.8.8' }, cfg), false, 'чужих не пускаем');
  assert.strictEqual(isWhitelisted({ name: 'Stranger' }, cfg), false, 'без данных о игроке — отказ');
});

test('вайтлист: пустые списки при включённом режиме закрывают сервер', () => {
  const cfg = config({ access: { whitelistEnabled: true, nicknames: [], socialClubIds: [], ips: [] } });
  assert.strictEqual(isWhitelisted({ name: 'Anyone', ip: '8.8.8.8' }, cfg), false);
});
