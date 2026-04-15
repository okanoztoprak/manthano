const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'manthano.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      slug      TEXT UNIQUE NOT NULL,
      name      TEXT NOT NULL,
      lessons   INTEGER NOT NULL,
      price     INTEGER NOT NULL,   -- in euro-cents
      per_hour  INTEGER NOT NULL,   -- in euro-cents
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
      status          TEXT DEFAULT 'pending',   -- pending | paid | expired | refunded
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
      date       TEXT NOT NULL,           -- YYYY-MM-DD
      slot_time  TEXT NOT NULL,           -- HH:MM
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
      status       TEXT DEFAULT 'confirmed', -- confirmed | cancelled | completed
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

module.exports = { getDb };
