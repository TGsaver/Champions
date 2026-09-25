// Создание администратора ресепшена:
//   npm run create-admin -- +79001234567 "Имя Фамилия"
// Пароль сгенерируется автоматически (или задайте ADMIN_PASSWORD).
// Если пользователь с таким номером уже есть, он получит права администратора.
import crypto from 'node:crypto';
import { openDb } from '../server/db.js';
import { createUser } from '../server/routes/auth.js';
import { formatPhone, hashPassword, normalizePhone } from '../server/security.js';

const [phoneArg, ...nameParts] = process.argv.slice(2);
const phone = normalizePhone(phoneArg);
if (!phone) {
  console.error('Использование: npm run create-admin -- +79001234567 "Имя Фамилия"');
  process.exit(1);
}
const password = process.env.ADMIN_PASSWORD;
if (password !== undefined && password.length < 8) {
  console.error('ADMIN_PASSWORD должен быть не короче 8 символов');
  process.exit(1);
}

const db = openDb(process.env.DATABASE_PATH || 'data/gym.db');
const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

if (existing) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
  if (password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), existing.id);
  }
  console.log(`${existing.name} (${formatPhone(phone)}) теперь администратор.${password ? ' Пароль обновлён.' : ''}`);
} else {
  const pass = password || crypto.randomBytes(9).toString('base64url');
  await createUser(db, { name: nameParts.join(' ') || 'Администратор', phone, password: pass, role: 'admin' });
  console.log(`Администратор создан: ${formatPhone(phone)}`);
  if (!password) console.log(`Пароль: ${pass}  — сохраните его, повторно он не показывается.`);
}
db.close();
