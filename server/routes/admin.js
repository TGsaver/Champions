import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAdmin } from '../auth.js';
import { AppError } from '../memberships.js';
import { normalizePassCode, normalizePhone } from '../security.js';
import { serializePayment, serializeUser } from '../serialize.js';
import { localParts, zonedToUtc } from '../time.js';
import { createUser, validateName } from './auth.js';

export function adminRoutes(ctx) {
  const r = Router();
  const { db, memberships, occupancy } = ctx;
  r.use(requireAdmin);
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const autoMs = () => ctx.config.occupancy.autoCheckoutMinutes * 60000;

  function memberCard(user) {
    const open = memberships.openVisitOf(user.id);
    return {
      ...serializeUser(user),
      membership: memberships.status(user),
      inGym: open ? { visitId: open.id, since: open.checked_in_at } : null,
    };
  }

  function findByCode(code) {
    const pass = normalizePassCode(code);
    if (pass) {
      const u = db.prepare('SELECT * FROM users WHERE pass_code = ?').get(pass);
      if (u) return u;
    }
    const phone = normalizePhone(code);
    if (phone) return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    return null;
  }

  function overview() {
    const now = ctx.clock();
    const today = localParts(now, ctx.config.timezone).date;
    const dayStart = zonedToUtc(today, 0, ctx.config.timezone);
    const inGym = db
      .prepare(
        `SELECT v.id, v.kind, v.entry_type, v.checked_in_at, u.id AS user_id, u.name, u.phone
         FROM visits v LEFT JOIN users u ON u.id = v.user_id
         WHERE v.checked_out_at IS NULL AND v.checked_in_at >= ? ORDER BY v.checked_in_at DESC`
      )
      .all(now - autoMs())
      .map((v) => ({
        visitId: v.id,
        kind: v.kind,
        entryType: v.entry_type,
        since: v.checked_in_at,
        user: v.user_id ? { id: v.user_id, name: v.name, phone: v.phone } : null,
      }));
    const visitsToday = db
      .prepare("SELECT COUNT(*) AS n FROM visits WHERE checked_in_at >= ? AND kind = 'member'")
      .get(dayStart).n;
    const guestsToday = db
      .prepare("SELECT COUNT(*) AS n FROM visits WHERE checked_in_at >= ? AND kind = 'guest'")
      .get(dayStart).n;
    const revenue = db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?")
      .get(dayStart);
    const newMembers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND role = 'member'").get(dayStart).n;
    return {
      occupancy: { ...occupancy.snapshot(now), breakdown: occupancy.counts(now) },
      inGym,
      today: { date: today, visits: visitsToday, guests: guestsToday, revenue: revenue.s, payments: revenue.n, newMembers },
    };
  }

  r.get('/overview', (req, res) => res.json(overview()));

  r.get('/members', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    let rows;
    if (!q) {
      rows = db.prepare("SELECT * FROM users WHERE role = 'member' ORDER BY created_at DESC LIMIT 20").all();
    } else {
      const exact = findByCode(q);
      const digits = q.replace(/\D/g, '');
      rows = db
        .prepare(
          `SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' OR (? != '' AND phone LIKE ?) ORDER BY name LIMIT 20`
        )
        .all(`%${q.replace(/[%_\\]/g, '\\$&')}%`, digits, `%${digits}%`);
      if (exact && !rows.some((u) => u.id === exact.id)) rows.unshift(exact);
    }
    res.json({ members: rows.map(memberCard) });
  });

  r.post('/members', async (req, res) => {
    const name = validateName(req.body?.name);
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw new AppError('bad_phone', 'Введите номер телефона в формате +7 900 000-00-00');
    // Временный пароль: клиент сменит его в личном кабинете.
    const password = crypto.randomInt(10000000, 99999999).toString();
    const user = await createUser(db, { name, phone, password, now: ctx.clock() });
    res.status(201).json({ member: memberCard(user), tempPassword: password });
  });

  r.get('/members/:id', (req, res) => {
    const user = memberships.getUser(Number(req.params.id));
    if (!user) throw new AppError('not_found', 'Клиент не найден', 404);
    res.json({
      member: memberCard(user),
      stats: memberships.stats(user.id),
      history: memberships.history(user.id, { limit: 20 }),
    });
  });

  r.post('/checkin', (req, res) => {
    const { code, userId, unfreeze } = req.body ?? {};
    const user = userId ? memberships.getUser(Number(userId)) : findByCode(code);
    if (!user) throw new AppError('not_found', 'Клиент с таким кодом или телефоном не найден', 404);
    if (unfreeze && memberships.status(user).frozen) memberships.unfreeze(user.id);
    try {
      const { visit } = memberships.checkIn({ userId: user.id, byUserId: req.user.id });
      occupancy.notify();
      res.json({ ok: true, visitId: visit.id, entryType: visit.entry_type, member: memberCard(memberships.getUser(user.id)) });
    } catch (err) {
      if (err instanceof AppError) err.member = memberCard(user);
      throw err;
    }
  });

  r.post('/checkout', (req, res) => {
    const { visitId, userId } = req.body ?? {};
    const visit = memberships.checkOut({ visitId: visitId ? Number(visitId) : null, userId: userId ? Number(userId) : null });
    occupancy.notify();
    res.json({ ok: true, visitId: visit.id });
  });

  r.post('/guests', (req, res) => {
    const action = req.body?.action;
    if (action === 'add') memberships.addGuest({ byUserId: req.user.id });
    else if (action === 'remove') memberships.removeGuest({});
    else throw new AppError('bad_action', 'action: add или remove');
    occupancy.notify();
    res.json(overview());
  });

  r.post('/members/:id/topup', (req, res) => {
    const user = memberships.getUser(Number(req.params.id));
    if (!user) throw new AppError('not_found', 'Клиент не найден', 404);
    const method = req.body?.method === 'card' ? 'card' : 'cash';
    const { payment } = ctx.payments.recordOffline({
      userId: user.id,
      planId: req.body?.planId,
      method,
      adminId: req.user.id,
    });
    res.json({ payment: serializePayment(payment), member: memberCard(memberships.getUser(user.id)) });
  });

  r.put('/settings', (req, res) => {
    const capacity = req.body?.capacity;
    if (!Number.isInteger(capacity) || capacity < 5 || capacity > 1000) {
      throw new AppError('bad_capacity', 'Вместимость — целое число от 5 до 1000');
    }
    occupancy.setCapacity(capacity);
    res.json(overview());
  });

  return r;
}
