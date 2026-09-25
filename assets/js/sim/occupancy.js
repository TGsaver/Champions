// Загрузка зала: текущее число людей, статус работы, прогноз по часам, live-обновления (SSE).
import { getSetting, setSetting } from './db.js';
import { DEFAULT_VISIT_MINUTES } from './memberships.js';
import { addDays, dowOf, fromMinutes, localParts, toMinutes, zonedToUtc } from './time.js';

const ON_DAY = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];

export const LEVELS = [
  { id: 'low', below: 40, label: 'Свободно' },
  { id: 'medium', below: 70, label: 'Умеренно' },
  { id: 'high', below: 90, label: 'Много людей' },
  { id: 'full', below: Infinity, label: 'Очень много людей' },
];

export const levelFor = (percent) => LEVELS.find((l) => percent < l.below);

// Типичная загрузка тренажёрного зала (доля от вместимости) по часам — используется,
// пока в системе не накопилась своя история посещений.
const TYPICAL = {
  weekday: { 7: 0.2, 8: 0.24, 9: 0.2, 10: 0.2, 11: 0.2, 12: 0.18, 13: 0.2, 14: 0.24, 15: 0.3, 16: 0.42, 17: 0.62, 18: 0.82, 19: 0.9, 20: 0.74, 21: 0.46, 22: 0.2 },
  saturday: { 9: 0.24, 10: 0.32, 11: 0.44, 12: 0.5, 13: 0.5, 14: 0.46, 15: 0.42, 16: 0.44, 17: 0.52, 18: 0.56, 19: 0.52, 20: 0.4, 21: 0.26, 22: 0.12 },
};
const WOMEN_FACTOR = 0.55;

export function createOccupancy({ db, config, demo = false, clock = () => Date.now() }) {
  const tz = config.timezone;
  const autoMs = config.occupancy.autoCheckoutMinutes * 60000;
  const clients = new Set();
  const historyCache = new Map();
  let lastKey = '';
  let timers = [];

  const countOpenStmt = db.prepare(
    "SELECT kind, COUNT(*) AS n FROM visits WHERE checked_out_at IS NULL AND checked_in_at >= ? GROUP BY kind"
  );

  function capacity() {
    return getSetting(db, 'capacity', config.occupancy.capacity);
  }

  function setCapacity(value) {
    setSetting(db, 'capacity', value);
    notify(true);
  }

  function daySchedule(dow) {
    const d = config.schedule.find((s) => s.day === dow);
    if (!d || d.closed) return null;
    return {
      open: toMinutes(d.open),
      close: toMinutes(d.close),
      women: d.women ? [toMinutes(d.women[0]), toMinutes(d.women[1])] : null,
    };
  }

  function nextOpening(p) {
    for (let i = 0; i < 8; i++) {
      const date = addDays(p.date, i);
      const s = daySchedule(dowOf(date));
      if (!s) continue;
      if (i === 0 && p.minutes >= s.open) continue;
      return { date, dow: dowOf(date), time: fromMinutes(s.open), inDays: i };
    }
    return null;
  }

  /** Работает ли зал сейчас, женские ли часы, текст статуса. */
  function openState(now = clock()) {
    const p = localParts(now, tz);
    const s = daySchedule(p.dow);
    const open = Boolean(s && p.minutes >= s.open && p.minutes < s.close);
    const women = Boolean(open && s.women && p.minutes >= s.women[0] && p.minutes < s.women[1]);
    let text;
    if (women) text = `Женские часы до ${fromMinutes(s.women[1])}`;
    else if (open) text = `Открыто до ${fromMinutes(s.close)}`;
    else {
      const next = nextOpening(p);
      if (!next) text = 'Закрыто';
      else if (next.inDays === 0) text = `Закрыто · откроется в ${next.time}`;
      else if (next.inDays === 1) text = `Закрыто · откроется завтра в ${next.time}`;
      else text = `Закрыто · откроется ${ON_DAY[next.dow]} в ${next.time}`;
    }
    return { open, women, text, parts: p };
  }

  function typicalFraction(dow, minutes) {
    const curve = dow === 5 || dow === 6 ? TYPICAL.saturday : TYPICAL.weekday;
    // значения заданы на середину часа — интерполируем линейно
    const x = minutes / 60 - 0.5;
    const h0 = Math.floor(x);
    const t = x - h0;
    const v0 = curve[h0] ?? 0.1;
    const v1 = curve[h0 + 1] ?? 0.1;
    return v0 + (v1 - v0) * t;
  }

  function isWomenTime(dow, minutes) {
    const s = daySchedule(dow);
    return Boolean(s && s.women && minutes >= s.women[0] && minutes < s.women[1]);
  }

  /** Демо-режим: реалистичное «живое» число посетителей по типичной кривой. */
  function simulated(now) {
    const st = openState(now);
    if (!st.open) return 0;
    const { dow, minutes } = st.parts;
    const minutesExact = minutes + st.parts.ss / 60;
    let f = typicalFraction(dow, minutesExact);
    if (st.women) f *= WOMEN_FACTOR;
    const t = now / 60000;
    const noise = 1 + 0.1 * Math.sin((2 * Math.PI * t) / 13) + 0.06 * Math.sin((2 * Math.PI * t) / 41 + 1.7);
    return Math.max(0, Math.round(capacity() * f * noise));
  }

  function counts(now = clock()) {
    const rows = countOpenStmt.all(now - autoMs);
    const members = rows.find((r) => r.kind === 'member')?.n ?? 0;
    const guests = rows.find((r) => r.kind === 'guest')?.n ?? 0;
    return { members, guests, simulated: demo ? simulated(now) : 0 };
  }

  function snapshot(now = clock()) {
    const c = counts(now);
    const cap = capacity();
    const st = openState(now);
    const count = c.members + c.guests + c.simulated;
    const percent = Math.min(100, Math.round((count / cap) * 100));
    const level = levelFor(percent);
    return {
      count,
      capacity: cap,
      percent,
      level: level.id,
      label: st.open ? level.label : 'Закрыто',
      open: st.open,
      womenOnly: st.women,
      statusText: st.text,
      updatedAt: now,
      demo,
    };
  }

  /** Средняя фактическая загрузка по часам для дня недели по истории посещений. */
  function historyProfile(dow, now) {
    const todayDate = localParts(now, tz).date;
    const key = `${todayDate}:${dow}`;
    const cached = historyCache.get(key);
    if (cached && cached.at > now - 10 * 60000) return cached.value;

    const s = daySchedule(dow);
    let value = null;
    if (s) {
      const dates = [];
      for (let i = 1; i <= config.occupancy.historyDays; i++) {
        const d = addDays(todayDate, -i);
        if (dowOf(d) === dow) dates.push(d);
      }
      const from = zonedToUtc(dates[dates.length - 1] ?? todayDate, 0, tz);
      const to = zonedToUtc(todayDate, 0, tz);
      const rows = db
        .prepare('SELECT checked_in_at, checked_out_at FROM visits WHERE checked_in_at >= ? AND checked_in_at < ?')
        .all(from, to);
      const byDate = new Map();
      for (const v of rows) {
        const d = localParts(v.checked_in_at, tz).date;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(v);
      }
      const sums = {};
      let days = 0;
      for (const d of dates) {
        const list = byDate.get(d);
        if (!list || list.length === 0) continue; // зал не работал или система ещё не использовалась
        days++;
        for (let h = Math.floor(s.open / 60); h < Math.ceil(s.close / 60); h++) {
          const at = zonedToUtc(d, h * 60 + 30, tz);
          let n = 0;
          for (const v of list) {
            const out = v.checked_out_at ?? v.checked_in_at + DEFAULT_VISIT_MINUTES * 60000;
            if (v.checked_in_at <= at && at < out) n++;
          }
          sums[h] = (sums[h] ?? 0) + n;
        }
      }
      if (days >= 3) {
        value = {};
        for (const h of Object.keys(sums)) value[h] = sums[h] / days;
      }
    }
    historyCache.set(key, { at: now, value });
    return value;
  }

  /** Прогноз загрузки по часам на дату (по умолчанию — сегодня). */
  function forecast(date, now = clock()) {
    const nowParts = localParts(now, tz);
    date = date || nowParts.date;
    const dow = dowOf(date);
    const s = daySchedule(dow);
    const cap = capacity();
    const isToday = date === nowParts.date;
    if (!s) return { date, dow, closed: true, capacity: cap, hours: [], bestWindow: null, source: 'typical' };

    // В демо-режиме «живое» число симулируется по типичной кривой — прогноз строим по ней же.
    const hist = demo ? null : historyProfile(dow, now);
    const hours = [];
    for (let h = Math.floor(s.open / 60); h < Math.ceil(s.close / 60); h++) {
      const mid = h * 60 + 30;
      const women = isWomenTime(dow, h * 60);
      let expected;
      if (hist) expected = hist[h] ?? 0;
      else expected = cap * typicalFraction(dow, mid) * (women ? WOMEN_FACTOR : 1);
      const percent = Math.min(100, Math.round((expected / cap) * 100));
      hours.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        expected: Math.round(expected),
        percent,
        level: levelFor(percent).id,
        women,
        past: isToday && h < nowParts.hh,
        now: isToday && h === nowParts.hh,
      });
    }

    // Лучшее время: окно из двух часов с минимальной загрузкой (без женских часов и прошедшего времени).
    let bestWindow = null;
    const candidates = hours.filter((x) => !x.women && !x.past && x.hour * 60 + 60 <= s.close);
    for (let i = 0; i + 1 < candidates.length; i++) {
      const a = candidates[i];
      const b = candidates[i + 1];
      if (b.hour !== a.hour + 1) continue;
      const avg = (a.percent + b.percent) / 2;
      if (!bestWindow || avg < bestWindow.avg) {
        bestWindow = { from: a.label, to: `${String(b.hour + 1).padStart(2, '0')}:00`, avg };
      }
    }
    if (bestWindow) bestWindow.avg = Math.round(bestWindow.avg);

    return {
      date,
      dow,
      closed: false,
      capacity: cap,
      open: fromMinutes(s.open),
      close: fromMinutes(s.close),
      women: s.women ? [fromMinutes(s.women[0]), fromMinutes(s.women[1])] : null,
      source: hist ? 'history' : 'typical',
      hours,
      bestWindow,
    };
  }

  // ---------- Live-обновления (Server-Sent Events) ----------
  function send(res, data) {
    res.write(`event: occupancy\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function subscribe(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    send(res, snapshot());
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  function notify(force = false) {
    const snap = snapshot();
    const key = [snap.count, snap.capacity, snap.open, snap.womenOnly].join(':');
    if (!force && key === lastKey) return;
    lastKey = key;
    for (const res of clients) send(res, snap);
  }

  function start({ closeStale } = {}) {
    stop();
    timers.push(
      setInterval(() => {
        if (closeStale) closeStale();
        notify();
      }, 15000)
    );
    timers.push(
      setInterval(() => {
        for (const res of clients) res.write(': ping\n\n');
      }, 25000)
    );
    for (const t of timers) t.unref?.();
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
    for (const res of clients) res.end();
    clients.clear();
  }

  return { snapshot, forecast, counts, capacity, setCapacity, openState, subscribe, notify, start, stop };
}
