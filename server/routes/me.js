import { Router } from 'express';
import QRCode from 'qrcode';
import { requireUser } from '../auth.js';
import { AppError } from '../memberships.js';
import { hashPassword, newPassCode, verifyPassword } from '../security.js';
import { serializePayment, serializeUser } from '../serialize.js';
import { validateName, validatePassword } from './auth.js';

export function passQrPayload(code) {
  return `GC:${code}`;
}

export function profile(ctx, userId) {
  const user = ctx.memberships.getUser(userId);
  const open = ctx.memberships.openVisitOf(userId);
  return {
    user: serializeUser(user),
    membership: ctx.memberships.status(user),
    inGym: open ? { visitId: open.id, since: open.checked_in_at } : null,
    stats: ctx.memberships.stats(userId),
  };
}

export function meRoutes(ctx) {
  const r = Router();
  r.use(requireUser);
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.get('/', (req, res) => res.json(profile(ctx, req.user.id)));

  r.patch('/', (req, res) => {
    const { name, monthlyGoal } = req.body ?? {};
    if (name !== undefined) {
      ctx.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(validateName(name), req.user.id);
    }
    if (monthlyGoal !== undefined) {
      if (!Number.isInteger(monthlyGoal) || monthlyGoal < 1 || monthlyGoal > 31) {
        throw new AppError('bad_goal', 'Цель — от 1 до 31 тренировки в месяц');
      }
      ctx.db.prepare('UPDATE users SET monthly_goal = ? WHERE id = ?').run(monthlyGoal, req.user.id);
    }
    res.json(profile(ctx, req.user.id));
  });

  r.post('/password', async (req, res) => {
    const { current, next } = req.body ?? {};
    const ok = typeof current === 'string' && (await verifyPassword(current.slice(0, 128), req.user.password_hash));
    if (!ok) throw new AppError('wrong_password', 'Текущий пароль указан неверно', 403);
    validatePassword(next);
    ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
    ctx.sessions.destroyOthers(req);
    res.json({ ok: true });
  });

  r.get('/pass.svg', async (req, res) => {
    const svg = await QRCode.toString(passQrPayload(req.user.pass_code), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  });

  r.post('/pass/rotate', (req, res) => {
    for (let i = 0; i < 5; i++) {
      try {
        ctx.db.prepare('UPDATE users SET pass_code = ? WHERE id = ?').run(newPassCode(), req.user.id);
        return res.json(profile(ctx, req.user.id));
      } catch (err) {
        if (!String(err.message).includes('users.pass_code')) throw err;
      }
    }
    throw new Error('Не удалось обновить код пропуска');
  });

  r.get('/history', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    res.json(ctx.memberships.history(req.user.id, { limit }));
  });

  r.post('/checkout', (req, res) => {
    ctx.memberships.checkOut({ userId: req.user.id });
    ctx.occupancy.notify();
    res.json(profile(ctx, req.user.id));
  });

  r.post('/freeze', (req, res) => {
    ctx.memberships.freeze(req.user.id, req.body?.days);
    res.json(profile(ctx, req.user.id));
  });

  r.post('/unfreeze', (req, res) => {
    ctx.memberships.unfreeze(req.user.id);
    res.json(profile(ctx, req.user.id));
  });

  return r;
}

export function paymentRoutes(ctx) {
  const r = Router();

  // Уведомления ЮKassa приходят без сессии пользователя.
  r.post('/webhook/yookassa', async (req, res) => {
    await ctx.payments.handleWebhook(req.body);
    ctx.occupancy.notify();
    res.json({ ok: true });
  });

  r.use(requireUser);
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.post('/', async (req, res) => {
    const returnUrl = `${ctx.publicUrl || `${req.protocol}://${req.get('host')}`}/account`;
    const { payment, confirmation } = await ctx.payments.start({
      user: req.user,
      planId: req.body?.planId,
      returnUrl,
    });
    res.status(201).json({ payment: serializePayment(payment), confirmation });
  });

  r.get('/:id', async (req, res) => {
    let p = ctx.payments.get(req.params.id);
    if (!p || p.user_id !== req.user.id) throw new AppError('not_found', 'Платёж не найден', 404);
    p = await ctx.payments.sync(p);
    res.json({ payment: serializePayment(p) });
  });

  r.post('/:id/confirm', (req, res) => {
    const { payment } = ctx.payments.confirmDemo({ user: req.user, paymentId: req.params.id });
    res.json({ payment: serializePayment(payment), ...profile(ctx, req.user.id) });
  });

  return r;
}
