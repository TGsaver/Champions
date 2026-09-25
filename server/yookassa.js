// Клиент ЮKassa (API v3). Включается, если заданы YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.
// Документация: https://yookassa.ru/developers/api
import crypto from 'node:crypto';

const API = 'https://api.yookassa.ru/v3';

export function createYooKassa({ shopId, secretKey, receipts = false, vatCode = 1, fetchImpl = fetch }) {
  const auth = 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');

  async function request(method, path, body) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'Idempotence-Key': crypto.randomUUID() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`YooKassa ${res.status}: ${data.description || data.code || 'error'}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    name: 'yookassa',

    async create({ payment, user, returnUrl }) {
      const amount = { value: payment.amount.toFixed(2), currency: 'RUB' };
      const description = `Абонемент «${payment.plan_title}» — Gym Champions`;
      const body = {
        amount,
        capture: true,
        confirmation: { type: 'redirect', return_url: returnUrl },
        description,
        metadata: { paymentId: payment.id },
      };
      if (receipts) {
        // Чек по 54-ФЗ: нужен, если в магазине подключены «Чеки от ЮKassa».
        body.receipt = {
          customer: { phone: user.phone },
          items: [
            {
              description: description.slice(0, 128),
              quantity: '1.00',
              amount,
              vat_code: vatCode,
              payment_mode: 'full_prepayment', // абонемент оплачивается до оказания услуги
              payment_subject: 'service',
            },
          ],
        };
      }
      const data = await request('POST', '/payments', body);
      return { id: data.id, status: data.status, confirmationUrl: data.confirmation?.confirmation_url };
    },

    async fetch(id) {
      const data = await request('GET', `/payments/${encodeURIComponent(id)}`);
      return { id: data.id, status: data.status };
    },
  };
}
