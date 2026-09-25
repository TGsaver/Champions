// Оплата абонементов: демо-оплата, оплата на ресепшене и ЮKassa (если заданы ключи).
import crypto from 'node:crypto';
import { tx } from './db.js';
import { AppError } from './memberships.js';

export function planSnapshot(plan) {
  const { id, title, price, visits = 0, days = 0, freezeDays = 0 } = plan;
  return { id, title, price, visits, days, freezeDays };
}

export function createPayments({ db, config, memberships, provider = null, clock = () => Date.now() }) {
  const plans = new Map(config.plans.map((p) => [p.id, p]));
  const q = {
    get: db.prepare('SELECT * FROM payments WHERE id = ?'),
    byProviderId: db.prepare('SELECT * FROM payments WHERE provider = ? AND provider_payment_id = ?'),
  };

  const get = (id) => q.get.get(id) || null;

  function findPlan(planId) {
    const plan = plans.get(planId);
    if (!plan) throw new AppError('bad_plan', 'Такого абонемента нет');
    return plan;
  }

  function insert({ userId, plan, providerName, status = 'pending', createdBy = null, now = clock() }) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO payments (id, user_id, plan_id, plan_title, plan_json, amount, status, provider, created_at, paid_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      userId,
      plan.id,
      plan.title,
      JSON.stringify(planSnapshot(plan)),
      plan.price,
      status,
      providerName,
      now,
      status === 'succeeded' ? now : null,
      createdBy
    );
    return get(id);
  }

  /** Отмечает оплату успешной и начисляет абонемент. Повторный вызов ничего не делает. */
  function markSucceeded(id, now = clock()) {
    return tx(db, () => {
      const p = get(id);
      if (!p) throw new AppError('not_found', 'Платёж не найден', 404);
      if (p.status === 'succeeded') return { payment: p, applied: false };
      if (p.status === 'canceled') throw new AppError('canceled', 'Платёж отменён', 409);
      db.prepare("UPDATE payments SET status = 'succeeded', paid_at = ? WHERE id = ? AND status = 'pending'").run(now, id);
      memberships.applyPlan(p.user_id, JSON.parse(p.plan_json), now);
      return { payment: get(id), applied: true };
    });
  }

  function markCanceled(id) {
    db.prepare("UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'").run(id);
    return get(id);
  }

  /** Онлайн-оплата из личного кабинета. */
  async function start({ user, planId, returnUrl }) {
    const plan = findPlan(planId);
    if (!provider) {
      const payment = insert({ userId: user.id, plan, providerName: 'demo' });
      return { payment, confirmation: { type: 'demo' } };
    }
    const payment = insert({ userId: user.id, plan, providerName: provider.name });
    try {
      const remote = await provider.create({ payment, user, returnUrl: `${returnUrl}?payment=${payment.id}` });
      db.prepare('UPDATE payments SET provider_payment_id = ? WHERE id = ?').run(remote.id, payment.id);
      return { payment: get(payment.id), confirmation: { type: 'redirect', url: remote.confirmationUrl } };
    } catch (err) {
      markCanceled(payment.id);
      throw new AppError('provider_error', 'Платёжный сервис недоступен, попробуйте позже', 502, { cause: err });
    }
  }

  /** Подтверждение демо-оплаты (реальные деньги не списываются). */
  function confirmDemo({ user, paymentId }) {
    const p = get(paymentId);
    if (!p || p.user_id !== user.id) throw new AppError('not_found', 'Платёж не найден', 404);
    if (p.provider !== 'demo') throw new AppError('not_demo', 'Этот платёж нельзя подтвердить вручную', 409);
    return markSucceeded(p.id);
  }

  /** Сверяет статус платежа с платёжным сервисом. */
  async function sync(p) {
    if (!provider || p.provider !== provider.name || p.status !== 'pending' || !p.provider_payment_id) return p;
    const remote = await provider.fetch(p.provider_payment_id);
    if (remote.status === 'succeeded') return markSucceeded(p.id).payment;
    if (remote.status === 'canceled') return markCanceled(p.id);
    return p;
  }

  /** Уведомление от платёжного сервиса: доверяем только данным, запрошенным у API напрямую. */
  async function handleWebhook(body) {
    const remoteId = body?.object?.id;
    if (!provider || typeof remoteId !== 'string') throw new AppError('bad_webhook', 'Некорректное уведомление');
    const p = q.byProviderId.get(provider.name, remoteId);
    if (!p) return null;
    return sync(p);
  }

  /** Оплата на ресепшене (наличные или терминал). */
  function recordOffline({ userId, planId, method, adminId }) {
    const plan = findPlan(planId);
    const providerName = method === 'card' ? 'reception_card' : 'cash';
    return tx(db, () => {
      const payment = insert({ userId, plan, providerName, createdBy: adminId });
      return markSucceeded(payment.id);
    });
  }

  return { get, start, confirmDemo, sync, handleWebhook, recordOffline, markSucceeded, providerName: provider?.name ?? 'demo' };
}
