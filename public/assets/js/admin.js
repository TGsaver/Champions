// Ресепшен: вход по QR-коду или телефону, кто в зале, гости, клиенты, пополнение на месте.
import { connectOccupancy, LEVEL_COLORS, peopleWord } from './live.js';
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
  toast,
} from './ui.js';

const app = $('#app');
const state = { config: null, user: null, overview: null, members: [], query: '', result: null };
const visitsWord = (n) => plural(n, ['посещение', 'посещения', 'посещений']);
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const minutesSince = (ms) => Math.max(0, Math.round((Date.now() - ms) / 60000));
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ================= Вход ================= */
function renderLogin(message = '') {
  const demo = state.config.demoAccounts?.admin;
  app.innerHTML = `
    <section class="auth container">
      <div class="auth__emblem emblem-gold" role="img" aria-label="Gym Champions"></div>
      <h1>Ресепшен</h1>
      <p class="auth__lead">Вход для администраторов зала.</p>
      <form class="form" id="login" novalidate>
        <div class="field"><label for="a-phone">Телефон</label>
          <input class="input" id="a-phone" name="phone" type="tel" inputmode="tel" autocomplete="username" placeholder="+7 (900) 000-00-00"></div>
        <div class="field"><label for="a-pass">Пароль</label>
          <input class="input" id="a-pass" name="password" type="password" autocomplete="current-password"></div>
        <p class="form__error" role="alert">${esc(message)}</p>
        <button class="btn btn--gold btn--block" type="submit">Войти</button>
      </form>
      ${
        demo
          ? `<div class="demo-box"><b>Демо-режим.</b>
              <div class="demo-row"><span>Администратор: <code>${esc(demo.phone)}</code> / <code>${esc(demo.password)}</code></span>
              <button class="btn btn--dark btn--sm" type="button" data-demo>Войти</button></div></div>`
          : ''
      }
    </section>`;
  const form = $('#login');
  bindPhoneInput(form.phone);
  form.phone.focus();
  $('[data-demo]')?.addEventListener('click', () => {
    form.phone.value = demo.phone;
    form.password.value = demo.password;
    form.requestSubmit();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    setBusy(btn, true);
    try {
      const { user } = await api('POST', '/auth/login', { phone: form.phone.value, password: form.password.value });
      state.user = user;
      if (user.role !== 'admin') return renderNoAccess();
      await start();
    } catch (err) {
      $('.form__error', form).textContent = err.message;
      setBusy(btn, false);
    }
  });
}

function renderNoAccess() {
  app.innerHTML = `
    <section class="auth container">
      <h1>Нет доступа</h1>
      <p class="auth__lead">Этот раздел — для администраторов зала. Вы вошли как ${esc(state.user.name)}.</p>
      <div class="actions" style="justify-content:center">
        <a class="btn btn--gold" href="/account">Личный кабинет</a>
        <button class="btn btn--dark" type="button" data-logout>Выйти</button>
      </div>
    </section>`;
  $('[data-logout]').addEventListener('click', logout);
}

async function logout() {
  await api('POST', '/auth/logout').catch(() => null);
  state.user = null;
  renderLogin();
}

/* ================= Панель ================= */
async function start() {
  await Promise.all([loadOverview(), loadMembers()]);
  renderShell();
  renderAll();
  $('#scan-input')?.focus();
}

async function loadOverview() {
  state.overview = await api('GET', '/admin/overview');
}

async function loadMembers(q = state.query) {
  state.query = q;
  const { members } = await api('GET', `/admin/members?q=${encodeURIComponent(q)}`);
  state.members = members;
}

function renderShell() {
  const now = capitalize(new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()));
  const hasCamera = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  app.innerHTML = `
    <section class="container">
      <div class="admin__head">
        <div><h1>Ресепшен</h1><p>${now} · ${esc(state.user.name)}</p></div>
        <div class="actions">
          <a class="btn btn--dark btn--sm" href="/" target="_blank">Сайт</a>
          <button class="btn btn--dark btn--sm" type="button" data-logout>Выйти</button>
        </div>
      </div>

      <div class="kpis" data-kpis></div>

      <div class="admin__grid">
        <div class="dash__col">
          <div class="panel">
            <div class="panel__head"><h2 class="panel__title">Вход в зал</h2><span class="panel__sub">QR-код или телефон</span></div>
            <form class="scan-form" id="scan" autocomplete="off">
              <input class="input" id="scan-input" name="code" placeholder="Сканируйте QR или введите телефон" aria-label="QR-код или телефон клиента" autocomplete="off">
              ${hasCamera ? `<button class="icon-btn" type="button" data-camera aria-label="Сканировать камерой">${icon('camera')}</button>` : ''}
              <button class="btn btn--gold" type="submit">Впустить</button>
            </form>
            <p class="scan-hint">Сканер QR-кодов работает как клавиатура: наведите его на пропуск в телефоне клиента — вход отметится сам.</p>
            <div data-result></div>
          </div>

          <div class="panel">
            <div class="panel__head"><h2 class="panel__title">Сейчас в зале</h2><span class="panel__sub" data-ingym-count></span></div>
            <div class="list" data-ingym></div>
          </div>
        </div>

        <div class="dash__col">
          <div class="panel guests">
            <div><h2 class="panel__title">Гости без аккаунта</h2><span class="panel__sub">Разовый вход за наличные — учитываются в загрузке</span></div>
            <div class="stepper">
              <button type="button" data-guest="remove" aria-label="Гость ушёл">${icon('minus')}</button>
              <div class="stepper__value" style="min-width:56px"><b data-guests>0</b></div>
              <button type="button" data-guest="add" aria-label="Пришёл гость">${icon('plus')}</button>
            </div>
          </div>

          <div class="panel">
            <div class="panel__head"><h2 class="panel__title">Клиенты</h2>
              <button class="btn btn--dark btn--sm" type="button" data-new-member>${icon('plus')} Новый</button></div>
            <form class="members-search" id="search" role="search">
              <input class="input" name="q" placeholder="Имя, телефон или код" value="${esc(state.query)}" aria-label="Поиск клиента">
            </form>
            <div class="list" data-members></div>
          </div>

          <div class="panel">
            <div class="panel__head"><h2 class="panel__title">Вместимость зала</h2></div>
            <form class="capacity" id="capacity">
              <input class="input" name="capacity" type="number" min="5" max="1000" inputmode="numeric" aria-label="Вместимость, человек">
              <span class="panel__sub">человек — 100% загрузки на сайте</span>
              <button class="btn btn--dark btn--sm" type="submit" style="margin-left:auto">Сохранить</button>
            </form>
          </div>
        </div>
      </div>
    </section>`;
  bindShell();
}

function renderAll() {
  renderKpis();
  renderInGym();
  renderMembers();
  const cap = $('#capacity')?.capacity;
  if (cap && document.activeElement !== cap) cap.value = state.overview.occupancy.capacity;
}

function renderKpis() {
  const { occupancy: o, today } = state.overview;
  const level = o.open ? o.level : 'closed';
  $('[data-kpis]').innerHTML = `
    <div class="kpi kpi--live">
      <div><div class="kpi__label">Сейчас в зале</div><div class="kpi__value">${o.count}<small> / ${o.capacity}</small></div></div>
      <div style="flex:1;min-width:0">
        <div class="kpi__status"><span class="dot" data-level="${level}"></span>${o.open ? o.label : 'Закрыто'} · ${o.percent}%</div>
        <div class="kpi-bar"><i style="width:${o.percent}%;--c:${LEVEL_COLORS[level]}"></i></div>
        ${o.demo && o.breakdown.simulated ? `<div class="panel__sub" style="margin-top:6px">из них ${o.breakdown.simulated} — демо-симуляция</div>` : ''}
      </div>
    </div>
    <div class="kpi"><div class="kpi__label">Визитов сегодня</div><div class="kpi__value">${today.visits}</div></div>
    <div class="kpi"><div class="kpi__label">Гостей сегодня</div><div class="kpi__value">${today.guests}</div></div>
    <div class="kpi"><div class="kpi__label">Оплаты сегодня</div><div class="kpi__value">${rub(today.revenue)}</div></div>
    <div class="kpi"><div class="kpi__label">Новых клиентов</div><div class="kpi__value">${today.newMembers}</div></div>`;
  $('[data-guests]').textContent = state.overview.occupancy.breakdown.guests;
}

function renderInGym() {
  const list = state.overview.inGym;
  $('[data-ingym-count]').textContent = list.length ? `${list.length} ${peopleWord(list.length)} отмечено` : '';
  $('[data-ingym]').innerHTML = list.length
    ? list
        .map(
          (v) => `
      <div class="list__item">
        <span class="avatar avatar--sm ${v.user ? '' : 'avatar--guest'}">${v.user ? esc(initial(v.user.name)) : 'Г'}</span>
        <span class="list__main"><b>${v.user ? esc(v.user.name) : 'Гость без аккаунта'}</b>
          <span>с ${fmtTime(v.since)} · ${fmtDuration(minutesSince(v.since))}${v.entryType === 'unlimited' ? ' · безлимит' : ''}</span></span>
        <button class="btn btn--dark btn--sm" type="button" data-checkout="${v.visitId}">Выход</button>
      </div>`
        )
        .join('')
    : '<p class="list__empty">Пока никого не отметили. Отсканируйте QR-код клиента на входе.</p>';
}

function statusBadge(m) {
  if (m.frozen) return `<span class="badge badge--blue">Заморожен до ${fmtDay(m.frozen.until)}</span>`;
  if (m.unlimited) return `<span class="badge badge--gold">Безлимит до ${fmtDay(m.unlimited.until)}</span>`;
  if (m.visits > 0) return `<span class="badge badge--green">${m.visits} ${visitsWord(m.visits)}</span>`;
  return '<span class="badge badge--red">Нет посещений</span>';
}

function renderMembers() {
  $('[data-members]').innerHTML = state.members.length
    ? state.members
        .map(
          (m) => `
      <button class="list__item list__item--button" type="button" data-member="${m.id}">
        <span class="avatar avatar--sm">${esc(initial(m.name))}</span>
        <span class="list__main"><b>${esc(m.name)}${m.inGym ? ' <span class="badge badge--green">в зале</span>' : ''}</b>
          <span>${esc(m.phoneFormatted)}</span></span>
        <span class="list__side">${statusBadge(m.membership)}</span>
      </button>`
        )
        .join('')
    : `<p class="list__empty">${state.query ? 'Никого не нашли' : 'Клиентов пока нет'}</p>`;
}

/* ================= Результат отметки ================= */
function renderResult({ kind, message, member }) {
  const box = $('[data-result]');
  if (!member) {
    box.innerHTML = `<div class="result result--${kind}"><p class="result__msg" style="margin:0">${esc(message)}</p></div>`;
    return;
  }
  const m = member.membership;
  const actions = [];
  if (member.inGym) actions.push(`<button class="btn btn--dark btn--sm" type="button" data-checkout="${member.inGym.visitId}">Отметить выход</button>`);
  else if (m.frozen) actions.push(`<button class="btn btn--gold btn--sm" type="button" data-checkin="${member.id}" data-unfreeze>Разморозить и впустить</button>`);
  else if (m.canEnter && kind !== 'ok') actions.push(`<button class="btn btn--gold btn--sm" type="button" data-checkin="${member.id}">Впустить</button>`);
  actions.push(`<button class="btn btn--dark btn--sm" type="button" data-topup="${member.id}">Пополнить</button>`);
  actions.push(`<button class="btn btn--ghost btn--sm" type="button" data-member="${member.id}">Карточка</button>`);
  box.innerHTML = `
    <div class="result result--${kind}">
      <div class="result__top">
        <span class="avatar">${esc(initial(member.name))}</span>
        <div><div class="result__name">${esc(member.name)}</div><div class="result__phone">${esc(member.phoneFormatted)}</div></div>
      </div>
      <p class="result__msg">${esc(message)}</p>
      <div class="result__meta">${statusBadge(m)}${m.unlimited && m.visits ? `<span class="badge">+${m.visits} ${visitsWord(m.visits)}</span>` : ''}</div>
      <div class="actions">${actions.join('')}</div>
    </div>`;
}

async function checkin(payload) {
  try {
    const res = await api('POST', '/admin/checkin', payload);
    const m = res.member.membership;
    const what =
      res.entryType === 'unlimited'
        ? `безлимит до ${fmtDay(m.unlimited.until)}`
        : `списано 1 посещение, осталось ${m.visits}`;
    renderResult({ kind: 'ok', message: `Вход отмечен — ${what}`, member: res.member });
    $('[data-result] .result')?.classList.add('flash-ok');
    await refreshData();
  } catch (err) {
    const member = err.data?.member;
    const messages = {
      no_balance: 'Нет посещений на балансе — предложите пополнить',
      frozen: err.message,
      already_in: 'Уже в зале',
      not_found: 'Клиент не найден. Проверьте код или найдите по телефону',
    };
    if (err.code === 'already_in' && member?.inGym) {
      renderResult({ kind: 'info', message: `Уже в зале с ${fmtTime(member.inGym.since)}`, member });
    } else {
      renderResult({ kind: 'error', message: messages[err.code] || err.message, member });
    }
  }
}

async function checkout(visitId) {
  try {
    await api('POST', '/admin/checkout', { visitId: Number(visitId) });
    toast('Выход отмечен');
    const box = $('[data-result]');
    if (box.querySelector(`[data-checkout="${visitId}"]`)) box.innerHTML = '';
    await refreshData();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function refreshData() {
  await Promise.all([loadOverview(), loadMembers()]);
  renderAll();
}

/* ================= Листы ================= */
async function openMember(id) {
  const sheet = openSheet({ title: 'Клиент', content: '<div class="processing"><span class="spinner"></span></div>' });
  const render = async () => {
    const { member, stats, history } = await api('GET', `/admin/members/${id}`);
    const m = member.membership;
    sheet.setTitle('Карточка клиента');
    sheet.setContent(`
      <div class="result__top" style="margin-bottom:14px">
        <span class="avatar">${esc(initial(member.name))}</span>
        <div><div class="result__name">${esc(member.name)}</div><div class="result__phone">${esc(member.phoneFormatted)} · код ${esc(member.passCode)}</div></div>
      </div>
      <div class="result__meta" style="margin:0 0 16px">${statusBadge(m)}${m.unlimited && m.visits ? `<span class="badge">+${m.visits} ${visitsWord(m.visits)}</span>` : ''}
        ${member.inGym ? `<span class="badge badge--green">в зале с ${fmtTime(member.inGym.since)}</span>` : ''}</div>
      <div class="balance" style="margin-bottom:16px">
        <div class="metric"><div class="metric__label">Тренировок</div><div class="metric__value">${stats.totalVisits}</div><div class="metric__note">${stats.monthVisits} в этом месяце</div></div>
        <div class="metric"><div class="metric__label">Уровень</div><div class="metric__value" style="font-size:22px">${stats.level.name}</div><div class="metric__note">серия ${stats.streakWeeks} нед.</div></div>
      </div>
      <div class="actions" style="margin:0 0 18px">
        ${
          member.inGym
            ? `<button class="btn btn--dark" type="button" data-s-checkout="${member.inGym.visitId}">Отметить выход</button>`
            : `<button class="btn btn--gold" type="button" data-s-checkin ${m.canEnter || m.frozen ? '' : 'disabled'}>${m.frozen ? 'Разморозить и впустить' : 'Впустить'}</button>`
        }
        <button class="btn btn--dark" type="button" data-s-topup>Пополнить</button>
      </div>
      <h3 class="panel__title" style="font-size:17px;margin-bottom:6px">Последние визиты</h3>
      <div class="list">${
        history.visits.length
          ? history.visits
              .slice(0, 6)
              .map(
                (v) => `<div class="list__item"><span class="list__main"><b>${capitalize(fmtDateShort(v.checkedInAt))}</b>
                  <span>${fmtTime(v.checkedInAt)} – ${v.open ? 'сейчас' : fmtTime(v.checkedOutAt)}</span></span>
                  <span class="list__side">${fmtDuration(v.minutes)}</span></div>`
              )
              .join('')
          : '<p class="list__empty">Визитов пока нет</p>'
      }</div>`);
    $('[data-s-checkin]', sheet.body)?.addEventListener('click', async () => {
      sheet.close();
      await checkin({ userId: member.id, unfreeze: Boolean(m.frozen) });
    });
    $('[data-s-checkout]', sheet.body)?.addEventListener('click', async (e) => {
      sheet.close();
      await checkout(e.currentTarget.dataset.sCheckout);
    });
    $('[data-s-topup]', sheet.body).addEventListener('click', () => {
      sheet.close();
      openTopup(member.id, member.name);
    });
  };
  try {
    await render();
  } catch (err) {
    sheet.setContent(`<p class="sheet__text">${esc(err.message)}</p>`);
  }
}

function openTopup(memberId, name) {
  const plans = state.config.plans;
  let selected = plans.find((p) => p.featured)?.id || plans[0].id;
  let method = 'cash';
  const sheet = openSheet({ title: `Пополнение · ${name}` });
  const render = () => {
    const plan = plans.find((p) => p.id === selected);
    sheet.setContent(`
      <div class="plan-options" role="radiogroup" aria-label="Абонемент">
        ${plans
          .map(
            (p) => `<button type="button" class="plan-option" role="radio" aria-checked="${p.id === selected}" data-plan="${p.id}">
              <span class="plan-option__radio"></span>
              <span class="plan-option__main"><b>${esc(p.title)}</b><span>${esc(p.subtitle)}</span></span>
              <span class="plan-option__price">${rub(p.price)}</span></button>`
          )
          .join('')}
      </div>
      <div class="segmented" role="tablist" aria-label="Способ оплаты" style="display:flex;margin:16px 0 0">
        <button type="button" role="tab" style="flex:1" data-method="cash" aria-selected="${method === 'cash'}">Наличные</button>
        <button type="button" role="tab" style="flex:1" data-method="card" aria-selected="${method === 'card'}">Карта (терминал)</button>
      </div>
      <button class="btn btn--gold btn--block" type="button" style="margin-top:16px;height:52px" data-go>Принять ${rub(plan.price)}</button>`);
    $$('[data-plan]', sheet.body).forEach((b) =>
      b.addEventListener('click', () => {
        selected = b.dataset.plan;
        render();
      })
    );
    $$('[data-method]', sheet.body).forEach((b) =>
      b.addEventListener('click', () => {
        method = b.dataset.method;
        render();
      })
    );
    $('[data-go]', sheet.body).addEventListener('click', async (e) => {
      setBusy(e.currentTarget, true);
      try {
        const { member } = await api('POST', `/admin/members/${memberId}/topup`, { planId: selected, method });
        sheet.close();
        toast(`Оплата принята: «${plan.title}», ${rub(plan.price)}`);
        renderResult({ kind: 'ok', message: 'Абонемент пополнен', member });
        await refreshData();
      } catch (err) {
        toast(err.message, { error: true });
        setBusy(e.currentTarget, false);
      }
    });
  };
  render();
}

function openNewMember() {
  const sheet = openSheet({
    title: 'Новый клиент',
    content: `
      <form class="form" novalidate>
        <div class="field"><label for="n-name">Имя</label><input class="input" id="n-name" name="name" maxlength="60" autofocus></div>
        <div class="field"><label for="n-phone">Телефон</label><input class="input" id="n-phone" name="phone" type="tel" inputmode="tel" placeholder="+7 (900) 000-00-00"></div>
        <p class="form__error" role="alert"></p>
        <button class="btn btn--gold btn--block" type="submit">Создать</button>
        <p class="panel__sub" style="margin:0">Клиент получит временный пароль и сможет войти в личный кабинет по номеру телефона.</p>
      </form>`,
  });
  const form = $('form', sheet.body);
  bindPhoneInput(form.phone);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', form);
    setBusy(btn, true);
    try {
      const { member, tempPassword } = await api('POST', '/admin/members', { name: form.name.value, phone: form.phone.value });
      sheet.setTitle('Клиент создан');
      sheet.setContent(`
        <p class="sheet__text">${esc(member.name)}, ${esc(member.phoneFormatted)}. Передайте клиенту временный пароль — его можно сменить в личном кабинете.</p>
        <div class="temp-pass"><span class="panel__sub">Временный пароль</span><b>${esc(tempPassword)}</b></div>
        <button class="btn btn--gold btn--block" type="button" data-topup-new>Пополнить абонемент</button>
        <button class="btn btn--ghost btn--block" type="button" style="margin-top:10px" data-close>Готово</button>`);
      $('[data-topup-new]', sheet.body).addEventListener('click', () => {
        sheet.close();
        openTopup(member.id, member.name);
      });
      $('[data-close]', sheet.body).addEventListener('click', sheet.close);
      await refreshData();
    } catch (err) {
      $('.form__error', form).textContent = err.message;
      setBusy(btn, false);
    }
  });
}

async function openCamera() {
  const sheet = openSheet({
    title: 'Сканирование QR',
    content: `<div class="camera"><video playsinline muted></video></div>
      <p class="sheet__text" style="margin-top:14px;text-align:center">Наведите камеру на QR-код в телефоне клиента.</p>`,
    onClose: () => stop(),
  });
  let stream;
  let timer;
  const stop = () => {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('video', sheet.body);
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    timer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue;
        if (value) {
          sheet.close();
          await checkin({ code: value });
        }
      } catch {
        /* кадр не распознан */
      }
    }, 350);
  } catch {
    sheet.setContent('<p class="sheet__text">Нет доступа к камере. Разрешите доступ в настройках браузера или используйте сканер.</p>');
  }
}

/* ================= События ================= */
function bindShell() {
  $('[data-logout]').addEventListener('click', logout);

  const scan = $('#scan');
  scan.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = scan.code.value.trim();
    if (!code) return;
    const btn = $('button[type=submit]', scan);
    setBusy(btn, true);
    await checkin({ code });
    setBusy(btn, false);
    scan.code.value = '';
    scan.code.focus();
  });
  $('[data-camera]')?.addEventListener('click', openCamera);

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      await loadMembers(e.target.value.trim());
      renderMembers();
    }, 250);
  });
  $('#search').addEventListener('submit', (e) => e.preventDefault());

  $('#capacity').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    setBusy(btn, true);
    try {
      state.overview = await api('PUT', '/admin/settings', { capacity: Number(e.target.capacity.value) });
      renderKpis();
      toast('Вместимость сохранена');
    } catch (err) {
      toast(err.message, { error: true });
    }
    setBusy(btn, false);
  });

  app.onclick = async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.guest) {
      try {
        state.overview = await api('POST', '/admin/guests', { action: t.dataset.guest });
        renderKpis();
        renderInGym();
      } catch (err) {
        toast(err.message, { error: true });
      }
    } else if (t.dataset.checkout) {
      await checkout(t.dataset.checkout);
    } else if (t.dataset.checkin) {
      await checkin({ userId: Number(t.dataset.checkin), unfreeze: t.hasAttribute('data-unfreeze') });
    } else if (t.dataset.topup) {
      const m = state.members.find((x) => x.id === Number(t.dataset.topup));
      openTopup(Number(t.dataset.topup), m?.name || $('.result__name')?.textContent || 'клиент');
    } else if (t.dataset.member) {
      openMember(Number(t.dataset.member));
    } else if (t.hasAttribute('data-new-member')) {
      openNewMember();
    }
  };
}

/* ================= Старт ================= */
async function init() {
  try {
    state.config = await api('GET', '/config');
    const { user } = await api('GET', '/auth/session');
    state.user = user;
    if (!user) renderLogin();
    else if (user.role !== 'admin') renderNoAccess();
    else await start();
  } catch {
    app.innerHTML = '<div class="app-loading"><p>Не удалось загрузить панель. <a class="link" href="">Обновить</a></p></div>';
    return;
  }
  connectOccupancy((s) => {
    const chip = $('[data-live-chip]');
    if (chip) {
      chip.hidden = false;
      $('.dot', chip).dataset.level = s.open ? s.level : 'closed';
      $('[data-live-chip-text]', chip).textContent = `${s.count} в зале`;
    }
    if (state.overview) {
      state.overview.occupancy = { ...state.overview.occupancy, ...s };
      if ($('[data-kpis]')) renderKpis();
    }
  });
  setInterval(() => {
    if (state.user?.role === 'admin' && !document.hidden && !document.querySelector('.sheet-backdrop')) {
      loadOverview()
        .then(() => {
          renderKpis();
          renderInGym();
        })
        .catch(() => null);
    }
  }, 20000);
}

init();
