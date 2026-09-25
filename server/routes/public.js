import { Router } from 'express';
import { isValidDate, WEEKDAY_SHORT } from '../time.js';

export function publicConfig(config, demo, paymentProvider) {
  return {
    name: config.name,
    tagline: config.tagline,
    address: config.address,
    contacts: config.contacts,
    maps: config.maps,
    schedule: config.schedule.map((d) => ({ ...d, label: WEEKDAY_SHORT[d.day] })),
    plans: config.plans.map(({ id, title, subtitle, price, visits, days, freezeDays, featured, features }) => ({
      id,
      title,
      subtitle,
      price,
      visits: visits || 0,
      days: days || 0,
      freezeDays: freezeDays || 0,
      featured: Boolean(featured),
      features: features || [],
    })),
    demo,
    paymentProvider,
  };
}

export function publicRoutes(ctx) {
  const r = Router();
  const cfg = publicConfig(ctx.config, ctx.demo, ctx.payments.providerName);

  r.get('/config', (req, res) => res.json(cfg));

  r.get('/occupancy', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(ctx.occupancy.snapshot());
  });

  r.get('/occupancy/forecast', (req, res) => {
    const { date } = req.query;
    if (date !== undefined && !isValidDate(date)) {
      return res.status(400).json({ error: 'bad_date', message: 'Дата в формате ГГГГ-ММ-ДД' });
    }
    res.set('Cache-Control', 'no-store');
    res.json(ctx.occupancy.forecast(date));
  });

  r.get('/occupancy/stream', (req, res) => ctx.occupancy.subscribe(req, res));

  return r;
}
