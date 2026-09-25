// Работа со временем в часовом поясе зала (не зависит от TZ сервера).

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Локальные дата/время для момента ms в часовом поясе tz. dow: 0 — понедельник. */
export function localParts(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const y = +parts.year;
  const m = +parts.month;
  const d = +parts.day;
  const hh = +parts.hour;
  const mm = +parts.minute;
  const ss = +parts.second;
  return {
    y,
    m,
    d,
    hh,
    mm,
    ss,
    dow: WEEKDAYS[parts.weekday],
    date: `${y}-${pad(m)}-${pad(d)}`,
    minutes: hh * 60 + mm,
  };
}

function offsetMs(ms, tz) {
  const p = localParts(ms, tz);
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** Момент (epoch ms) для локальной даты 'YYYY-MM-DD' и минут от полуночи. */
export function zonedToUtc(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wall - offsetMs(wall, tz);
  guess = wall - offsetMs(guess, tz);
  return guess;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Количество дней от a до b (b - a). */
export function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function dowOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** '13:30' -> 810 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(min) {
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

export const WEEKDAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
