// Сессии в SQLite + middleware авторизации.
import { randomToken, sha256 } from './security.js';

export const COOKIE = 'gc_sid';
const TTL = 30 * 24 * 3600 * 1000; // 30 дней
const RENEW_BEFORE = 15 * 24 * 3600 * 1000;

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function createSessions({ db, secureCookies = false, clock = () => Date.now() }) {
  const q = {
    insert: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    find: db.prepare(
      `SELECT s.token_hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    ),
    renew: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeForUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  const cookieOptions = (maxAge) => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies,
    path: '/',
    maxAge,
  });

  function issue(res, userId) {
    const token = randomToken();
    const now = clock();
    q.insert.run(sha256(token), userId, now, now + TTL);
    res.cookie(COOKIE, token, cookieOptions(TTL));
  }

  /** Подставляет req.user, если есть действующая сессия. */
  function middleware(req, res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.user = null;
    if (token) {
      const hash = sha256(token);
      const row = q.find.get(hash);
      const now = clock();
      if (row && row.expires_at > now) {
        const { token_hash: _t, expires_at: expiresAt, ...user } = row;
        req.user = user;
        req.sessionHash = hash;
        if (expiresAt - now < RENEW_BEFORE) {
          q.renew.run(now + TTL, hash);
          res.cookie(COOKIE, token, cookieOptions(TTL));
        }
      } else if (row) {
        q.remove.run(hash);
      }
    }
    next();
  }

  function destroy(req, res) {
    if (req.sessionHash) q.remove.run(req.sessionHash);
    res.clearCookie(COOKIE, { ...cookieOptions(undefined), maxAge: undefined });
  }

  /** Завершает все остальные сессии пользователя (после смены пароля). */
  function destroyOthers(req) {
    q.removeForUser.run(req.user.id, req.sessionHash || '');
  }

  function purgeExpired() {
    q.purge.run(clock());
  }

  return { issue, middleware, destroy, destroyOthers, purgeExpired };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Войдите в личный кабинет' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Войдите как администратор' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Недостаточно прав' });
  next();
}
