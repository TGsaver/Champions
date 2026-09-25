import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAdmin, startApp } from './helpers.js';

let t;
before(async () => {
  t = await startApp();
});
after(() => t.close());

async function register(phone, name = 'Магомед') {
  const c = t.client();
  const r = await c('POST', '/api/auth/register', { name, phone, password: 'secret-123', consent: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

test('публичные эндпоинты', async () => {
  const c = t.client();
  const cfg = await c('GET', '/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.data.plans.length, 4);
  assert.equal(cfg.data.paymentProvider, 'demo');
  const occ = await c('GET', '/api/occupancy');
  assert.equal(occ.data.count, 0);
  assert.equal(occ.data.open, true);
  const bad = await c('GET', '/api/occupancy/forecast?date=2026-13-01');
  assert.equal(bad.status, 400);
  const page = await c('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  const missing = await c('GET', '/nope');
  assert.equal(missing.status, 404);
});

test('регистрация: проверки', async () => {
  const c = t.client();
  let r = await c('POST', '/api/auth/register', { name: 'Али', phone: '123', password: 'secret-123', consent: true });
  assert.equal(r.data.error, 'bad_phone');
  r = await c('POST', '/api/auth/register', { name: 'Али', phone: '+7 999 000-11-22', password: 'short', consent: true });
  assert.equal(r.data.error, 'bad_password');
  r = await c('POST', '/api/auth/register', { name: 'Али', phone: '+7 999 000-11-22', password: 'secret-123' });
  assert.equal(r.data.error, 'no_consent');
  await register('8 (999) 000-11-22', 'Али');
  r = await t.client()('POST', '/api/auth/register', { name: 'Али', phone: '79990001122', password: 'secret-123', consent: true });
  assert.equal(r.status, 409);
});

test('вход, сессия, выход', async () => {
  const c = t.client();
  let r = await c('POST', '/api/auth/login', { phone: '+79990001122', password: 'wrong-pass' });
  assert.equal(r.status, 401);
  r = await c('POST', '/api/auth/login', { phone: '+79990001122', password: 'secret-123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Али');
  assert.equal(r.data.user.passwordHash, undefined);
  r = await c('GET', '/api/auth/session');
  assert.equal(r.data.user.phone, '79990001122');
  await c('POST', '/api/auth/logout');
  r = await c('GET', '/api/me');
  assert.equal(r.status, 401);
});

test('подбор пароля ограничен', async () => {
  const c = t.client();
  let last;
  for (let i = 0; i < 9; i++) last = await c('POST', '/api/auth/login', { phone: '79995556677', password: 'guess-' + i });
  assert.equal(last.status, 429);
});

test('покупка абонемента (демо-оплата) и вход по QR-коду', async () => {
  const member = await register('79991234567');
  let me = await member('GET', '/api/me');
  assert.equal(me.data.membership.canEnter, false);
  assert.equal(me.data.membership.reason, 'no_balance');

  const start = await member('POST', '/api/payments', { planId: 'pack8' });
  assert.equal(start.status, 201);
  assert.equal(start.data.confirmation.type, 'demo');
  assert.equal(start.data.payment.amount, 1600);
  const pid = start.data.payment.id;

  const ok = await member('POST', `/api/payments/${pid}/confirm`);
  assert.equal(ok.data.payment.status, 'succeeded');
  assert.equal(ok.data.membership.visits, 8);
  const again = await member('POST', `/api/payments/${pid}/confirm`);
  assert.equal(again.data.membership.visits, 8, 'повторное подтверждение не начисляет дважды');

  const stranger = await register('79997654321', 'Чужой');
  const steal = await stranger('POST', `/api/payments/${pid}/confirm`);
  assert.equal(steal.status, 404);

  const qr = await member('GET', '/api/me/pass.svg');
  assert.match(qr.data, /<svg/);

  const admin = t.client();
  const creds = await makeAdmin(t.db);
  await admin('POST', '/api/auth/login', creds);
  const code = me.data.user.passCode;
  const checkin = await admin('POST', '/api/admin/checkin', { code: `GC:${code.slice(0, 4)}-${code.slice(4)}` });
  assert.equal(checkin.status, 200, JSON.stringify(checkin.data));
  assert.equal(checkin.data.member.membership.visits, 7);

  const dup = await admin('POST', '/api/admin/checkin', { code });
  assert.equal(dup.data.error, 'already_in');

  let occ = await member('GET', '/api/occupancy');
  assert.equal(occ.data.count, 1);

  me = await member('GET', '/api/me');
  assert.ok(me.data.inGym);
  await member('POST', '/api/me/checkout');
  occ = await member('GET', '/api/occupancy');
  assert.equal(occ.data.count, 0);

  const hist = await member('GET', '/api/me/history');
  assert.equal(hist.data.visits.length, 1);
  assert.equal(hist.data.payments[0].amount, 1600);
});

test('ресепшен: гости, пополнение наличными, новый клиент, вместимость', async () => {
  const admin = t.client();
  await admin('POST', '/api/auth/login', { phone: '79990000001', password: 'admin-pass-1' });
  let r = await admin('POST', '/api/admin/guests', { action: 'add' });
  assert.equal(r.data.occupancy.count, 1);
  r = await admin('POST', '/api/admin/guests', { action: 'remove' });
  assert.equal(r.data.occupancy.count, 0);
  r = await admin('POST', '/api/admin/guests', { action: 'remove' });
  assert.equal(r.data.error, 'no_guests');

  r = await admin('POST', '/api/admin/members', { name: 'Заира', phone: '+7 928 111-22-33' });
  assert.equal(r.status, 201);
  assert.match(r.data.tempPassword, /^\d{8}$/);
  const id = r.data.member.id;
  r = await admin('POST', `/api/admin/members/${id}/topup`, { planId: 'month', method: 'cash' });
  assert.ok(r.data.member.membership.unlimited);
  r = await admin('POST', '/api/admin/checkin', { code: '8 928 111 22 33' });
  assert.equal(r.data.entryType, 'unlimited');

  r = await admin('GET', '/api/admin/members?q=Заир');
  assert.equal(r.data.members[0].name, 'Заира');
  r = await admin('GET', '/api/admin/overview');
  assert.equal(r.data.inGym.length, 1);
  assert.equal(r.data.today.revenue >= 2200, true);

  r = await admin('PUT', '/api/admin/settings', { capacity: 20 });
  assert.equal(r.data.occupancy.capacity, 20);
  assert.equal(r.data.occupancy.percent, 5);
  r = await admin('PUT', '/api/admin/settings', { capacity: 'много' });
  assert.equal(r.status, 400);
});

test('права доступа и защита от CSRF', async () => {
  const member = await register('79990009988');
  let r = await member('GET', '/api/admin/overview');
  assert.equal(r.status, 403);
  r = await member('POST', '/api/payments', { planId: 'pack8' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await member('POST', '/api/payments', 'planId=pack8', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
  r = await member('POST', '/api/payments', { planId: 'nope' });
  assert.equal(r.data.error, 'bad_plan');
  r = await t.client()('GET', '/api/admin/overview');
  assert.equal(r.status, 401);
});

test('профиль: имя, цель, смена пароля завершает другие сессии', async () => {
  const a = await register('79990007766', 'Руслан');
  const b = t.client();
  await b('POST', '/api/auth/login', { phone: '79990007766', password: 'secret-123' });
  let r = await a('PATCH', '/api/me', { name: 'Руслан О.', monthlyGoal: 16 });
  assert.equal(r.data.user.name, 'Руслан О.');
  assert.equal(r.data.user.monthlyGoal, 16);
  r = await a('POST', '/api/me/password', { current: 'wrong', next: 'new-secret-1' });
  assert.equal(r.status, 403);
  r = await a('POST', '/api/me/password', { current: 'secret-123', next: 'new-secret-1' });
  assert.equal(r.data.ok, true);
  assert.equal((await a('GET', '/api/me')).status, 200);
  assert.equal((await b('GET', '/api/me')).status, 401);
});

test('без платёжного сервиса и вне демо-режима онлайн-оплата выключена', async () => {
  const prod = await startApp({ demoPayments: false });
  try {
    const c = prod.client();
    await c('POST', '/api/auth/register', { name: 'Прод', phone: '79990001111', password: 'secret-123', consent: true });
    const cfg = await c('GET', '/api/config');
    assert.equal(cfg.data.paymentProvider, null);
    const r = await c('POST', '/api/payments', { planId: 'month' });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, 'payments_disabled');
    // подтвердить «демо-платёж» тоже нельзя
    prod.db
      .prepare(
        "INSERT INTO payments (id, user_id, plan_id, plan_title, plan_json, amount, status, provider, created_at) VALUES ('p1', 1, 'month', 'Месяц', '{\"days\":30}', 2200, 'pending', 'demo', 0)"
      )
      .run();
    const confirm = await c('POST', '/api/payments/p1/confirm');
    assert.equal(confirm.status, 409);
    const me = await c('GET', '/api/me');
    assert.equal(me.data.membership.unlimited, null);
  } finally {
    await prod.close();
  }
});
