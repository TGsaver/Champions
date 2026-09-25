// Загрузка зала: подписка на live-обновления (SSE) с запасным вариантом — опросом.

export function plural(n, [one, few, many]) {
  const r = new Intl.PluralRules('ru').select(n);
  return r === 'one' ? one : r === 'few' ? few : many;
}

export const peopleWord = (n) => plural(n, ['человек', 'человека', 'человек']);

export const LEVEL_COLORS = {
  low: 'var(--green)',
  medium: 'var(--yellow)',
  high: 'var(--orange)',
  full: 'var(--red)',
  closed: 'var(--text-3)',
};

export function connectOccupancy(onData) {
  let source = null;
  let timer = null;

  const poll = async () => {
    try {
      const res = await fetch('/api/occupancy', { cache: 'no-store' });
      if (res.ok) onData(await res.json());
    } catch {
      /* сеть недоступна — попробуем позже */
    }
  };

  const startPolling = () => {
    if (timer) return;
    poll();
    timer = setInterval(poll, 30000);
  };

  if ('EventSource' in window) {
    source = new EventSource('/api/occupancy/stream');
    source.addEventListener('occupancy', (e) => {
      try {
        onData(JSON.parse(e.data));
      } catch {
        /* пропускаем битое сообщение */
      }
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        source = null;
        startPolling();
      }
    };
  } else {
    startPolling();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  return () => {
    source?.close();
    clearInterval(timer);
  };
}

export function timeHHMM(ms) {
  return new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
