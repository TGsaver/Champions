import config from '../config/gym.js';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedDemo } from './demo.js';
import { normalizePhone } from './security.js';
import { createUser } from './routes/auth.js';
import { createYooKassa } from './yookassa.js';

const env = process.env;
const flag = (v) => ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const PORT = Number(env.PORT) || 3000;
const HOST = env.HOST || '0.0.0.0';
const DEMO = flag(env.DEMO_MODE) || process.argv.includes('--demo');
const db = openDb(env.DATABASE_PATH || 'data/gym.db');

// Первый администратор из переменных окружения (если админов ещё нет).
const hasAdmin = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
if (!hasAdmin && env.ADMIN_PHONE && env.ADMIN_PASSWORD) {
  const phone = normalizePhone(env.ADMIN_PHONE);
  if (!phone) throw new Error('ADMIN_PHONE: неверный формат номера');
  if (env.ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD: не короче 8 символов');
  await createUser(db, { name: env.ADMIN_NAME || 'Администратор', phone, password: env.ADMIN_PASSWORD, role: 'admin' });
  console.log(`Создан администратор ${phone}`);
} else if (!hasAdmin && !DEMO) {
  console.log('Администратора ещё нет. Создайте: npm run create-admin -- +79001234567 "Имя Фамилия"');
}

if (DEMO) await seedDemo(db, config);

if (env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY && !env.PUBLIC_URL) {
  // адрес возврата после оплаты нельзя брать из заголовка Host — его подделывают
  throw new Error('Для ЮKassa задайте PUBLIC_URL — адрес сайта, например https://example.ru');
}
const paymentProvider =
  env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY
    ? createYooKassa({
        shopId: env.YOOKASSA_SHOP_ID,
        secretKey: env.YOOKASSA_SECRET_KEY,
        receipts: flag(env.YOOKASSA_RECEIPTS),
        vatCode: Number(env.YOOKASSA_VAT_CODE) || 1,
      })
    : null;

const { app, ctx } = await createApp({
  db,
  config,
  demo: DEMO,
  secureCookies: flag(env.COOKIE_SECURE),
  trustProxy: env.TRUST_PROXY ? (flag(env.TRUST_PROXY) ? 1 : env.TRUST_PROXY) : false,
  paymentProvider,
  publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, '') : null,
});

ctx.occupancy.start({ closeStale: () => ctx.memberships.closeStaleVisits() });
setInterval(() => ctx.sessions.purgeExpired(), 3600 * 1000).unref();

const server = app.listen(PORT, HOST, () => {
  console.log(`Gym Champions: http://localhost:${PORT}${DEMO ? '  (демо-режим)' : ''}`);
  const pay = paymentProvider ? 'ЮKassa' : DEMO ? 'демо (деньги не списываются)' : 'онлайн выключена, оплата на ресепшене';
  console.log(`Оплата: ${pay}`);
});

function shutdown() {
  ctx.occupancy.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
