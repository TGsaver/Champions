// Все данные о зале в одном месте: контакты, расписание, абонементы, вместимость.
// После правок перезапустите сервер (npm start).
//
// ⚠ Проверьте перед запуском: телефон, Instagram, часы работы и цены взяты
//   из открытых источников (карточки зала в 2ГИС / Яндекс Картах) или являются примером.

export default {
  name: 'Gym Champions',
  shortName: 'Champions',
  tagline: 'Тренажёрный зал в Махачкале',

  // Часовой пояс зала: определяет «сегодня», часы работы и прогноз загрузки.
  timezone: 'Europe/Moscow',

  address: {
    city: 'Махачкала',
    street: 'ул. Циолковского, 24',
    details: '2 этаж',
    full: 'г. Махачкала, ул. Циолковского, 24, 2 этаж',
    postalCode: '367029',
  },

  contacts: {
    phone: '+7 (996) 420-88-95', // проверьте
    phoneHref: 'tel:+79964208895',
    whatsapp: 'https://wa.me/79964208895',
    instagram: 'https://instagram.com/champions_gym24', // проверьте
    instagramHandle: '@champions_gym24',
  },

  // Карточки зала на картах: отзывы, маршрут, виджеты.
  maps: {
    yandexOrgId: '199573048114',
    yandexUrl: 'https://yandex.ru/maps/org/gym_champion/199573048114/',
    yandexReviewsUrl: 'https://yandex.ru/maps/org/gym_champion/199573048114/reviews/',
    twoGisUrl: 'https://2gis.ru/makhachkala/firm/70000001033665957',
    twoGisReviewsUrl: 'https://2gis.ru/makhachkala/firm/70000001033665957/tab/reviews',
    // Официальные виджеты Яндекса. Точный код карты: карточка зала в Яндекс Картах →
    // «Поделиться» → «Встроить карту» (возьмите адрес из src у iframe).
    reviewsWidgetUrl: 'https://yandex.ru/maps-reviews-widget/199573048114?comments',
    mapWidgetUrl: 'https://yandex.ru/map-widget/v1/?mode=search&oid=199573048114&ol=biz&z=16',
  },

  // Расписание. day: 0 — понедельник … 6 — воскресенье.
  // women — женские часы (зал работает только для женщин).
  schedule: [
    { day: 0, open: '09:00', close: '22:00', women: ['09:00', '13:00'] },
    { day: 1, open: '13:00', close: '22:00' },
    { day: 2, open: '09:00', close: '22:00', women: ['09:00', '13:00'] },
    { day: 3, open: '13:00', close: '22:00' },
    { day: 4, open: '09:00', close: '22:00', women: ['09:00', '13:00'] },
    { day: 5, open: '13:00', close: '22:00' },
    { day: 6, closed: true },
  ],

  occupancy: {
    capacity: 40, // сколько человек зал комфортно вмещает (меняется в панели ресепшена)
    autoCheckoutMinutes: 150, // если выход не отметили, визит закрывается автоматически
    historyDays: 56, // сколько дней истории использовать для прогноза
  },

  // Абонементы. visits — пакет посещений, days — безлимит на N дней.
  // freezeDays — сколько дней заморозки даёт абонемент.
  // ⚠ Цены (кроме безлимита от 2 200 ₽) — пример, замените на актуальные.
  plans: [
    {
      id: 'single',
      title: 'Разовое',
      subtitle: 'Одна тренировка',
      price: 300,
      visits: 1,
      features: ['Весь зал без ограничений', 'Оплата онлайн или на месте', 'Без обязательств'],
    },
    {
      id: 'pack8',
      title: '8 посещений',
      subtitle: 'Два раза в неделю',
      price: 1600,
      visits: 8,
      features: ['200 ₽ за тренировку', 'Посещения не сгорают', 'Удобно при плотном графике'],
    },
    {
      id: 'month',
      title: 'Месяц',
      subtitle: 'Безлимит · 30 дней',
      price: 2200,
      days: 30,
      freezeDays: 7,
      featured: true,
      features: ['Тренируйтесь каждый день', 'Заморозка до 7 дней', 'QR-пропуск в телефоне'],
    },
    {
      id: 'quarter',
      title: '3 месяца',
      subtitle: 'Безлимит · 90 дней',
      price: 6000,
      days: 90,
      freezeDays: 21,
      features: ['2 000 ₽ в месяц', 'Заморозка до 21 дня', 'Для тех, кто настроен серьёзно'],
    },
  ],

  features: {
    personalTrainer: true,
    prayerRoom: true,
    womenHours: true,
  },
};
