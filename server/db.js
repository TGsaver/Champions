import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1 — базовая схема
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    pass_code TEXT NOT NULL UNIQUE,
    visits_balance INTEGER NOT NULL DEFAULT 0 CHECK (visits_balance >= 0),
    unlimited_until TEXT,
    frozen_from TEXT,
    frozen_until TEXT,
    freeze_days_left INTEGER NOT NULL DEFAULT 0,
    monthly_goal INTEGER NOT NULL DEFAULT 12,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE visits (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('member', 'guest')),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('visit', 'unlimited', 'guest')),
    checked_in_at INTEGER NOT NULL,
    checked_out_at INTEGER,
    auto_closed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX visits_open ON visits(checked_out_at) WHERE checked_out_at IS NULL;
  CREATE INDEX visits_in ON visits(checked_in_at);
  CREATE INDEX visits_user ON visits(user_id, checked_in_at);

  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    plan_title TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'canceled')),
    provider TEXT NOT NULL,
    provider_payment_id TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX payments_user ON payments(user_id, created_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

let depth = 0;
/** Выполняет fn в транзакции. Вложенные вызовы используют ту же транзакцию. */
export function tx(db, fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}
