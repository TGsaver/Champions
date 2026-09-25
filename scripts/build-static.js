// Статическая сборка для GitHub Pages: npm run build:static -> dist/
// Главная работает полностью (загрузка зала моделируется в браузере),
// личный кабинет и ресепшен требуют сервер — вместо них страница-пояснение.
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/gym.js';
import { createRenderer } from '../server/render.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BASE = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const REPO_URL = process.env.REPO_URL || 'https://github.com';

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

// Код симуляции загрузки: тот же occupancy.js, что на сервере, с заглушками вместо базы данных.
const SIM = path.join(DIST, 'assets/js/sim');
fs.mkdirSync(SIM, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'server/occupancy.js'), path.join(SIM, 'occupancy.js'));
fs.copyFileSync(path.join(ROOT, 'server/time.js'), path.join(SIM, 'time.js'));
fs.copyFileSync(path.join(ROOT, 'config/gym.js'), path.join(SIM, 'gym.js'));
fs.writeFileSync(
  path.join(SIM, 'db.js'),
  'export const getSetting = (db, key, fallback = null) => fallback;\nexport const setSetting = () => {};\n'
);
fs.writeFileSync(path.join(SIM, 'memberships.js'), 'export const DEFAULT_VISIT_MINUTES = 90;\n');

// Абсолютные ссылки «/…» -> с учётом адреса проекта на GitHub Pages.
const rebase = (html) => html.replace(/(href|src|content)="\/(?!\/)/g, `$1="${BASE}`);

const renderer = await createRenderer({ config, demo: true, onlinePayments: false });
let index = await renderer.render('index');
index = index.replace(
  '<script type="module" src="/assets/js/landing.js',
  '<script type="module" src="/assets/js/static-api.js"></script>\n  <script type="module" src="/assets/js/landing.js'
);
index = index.replace(
  /Данные обновляются автоматически\.[^<]*/,
  'Это демо-версия сайта на GitHub Pages: число посетителей смоделировано. На сервере зала сюда приходят реальные отметки входа по QR-коду.'
);
fs.writeFileSync(path.join(DIST, 'index.html'), rebase(index));
fs.mkdirSync(path.join(DIST, 'privacy'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'privacy/index.html'), rebase(await renderer.render('privacy')));
fs.writeFileSync(path.join(DIST, '404.html'), rebase(await renderer.render('404')));

// Кабинет и ресепшен без сервера не работают — объясняем и даём ссылку.
const notice = (title, text) => `<!doctype html>
<html lang="ru" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex">
  <title>${title} — ${config.name}</title>
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/css/base.css">
  <link rel="stylesheet" href="/assets/css/app.css">
  <script src="/assets/js/boot.js"></script>
</head>
<body class="app-page">
  <main class="app">
    <section class="auth container">
      <div class="auth__emblem emblem-gold" role="img" aria-label="${config.name}"></div>
      <h1>${title}</h1>
      <p class="auth__lead">${text}</p>
      <div class="actions" style="justify-content:center">
        <a class="btn btn--gold" href="/">На главную</a>
        <a class="btn btn--dark" href="${REPO_URL}#быстрый-старт-демо">Как запустить</a>
      </div>
    </section>
  </main>
</body>
</html>`;
const serverNote =
  'Эта страница работает на сервере зала: регистрация, QR-пропуск, баланс и оплата хранятся в базе данных. ' +
  'На GitHub Pages размещена только витрина сайта. Запустите сервер (npm run demo) или разместите сайт на хостинге с Node.js.';
for (const [dir, title] of [['account', 'Личный кабинет'], ['admin', 'Ресепшен']]) {
  fs.mkdirSync(path.join(DIST, dir), { recursive: true });
  fs.writeFileSync(path.join(DIST, dir, 'index.html'), rebase(notice(title, serverNote)));
}

// Манифест тоже с учётом базового пути.
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'site.webmanifest'), 'utf8'));
manifest.start_url = BASE;
manifest.scope = BASE;
manifest.icons = manifest.icons.map((i) => ({ ...i, src: BASE + i.src.replace(/^\//, '') }));
fs.writeFileSync(path.join(DIST, 'site.webmanifest'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

console.log(`Готово: dist/ (базовый путь ${BASE})`);
