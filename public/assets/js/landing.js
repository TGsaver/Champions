// Главная страница: интро, навигация, анимации прокрутки, загрузка зала и прогноз.
import { connectOccupancy, LEVEL_COLORS, peopleWord } from './live.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ================= Интро ================= */
function runIntro() {
  const intro = $('#intro');
  if (!root.classList.contains('intro-play') || !intro) {
    intro?.remove();
    return;
  }
  const stage = $('#intro-stage');
  const target = $('#hero-emblem');
  let finished = false;

  const cleanup = () => {
    root.classList.remove('intro-play', 'intro-out');
    intro.remove();
    document.removeEventListener('keydown', onKey);
  };

  const finish = (skip = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      sessionStorage.setItem('gc-intro', '1');
    } catch {
      /* ignore */
    }
    root.classList.add('intro-out');
    if (skip) {
      intro.style.transition = 'opacity .35s ease';
      intro.style.opacity = '0';
      setTimeout(cleanup, 360);
      return;
    }
    // Эмблема «приземляется» на своё место на первом экране.
    const from = stage.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const scale = to.width / from.width;
    intro.classList.add('intro--leaving');
    stage.style.transition = 'transform 1s cubic-bezier(.65,0,.35,1)';
    stage.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
    stage.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 1300);
  };

  const onKey = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(true);
  };
  document.addEventListener('keydown', onKey);
  $('[data-intro-skip]', intro)?.addEventListener('click', () => finish(true));
  const timer = setTimeout(() => finish(false), 2750);
}

/* ================= Навигация ================= */
function initNav() {
  const nav = $('#nav');
  const burger = $('.nav__burger', nav);
  const menu = $('#menu');
  const onScroll = () => nav.classList.toggle('nav--solid', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setOpen = (open) => {
    nav.classList.toggle('nav--open', open);
    burger.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => setOpen(menu.hidden));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setOpen(false);
  });

  // Подсветка текущего раздела
  const links = new Map($$('.nav__links a').map((a) => [a.hash, a]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const link = links.get(`#${e.target.id}`);
        if (!link) continue;
        if (e.isIntersecting) {
          links.forEach((l) => l.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'true');
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  $$('main section[id]').forEach((s) => io.observe(s));
}

/* ================= Появление блоков ================= */
function initReveal() {
  const els = $$('[data-reveal]');
  if (!('IntersectionObserver' in window) || reduceMotion) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
  );
  els.forEach((el) => io.observe(el));
}

/* ================= Эффекты прокрутки ================= */
function splitWords(el) {
  const words = [];
  const walk = (node, gold) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(part);
            continue;
          }
          const span = document.createElement('span');
          span.className = gold ? 'w w--gold' : 'w';
          span.textContent = part;
          words.push(span);
          frag.append(span);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child, gold || child.classList.contains('w--gold-src'));
      }
    }
  };
  walk(el, false);
  return words;
}

function initScrollEffects() {
  const text = $('[data-scroll-words]');
  const words = text ? splitWords(text) : [];
  const visual = $('[data-hero-visual]');
  const phone = $('[data-phone]');
  let ticking = false;

  const update = () => {
    ticking = false;
    const vh = window.innerHeight;

    if (text) {
      const r = text.getBoundingClientRect();
      const start = vh * 0.82;
      const end = vh * 0.38;
      const p = reduceMotion ? 1 : clamp((start - r.top) / (r.height + start - end));
      const n = words.length;
      words.forEach((w, i) => {
        const o = clamp(p * (n + 4) - i).toFixed(2);
        if (w.style.getPropertyValue('--o') !== o) w.style.setProperty('--o', o);
      });
    }

    if (visual && !reduceMotion && !root.classList.contains('intro-play')) {
      const t = clamp(window.scrollY / vh);
      visual.style.transform = `translateY(${(t * 90).toFixed(1)}px) scale(${(1 - t * 0.14).toFixed(3)})`;
      visual.style.opacity = (1 - t * 0.85).toFixed(3);
    }

    if (phone && !reduceMotion) {
      const r = phone.getBoundingClientRect();
      const p = clamp((vh - r.top) / (vh + r.height));
      phone.style.setProperty('--ry', `${(-16 + p * 22).toFixed(2)}deg`);
      phone.style.setProperty('--rx', `${(8 - p * 10).toFixed(2)}deg`);
    }
  };

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  // Мягкий «прожектор» за курсором на первом экране
  const hero = $('.hero');
  const spot = $('.hero__spot');
  if (hero && spot && window.matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      spot.style.setProperty('--mx', `${e.clientX - r.left}px`);
      spot.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }
}

/* ================= Счётчик цены ================= */
function initCounters() {
  const fmt = (n) => `${n.toLocaleString('ru-RU')}\u00a0₽`;
  const els = $$('[data-count]');
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target;
      const to = Number(el.dataset.count);
      const t0 = performance.now();
      const dur = 1400;
      const step = (t) => {
        const k = clamp((t - t0) / dur);
        const eased = 1 - Math.pow(2, -10 * k);
        el.textContent = fmt(Math.round((k === 1 ? 1 : eased) * to / 10) * 10);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  els.forEach((el) => io.observe(el));
}

/* ================= Отложенная загрузка виджетов Яндекса ================= */
function initLazyFrames() {
  const frames = $$('[data-lazy-frame]');
  const load = (box) => {
    if (box.querySelector('iframe')) return;
    const iframe = document.createElement('iframe');
    iframe.src = box.dataset.lazyFrame;
    iframe.title = box.dataset.frameTitle || '';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    iframe.addEventListener('load', () => {
      box.querySelector('.spinner')?.remove();
      iframe.classList.add('is-loaded');
    });
    box.append(iframe);
  };
  if (!('IntersectionObserver' in window)) return frames.forEach(load);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.unobserve(e.target);
          load(e.target);
        }
      }
    },
    { rootMargin: '600px 0px' }
  );
  frames.forEach((f) => io.observe(f));
}

/* ================= Загрузка зала ================= */
function renderLive(s) {
  const level = s.open ? s.level : 'closed';
  const word = peopleWord(s.count);

  $$('[data-live-count]').forEach((el) => (el.textContent = s.count));
  $$('[data-live-unit]').forEach((el) => (el.textContent = `${word} в зале`));
  $$('[data-live-label]').forEach((el) => (el.textContent = s.open ? s.label : 'Зал закрыт'));
  $$('[data-live-dot]').forEach((el) => (el.dataset.level = level));
  $$('[data-live-cap]').forEach((el) => (el.textContent = `вместимость ${s.capacity}`));
  $$('[data-live-status]').forEach((el) => (el.textContent = s.statusText));

  const bar = $('[data-gauge-bar]');
  if (bar) {
    bar.style.setProperty('--level-color', LEVEL_COLORS[level]);
    bar.style.strokeDashoffset = String(1 - Math.max(0.005, s.percent / 100));
  }

  const pill = $('[data-live-pill]');
  if (pill) {
    $('.dot', pill).dataset.level = level;
    $('[data-live-pill-text]', pill).innerHTML = s.open
      ? `Сейчас в зале <b>${s.count}</b> ${word} · ${s.label.toLowerCase()}`
      : `${s.statusText}`;
  }

  const mini = $('[data-live-mini]');
  if (mini) {
    mini.hidden = false;
    $('.dot', mini).dataset.level = level;
    $('[data-live-mini-text]', mini).textContent = s.open ? `${s.count} в зале` : 'Закрыто';
  }

  const openDot = $('[data-open-dot]');
  if (openDot) {
    openDot.dataset.level = s.open ? 'low' : 'closed';
    $('[data-open-text]').textContent = s.statusText;
  }
}

/* ================= Прогноз по часам ================= */
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAY_IN = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];
const LEVEL_TEXT = { low: 'свободно', medium: 'умеренно', high: 'много людей', full: 'очень много людей' };

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

async function fetchForecast(date) {
  const res = await fetch(`/api/occupancy/forecast${date ? `?date=${date}` : ''}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('forecast');
  return res.json();
}

function renderChart(f, isToday) {
  const chart = $('[data-chart]');
  const axis = $('[data-chart-axis]');
  const best = $('[data-best]');
  if (!chart) return;

  if (f.closed) {
    const closed = document.createElement('div');
    closed.className = 'chart__closed';
    closed.textContent = 'Выходной день — зал закрыт';
    chart.replaceWith(closed);
    closed.setAttribute('data-chart', '');
    axis.innerHTML = '';
    best.textContent = '';
    return;
  }
  if (!chart.classList.contains('chart')) {
    const fresh = document.createElement('div');
    fresh.className = 'chart';
    fresh.setAttribute('data-chart', '');
    fresh.setAttribute('role', 'img');
    chart.replaceWith(fresh);
    return renderChart(f, isToday);
  }

  const max = Math.max(60, ...f.hours.map((h) => h.percent));
  chart.innerHTML = '';
  axis.innerHTML = '';
  const third = f.hours.length / 3;
  f.hours.forEach((h, i) => {
    const bar = document.createElement('div');
    bar.className = 'chart__bar';
    if (i < third) bar.classList.add('tip-start');
    else if (i >= f.hours.length - third) bar.classList.add('tip-end');
    bar.dataset.level = h.level;
    bar.tabIndex = 0;
    if (h.women) bar.classList.add('is-women');
    if (h.past) bar.classList.add('is-past');
    if (h.now) bar.classList.add('is-now');
    const fill = document.createElement('div');
    fill.className = 'chart__fill';
    fill.style.height = '0%';
    const tip = document.createElement('div');
    tip.className = 'chart__tip';
    tip.innerHTML = `<b>${h.label}</b><br>≈ ${h.expected} ${peopleWord(h.expected)} · ${h.women ? 'женские часы' : LEVEL_TEXT[h.level]}`;
    bar.append(fill, tip);
    if (h.now) {
      const now = document.createElement('span');
      now.className = 'chart__now';
      now.textContent = 'Сейчас';
      bar.append(now);
    }
    bar.setAttribute('aria-label', `${h.label}: около ${h.expected} ${peopleWord(h.expected)}`);
    chart.append(bar);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (fill.style.height = `${Math.max(3, (h.percent / max) * 100)}%`))
    );

    const label = document.createElement('span');
    label.textContent = h.hour % 3 === 0 ? String(h.hour).padStart(2, '0') : '';
    axis.append(label);
  });
  chart.setAttribute('aria-label', `Прогноз загрузки по часам ${isToday ? 'на сегодня' : DAY_IN[f.dow]}`);

  if (f.bestWindow) {
    best.innerHTML = `Лучшее время ${isToday ? 'сегодня' : DAY_IN[f.dow]}: <b>${f.bestWindow.from}–${f.bestWindow.to}</b>`;
  } else {
    best.textContent = isToday ? 'На сегодня тренировки почти закончились — ждём вас завтра.' : '';
  }
}

function renderSpark(f) {
  const spark = $('[data-spark]');
  if (!spark || f.closed) return;
  const max = Math.max(60, ...f.hours.map((h) => h.percent));
  spark.innerHTML = f.hours
    .map((h) => `<i class="${h.now ? 'is-now' : ''}" style="height:${Math.max(6, (h.percent / max) * 100)}%"></i>`)
    .join('');
}

async function initForecast() {
  const tabs = $('[data-day-tabs]');
  if (!tabs) return;
  let today;
  try {
    today = await fetchForecast();
  } catch {
    $('[data-best]').textContent = 'Прогноз временно недоступен.';
    return;
  }
  renderChart(today, true);
  renderSpark(today);
  highlightToday(today.dow);

  const cache = new Map([[today.date, today]]);
  DAY_SHORT.forEach((label, dow) => {
    const offset = (dow - today.dow + 7) % 7;
    const date = addDays(today.date, offset);
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = offset === 0 ? 'Сегодня' : label;
    b.setAttribute('aria-selected', String(offset === 0));
    b.addEventListener('click', async () => {
      $$('button', tabs).forEach((x) => x.setAttribute('aria-selected', 'false'));
      b.setAttribute('aria-selected', 'true');
      try {
        if (!cache.has(date)) cache.set(date, await fetchForecast(date));
        renderChart(cache.get(date), offset === 0);
      } catch {
        /* оставляем прежний график */
      }
    });
    tabs.append(b);
  });
  // «Сегодня» — первой вкладкой, дальше дни по порядку
  const buttons = $$('button', tabs);
  const order = buttons.map((b, dow) => ({ b, k: (dow - today.dow + 7) % 7 })).sort((a, b) => a.k - b.k);
  order.forEach(({ b }) => tabs.append(b));

  // обновляем прогноз раз в 10 минут (сдвигается «сейчас»)
  setInterval(async () => {
    try {
      const fresh = await fetchForecast();
      cache.set(fresh.date, fresh);
      renderSpark(fresh);
      if ($('[data-day-tabs] [aria-selected="true"]')?.textContent === 'Сегодня') renderChart(fresh, true);
    } catch {
      /* ignore */
    }
  }, 600000);
}

function highlightToday(dow) {
  $$('.hours li').forEach((li) => {
    const days = li.dataset.days.split(',').map(Number);
    li.classList.toggle('is-today', days.includes(dow));
  });
}

/* ================= Старт ================= */
runIntro();
initNav();
initReveal();
initScrollEffects();
initCounters();
initLazyFrames();
connectOccupancy(renderLive);
initForecast();
