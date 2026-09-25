// Личный кабинет: вход, QR-пропуск, баланс, пополнение, заморозка, история, профиль.
import { connectOccupancy } from './live.js';
import {
  $,
  $$,
  api,
  bindPhoneInput,
  esc,
  fmtDateShort,
  fmtDay,
  fmtDuration,
  fmtTime,
  icon,
  openSheet,
  plural,
  rub,
  setBusy,
  successMark,
  toast,
} from './ui.js';

const app = $('#app');
const params = new URLSearchParams(location.search);
const state = { config: null, me: null, history: null, forecast: null, occupancy: null, tab: 'visits', showAll: false };
const HISTORY_PREVIEW = 6;

const visitsWord = (n) => plural(n, ['посещение', 'посещения', 'посещений']);
const daysWord = (n) => plural(n, ['день', 'дня', 'дней']);
const trainingsWord = (n) => plural(n, ['тренировка', 'тренировки', 'тренировок']);
const firstName = (name) => name.trim().split(/\s+/)[0];
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const passLabel = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function localToday() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function cleanUrl() {
  history.replaceState(null, '', location.pathname);
}

/* ================= Вход и регистрация ================= */
function renderAuth(mode = params.get('mode') === 'register' ? 'register' : 'login') {
  const { demo, demoAccounts } = state.config;
  const reg = mode === 'register';
  app.innerHTML = `
    <section class="auth container">
      <div class="auth__emblem emblem-gold" role="img" aria-label="Gym Champions"></div>
      <h1>Личный кабинет</h1>
      <p class="auth__lead">QR-пропуск, баланс посещений и история тренировок.</p>
      <div class="segmented" role="tablist" aria-label="Вход или регистрация">
        <button type="button" role="tab" data-mode="login" aria-selected="${!reg}">Вход</button>
        <button type="button" role="tab" data-mode="register" aria-selected="${reg}">Регистрация</button>
      </div>
      <form class="form" id="auth-form" novalidate>
        ${
          reg
            ? `<div class="field"><label for="f-name">Имя</label>
               <input class="input" id="f-name" name="name" autocomplete="name" maxlength="60" placeholder="Как к вам обращаться" required></div>`
            : ''
        }
        <div class="field"><label for="f-phone">Телефон</label>
          <input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 (900) 000-00-00" required></div>
        <div class="field"><label for="f-pass">Пароль</label>
          <input class="input" id="f-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}"
            placeholder="${reg ? 'Не короче 8 символов' : 'Ваш пароль'}" required></div>
        ${
          reg
            ? `<label class="check"><input type="checkbox" name="consent">
               <span>Согласен на обработку персональных данных в соответствии с <a href="/privacy" target="_blank">политикой конфиденциальности</a></span></label>`
            : ''
        }
        <p class="form__error" role="alert"></p>
        <button class="btn btn--gold btn--block" type="submit">${reg ? 'Создать аккаунт' : 'Войти'}</button>
      </form>
      ${
        demo && demoAccounts
          ? `<div class="demo-box"><b>Демо-режим.</b> Данные тестовые, оплата не списывает деньги.
              <div class="demo-row"><span>Клиент: <code>${esc(demoAccounts.member.phone)}</code> / <code>${esc(demoAccounts.member.password)}</code></span>
                <button class="btn btn--dark btn--sm" type="button" data-demo="member">Войти</button></div>
              <div class="demo-row"><span>Администратор: <code>${esc(demoAccounts.admin.phone)}</code> / <code>${esc(demoAccounts.admin.password)}</code></span>
                <a class="btn btn--dark btn--sm" href="/admin">Ресепшен</a></div>
            </div>`
          : ''
      }
    </section>`;

  $$('[data-mode]', app).forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.mode !== mode) renderAuth(b.dataset.mode);
    })
  );
  const form = $('#auth-form');
  bindPhoneInput(form.phone);
  (reg ? form.name : form.phone).focus({ preventScroll: true });

  $('[data-demo]', app)?.addEventListener('click', () => {
    if (reg) return;
    form.phone.value = demoAccounts.member.phone;
    form.password.value = demoAccounts.member.password;
    form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('.form__error', form);
    const btn = $('button[type=submit]', form);
    error.textContent = '';
    $$('.input', form).forEach((i) => i.removeAttribute('aria-invalid'));
    const invalid = (input, msg) => {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      error.textContent = msg;
    };
    if (reg && form.name.value.trim().length < 2) return invalid(form.name, 'Введите имя');
    if (form.phone.value.replace(/\D/g, '').length !== 11) return invalid(form.phone, 'Введите номер телефона полностью');
    if (reg && form.password.value.length < 8) return invalid(form.password, 'Пароль должен быть не короче 8 символов');
    if (!reg && !form.password.value) return invalid(form.password, 'Введите пароль');
    if (reg && !form.consent.checked) {
      error.textContent = 'Нужно согласие на обработку персональных данных';
      return;
    }
    setBusy(btn, true);
    try {
      if (reg) {
        await api('POST', '/auth/register', {
          name: form.name.value,
          phone: form.phone.value,
          password: form.password.value,
          consent: true,
        });
      } else {
        await api('POST', '/auth/login', { phone: form.phone.value, password: form.password.value });
      }
      await loadDashboard();
      toast(reg ? 'Аккаунт создан. Добро пожаловать в Champions!' : 'С возвращением!');
    } catch (err) {
      error.textContent = err.message;
      setBusy(btn, false);
    }
  });
}

/* ================= Кабинет ================= */
async function loadDashboard() {
  const [me, history, forecast] = await Promise.all([
    api('GET', '/me'),
    api('GET', '/me/history?limit=40'),
    api('GET', '/occupancy/forecast').catch(() => null),
  ]);
  Object.assign(state, { me, history, forecast });
  renderDashboard();
  handleUrlActions();
}

async function refresh({ withHistory = true } = {}) {
  const [me, history] = await Promise.all([
    api('GET', '/me'),
    withHistory ? api('GET', '/me/history?limit=40') : Promise.resolve(state.history),
  ]);
  const changed = JSON.stringify([me, history]) !== JSON.stringify([state.me, state.history]);
  Object.assign(state, { me, history });
  if (changed) renderDashboard({ animate: false });
}

function renderDashboard({ animate = true } = {}) {
  const { user } = state.me;
  const today = capitalize(new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));
  app.innerHTML = `
    <section class="dash container">
      ${
        user.role === 'admin'
          ? `<div class="banner" style="margin-bottom:20px"><div><b>Вы вошли как администратор</b><span>Отмечайте посетителей на ресепшене</span></div>
             <a class="btn btn--gold btn--sm" href="/admin">Ресепшен</a></div>`
          : ''
      }
      <div class="dash__hello"><p class="eyebrow">${today}</p><h1>Привет, ${esc(firstName(user.name))}</h1></div>
      <div class="dash__grid">
        <div class="dash__col">
          ${walletCard()}
          ${statusBanner()}
          <div class="panel">${balancePanel()}</div>
          <a class="panel load" href="/#live" data-load aria-label="Загрузка зала"></a>
        </div>
        <div class="dash__col">
          <div class="panel">${ringsPanel()}</div>
          <div class="stats">${statsTiles()}</div>
          <div class="panel" data-history>${historyPanel()}</div>
          <div class="panel">${profilePanel()}</div>
        </div>
      </div>
    </section>`;
  bindDashboard();
  renderLoad();
  requestAnimationFrame(() => requestAnimationFrame(() => animateRings(animate)));
}

function planType(m) {
  if (m.unlimited) return 'Безлимит';
  if (m.visits > 0) return `${m.visits} ${visitsWord(m.visits)}`;
  return 'Нет абонемента';
}

function walletCard() {
  const { user, membership: m } = state.me;
  const variant = m.frozen ? 'wallet--frozen' : m.canEnter ? '' : 'wallet--muted';
  let meta = 'Пополните баланс, чтобы пройти в зал';
  if (m.frozen) meta = `Заморожен до ${fmtDay(m.frozen.until)}`;
  else if (m.unlimited) meta = `До ${fmtDay(m.unlimited.until)}${m.visits ? ` · +${m.visits} ${visitsWord(m.visits)}` : ''}`;
  else if (m.visits > 0) meta = 'Посещения на балансе';
  return `
    <div class="wallet-wrap">
      <button class="wallet ${variant}" type="button" data-action="pass" aria-label="Открыть QR-пропуск">
        <span class="wallet__top">
          <span class="wallet__emblem"></span>
          <span class="wallet__type">Абонемент<b>${planType(m)}</b></span>
        </span>
        <span class="wallet__bottom">
          <span>
            <span class="wallet__name">${esc(user.name)}</span>
            <span class="wallet__meta" style="display:block">${meta}</span>
            <span class="wallet__meta" style="display:block">GC · ${passLabel(user.passCode)}</span>
          </span>
          <span class="wallet__qr"><img src="/api/me/pass.svg?c=${user.passCode}" alt="" width="84" height="84"></span>
        </span>
      </button>
      <p class="wallet__hint">Нажмите на карту, чтобы открыть QR-пропуск</p>
    </div>`;
}

function statusBanner() {
  const { membership: m, inGym } = state.me;
  if (inGym) {
    const min = Math.max(1, Math.round((Date.now() - inGym.since) / 60000));
    return `<div class="banner"><div><b>Вы в зале</b><span>с ${fmtTime(inGym.since)} · ${fmtDuration(min)}</span></div>
      <button class="btn btn--dark btn--sm" type="button" data-action="checkout">Я ушёл</button></div>`;
  }
  if (m.frozen) {
    return `<div class="banner banner--frozen"><div><b>Абонемент заморожен</b><span>до ${fmtDay(m.frozen.until)} включительно</span></div>
      <button class="btn btn--dark btn--sm" type="button" data-action="unfreeze">Разморозить</button></div>`;
  }
  if (m.reason === 'no_balance') {
    return `<div class="banner banner--warn"><div><b>Нет посещений на балансе</b><span>Пополните, чтобы пройти в зал</span></div>
      <button class="btn btn--gold btn--sm" type="button" data-action="topup">Пополнить</button></div>`;
  }
  return '';
}

function balancePanel() {
  const m = state.me.membership;
  const unlimitedNote = m.unlimited
    ? `до ${fmtDay(m.unlimited.until)}`
    : m.unlimitedExpired
      ? `закончился ${fmtDay(m.unlimitedExpired)}`
      : 'не подключён';
  return `
    <div class="panel__head"><h2 class="panel__title">Баланс</h2>
      <span class="panel__sub">${m.canEnter ? 'Проход открыт' : m.frozen ? 'Пауза' : 'Нужно пополнить'}</span></div>
    <div class="balance">
      <div class="metric">
        <div class="metric__label">Безлимит</div>
        <div class="metric__value">${m.unlimited ? `${m.unlimited.daysLeft} <small>${daysWord(m.unlimited.daysLeft)}</small>` : '—'}</div>
        <div class="metric__note">${unlimitedNote}</div>
      </div>
      <div class="metric">
        <div class="metric__label">Посещения</div>
        <div class="metric__value">${m.visits}</div>
        <div class="metric__note">${visitsWord(m.visits)} на балансе</div>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn--gold" type="button" data-action="topup">Пополнить</button>
      ${
        m.frozen
          ? `<button class="btn btn--dark" type="button" data-action="unfreeze">Разморозить</button>`
          : m.unlimited
            ? `<button class="btn btn--dark" type="button" data-action="freeze" ${m.freezeDaysLeft ? '' : 'disabled'}>Заморозить</button>`
            : ''
      }
    </div>
    ${m.unlimited ? `<p class="panel__sub" style="margin:12px 0 0">Доступно дней заморозки: ${m.freezeDaysLeft}</p>` : ''}`;
}

function ringsData() {
  const { stats, user } = state.me;
  const goal = user.monthlyGoal;
  const weekGoal = Math.max(1, Math.round(goal / 4.3));
  return [
    { c: 'var(--gold)', bg: '#3a2f16', v: stats.monthVisits / goal },
    { c: 'var(--green)', bg: '#0e3a1c', v: stats.weekVisits / weekGoal },
    { c: '#64d2ff', bg: '#0b2f3d', v: stats.level.progress },
    { goal, weekGoal },
  ];
}

function ringsPanel() {
  const { stats } = state.me;
  const [a, b, c, { goal, weekGoal }] = ringsData();
  const month = MONTHS_IN[new Date().getMonth()];
  const ring = (r, w, d, i) => `
    <circle class="ring-bg" cx="70" cy="70" r="${r}" stroke="${d.c}" stroke-width="${w}"/>
    <circle class="ring" data-ring="${i}" cx="70" cy="70" r="${r}" stroke="${d.c}" stroke-width="${w}" pathLength="1"/>`;
  return `
    <div class="panel__head"><h2 class="panel__title">Активность</h2>
      <button class="btn btn--dark btn--sm" type="button" data-action="goal">Цель: ${goal}</button></div>
    <div class="rings">
      <svg viewBox="0 0 140 140" aria-hidden="true">${ring(60, 14, a, 0)}${ring(43, 14, b, 1)}${ring(26, 14, c, 2)}</svg>
      <div class="rings__legend">
        <div class="rings__item"><b><i style="--c:var(--gold)"></i>${stats.monthVisits} из ${goal}</b><span>${trainingsWord(goal)} в ${month}</span></div>
        <div class="rings__item"><b><i style="--c:var(--green)"></i>${stats.weekVisits} из ${weekGoal}</b><span>на этой неделе</span></div>
        <div class="rings__item"><b><i style="--c:#64d2ff"></i>${stats.level.name}</b>
          <span>${stats.level.next ? `ещё ${stats.level.toNext} до «${stats.level.next}»` : 'высший уровень'}</span></div>
      </div>
    </div>`;
}

function animateRings(animate) {
  const data = ringsData();
  $$('[data-ring]', app).forEach((c) => {
    const v = Math.min(1, data[c.dataset.ring].v);
    if (!animate) c.style.transition = 'none';
    c.style.strokeDasharray = `${Math.max(0.001, v)} 1`;
  });
}

function statsTiles() {
  const s = state.me.stats;
  const hours = Math.floor(s.totalMinutes / 60);
  const tiles = [
    ['chart', s.totalVisits, `${trainingsWord(s.totalVisits)} всего`],
    ['clock', hours ? `${hours} ч` : `${s.totalMinutes} мин`, 'в зале'],
    ['bolt', s.avgMinutes ? fmtDuration(s.avgMinutes) : '—', 'средняя тренировка'],
    ['flame', `${s.streakWeeks} нед.`, 'подряд без пропусков'],
  ];
  return tiles
    .map(([ic, v, l]) => `<div class="stat">${icon(ic)}<div class="stat__value">${v}</div><div class="stat__label">${l}</div></div>`)
    .join('');
}

function historyPanel() {
  const { visits, payments } = state.history;
  const tab = state.tab;
  let items;
  const list = tab === 'visits' ? visits : payments;
  const more = !state.showAll && list.length > HISTORY_PREVIEW;
  if (tab === 'visits') {
    items = visits.length
      ? visits
          .slice(0, state.showAll ? undefined : HISTORY_PREVIEW)
          .map(
            (v) => `
        <div class="list__item">
          <span class="list__icon">${icon(v.open ? 'bolt' : 'history')}</span>
          <span class="list__main"><b>${capitalize(fmtDateShort(v.checkedInAt))}</b>
            <span>${fmtTime(v.checkedInAt)} – ${v.open ? 'сейчас' : fmtTime(v.checkedOutAt)}</span></span>
          <span class="list__side">${fmtDuration(v.minutes)}
            <small>${v.open ? '<span class="badge badge--green">В зале</span>' : v.entryType === 'unlimited' ? 'Безлимит' : 'Посещение'}</small></span>
        </div>`
          )
          .join('')
      : '<p class="list__empty">Здесь появятся ваши тренировки. Покажите QR-код на входе — и первая уже в истории.</p>';
  } else {
    const how = { demo: 'Онлайн (демо)', yookassa: 'Онлайн', cash: 'Наличные', reception_card: 'Картой на ресепшене' };
    items = payments.length
      ? payments
          .slice(0, state.showAll ? undefined : HISTORY_PREVIEW)
          .map(
            (p) => `
        <div class="list__item">
          <span class="list__icon">${icon('wallet')}</span>
          <span class="list__main"><b>${esc(p.title)}</b><span>${capitalize(fmtDateShort(p.paidAt))} · ${how[p.provider] || p.provider}</span></span>
          <span class="list__side"><b>${rub(p.amount)}</b></span>
        </div>`
          )
          .join('')
      : '<p class="list__empty">Оплат пока не было.</p>';
  }
  return `
    <div class="panel__head"><h2 class="panel__title">История</h2>
      <div class="segmented" role="tablist" aria-label="История">
        <button type="button" role="tab" data-tab="visits" aria-selected="${tab === 'visits'}">Тренировки</button>
        <button type="button" role="tab" data-tab="payments" aria-selected="${tab === 'payments'}">Оплаты</button>
      </div></div>
    <div class="list">${items}</div>
    ${more ? `<button class="list__more" type="button" data-more>Показать все (${list.length})</button>` : ''}`;
}

function profilePanel() {
  const { user } = state.me;
  const row = (action, ic, title, sub, danger = false) => `
    <button class="list__item list__item--button${danger ? ' list__item--danger' : ''}" type="button" data-action="${action}">
      <span class="list__icon">${icon(ic)}</span>
      <span class="list__main"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</span>
      <span class="chev" aria-hidden="true"></span>
    </button>`;
  return `
    <div class="panel__head"><h2 class="panel__title">Профиль</h2></div>
    <div class="list">
      ${row('name', 'user', esc(user.name), 'Имя')}
      <div class="list__item"><span class="list__icon">${icon('phone')}</span>
        <span class="list__main"><b>${esc(user.phoneFormatted)}</b><span>Телефон</span></span></div>
      ${row('goal', 'target', `${user.monthlyGoal} ${trainingsWord(user.monthlyGoal)} в месяц`, 'Цель')}
      ${row('password', 'lock', 'Сменить пароль', '')}
      ${row('rotate', 'refresh', 'Обновить QR-код', 'Если код увидели посторонние')}
      ${row('logout', 'logout', 'Выйти', '', true)}
    </div>`;
}

function renderLoad() {
  const box = $('[data-load]', app);
  const s = state.occupancy;
  if (!box || !s) return;
  const f = state.forecast;
  const max = f && !f.closed ? Math.max(60, ...f.hours.map((h) => h.percent)) : 100;
  const spark =
    f && !f.closed
      ? `<span class="spark" aria-hidden="true">${f.hours
          .map((h) => `<i class="${h.now ? 'is-now' : ''}" style="height:${Math.max(6, (h.percent / max) * 100)}%"></i>`)
          .join('')}</span>`
      : '';
  const best = f?.bestWindow ? `Лучшее время сегодня: ${f.bestWindow.from}–${f.bestWindow.to}` : s.statusText;
  box.innerHTML = `
    <span class="load__num">${s.count}</span>
    <span class="load__text"><b><span class="dot" data-level="${s.open ? s.level : 'closed'}"></span>${s.open ? s.label : 'Зал закрыт'}</b>
      <span>${best}</span></span>
    ${spark}`;
}

function renderLiveChip() {
  const s = state.occupancy;
  const chip = $('[data-live-chip]');
  if (!chip || !s) return;
  chip.hidden = false;
  $('.dot', chip).dataset.level = s.open ? s.level : 'closed';
  $('[data-live-chip-text]', chip).textContent = s.open ? `${s.count} в зале` : 'Зал закрыт';
}

/* ================= Действия ================= */
function bindDashboard() {
  app.onclick = async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      state.showAll = false;
      $('[data-history]', app).innerHTML = historyPanel();
      return;
    }
    if (e.target.closest('[data-more]')) {
      state.showAll = true;
      $('[data-history]', app).innerHTML = historyPanel();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const actions = {
      pass: openPass,
      topup: () => openTopup(),
      freeze: openFreeze,
      unfreeze: () => unfreeze(btn),
      checkout: () => checkout(btn),
      goal: openGoal,
      name: openName,
      password: openPassword,
      rotate: openRotate,
      logout: () => logout(btn),
    };
    actions[btn.dataset.action]?.();
  };
}

function applyProfile(profile) {
  if (profile?.user) {
    state.me = { user: profile.user, membership: profile.membership, inGym: profile.inGym, stats: profile.stats };
  }
}

function openPass() {
  const { user, membership: m } = state.me;
  const status = m.canEnter
    ? '<span class="badge badge--green">Проход разрешён</span>'
    : m.frozen
      ? '<span class="badge badge--blue">Абонемент заморожен</span>'
      : '<span class="badge badge--red">Нет посещений на балансе</span>';
  openSheet({
    title: 'QR-пропуск',
    content: `
      <div class="pass-view">
        <div class="pass-view__qr"><img src="/api/me/pass.svg?c=${user.passCode}" alt="QR-код пропуска" width="268" height="268"></div>
        <div class="pass-view__code">GC · ${passLabel(user.passCode)}</div>
        <p class="pass-view__status">${status}</p>
        <p class="sheet__text" style="margin-top:14px">Покажите код администратору на входе. Совет: прибавьте яркость экрана.</p>
      </div>`,
  });
}

function planEffect(p) {
  const m = state.me.membership;
  if (p.visits) {
    return `На баланс добавится ${p.visits} ${visitsWord(p.visits)}. Сейчас на балансе: ${m.visits}.`;
  }
  const start = m.unlimited ? addDays(m.unlimited.until, 1) : localToday();
  const until = addDays(start, p.days - 1);
  return m.unlimited
    ? `Безлимит продлится до ${fmtDay(until)}. Дней заморозки: +${p.freezeDays}.`
    : `Безлимит на ${p.days} ${daysWord(p.days)} — до ${fmtDay(until)}. Дней заморозки: ${p.freezeDays}.`;
}

function openTopup(preselect) {
  const plans = state.config.plans;
  let selected = plans.find((p) => p.id === preselect)?.id || plans.find((p) => p.featured)?.id || plans[0].id;
  const sheet = openSheet({ title: 'Пополнить абонемент' });

  const online = Boolean(state.config.paymentProvider);
  const renderPlans = () => {
    const plan = plans.find((p) => p.id === selected);
    sheet.setTitle('Пополнить абонемент');
    sheet.setContent(`
      <div class="plan-options" role="radiogroup" aria-label="Абонемент">
        ${plans
          .map(
            (p) => `
          <button type="button" class="plan-option" role="radio" aria-checked="${p.id === selected}" data-plan="${p.id}">
            <span class="plan-option__radio"></span>
            <span class="plan-option__main"><b>${esc(p.title)}${p.featured ? '<span class="badge badge--gold">Популярный</span>' : ''}</b><span>${esc(p.subtitle)}</span></span>
            <span class="plan-option__price">${rub(p.price)}</span>
          </button>`
          )
          .join('')}
      </div>
      <p class="sheet__text" style="margin:16px 0 0">${planEffect(plan)}</p>
      ${
        online
          ? `<button class="btn btn--gold btn--block" type="button" style="margin-top:18px;height:52px" data-pay>Оплатить ${rub(plan.price)}</button>
             <p class="panel__sub" style="text-align:center;margin:12px 0 0">Можно оплатить и на ресепшене — наличными или картой.</p>`
          : `<p class="pay-note" style="margin-top:18px">${icon('wallet')}<span>Оплата — на ресепшене, наличными или картой. Назовите администратору номер телефона или покажите QR-код: «${esc(plan.title)}» появится в кабинете сразу после оплаты.</span></p>`
      }`);
    $$('[data-plan]', sheet.body).forEach((b) =>
      b.addEventListener('click', () => {
        selected = b.dataset.plan;
        renderPlans();
        $(`[data-plan="${selected}"]`, sheet.body).focus();
      })
    );
    $('[data-pay]', sheet.body)?.addEventListener('click', (e) => startPayment(plan, e.currentTarget));
  };

  const startPayment = async (plan, btn) => {
    setBusy(btn, true);
    try {
      const { payment, confirmation } = await api('POST', '/payments', { planId: plan.id });
      if (confirmation.type === 'redirect') {
        location.href = confirmation.url;
        return;
      }
      renderCard(plan, payment);
    } catch (err) {
      toast(err.message, { error: true });
      setBusy(btn, false);
    }
  };

  const renderCard = (plan, payment) => {
    sheet.setTitle('Оплата картой');
    sheet.setContent(`
      <div class="card-form">
        <div class="card-preview" aria-hidden="true">
          <div class="card-preview__chip"></div>
          <div class="card-preview__num" data-num>4242 4242 4242 4242</div>
          <div class="card-preview__exp" data-exp>12/28</div>
        </div>
        <div class="field"><label for="c-num">Номер карты</label>
          <input class="input" id="c-num" inputmode="numeric" autocomplete="off" value="4242 4242 4242 4242" maxlength="19"></div>
        <div class="card-form__row">
          <div class="field"><label for="c-exp">Срок</label><input class="input" id="c-exp" inputmode="numeric" autocomplete="off" value="12/28" maxlength="5"></div>
          <div class="field"><label for="c-cvc">CVC</label><input class="input" id="c-cvc" type="password" inputmode="numeric" autocomplete="off" value="123" maxlength="3"></div>
        </div>
        <p class="pay-note">${icon('lock')}<span>Демо-оплата: деньги не списываются, данные карты никуда не отправляются. Для реальных платежей подключается ЮKassa.</span></p>
        <div class="pay-summary"><span>${esc(plan.title)} · ${esc(plan.subtitle)}</span><b>${rub(plan.price)}</b></div>
        <button class="btn btn--gold btn--block" type="button" style="height:52px" data-confirm>Оплатить ${rub(plan.price)}</button>
        <button class="btn btn--ghost btn--block" type="button" data-back>Назад</button>
      </div>`);
    const num = $('#c-num', sheet.body);
    num.addEventListener('input', () => {
      num.value = num.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
      $('[data-num]', sheet.body).textContent = num.value || '•••• •••• •••• ••••';
    });
    $('#c-exp', sheet.body).addEventListener('input', (e) => {
      const d = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
      $('[data-exp]', sheet.body).textContent = e.target.value || 'ММ/ГГ';
    });
    $('[data-back]', sheet.body).addEventListener('click', renderPlans);
    $('[data-confirm]', sheet.body).addEventListener('click', () => confirmDemo(plan, payment));
  };

  const confirmDemo = async (plan, payment) => {
    sheet.setContent('<div class="processing"><span class="spinner"></span><p>Проводим оплату…</p></div>');
    try {
      const [res] = await Promise.all([
        api('POST', `/payments/${payment.id}/confirm`),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
      applyProfile(res);
      state.history = await api('GET', '/me/history?limit=40');
      renderDashboard({ animate: true });
      renderSuccess(sheet, plan);
    } catch (err) {
      toast(err.message, { error: true });
      renderPlans();
    }
  };

  renderPlans();
}

function renderSuccess(sheet, plan) {
  const m = state.me.membership;
  const detail = plan.visits
    ? `На балансе ${m.visits} ${visitsWord(m.visits)}.`
    : m.unlimited
      ? `Безлимит действует до ${fmtDay(m.unlimited.until)}.`
      : '';
  sheet.setTitle('Готово');
  sheet.setContent(`
    <div class="success">
      ${successMark()}
      <h3>Оплачено</h3>
      <p>«${esc(plan.title)}» уже в вашем кабинете. ${detail}<br>Покажите QR-код на входе.</p>
      <button class="btn btn--gold btn--block" type="button" data-done>Отлично</button>
    </div>`);
  $('[data-done]', sheet.body).addEventListener('click', sheet.close);
}

function openFreeze() {
  const m = state.me.membership;
  const maxDays = m.freezeDaysLeft;
  let days = Math.min(7, maxDays);
  const sheet = openSheet({ title: 'Заморозка абонемента' });
  const render = () => {
    const until = addDays(localToday(), days - 1);
    const newEnd = addDays(m.unlimited.until, days);
    sheet.setContent(`
      <p class="sheet__text">Безлимит встанет на паузу, а срок действия продлится на столько же дней. Разморозить можно в любой момент — неиспользованные дни вернутся.</p>
      <div class="stepper">
        <button type="button" data-dec aria-label="Меньше" ${days <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
        <div class="stepper__value"><b>${days}</b><span>${daysWord(days)}</span></div>
        <button type="button" data-inc aria-label="Больше" ${days >= maxDays ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
      <p class="sheet__text" style="text-align:center">Пауза до ${fmtDay(until)} · абонемент продлится до ${fmtDay(newEnd)}</p>
      <button class="btn btn--gold btn--block" type="button" style="height:52px" data-go>Заморозить на ${days} ${daysWord(days)}</button>`);
    $('[data-dec]', sheet.body).addEventListener('click', () => {
      days = Math.max(1, days - 1);
      render();
    });
    $('[data-inc]', sheet.body).addEventListener('click', () => {
      days = Math.min(maxDays, days + 1);
      render();
    });
    $('[data-go]', sheet.body).addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true);
      try {
        applyProfile(await api('POST', '/me/freeze', { days }));
        renderDashboard({ animate: false });
        sheet.close();
        toast(`Абонемент заморожен на ${days} ${daysWord(days)}`);
      } catch (err) {
        toast(err.message, { error: true });
        setBusy(e.currentTarget, false);
      }
    });
  };
  render();
}

async function unfreeze(btn) {
  setBusy(btn, true);
  try {
    applyProfile(await api('POST', '/me/unfreeze'));
    renderDashboard({ animate: false });
    toast('Абонемент разморожен — ждём вас в зале!');
  } catch (err) {
    toast(err.message, { error: true });
    setBusy(btn, false);
  }
}

async function checkout(btn) {
  const since = state.me.inGym?.since;
  setBusy(btn, true);
  try {
    applyProfile(await api('POST', '/me/checkout'));
    state.history = await api('GET', '/me/history?limit=40');
    renderDashboard({ animate: false });
    const min = since ? Math.max(1, Math.round((Date.now() - since) / 60000)) : 0;
    toast(min ? `Отличная работа! Тренировка: ${fmtDuration(min)}` : 'Выход отмечен');
  } catch (err) {
    toast(err.message, { error: true });
    setBusy(btn, false);
  }
}

function openGoal() {
  let goal = state.me.user.monthlyGoal;
  const sheet = openSheet({ title: 'Цель на месяц' });
  const render = () => {
    sheet.setContent(`
      <p class="sheet__text">Сколько тренировок в месяц вы планируете? Цель задаёт кольца активности.</p>
      <div class="stepper">
        <button type="button" data-dec aria-label="Меньше" ${goal <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
        <div class="stepper__value"><b>${goal}</b><span>${trainingsWord(goal)}</span></div>
        <button type="button" data-inc aria-label="Больше" ${goal >= 31 ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
      <p class="sheet__text" style="text-align:center">≈ ${Math.max(1, Math.round(goal / 4.3))} в неделю</p>
      <button class="btn btn--gold btn--block" type="button" style="height:52px" data-go>Сохранить</button>`);
    $('[data-dec]', sheet.body).addEventListener('click', () => {
      goal = Math.max(1, goal - 1);
      render();
    });
    $('[data-inc]', sheet.body).addEventListener('click', () => {
      goal = Math.min(31, goal + 1);
      render();
    });
    $('[data-go]', sheet.body).addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true);
      try {
        applyProfile(await api('PATCH', '/me', { monthlyGoal: goal }));
        renderDashboard();
        sheet.close();
      } catch (err) {
        toast(err.message, { error: true });
        setBusy(e.currentTarget, false);
      }
    });
  };
  render();
}

function openName() {
  const sheet = openSheet({
    title: 'Имя',
    content: `
      <form class="form" novalidate>
        <div class="field"><label for="p-name">Как к вам обращаться</label>
          <input class="input" id="p-name" name="name" maxlength="60" autocomplete="name" value="${esc(state.me.user.name)}" autofocus></div>
        <p class="form__error" role="alert"></p>
        <button class="btn btn--gold btn--block" type="submit">Сохранить</button>
      </form>`,
  });
  const form = $('form', sheet.body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    setBusy(btn, true);
    try {
      applyProfile(await api('PATCH', '/me', { name: form.name.value }));
      renderDashboard({ animate: false });
      sheet.close();
    } catch (err) {
      $('.form__error', form).textContent = err.message;
      setBusy(btn, false);
    }
  });
}

function openPassword() {
  const sheet = openSheet({
    title: 'Смена пароля',
    content: `
      <form class="form" novalidate>
        <div class="field"><label for="p-cur">Текущий пароль</label>
          <input class="input" id="p-cur" name="current" type="password" autocomplete="current-password" autofocus></div>
        <div class="field"><label for="p-new">Новый пароль</label>
          <input class="input" id="p-new" name="next" type="password" autocomplete="new-password" placeholder="Не короче 8 символов"></div>
        <p class="form__error" role="alert"></p>
        <button class="btn btn--gold btn--block" type="submit">Сменить пароль</button>
        <p class="panel__sub" style="margin:0">После смены пароля выйдем из аккаунта на других устройствах.</p>
      </form>`,
  });
  const form = $('form', sheet.body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    if (form.next.value.length < 8) {
      $('.form__error', form).textContent = 'Новый пароль должен быть не короче 8 символов';
      return;
    }
    setBusy(btn, true);
    try {
      await api('POST', '/me/password', { current: form.current.value, next: form.next.value });
      sheet.close();
      toast('Пароль изменён');
    } catch (err) {
      $('.form__error', form).textContent = err.message;
      setBusy(btn, false);
    }
  });
}

function openRotate() {
  const sheet = openSheet({
    title: 'Обновить QR-код',
    content: `
      <p class="sheet__text">Старый код перестанет работать, а новый появится в кабинете сразу. Сделайте это, если скриншот вашего пропуска мог попасть к посторонним.</p>
      <button class="btn btn--gold btn--block" type="button" style="height:52px" data-go>Обновить код</button>`,
  });
  $('[data-go]', sheet.body).addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true);
    try {
      applyProfile(await api('POST', '/me/pass/rotate'));
      renderDashboard({ animate: false });
      sheet.close();
      toast('QR-код обновлён');
    } catch (err) {
      toast(err.message, { error: true });
      setBusy(e.currentTarget, false);
    }
  });
}

async function logout(btn) {
  setBusy(btn, true);
  await api('POST', '/auth/logout').catch(() => null);
  state.me = null;
  renderAuth('login');
  toast('Вы вышли из кабинета');
}

/* ================= Параметры адреса ================= */
async function handleUrlActions() {
  const buy = params.get('buy');
  const paymentId = params.get('payment');
  if (buy) {
    params.delete('buy');
    cleanUrl();
    openTopup(buy);
  }
  if (paymentId) {
    params.delete('payment');
    cleanUrl();
    // возврат со страницы оплаты ЮKassa: ждём подтверждения платежа
    const sheet = openSheet({ title: 'Оплата', content: '<div class="processing"><span class="spinner"></span><p>Проверяем оплату…</p></div>' });
    for (let i = 0; i < 15; i++) {
      try {
        const { payment } = await api('GET', `/payments/${paymentId}`);
        if (payment.status === 'succeeded') {
          await refresh();
          const plan = state.config.plans.find((p) => p.id === payment.planId) || { title: payment.title };
          renderSuccess(sheet, plan);
          return;
        }
        if (payment.status === 'canceled') {
          sheet.setContent('<p class="sheet__text">Платёж отменён. Деньги не списаны — можно попробовать ещё раз.</p>');
          return;
        }
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    sheet.setContent('<p class="sheet__text">Платёж ещё обрабатывается. Абонемент появится в кабинете автоматически, как только банк подтвердит оплату.</p>');
  }
}

/* ================= Старт ================= */
async function init() {
  try {
    state.config = await api('GET', '/config');
    const { user } = await api('GET', '/auth/session');
    if (user) await loadDashboard();
    else renderAuth();
  } catch {
    app.innerHTML = `<div class="app-loading"><p>Не удалось загрузить кабинет. <a class="link" href="">Обновить страницу</a></p></div>`;
    return;
  }
  connectOccupancy((s) => {
    state.occupancy = s;
    renderLiveChip();
    renderLoad();
  });
  // Отметки ресепшена (вход/выход, пополнение) появляются без перезагрузки страницы.
  setInterval(() => {
    if (state.me && !document.hidden && !document.querySelector('.sheet-backdrop')) refresh().catch(() => null);
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (state.me && !document.hidden) refresh().catch(() => null);
  });
}

init();
