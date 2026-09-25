// Серверный рендер лендинга (EJS) — содержимое индексируется поисковиками.
import ejs from 'ejs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { icon } from '../public/assets/js/icons.js';
import { WEEKDAY_SHORT } from './time.js';

const VIEWS = path.resolve(import.meta.dirname, 'views');
const ROOT = path.resolve(import.meta.dirname, '..');

const rub = (n) => `${n.toLocaleString('ru-RU')}\u00a0₽`;

/** Группирует одинаковые дни расписания: «Пн, Ср, Пт — 09:00–22:00». */
export function groupSchedule(schedule) {
  const groups = [];
  for (const d of [...schedule].sort((a, b) => a.day - b.day)) {
    const key = d.closed ? 'closed' : `${d.open}-${d.close}-${d.women ? d.women.join('-') : ''}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, days: [], closed: Boolean(d.closed), open: d.open, close: d.close, women: d.women || null };
      groups.push(g);
    }
    g.days.push(d.day);
  }
  return groups.map((g) => ({ ...g, label: g.days.map((d) => WEEKDAY_SHORT[d]).join(', ') }));
}

function planNote(p) {
  if (p.visits > 1) return `${rub(Math.round(p.price / p.visits))} за тренировку`;
  if (p.visits === 1) return 'Оплата за одно посещение';
  if (p.days >= 60) return `${rub(Math.round(p.price / (p.days / 30)))} в месяц`;
  return 'Без ограничений по посещениям';
}

function assetVersion() {
  const hash = crypto.createHash('sha1');
  for (const dir of ['public/assets/css', 'public/assets/js']) {
    const abs = path.join(ROOT, dir);
    for (const f of fs.readdirSync(abs).sort()) hash.update(fs.readFileSync(path.join(abs, f)));
  }
  return hash.digest('hex').slice(0, 10);
}

function loadReviews() {
  const file = path.join(ROOT, 'content/reviews.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { sources: data.sources || [], reviews: (data.reviews || []).filter((r) => r && r.text) };
  } catch {
    return { sources: [], reviews: [] };
  }
}

export async function createRenderer({ config, demo, publicUrl = null, onlinePayments = true }) {
  const emblemRaw = fs.readFileSync(path.join(VIEWS, 'partials/emblem.svg'), 'utf8');
  const wordmark = fs.readFileSync(path.join(VIEWS, 'partials/wordmark.svg'), 'utf8');
  const sampleQr = await QRCode.toString('GC:DEMO2026', { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const version = assetVersion();

  // Каждый экземпляр эмблемы получает свой id маски (иначе конфликт id в документе).
  const emblem = (id, cls = '') =>
    emblemRaw.replaceAll('gci-wm', `${id}-wm`).replace('class="emblem"', `class="emblem ${cls}"`.trim());

  const locals = () => ({
    gym: config,
    demo,
    plans: config.plans.map((p) => ({ ...p, priceText: rub(p.price), note: planNote(p) })),
    minMonthly: Math.min(...config.plans.filter((p) => p.days).map((p) => p.price)),
    scheduleGroups: groupSchedule(config.schedule),
    reviews: loadReviews(),
    emblem,
    icon,
    wordmark,
    sampleQr,
    rub,
    v: version,
    onlinePayments,
    publicUrl,
    abs: (p) => (publicUrl ? `${publicUrl}${p}` : p),
    year: new Date().getFullYear(),
  });

  const cache = new Map();
  async function render(view, extra = {}) {
    if (!cache.has(view) || process.env.NODE_ENV === 'development') {
      const html = await ejs.renderFile(path.join(VIEWS, `${view}.ejs`), { ...locals(), ...extra }, { async: false });
      cache.set(view, html);
    }
    return cache.get(view);
  }

  return { render, version };
}
