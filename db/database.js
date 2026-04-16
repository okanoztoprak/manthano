const path = require('path');
const DB_PATH = path.join(__dirname, 'manthano.db');

let db = null;

// ── Thin wrapper: voegt transaction() toe aan DatabaseSync ────────────────
class Db {
  constructor(raw) { this._raw = raw; }

  exec(sql) { return this._raw.exec(sql); }

  prepare(sql) { return this._raw.prepare(sql); }

  transaction(fn) {
    return (...args) => {
      this._raw.exec('BEGIN');
      try {
        const result = fn(...args);
        this._raw.exec('COMMIT');
        return result;
      } catch (err) {
        this._raw.exec('ROLLBACK');
        throw err;
      }
    };
  }
}

// ── Schema ────────────────────────────────────────────────────────────────
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      slug      TEXT UNIQUE NOT NULL,
      name      TEXT NOT NULL,
      lessons   INTEGER NOT NULL,
      price     INTEGER NOT NULL,
      per_hour  INTEGER NOT NULL,
      saving    TEXT,
      featured  INTEGER DEFAULT 0,
      active    INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL,
      phone      TEXT,
      level      TEXT,
      notes      TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid            TEXT UNIQUE NOT NULL,
      customer_id     INTEGER REFERENCES customers(id),
      package_id      INTEGER REFERENCES packages(id),
      package_name    TEXT NOT NULL,
      lessons_total   INTEGER NOT NULL,
      lessons_used    INTEGER DEFAULT 0,
      amount_cents    INTEGER NOT NULL,
      status          TEXT DEFAULT 'pending',
      mollie_id       TEXT,
      mollie_status   TEXT,
      access_token    TEXT UNIQUE NOT NULL,
      expires_at      TEXT,
      paid_at         TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS availability (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      slot_time  TEXT NOT NULL,
      max_spots  INTEGER DEFAULT 1,
      booked     INTEGER DEFAULT 0,
      active     INTEGER DEFAULT 1,
      UNIQUE(date, slot_time)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid         TEXT UNIQUE NOT NULL,
      order_id     INTEGER REFERENCES orders(id),
      avail_id     INTEGER REFERENCES availability(id),
      date         TEXT NOT NULL,
      slot_time    TEXT NOT NULL,
      status       TEXT DEFAULT 'confirmed',
      zoom_link    TEXT,
      notes        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS digital_products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      price       INTEGER NOT NULL,
      file_path   TEXT,
      active      INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS digital_orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid          TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      product_id    INTEGER REFERENCES digital_products(id),
      amount_cents  INTEGER NOT NULL,
      mollie_id     TEXT,
      status        TEXT DEFAULT 'pending',
      access_token  TEXT UNIQUE NOT NULL,
      paid_at       TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Lokale datum als YYYY-MM-DD ───────────────────────────────────────────
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Auto-seed op eerste start ─────────────────────────────────────────────
function autoSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM packages').get();
  if (count && count.n > 0) return;

  db.exec('BEGIN');
  try {
    const insertPkg = db.prepare(`
      INSERT OR REPLACE INTO packages (slug, name, lessons, price, per_hour, saving, featured, active, sort_order)
      VALUES (@slug, @name, @lessons, @price, @per_hour, @saving, @featured, 1, @sort_order)
    `);
    [
      { slug: 'losse-les', name: 'Losse les',       lessons: 1, price: 6500,  per_hour: 6500, saving: 'Flexibel',    featured: 0, sort_order: 1 },
      { slug: 'pakket-4',  name: 'Pakket 4 lessen', lessons: 4, price: 23000, per_hour: 5750, saving: 'Bespaar 12%', featured: 1, sort_order: 2 },
      { slug: 'pakket-8',  name: 'Pakket 8 lessen', lessons: 8, price: 40000, per_hour: 5000, saving: 'Bespaar 23%', featured: 0, sort_order: 3 },
    ].forEach(p => insertPkg.run(p));

    db.prepare(`
      INSERT OR REPLACE INTO digital_products (slug, name, description, price, active)
      VALUES (@slug, @name, @description, @price, 1)
    `).run({
      slug: 'studieplanner',
      name: 'Digitale studieplanner',
      description: 'Een handige digitale studieplanner om je schooljaar overzichtelijk te houden. Direct te downloaden na betaling.',
      price: 1250,
    });

    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO availability (date, slot_time, max_spots, booked, active)
      VALUES (?, ?, 1, 0, 1)
    `);
    const now = new Date();
    for (let i = 1; i <= 90; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const dateStr = localDate(d);
      for (const t of ['17:30', '19:00', '20:00']) insertSlot.run(dateStr, t);
    }

    db.exec('COMMIT');
    console.log('Database automatisch gevuld met pakketten en beschikbaarheid.');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('AutoSeed mislukt:', e.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
async function initDb() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB_PATH);
    db = new Db(raw);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
    autoSeed();
    console.log('Database: node:sqlite (ingebouwd)');
    return db;
  } catch (e) {
    throw new Error(`Database kon niet worden geopend: ${e.message}`);
  }
}

function getDb() {
  if (!db) throw new Error('Database niet geïnitialiseerd. Roep initDb() aan bij opstarten.');
  return db;
}

module.exports = { initDb, getDb };
