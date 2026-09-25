import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createMemberships } from '../server/memberships.js';
import { createOccupancy, levelFor } from '../server/occupancy.js';
import { zonedToUtc } from '../server/time.js';
import { config } from './helpers.js';

const TZ = config.timezone;
const at = (date, hhmm) => zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);

function setup(now, { demo = false } = {}) {
  const clock = { now };
  const db = openDb(':memory:');
  const occ = createOccupancy({ db, config, demo, clock: () => clock.now });
  const m = createMemberships({ db, config, clock: () => clock.now });
  return { db, occ, m, clock };
}

test('уровни загрузки', () => {
  assert.equal(levelFor(0).id, 'low');
  assert.equal(levelFor(39).id, 'low');
  assert.equal(levelFor(40).id, 'medium');
  assert.equal(levelFor(75).id, 'high');
  assert.equal(levelFor(100).id, 'full');
});

test('статус работы: открыто, женские часы, закрыто', () => {
  // 2026-09-21 — понедельник (женские часы 09–13), 2026-09-27 — воскресенье (выходной)
  const { occ, clock } = setup(at('2026-09-21', '10:15'));
  assert.deepEqual(
    (({ open, women, text }) => ({ open, women, text }))(occ.openState()),
    { open: true, women: true, text: 'Женские часы до 13:00' }
  );
  clock.now = at('2026-09-21', '15:00');
  assert.equal(occ.openState().text, 'Открыто до 22:00');
  clock.now = at('2026-09-22', '10:00'); // вторник, откроется в 13:00
  assert.equal(occ.openState().text, 'Закрыто · откроется в 13:00');
  clock.now = at('2026-09-22', '22:30');
  assert.equal(occ.openState().text, 'Закрыто · откроется завтра в 09:00');
  clock.now = at('2026-09-26', '23:00'); // суббота вечер -> воскресенье выходной
  assert.equal(occ.openState().text, 'Закрыто · откроется в понедельник в 09:00');
});

test('снимок считает участников и гостей, вместимость настраивается', () => {
  const { occ, m, db, clock } = setup(at('2026-09-23', '18:00'));
  db.prepare("INSERT INTO users (phone, name, password_hash, pass_code, created_at, visits_balance) VALUES ('79990000000', 'A', 'x', 'AAAA2222', 0, 5)").run();
  m.checkIn({ userId: 1 });
  m.addGuest({});
  m.addGuest({});
  let s = occ.snapshot();
  assert.equal(s.count, 3);
  assert.equal(s.capacity, 40);
  assert.equal(s.percent, 8);
  assert.equal(s.level, 'low');
  m.removeGuest({});
  occ.setCapacity(10);
  s = occ.snapshot();
  assert.equal(s.count, 2);
  assert.equal(s.percent, 20);
  clock.now += 3 * 3600000; // визиты старше 150 минут не считаются
  assert.equal(occ.snapshot().count, 0);
});

test('прогноз: часы работы, женские часы, лучшее время', () => {
  const { occ } = setup(at('2026-09-23', '14:10'));
  const f = occ.forecast();
  assert.equal(f.date, '2026-09-23');
  assert.equal(f.source, 'typical');
  assert.equal(f.hours[0].hour, 9);
  assert.equal(f.hours.at(-1).hour, 21);
  assert.ok(f.hours.find((h) => h.hour === 10).women);
  assert.ok(f.hours.find((h) => h.hour === 13).past);
  assert.ok(f.hours.find((h) => h.hour === 14).now);
  assert.ok(f.bestWindow, 'есть рекомендация');
  assert.ok(f.bestWindow.from >= '14:00');
  assert.equal(occ.forecast('2026-09-27').closed, true);
});

test('прогноз по истории, когда накоплено 3+ недели данных', () => {
  const { occ, db } = setup(at('2026-09-23', '09:00'));
  const ins = db.prepare("INSERT INTO visits (kind, entry_type, checked_in_at, checked_out_at) VALUES ('guest', 'guest', ?, ?)");
  for (const date of ['2026-09-16', '2026-09-09', '2026-09-02']) {
    for (let i = 0; i < 12; i++) ins.run(at(date, '18:00'), at(date, '19:40'));
  }
  const f = occ.forecast();
  assert.equal(f.source, 'history');
  assert.equal(f.hours.find((h) => h.hour === 18).expected, 12);
  assert.equal(f.hours.find((h) => h.hour === 20).expected, 0);
});

test('демо-режим: симуляция только в часы работы', () => {
  const { occ, clock } = setup(at('2026-09-23', '19:00'), { demo: true });
  const s = occ.snapshot();
  assert.ok(s.count > 20 && s.count <= 45, `вечером людно: ${s.count}`);
  assert.equal(s.demo, true);
  clock.now = at('2026-09-27', '12:00');
  assert.equal(occ.snapshot().count, 0);
});
