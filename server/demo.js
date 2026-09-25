// Демо-данные: тестовые аккаунты и история тренировок (DEMO_MODE=true).
import crypto from 'node:crypto';
import { tx } from './db.js';
import { planSnapshot } from './payments.js';
import { createUser } from './routes/auth.js';
import { addDays, dowOf, localParts, toMinutes, zonedToUtc } from './time.js';

export const DEMO_ACCOUNTS = {
  admin: { phone: '79000000001', password: 'admin2026', name: 'Администратор' },
  member: { phone: '79000000002', password: 'champion', name: 'Шамиль' },
};

const MEMBERS = [
  'Магомед Алиев',
  'Патимат Гаджиева',
  'Ахмед Магомедов',
  'Мадина Исаева',
  'Руслан Омаров',
  'Заира Абдуллаева',
  'Гаджи Рамазанов',
  'Камиль Сулейманов',
];

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemo(db, config, now = Date.now()) {
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(DEMO_ACCOUNTS.admin.phone)) return false;
  const tz = config.timezone;
  const DAY = 86400000;
  const rand = rng(2026);
  const today = localParts(now, tz).date;
  const plans = new Map(config.plans.map((p) => [p.id, p]));

  const admin = await createUser(db, { ...DEMO_ACCOUNTS.admin, role: 'admin', now: now - 200 * DAY });
  const main = await createUser(db, { ...DEMO_ACCOUNTS.member, now: now - 130 * DAY });
  const others = [];
  for (const [i, name] of MEMBERS.entries()) {
    const phone = `7928${String(5550100 + i * 37).padStart(7, '0')}`;
    others.push(await createUser(db, { name, phone, password: crypto.randomBytes(12).toString('hex'), now: now - (20 + i * 9) * DAY }));
  }

  const insertVisit = db.prepare(
    "INSERT INTO visits (user_id, kind, entry_type, checked_in_at, checked_out_at, created_by) VALUES (?, 'member', ?, ?, ?, ?)"
  );
  const insertPayment = db.prepare(
    `INSERT INTO payments (id, user_id, plan_id, plan_title, plan_json, amount, status, provider, created_at, paid_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`
  );
  const pay = (userId, planId, at, provider) => {
    const p = plans.get(planId);
    if (!p) return;
    insertPayment.run(crypto.randomUUID(), userId, p.id, p.title, JSON.stringify(planSnapshot(p)), p.price, provider, at, at, provider === 'demo' ? null : admin.id);
  };

  /** Случайные тренировки в часы работы зала. */
  function visitsFor(userId, { days, perWeek, prefer = 'evening', entryType }) {
    for (let i = days; i >= 1; i--) {
      const date = addDays(today, -i);
      const sched = config.schedule.find((d) => d.day === dowOf(date));
      if (!sched || sched.closed || rand() > perWeek / 6) continue;
      const general = sched.women ? toMinutes(sched.women[1]) : toMinutes(sched.open);
      const close = toMinutes(sched.close);
      const start =
        prefer === 'evening'
          ? Math.max(general, close - 240 + Math.floor(rand() * 150))
          : general + Math.floor(rand() * Math.max(30, close - general - 180));
      const duration = 55 + Math.floor(rand() * 50);
      const inAt = zonedToUtc(date, Math.min(start, close - duration), tz);
      insertVisit.run(userId, entryType, inAt, inAt + duration * 60000, admin.id);
    }
  }

  tx(db, () => {
    // Основной демо-клиент: безлимит + немного разовых посещений, история за 4 месяца.
    visitsFor(main.id, { days: 120, perWeek: 3.4, entryType: 'unlimited' });
    for (let k = 4; k >= 1; k--) pay(main.id, 'month', now - (k * 30 - 10) * DAY, k % 2 ? 'demo' : 'cash');
    pay(main.id, 'pack8', now - 95 * DAY, 'demo');
    db.prepare('UPDATE users SET unlimited_until = ?, freeze_days_left = 7, visits_balance = 3, monthly_goal = 14 WHERE id = ?').run(
      addDays(today, 19),
      main.id
    );

    others.forEach((u, i) => {
      const unlimited = i % 3 === 0;
      visitsFor(u.id, { days: 20 + i * 9, perWeek: 1.5 + (i % 4), prefer: i % 2 ? 'day' : 'evening', entryType: unlimited ? 'unlimited' : 'visit' });
      if (unlimited) {
        pay(u.id, 'month', now - (5 + i) * DAY, 'cash');
        db.prepare('UPDATE users SET unlimited_until = ?, freeze_days_left = 7 WHERE id = ?').run(addDays(today, 24 - i), u.id);
      } else {
        pay(u.id, 'pack8', now - (8 + i * 2) * DAY, i % 2 ? 'demo' : 'cash');
        db.prepare('UPDATE users SET visits_balance = ? WHERE id = ?').run(i % 5, u.id);
      }
    });
  });
  return true;
}
