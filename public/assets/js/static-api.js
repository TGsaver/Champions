// Статическая версия сайта (GitHub Pages): сервера нет, поэтому загрузка зала
// считается прямо в браузере тем же кодом, что и на сервере в демо-режиме.
import config from './sim/gym.js';
import { createOccupancy } from './sim/occupancy.js';

const fakeDb = { prepare: () => ({ all: () => [], get: () => undefined, run() {} }) };
const occupancy = createOccupancy({ db: fakeDb, config, demo: true });
const json = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const nativeFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname.endsWith('/api/occupancy')) return json(occupancy.snapshot());
  if (url.pathname.endsWith('/api/occupancy/forecast')) {
    return json(occupancy.forecast(url.searchParams.get('date') || undefined));
  }
  return nativeFetch(input, init);
};

// Без сервера нет потока событий — live.js перейдёт на опрос, который отвечает код выше.
delete window.EventSource;
