// Абонементы, баланс посещений, вход/выход, заморозка, статистика клиента.
import { tx } from './db.js';
import { addDays, diffDays, localParts, zonedToUtc } from './time.js';

export class AppError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

// Средняя длительность тренировки для визитов, закрытых автоматически.
export const DEFAULT_VISIT_MINUTES = 90;

export const LEVELS = [
  { name: 'Новичок', from: 0 },
  { name: 'Любитель', from: 10 },
  { name: 'Атлет', from: 30 },
  { name: 'Профи', from: 60 },
  { name: 'Чемпион', from: 100 },
  { name: 'Легенда', from: 200 },
];

export function levelFor(total) {
  let i = 0;
  while (i + 1 < LEVELS.length && total >= LEVELS[i + 1].from) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  return {
    name: cur.name,
    next: next ? next.name : null,
    toNext: next ? next.from - total : 0,
    progress: next ? (total - cur.from) / (next.from - cur.from) : 1,
  };
}

const formatDate = (d) => d.split('-').reverse().join('.');

export function createMemberships({ db, config, clock = () => Date.now() }) {
  const tz = config.timezone;
  const autoMs = config.occupancy.autoCheckoutMinutes * 60000;
  const today = (now = clock()) => localParts(now, tz).date;

  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    openVisit: db.prepare(
      'SELECT * FROM visits WHERE user_id = ? AND checked_out_at IS NULL AND checked_in_at >= ? ORDER BY checked_in_at DESC LIMIT 1'
    ),
    decVisit: db.prepare('UPDATE users SET visits_balance = visits_balance - 1 WHERE id = ? AND visits_balance > 0'),
    insertVisit: db.prepare(
      'INSERT INTO visits (user_id, kind, entry_type, checked_in_at, created_by) VALUES (?, ?, ?, ?, ?)'
    ),
    closeVisit: db.prepare('UPDATE visits SET checked_out_at = ? WHERE id = ? AND checked_out_at IS NULL'),
    visit: db.prepare('SELECT * FROM visits WHERE id = ?'),
  };

  const getUser = (id) => q.user.get(id);

  function status(user, now = clock()) {
    const t = today(now);
    const unlimitedActive = Boolean(user.unlimited_until && user.unlimited_until >= t);
    const frozen =
      user.frozen_from && user.frozen_until && user.frozen_from <= t && user.frozen_until >= t
        ? { from: user.frozen_from, until: user.frozen_until, daysLeft: diffDays(t, user.frozen_until) + 1 }
        : null;
    let reason = null;
    if (frozen) reason = 'frozen';
    else if (!unlimitedActive && user.visits_balance <= 0) reason = 'no_balance';
    return {
      visits: user.visits_balance,
      unlimited: unlimitedActive
        ? { until: user.unlimited_until, daysLeft: diffDays(t, user.unlimited_until) + 1 }
        : null,
      unlimitedExpired: user.unlimited_until && !unlimitedActive ? user.unlimited_until : null,
      frozen,
      freezeDaysLeft: unlimitedActive ? user.freeze_days_left : 0,
      canEnter: !reason,
      reason,
    };
  }

  function openVisitOf(userId, now = clock()) {
    return q.openVisit.get(userId, now - autoMs) || null;
  }

  /** Начисляет абонемент (пакет посещений или безлимит). plan — снимок из конфига. */
  function applyPlan(userId, plan, now = clock()) {
    return tx(db, () => {
      const user = getUser(userId);
      if (!user) throw new AppError('not_found', 'Клиент не найден', 404);
      if (plan.visits) {
        db.prepare('UPDATE users SET visits_balance = visits_balance + ? WHERE id = ?').run(plan.visits, userId);
      }
      if (plan.days) {
        const t = today(now);
        const active = user.unlimited_until && user.unlimited_until >= t;
        const start = active ? addDays(user.unlimited_until, 1) : t;
        const until = addDays(start, plan.days - 1);
        const freeze = plan.freezeDays || 0;
        db.prepare(
          active
            ? 'UPDATE users SET unlimited_until = ?, freeze_days_left = freeze_days_left + ? WHERE id = ?'
            : 'UPDATE users SET unlimited_until = ?, freeze_days_left = ? WHERE id = ?'
        ).run(until, freeze, userId);
      }
      return getUser(userId);
    });
  }

  function checkIn({ userId, byUserId = null, now = clock() }) {
    return tx(db, () => {
      const user = getUser(userId);
      if (!user) throw new AppError('not_found', 'Клиент не найден', 404);
      const open = openVisitOf(userId, now);
      if (open) throw new AppError('already_in', 'Клиент уже отмечен в зале', 409, { visitId: open.id });
      const s = status(user, now);
      if (s.reason === 'frozen') {
        throw new AppError('frozen', `Абонемент заморожен до ${formatDate(s.frozen.until)}`, 409);
      }
      let entryType;
      if (s.unlimited) {
        entryType = 'unlimited';
      } else if (user.visits_balance > 0) {
        entryType = 'visit';
        q.decVisit.run(userId);
      } else {
        throw new AppError('no_balance', 'На балансе нет посещений', 409);
      }
      const r = q.insertVisit.run(userId, 'member', entryType, now, byUserId);
      return { visit: q.visit.get(Number(r.lastInsertRowid)), user: getUser(userId) };
    });
  }

  function checkOut({ userId = null, visitId = null, now = clock() }) {
    const visit = visitId ? q.visit.get(visitId) : openVisitOf(userId, now);
    if (!visit || visit.checked_out_at) throw new AppError('not_in_gym', 'Посещение уже закрыто', 409);
    q.closeVisit.run(now, visit.id);
    return q.visit.get(visit.id);
  }

  function addGuest({ byUserId = null, now = clock() }) {
    const r = q.insertVisit.run(null, 'guest', 'guest', now, byUserId);
    return q.visit.get(Number(r.lastInsertRowid));
  }

  function removeGuest({ now = clock() }) {
    const guest = db
      .prepare(
        "SELECT * FROM visits WHERE kind = 'guest' AND checked_out_at IS NULL AND checked_in_at >= ? ORDER BY checked_in_at DESC LIMIT 1"
      )
      .get(now - autoMs);
    if (!guest) throw new AppError('no_guests', 'В зале нет гостей без аккаунта', 409);
    q.closeVisit.run(now, guest.id);
    return guest;
  }

  /** Закрывает визиты, по которым забыли отметить выход. */
  function closeStaleVisits(now = clock()) {
    return db
      .prepare(
        'UPDATE visits SET checked_out_at = checked_in_at + ?, auto_closed = 1 WHERE checked_out_at IS NULL AND checked_in_at < ?'
      )
      .run(DEFAULT_VISIT_MINUTES * 60000, now - autoMs).changes;
  }

  function freeze(userId, days, now = clock()) {
    return tx(db, () => {
      const user = getUser(userId);
      const s = status(user, now);
      if (!s.unlimited) throw new AppError('no_unlimited', 'Заморозка доступна только для безлимитного абонемента', 409);
      if (s.frozen) throw new AppError('already_frozen', 'Абонемент уже заморожен', 409);
      if (!Number.isInteger(days) || days < 1) throw new AppError('bad_days', 'Укажите количество дней');
      if (days > user.freeze_days_left) {
        throw new AppError('no_freeze_days', `Доступно дней заморозки: ${user.freeze_days_left}`, 409);
      }
      const t = today(now);
      db.prepare(
        'UPDATE users SET frozen_from = ?, frozen_until = ?, unlimited_until = ?, freeze_days_left = freeze_days_left - ? WHERE id = ?'
      ).run(t, addDays(t, days - 1), addDays(user.unlimited_until, days), days, userId);
      return getUser(userId);
    });
  }

  /** Досрочная разморозка: неиспользованные дни (включая сегодня) возвращаются. */
  function unfreeze(userId, now = clock()) {
    return tx(db, () => {
      const user = getUser(userId);
      const s = status(user, now);
      if (!s.frozen) throw new AppError('not_frozen', 'Абонемент не заморожен', 409);
      const unused = diffDays(today(now), user.frozen_until) + 1;
      db.prepare(
        'UPDATE users SET frozen_from = NULL, frozen_until = NULL, unlimited_until = ?, freeze_days_left = freeze_days_left + ? WHERE id = ?'
      ).run(addDays(user.unlimited_until, -unused), unused, userId);
      return getUser(userId);
    });
  }

  function visitMinutes(v, now) {
    const end = v.checked_out_at ?? Math.min(now, v.checked_in_at + autoMs);
    return Math.max(0, Math.round((end - v.checked_in_at) / 60000));
  }

  function stats(userId, now = clock()) {
    const p = localParts(now, tz);
    const monthStart = zonedToUtc(`${p.date.slice(0, 8)}01`, 0, tz);
    const weekStartDate = addDays(p.date, -p.dow);
    const weekStart = zonedToUtc(weekStartDate, 0, tz);
    const rows = db
      .prepare('SELECT checked_in_at, checked_out_at FROM visits WHERE user_id = ? ORDER BY checked_in_at DESC')
      .all(userId);
    let monthVisits = 0;
    let weekVisits = 0;
    let totalMinutes = 0;
    const weeks = new Set();
    for (const v of rows) {
      if (v.checked_in_at >= monthStart) monthVisits++;
      if (v.checked_in_at >= weekStart) weekVisits++;
      totalMinutes += visitMinutes(v, now);
      const lp = localParts(v.checked_in_at, tz);
      weeks.add(addDays(lp.date, -lp.dow));
    }
    // Серия недель подряд с тренировками (текущая неделя может быть ещё пустой).
    let w = weekStartDate;
    if (!weeks.has(w)) w = addDays(w, -7);
    let streakWeeks = 0;
    while (weeks.has(w)) {
      streakWeeks++;
      w = addDays(w, -7);
    }
    return {
      totalVisits: rows.length,
      monthVisits,
      weekVisits,
      streakWeeks,
      totalMinutes,
      avgMinutes: rows.length ? Math.round(totalMinutes / rows.length) : 0,
      level: levelFor(rows.length),
    };
  }

  function history(userId, { limit = 50 } = {}, now = clock()) {
    const visits = db
      .prepare('SELECT * FROM visits WHERE user_id = ? ORDER BY checked_in_at DESC LIMIT ?')
      .all(userId, limit)
      .map((v) => ({
        id: v.id,
        entryType: v.entry_type,
        checkedInAt: v.checked_in_at,
        checkedOutAt: v.checked_out_at,
        autoClosed: Boolean(v.auto_closed),
        minutes: visitMinutes(v, now),
        open: !v.checked_out_at && v.checked_in_at >= now - autoMs,
      }));
    const payments = db
      .prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'succeeded' ORDER BY paid_at DESC LIMIT ?")
      .all(userId, limit)
      .map((pmt) => ({
        id: pmt.id,
        planId: pmt.plan_id,
        title: pmt.plan_title,
        amount: pmt.amount,
        provider: pmt.provider,
        paidAt: pmt.paid_at,
      }));
    return { visits, payments };
  }

  return {
    getUser,
    status,
    openVisitOf,
    applyPlan,
    checkIn,
    checkOut,
    addGuest,
    removeGuest,
    closeStaleVisits,
    freeze,
    unfreeze,
    stats,
    history,
    today,
  };
}
