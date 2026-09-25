import { Router } from 'express';
import { AppError } from '../memberships.js';
import { hashPassword, newPassCode, normalizePhone, RateLimiter, verifyPassword } from '../security.js';
import { serializeUser } from '../serialize.js';

// Хэш для выравнивания времени ответа, когда пользователь не найден.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function validateName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 60) throw new AppError('bad_name', 'Введите имя (от 2 до 60 символов)');
  return n;
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) {
    throw new AppError('bad_password', 'Пароль должен быть не короче 8 символов');
  }
  return pw;
}

/** Создаёт пользователя; при совпадении кода пропуска генерирует новый. */
export async function createUser(db, { name, phone, password, role = 'member', now = Date.now() }) {
  const hash = await hashPassword(password);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = db
        .prepare('INSERT INTO users (phone, name, password_hash, role, pass_code, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(phone, name, hash, role, newPassCode(), now);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid));
    } catch (err) {
      if (String(err.message).includes('users.phone')) {
        throw new AppError('phone_taken', 'Этот номер уже зарегистрирован. Войдите в кабинет', 409);
      }
      if (!String(err.message).includes('users.pass_code')) throw err;
    }
  }
  throw new Error('Не удалось сгенерировать код пропуска');
}

export function authRoutes(ctx) {
  const r = Router();
  const ipLimiter = new RateLimiter({ windowMs: 15 * 60000, max: 30 });
  const phoneLimiter = new RateLimiter({ windowMs: 15 * 60000, max: 8 });
  const registerLimiter = new RateLimiter({ windowMs: 60 * 60000, max: 10 });

  const limit = (limiter, key) => {
    const { allowed, retryAfter } = limiter.hit(key);
    if (!allowed) {
      throw new AppError('rate_limited', `Слишком много попыток. Повторите через ${Math.ceil(retryAfter / 60)} мин.`, 429);
    }
  };

  r.get('/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user ? serializeUser(req.user) : null });
  });

  r.post('/register', async (req, res) => {
    limit(registerLimiter, req.ip);
    const { name, phone, password, consent } = req.body ?? {};
    const cleanName = validateName(name);
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) throw new AppError('bad_phone', 'Введите номер телефона в формате +7 900 000-00-00');
    validatePassword(password);
    if (consent !== true) throw new AppError('no_consent', 'Нужно согласие на обработку персональных данных');
    const user = await createUser(ctx.db, { name: cleanName, phone: cleanPhone, password, now: ctx.clock() });
    ctx.sessions.issue(res, user.id);
    res.status(201).json({ user: serializeUser(user) });
  });

  r.post('/login', async (req, res) => {
    limit(ipLimiter, req.ip);
    const { phone, password } = req.body ?? {};
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || typeof password !== 'string' || !password) {
      throw new AppError('bad_credentials', 'Введите номер телефона и пароль');
    }
    limit(phoneLimiter, cleanPhone);
    const user = ctx.db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
    const ok = await verifyPassword(password.slice(0, 128), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new AppError('invalid_credentials', 'Неверный номер телефона или пароль', 401);
    phoneLimiter.reset(cleanPhone);
    ctx.sessions.issue(res, user.id);
    res.json({ user: serializeUser(user) });
  });

  r.post('/logout', (req, res) => {
    ctx.sessions.destroy(req, res);
    res.json({ ok: true });
  });

  return r;
}
