import express from 'express';
import path from 'node:path';
import { createSessions } from './auth.js';
import { AppError, createMemberships } from './memberships.js';
import { createOccupancy } from './occupancy.js';
import { createPayments } from './payments.js';
import { createRenderer } from './render.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes, paymentRoutes } from './routes/me.js';
import { publicRoutes } from './routes/public.js';

const PUBLIC = path.resolve(import.meta.dirname, '../public');


const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // официальные виджеты Яндекс Карт: отзывы и карта
  'frame-src https://yandex.ru https://yandex.com',
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

/** Защита от CSRF: изменяющие запросы к API — только JSON и только с нашего origin. */
function sameOriginJson(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/payments/webhook/')) return next();
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      host = null;
    }
    if (host !== req.get('host')) {
      return res.status(403).json({ error: 'bad_origin', message: 'Запрос с чужого сайта отклонён' });
    }
  }
  if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !req.is('application/json')) {
    return res.status(415).json({ error: 'unsupported_media_type', message: 'Ожидается JSON' });
  }
  next();
}

export async function createApp({
  db,
  config,
  demo = false,
  clock = () => Date.now(),
  secureCookies = false,
  trustProxy = false,
  paymentProvider = null,
  publicUrl = null,
  logger = console,
}) {
  const memberships = createMemberships({ db, config, clock });
  const occupancy = createOccupancy({ db, config, demo, clock });
  const payments = createPayments({ db, config, memberships, provider: paymentProvider, clock });
  const sessions = createSessions({ db, secureCookies, clock });
  const renderer = await createRenderer({ config, demo });
  const ctx = { db, config, demo, clock, memberships, occupancy, payments, sessions, publicUrl };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '20kb' }));
  api.use(sameOriginJson);
  api.use(sessions.middleware);
  api.use('/', publicRoutes(ctx));
  api.use('/auth', authRoutes(ctx));
  api.use('/me', meRoutes(ctx));
  api.use('/payments', paymentRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Метод API не найден' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err instanceof AppError) {
      const body = { error: err.code, message: err.message };
      if (err.member) body.member = err.member;
      if (err.visitId) body.visitId = err.visitId;
      return res.status(err.status).json(body);
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_json', message: 'Некорректный JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос' });
    }
    logger.error(err);
    res.status(500).json({ error: 'server_error', message: 'Что-то пошло не так. Попробуйте ещё раз' });
  });
  app.use('/api', api);

  // ---------- Страницы ----------
  const html = (res, body, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(body);
  app.get('/', async (req, res) => html(res, await renderer.render('index')));
  app.get('/privacy', async (req, res) => html(res, await renderer.render('privacy')));
  app.get(['/account', '/account/'], async (req, res) => html(res, await renderer.render('account')));
  app.get(['/admin', '/admin/'], async (req, res) => html(res, await renderer.render('admin')));

  app.use(
    express.static(PUBLIC, {
      index: false,
      setHeaders(res, file) {
        // JS-модули импортируют друг друга без ?v= — всегда сверяем по ETag.
        // Остальные ассеты подключаются с ?v=<хэш> и кэшируются надолго.
        if (file.endsWith('.js')) res.set('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=604800');
      },
    })
  );

  app.use(async (req, res) => html(res, await renderer.render('404'), 404));

  return { app, ctx };
}
