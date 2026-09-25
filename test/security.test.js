import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, hashPassword, normalizePassCode, normalizePhone, RateLimiter, verifyPassword } from '../server/security.js';

test('нормализация телефона', () => {
  assert.equal(normalizePhone('+7 (928) 555-01-00'), '79285550100');
  assert.equal(normalizePhone('8 928 555 01 00'), '79285550100');
  assert.equal(normalizePhone('9285550100'), '79285550100');
  assert.equal(normalizePhone('+1 555 0100'), null);
  assert.equal(formatPhone('79285550100'), '+7 (928) 555-01-00');
});

test('код пропуска: префикс, дефисы, русская раскладка сканера', () => {
  assert.equal(normalizePassCode('GC:ABCD2345'), 'ABCD2345');
  assert.equal(normalizePassCode('gc:abcd-2345'), 'ABCD2345');
  assert.equal(normalizePassCode('ПСЖФИСВ2345'), 'ABCD2345'); // GC:ABCD2345, набранный в русской раскладке
  assert.equal(normalizePassCode('ABC'), null);
});

test('пароли: хэш и проверка', async () => {
  const h = await hashPassword('secret-123');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('secret-123', h), true);
  assert.equal(await verifyPassword('secret-124', h), false);
});

test('ограничитель частоты', () => {
  const l = new RateLimiter({ windowMs: 1000, max: 2 });
  assert.equal(l.hit('a', 0).allowed, true);
  assert.equal(l.hit('a', 10).allowed, true);
  assert.equal(l.hit('a', 20).allowed, false);
  assert.equal(l.hit('a', 1500).allowed, true);
});
