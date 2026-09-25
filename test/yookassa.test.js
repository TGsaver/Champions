import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createYooKassa } from '../server/yookassa.js';
import { startApp } from './helpers.js';

// Поддельный API ЮKassa: хранит платежи в памяти, статус меняем из теста.
function fakeYooKassa() {
  const payments = new Map();
  const calls = [];
  let fail = false;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (fail) return new Response(JSON.stringify({ code: 'internal_server_error' }), { status: 500 });
    const u = new URL(url);
    if (init.method === 'POST' && u.pathname === '/v3/payments') {
      const body = JSON.parse(init.body);
      const id = `yk-${payments.size + 1}`;
      const p = { id, status: 'pending', amount: body.amount, metadata: body.metadata };
      payments.set(id, p);
      return Response.json({ ...p, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.example/checkout/${id}` } });
    }
    const m = u.pathname.match(/^\/v3\/payments\/(.+)$/);
    if (init.method === 'GET' && m && payments.has(m[1])) return Response.json(payments.get(m[1]));
    return new Response('{}', { status: 404 });
  };
  return {
    payments,
    calls,
    setFail: (v) => (fail = v),
    provider: createYooKassa({ shopId: '123', secretKey: 'test_key', receipts: true, fetchImpl }),
  };
}

let t;
let yk;
let member;
before(async () => {
  yk = fakeYooKassa();
  t = await startApp({ paymentProvider: yk.provider });
  member = t.client();
  await member('POST', '/api/auth/register', { name: 'Ахмед', phone: '79990004455', password: 'secret-123', consent: true });
});
after(() => t.close());

test('создание платежа: сумма, возврат в кабинет, чек, ссылка на оплату', async () => {
  const r = await member('POST', '/api/payments', { planId: 'month' });
  assert.equal(r.status, 201);
  assert.equal(r.data.confirmation.type, 'redirect');
  assert.match(r.data.confirmation.url, /yoomoney\.example\/checkout\/yk-1/);

  const call = yk.calls.at(-1);
  const body = JSON.parse(call.init.body);
  assert.equal(call.init.headers.Authorization, 'Basic ' + Buffer.from('123:test_key').toString('base64'));
  assert.ok(call.init.headers['Idempotence-Key']);
  assert.deepEqual(body.amount, { value: '2200.00', currency: 'RUB' });
  assert.equal(body.capture, true);
  assert.match(body.confirmation.return_url, new RegExp(`/account\\?payment=${r.data.payment.id}$`));
  assert.equal(body.metadata.paymentId, r.data.payment.id);
  assert.equal(body.receipt.customer.phone, '79990004455');
  assert.equal(body.receipt.items[0].payment_subject, 'service');
});

test('демо-подтверждение для платежа ЮKassa запрещено', async () => {
  const r = await member('POST', '/api/payments', { planId: 'single' });
  const c = await member('POST', `/api/payments/${r.data.payment.id}/confirm`);
  assert.equal(c.status, 409);
  assert.equal(c.data.error, 'not_demo');
});

test('вебхук не доверяет телу уведомления — статус сверяется с API', async () => {
  const r = await member('POST', '/api/payments', { planId: 'pack8' });
  const ykId = [...yk.payments.keys()].at(-1);
  // Подделка: в теле «succeeded», но в ЮKassa платёж ещё не оплачен.
  await t.client()('POST', '/api/payments/webhook/yookassa', {
    type: 'notification',
    event: 'payment.succeeded',
    object: { id: ykId, status: 'succeeded' },
  });
  let me = await member('GET', '/api/me');
  assert.equal(me.data.membership.visits, 0);
  const status = await member('GET', `/api/payments/${r.data.payment.id}`);
  assert.equal(status.data.payment.status, 'pending');

  // Настоящая оплата: статус в API изменился.
  yk.payments.get(ykId).status = 'succeeded';
  const hook = await t.client()('POST', '/api/payments/webhook/yookassa', {
    type: 'notification',
    event: 'payment.succeeded',
    object: { id: ykId },
  });
  assert.equal(hook.status, 200);
  me = await member('GET', '/api/me');
  assert.equal(me.data.membership.visits, 8);

  // Повторное уведомление и опрос статуса не начисляют второй раз.
  await t.client()('POST', '/api/payments/webhook/yookassa', { object: { id: ykId } });
  await member('GET', `/api/payments/${r.data.payment.id}`);
  me = await member('GET', '/api/me');
  assert.equal(me.data.membership.visits, 8);
});

test('возврат с оплаты: статус подтягивается при запросе платежа', async () => {
  const r = await member('POST', '/api/payments', { planId: 'single' });
  const ykId = [...yk.payments.keys()].at(-1);
  yk.payments.get(ykId).status = 'succeeded';
  const s = await member('GET', `/api/payments/${r.data.payment.id}`);
  assert.equal(s.data.payment.status, 'succeeded');
  const me = await member('GET', '/api/me');
  assert.equal(me.data.membership.visits, 9);
});

test('отменённый платёж и недоступный сервис', async () => {
  const r = await member('POST', '/api/payments', { planId: 'quarter' });
  const ykId = [...yk.payments.keys()].at(-1);
  yk.payments.get(ykId).status = 'canceled';
  const s = await member('GET', `/api/payments/${r.data.payment.id}`);
  assert.equal(s.data.payment.status, 'canceled');

  yk.setFail(true);
  const down = await member('POST', '/api/payments', { planId: 'month' });
  assert.equal(down.status, 502);
  assert.equal(down.data.error, 'provider_error');
  yk.setFail(false);

  const unknown = await t.client()('POST', '/api/payments/webhook/yookassa', { object: { id: 'nope' } });
  assert.equal(unknown.status, 200);
});
