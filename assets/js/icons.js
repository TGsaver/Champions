// Линейные иконки 24×24 в стиле SF Symbols (общие для сервера и браузера). icon("qr") -> <svg>…</svg>
const PATHS = {
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  trainer:
    '<path d="M2.5 6h19M4.5 3.8v4.4M19.5 3.8v4.4M8 6l1.6 4.2M16 6l-1.6 4.2"/><circle cx="12" cy="9.4" r="1.9"/><path d="M9.6 12.6h4.8l-.9 4.4h-3zM10.5 17l-1.5 4M13.5 17l1.5 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  arch: '<path d="M5 21V11.5a7 7 0 0 1 14 0V21M3 21h18M9 21v-6.5a3 3 0 0 1 6 0V21"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M20.5 14v2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  phone:
    '<path d="M6.6 3.5h2.6l1.5 4.2-2 1.4a11 11 0 0 0 6.2 6.2l1.4-2 4.2 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
  chat: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.5-4.4A8.4 8.4 0 1 1 20.5 11.6z"/><path d="M9 9.5c.4 2.4 2.2 4.4 4.9 5.1"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17.2" cy="6.8" r=".6" fill="currentColor"/>',
  route: '<circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="6" r="2.3"/><path d="M8.3 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.7"/>',
  bolt: '<path d="M13 2.8L5 13.5h6l-1 7.7 8-10.7h-6z"/>',
  chart: '<path d="M4 20V10M9.3 20V4M14.7 20v-7M20 20V8"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16.5 13h.01M3 9.5h18M6 6l9.5-2.8a1.5 1.5 0 0 1 1.9 1.4V6"/>',
  snow: '<path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 3.5V8H8M12 8v4.3l3 1.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  star: '<path fill="currentColor" stroke="none" d="M12 2.8l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.1l-5.7 3 1.2-6.3-4.6-4.4 6.3-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  camera: '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  logout: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5M4 4v4h4M20 20v-4h-4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.5-4-6.5-4.5-11-2.5 2-3.2 4.3-3 6.3C9.6 8.9 9 8 8.8 6.8 6.8 8.6 5.5 11.3 5.5 14.5A6.5 6.5 0 0 0 12 21z"/>',
  gauge: '<path d="M4.2 17a8.5 8.5 0 1 1 15.6 0"/><path d="M12 13l4-4.5"/><circle cx="12" cy="13" r="1.3" fill="currentColor"/>',
};

export function icon(name, cls = '') {
  const body = PATHS[name];
  if (!body) throw new Error(`Нет иконки ${name}`);
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICONS = Object.keys(PATHS);
