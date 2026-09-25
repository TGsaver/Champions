import baseConfig from '../config/gym.js';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { createUser } from '../server/routes/auth.js';

export const config = baseConfig;

/** Поднимает приложение на случайном порту с управляемыми часами. */
export async function startApp({ now = Date.parse('2026-09-23T15:00:00Z'), demo = false, paymentProvider = null, demoPayments = true } = {}) {
  const clock = { now };
  const db = openDb(':memory:');
  const { app, ctx } = await createApp({
    db,
    config,
    demo,
    clock: () => clock.now,
    paymentProvider,
    demoPayments,
    logger: { error() {} },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    ctx,
    clock,
    base,
    client: () => client(base),
    async close() {
      ctx.occupancy.stop();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}

export function client(base) {
  let cookie = '';
  return async function request(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

export async function makeAdmin(db, phone = '79990000001', password = 'admin-pass-1') {
  await createUser(db, { name: 'Админ', phone, password, role: 'admin' });
  return { phone, password };
}
