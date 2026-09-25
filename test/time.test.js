import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, diffDays, dowOf, isValidDate, localParts, zonedToUtc } from '../server/time.js';

const TZ = 'Europe/Moscow';

test('localParts переводит момент во время зала', () => {
  const p = localParts(Date.parse('2026-09-23T21:30:00Z'), TZ); // 00:30 по Москве следующего дня
  assert.equal(p.date, '2026-09-24');
  assert.equal(p.hh, 0);
  assert.equal(p.mm, 30);
  assert.equal(p.dow, 3); // четверг
});

test('zonedToUtc — обратное преобразование', () => {
  const ms = zonedToUtc('2026-09-24', 13 * 60, TZ);
  assert.equal(new Date(ms).toISOString(), '2026-09-24T10:00:00.000Z');
  const p = localParts(ms, TZ);
  assert.equal(p.minutes, 13 * 60);
});

test('арифметика дат', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-09-01', '2026-09-30'), 29);
  assert.equal(dowOf('2026-09-21'), 0); // понедельник
  assert.equal(dowOf('2026-09-27'), 6); // воскресенье
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('26-02-01'));
});
