// Общие утилиты интерфейса: запросы к API, форматирование, нижние листы, уведомления.
import { icon } from './icons.js';

export { icon };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.message || 'Ошибка сети. Проверьте подключение');
    this.status = status;
    this.code = data?.error;
    this.data = data;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- Форматирование ----------
export const rub = (n) => `${Number(n).toLocaleString('ru-RU')}\u00a0₽`;

export function plural(n, [one, few, many]) {
  const r = new Intl.PluralRules('ru').select(n);
  return r === 'one' ? one : r === 'few' ? few : many;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const fmtDateShort = (ms) => dateFmt.format(ms);
export const fmtTime = (ms) => timeFmt.format(ms);

/** '2026-10-14' -> '14 октября' */
export function fmtDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return dayFmt.format(new Date(y, m - 1, d));
}

export function fmtDuration(min) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Маска телефона: +7 (900) 000-00-00 */
export function formatPhone(value) {
  let d = String(value).replace(/\D/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (d && !d.startsWith('7')) d = '7' + d;
  d = d.slice(0, 11);
  if (!d) return '';
  let out = '+7';
  if (d.length > 1) out += ` (${d.slice(1, 4)}`;
  if (d.length >= 4) out += ')';
  if (d.length > 4) out += ` ${d.slice(4, 7)}`;
  if (d.length > 7) out += `-${d.slice(7, 9)}`;
  if (d.length > 9) out += `-${d.slice(9, 11)}`;
  return out;
}

export function bindPhoneInput(input) {
  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    const formatted = formatPhone(input.value);
    if (atEnd || formatted.length < input.value.length) input.value = formatted;
  });
  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+7 ';
  });
  input.addEventListener('blur', () => {
    if (input.value.replace(/\D/g, '').length <= 1) input.value = '';
    else input.value = formatPhone(input.value);
  });
}

// ---------- Уведомления ----------
let toastTimer;
export function toast(message, { error = false } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('<div id="toast" class="toast" role="status" aria-live="polite"></div>');
    document.body.append(t);
  }
  t.textContent = message;
  t.classList.toggle('toast--error', error);
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 3200);
}

// ---------- Нижние листы ----------
export function openSheet({ title = '', content = '', onClose } = {}) {
  const backdrop = el(`
    <div class="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet__grab"></div>
        <div class="sheet__head">
          <h2 class="sheet__title">${esc(title)}</h2>
          <button class="sheet__close" type="button" aria-label="Закрыть">${icon('close')}</button>
        </div>
        <div class="sheet__body"></div>
      </div>
    </div>`);
  const sheet = $('.sheet', backdrop);
  const body = $('.sheet__body', backdrop);
  const prevFocus = document.activeElement;
  let closed = false;

  const setContent = (html) => {
    if (typeof html === 'string') body.innerHTML = html;
    else {
      body.innerHTML = '';
      body.append(html);
    }
  };
  const setTitle = (t) => {
    $('.sheet__title', backdrop).textContent = t;
    sheet.setAttribute('aria-label', t);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      backdrop.remove();
      if (!document.querySelector('.sheet-backdrop')) document.body.style.overflow = '';
    }, 350);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  setContent(content);
  $('.sheet__close', backdrop).addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    (body.querySelector('[autofocus]') || $('.sheet__close', backdrop)).focus({ preventScroll: true });
  });
  return { close, body, setContent, setTitle, el: backdrop };
}

export function successMark() {
  return `<svg class="success__mark" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" pathLength="1"/><path d="M30 52l13 13 27-29" pathLength="1"/></svg>`;
}

export function setBusy(button, busy, text) {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:20px;height:20px;border-width:2px"></span>${text ? ` ${esc(text)}` : ''}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}
