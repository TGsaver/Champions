import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const PASS_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Код QR-пропуска: 8 символов без похожих букв/цифр (0/O, 1/I). */
export function newPassCode() {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += PASS_ALPHABET[b % PASS_ALPHABET.length];
  return code;
}

// Сканер QR-кодов «печатает» как клавиатура: при русской раскладке вместо GC:ABCD2345
// приходит «ПСЖФИСВ2345». Возвращаем символы клавиш латинской раскладки.
const RU_TO_EN = Object.fromEntries(
  [...'ЙЦУКЕНГШЩЗФЫВАПРОЛДЯЧСМИТЬ'].map((ru, i) => [ru, 'QWERTYUIOPASDFGHJKLZXCVBNM'[i]])
);

/** Нормализует код с пропуска: «gc:abcd-2345» или «псжфисв2345» -> «ABCD2345». */
export function normalizePassCode(input) {
  const s = [...String(input || '').toUpperCase()]
    .map((ch) => RU_TO_EN[ch] ?? ch)
    .join('')
    .replace(/^GC[:\-\s]?/, '')
    .replace(/[^0-9A-Z]/g, '');
  return s.length === 8 ? s : null;
}

/** Российский номер -> 11 цифр, начиная с 7. Иначе null. */
export function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return /^7\d{10}$/.test(d) ? d : null;
}

export function formatPhone(d) {
  if (!/^7\d{10}$/.test(d)) return d;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

/** Простой ограничитель частоты запросов в памяти процесса. */
export class RateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  hit(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    if (this.hits.size > 10000) this.prune(now);
    return { allowed: entry.count <= this.max, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune(now) {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}
