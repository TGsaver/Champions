import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createMemberships, levelFor } from '../server/memberships.js';
import { createUser } from '../server/routes/auth.js';
import { config } from './helpers.js';

const WED_18 = Date.parse('2026-09-23T15:00:00Z'); // среда, 18:00 по Москве
const DAY = 86400000;
const plan = (id) => config.plans.find((p) => p.id === id);

async function setup(now = WED_18) {
  const clock = { now };
  const db = openDb(':memory:');
  const m = createMemberships({ db, config, clock: () => clock.now });
  const user = await createUser(db, { name: 'Тест', phone: '79991112233', password: 'password1' });
  return { db, m, user, clock };
}

test('пакет посещений: вход списывает одно посещение', async () => {
  const { m, user } = await setup();
  m.applyPlan(user.id, plan('pack8'));
  const { visit, user: after } = m.checkIn({ userId: user.id });
  assert.equal(visit.entry_type, 'visit');
  assert.equal(after.visits_balance, 7);
});

test('без баланса вход запрещён, повторный вход — ошибка', async () => {
  const { m, user, clock } = await setup();
  assert.throws(() => m.checkIn({ userId: user.id }), { code: 'no_balance' });
  m.applyPlan(user.id, plan('single'));
  m.checkIn({ userId: user.id });
  assert.throws(() => m.checkIn({ userId: user.id }), { code: 'already_in' });
  m.checkOut({ userId: user.id });
  clock.now += 3600000;
  assert.throws(() => m.checkIn({ userId: user.id }), { code: 'no_balance' });
});

test('безлимит: вход без списания, продление добавляется к сроку', async () => {
  const { m, user } = await setup();
  let u = m.applyPlan(user.id, plan('month'));
  assert.equal(u.unlimited_until, '2026-10-22'); // 30 дней включая сегодня
  assert.equal(u.freeze_days_left, 7);
  u = m.applyPlan(user.id, plan('month'));
  assert.equal(u.unlimited_until, '2026-11-21');
  assert.equal(u.freeze_days_left, 14);
  m.applyPlan(user.id, plan('pack8'));
  const { visit, user: after } = m.checkIn({ userId: user.id });
  assert.equal(visit.entry_type, 'unlimited');
  assert.equal(after.visits_balance, 8);
});

test('истёкший безлимит начинается заново и не копит дни заморозки', async () => {
  const { m, user, clock } = await setup();
  m.applyPlan(user.id, plan('month'));
  clock.now += 45 * DAY;
  const u = m.applyPlan(user.id, plan('month'));
  assert.equal(u.unlimited_until, '2026-12-06');
  assert.equal(u.freeze_days_left, 7);
});

test('заморозка продлевает абонемент, разморозка возвращает неиспользованные дни', async () => {
  const { m, user, clock } = await setup();
  m.applyPlan(user.id, plan('month')); // до 2026-10-22
  let u = m.freeze(user.id, 5);
  assert.equal(u.frozen_from, '2026-09-23');
  assert.equal(u.frozen_until, '2026-09-27');
  assert.equal(u.unlimited_until, '2026-10-27');
  assert.equal(u.freeze_days_left, 2);
  assert.throws(() => m.checkIn({ userId: user.id }), { code: 'frozen' });
  assert.throws(() => m.freeze(user.id, 1), { code: 'already_frozen' });

  clock.now += 2 * DAY; // 25.09: использованы 23 и 24 сентября
  u = m.unfreeze(user.id);
  assert.equal(u.unlimited_until, '2026-10-24');
  assert.equal(u.freeze_days_left, 5);
  assert.equal(m.checkIn({ userId: user.id }).visit.entry_type, 'unlimited');
});

test('заморозка: проверки', async () => {
  const { m, user } = await setup();
  assert.throws(() => m.freeze(user.id, 3), { code: 'no_unlimited' });
  m.applyPlan(user.id, plan('month'));
  assert.throws(() => m.freeze(user.id, 8), { code: 'no_freeze_days' });
  assert.throws(() => m.freeze(user.id, 0), { code: 'bad_days' });
  assert.throws(() => m.unfreeze(user.id), { code: 'not_frozen' });
});

test('заморозка заканчивается сама по дате', async () => {
  const { m, user, clock } = await setup();
  m.applyPlan(user.id, plan('month'));
  m.freeze(user.id, 2);
  clock.now += 2 * DAY;
  const s = m.status(m.getUser(user.id));
  assert.equal(s.frozen, null);
  assert.equal(s.canEnter, true);
});

test('забытые визиты закрываются автоматически', async () => {
  const { m, user, clock } = await setup();
  m.applyPlan(user.id, plan('pack8'));
  m.checkIn({ userId: user.id });
  clock.now += 3 * 3600000;
  assert.equal(m.openVisitOf(user.id), null);
  assert.equal(m.closeStaleVisits(), 1);
  const [v] = m.history(user.id).visits;
  assert.equal(v.autoClosed, true);
  assert.equal(v.minutes, 90);
});

test('статистика: визиты за месяц, серия недель, уровень', async () => {
  const { m, user, db } = await setup();
  const ins = db.prepare(
    "INSERT INTO visits (user_id, kind, entry_type, checked_in_at, checked_out_at) VALUES (?, 'member', 'visit', ?, ?)"
  );
  // три недели подряд, по визиту в неделю (включая текущую)
  for (const d of [0, 7, 14]) ins.run(user.id, WED_18 - d * DAY - 3600000, WED_18 - d * DAY);
  const s = m.stats(user.id);
  assert.equal(s.totalVisits, 3);
  assert.equal(s.weekVisits, 1);
  assert.equal(s.monthVisits, 3);
  assert.equal(s.streakWeeks, 3);
  assert.equal(s.totalMinutes, 180);
  assert.equal(s.level.name, 'Новичок');
  assert.equal(s.level.toNext, 7);
});

test('уровни', () => {
  assert.equal(levelFor(0).name, 'Новичок');
  assert.equal(levelFor(10).name, 'Любитель');
  assert.equal(levelFor(99).next, 'Чемпион');
  assert.equal(levelFor(250).next, null);
});
