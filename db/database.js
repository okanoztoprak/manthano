const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, 'manthano.db');

let db = null;
let _saveTimer = null;

// ── Persist in-memory DB to disk (debounced — max 1x per 500ms) ──────────
function save() {
  if (!db) return;
  if (_saveTimer) return; // al ingepland
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const data = db._raw.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('DB opslaan mislukt:', e.message);
    }
  }, 500);
}

// Geforceerde synchrone save bij afsluiten
function saveSync() {
  if (!db) return;
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    const data = db._raw.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('DB opslaan bij afsluiten mislukt:', e.message);
  }
}

process.on('exit',   saveSync);
process.on('SIGINT',  () => { saveSync(); process.exit(0); });
process.on('SIGTERM', () => { saveSync(); process.exit(0); });

// ── Convert {slug: 'x'} → {'@slug': 'x'} for named params ───────────────
function prepareParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const obj = {};
    for (const [k, v] of Object.entries(args[0])) {
      obj[(k[0] === '@' || k[0] === ':' || k[0] === '$') ? k : `@${k}`] = v;
    }
    return obj;
  }
  return args; // positional spread
}

// ── Prepared statement wrapper ────────────────────────────────────────────
class Statement {
  constructor(rawDb, sql) {
    this._rawDb = rawDb;
    this._sql   = sql;
  }

  run(...args) {
    const params = prepareParams(args);
    const stmt = this._rawDb.prepare(this._sql);
    stmt.run(params);
    const res = this._rawDb.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = res[0]?.values[0]?.[0] ?? 0;
    stmt.free();
    if (!db._inTx) save();
    return { lastInsertRowid, changes: 1 };
  }

  get(...args) {
    const params = prepareParams(args);
    const stmt = this._rawDb.prepare(this._sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject({}) : undefined;
    stmt.free();
    return row;
  }

  all(...args) {
    const params = prepareParams(args);
    const stmt = this._rawDb.prepare(this._sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject({}));
    stmt.free();
    return rows;
  }
}

// ── Database wrapper ──────────────────────────────────────────────────────
class Db {
  constructor(rawDb) {
    this._raw  = rawDb;
    this._inTx = false;
  }

  exec(sql) {
    this._raw.exec(sql);
    const upper = sql.trim().toUpperCase();
    if (upper.startsWith('BEGIN')) {
      this._inTx = true;
    } else if (upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK')) {
      this._inTx = false;
      if (upper.startsWith('COMMIT')) save();
    } else if (!upper.startsWith('PRAGMA') && !this._inTx) {
      save();
    }
  }

  prepare(sql) {
    return new Statement(this._raw, sql);
  }

  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        this.exec('ROLLBACK');
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

// ── Init (async, call once at server startup) ─────────────────────────────
async function initDb() {
  const initSqlJs = require('sql.js');
  const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm');

  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  const fileBuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const rawDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db = new Db(rawDb);
  db.exec('PRAGMA foreign_keys = ON');
  initSchema();
  autoSeed();

  return db;
}

// ── Auto-seed op eerste start (als packages tabel leeg is) ───────────────
function autoSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM packages').get();
  if (count && count.n > 0) return; // al gevuld

  const pkgs = [
    { slug: 'losse-les',  name: 'Losse les',       lessons: 1, price: 6500,  per_hour: 6500, saving: 'Flexibel',    featured: 0, sort_order: 1 },
    { slug: 'pakket-4',   name: 'Pakket 4 lessen',  lessons: 4, price: 23000, per_hour: 5750, saving: 'Bespaar 12%', featured: 1, sort_order: 2 },
    { slug: 'pakket-8',   name: 'Pakket 8 lessen',  lessons: 8, price: 40000, per_hour: 5000, saving: 'Bespaar 23%', featured: 0, sort_order: 3 },
  ];
  const insertPkg = db.prepare(`
    INSERT OR REPLACE INTO packages (slug, name, lessons, price, per_hour, saving, featured, active, sort_order)
    VALUES (@slug, @name, @lessons, @price, @per_hour, @saving, @featured, 1, @sort_order)
  `);
  for (const p of pkgs) insertPkg.run(p);

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
    const dateStr = d.toISOString().slice(0, 10);
    for (const t of ['17:30', '19:00', '20:00']) insertSlot.run(dateStr, t);
  }

  console.log('Database automatisch gevuld met pakketten en beschikbaarheid.');
}

function getDb() {
  if (!db) throw new Error('Database niet geïnitialiseerd. Roep initDb() aan bij opstarten.');
  return db;
}

module.exports = { initDb, getDb };
