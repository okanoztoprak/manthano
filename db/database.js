const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, 'manthano.db');

let db    = null;
let _mode = null; // 'native' of 'sqljs'

// ── Lokale datum als YYYY-MM-DD (geen UTC-verschuiving) ───────────────────
function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Wrapper voor node:sqlite (native) ────────────────────────────────────
class NativeDb {
  constructor(raw) { this._raw = raw; }
  exec(sql)        { return this._raw.exec(sql); }
  prepare(sql)     { return this._raw.prepare(sql); }
  transaction(fn) {
    return (...args) => {
      this._raw.exec('BEGIN');
      try   { const r = fn(...args); this._raw.exec('COMMIT');   return r; }
      catch (e) { this._raw.exec('ROLLBACK'); throw e; }
    };
  }
}

// ── Wrapper voor sql.js (WASM fallback) ───────────────────────────────────
let _saveTimer = null;
function sqljsSave(raw) {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try { fs.writeFileSync(DB_PATH, Buffer.from(raw.export())); }
    catch (e) { console.error('DB save fout:', e.message); }
  }, 200);
}
function sqljsSaveSync(raw) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try { fs.writeFileSync(DB_PATH, Buffer.from(raw.export())); }
  catch (e) { console.error('DB save fout:', e.message); }
}

class SqljsStatement {
  constructor(rawDb, sql) { this._db = rawDb; this._sql = sql; }
  _params(args) {
    if (!args.length) return [];
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const o = {};
      for (const [k, v] of Object.entries(args[0]))
        o[(k[0]==='@'||k[0]===':'||k[0]==='$') ? k : `@${k}`] = v;
      return o;
    }
    return args;
  }
  run(...args) {
    const p = this._params(args), s = this._db.prepare(this._sql);
    s.run(p);
    const ri = this._db.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = ri[0]?.values[0]?.[0] ?? 0;
    s.free();
    if (!db._inTx) sqljsSave(this._db);
    return { lastInsertRowid, changes: 1 };
  }
  get(...args) {
    const p = this._params(args), s = this._db.prepare(this._sql);
    s.bind(p);
    const row = s.step() ? s.getAsObject({}) : undefined;
    s.free(); return row;
  }
  all(...args) {
    const p = this._params(args), s = this._db.prepare(this._sql);
    s.bind(p);
    const rows = [];
    while (s.step()) rows.push(s.getAsObject({}));
    s.free(); return rows;
  }
}

class SqljsDb {
  constructor(raw) { this._raw = raw; this._inTx = false; }
  exec(sql) {
    this._raw.exec(sql);
    const u = sql.trim().toUpperCase();
    if      (u.startsWith('BEGIN'))    { this._inTx = true; }
    else if (u.startsWith('COMMIT'))   { this._inTx = false; sqljsSave(this._raw); }
    else if (u.startsWith('ROLLBACK')) { this._inTx = false; }
    else if (!u.startsWith('PRAGMA') && !this._inTx) { sqljsSave(this._raw); }
  }
  prepare(sql) { return new SqljsStatement(this._raw, sql); }
  transaction(fn) {
    return (...args) => {
      this.exec('BEGIN');
      try   { const r = fn(...args); this.exec('COMMIT');   return r; }
      catch (e) { this.exec('ROLLBACK'); throw e; }
    };
  }
}

// ── Schema ────────────────────────────────────────────────────────────────
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, lessons INTEGER NOT NULL, price INTEGER NOT NULL,
      per_hour INTEGER NOT NULL, saving TEXT, featured INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      email TEXT NOT NULL, phone TEXT, level TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      package_id INTEGER REFERENCES packages(id),
      package_name TEXT NOT NULL, lessons_total INTEGER NOT NULL,
      lessons_used INTEGER DEFAULT 0, amount_cents INTEGER NOT NULL,
      status TEXT DEFAULT 'pending', mollie_id TEXT, mollie_status TEXT,
      access_token TEXT UNIQUE NOT NULL, expires_at TEXT, paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
      slot_time TEXT NOT NULL, max_spots INTEGER DEFAULT 1,
      booked INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      UNIQUE(date, slot_time)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
      order_id INTEGER REFERENCES orders(id),
      avail_id INTEGER REFERENCES availability(id),
      date TEXT NOT NULL, slot_time TEXT NOT NULL,
      status TEXT DEFAULT 'confirmed', zoom_link TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS digital_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, description TEXT, price INTEGER NOT NULL,
      file_path TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS digital_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
      product_id INTEGER REFERENCES digital_products(id),
      amount_cents INTEGER NOT NULL, mollie_id TEXT,
      status TEXT DEFAULT 'pending', access_token TEXT UNIQUE NOT NULL,
      paid_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── AutoSeed ──────────────────────────────────────────────────────────────
function autoSeed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM packages').get();
  if (count && count.n > 0) return;

  const runInTx = db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO packages (slug,name,lessons,price,per_hour,saving,featured,active,sort_order) VALUES (@slug,@name,@lessons,@price,@per_hour,@saving,@featured,1,@sort_order)`)
      .run({ slug:'losse-les', name:'Losse les',       lessons:1, price:6500,  per_hour:6500, saving:'Flexibel',    featured:0, sort_order:1 });
    db.prepare(`INSERT OR REPLACE INTO packages (slug,name,lessons,price,per_hour,saving,featured,active,sort_order) VALUES (@slug,@name,@lessons,@price,@per_hour,@saving,@featured,1,@sort_order)`)
      .run({ slug:'pakket-4',  name:'Pakket 4 lessen', lessons:4, price:23000, per_hour:5750, saving:'Bespaar 12%', featured:1, sort_order:2 });
    db.prepare(`INSERT OR REPLACE INTO packages (slug,name,lessons,price,per_hour,saving,featured,active,sort_order) VALUES (@slug,@name,@lessons,@price,@per_hour,@saving,@featured,1,@sort_order)`)
      .run({ slug:'pakket-8',  name:'Pakket 8 lessen', lessons:8, price:40000, per_hour:5000, saving:'Bespaar 23%', featured:0, sort_order:3 });

    db.prepare(`INSERT OR REPLACE INTO digital_products (slug,name,description,price,active) VALUES (@slug,@name,@description,@price,1)`)
      .run({ slug:'studieplanner', name:'Digitale studieplanner', description:'Een handige digitale studieplanner om je schooljaar overzichtelijk te houden. Direct te downloaden na betaling.', price:1250 });

    const ins = db.prepare(`INSERT OR IGNORE INTO availability (date,slot_time,max_spots,booked,active) VALUES (?,?,1,0,1)`);
    const now = new Date();
    for (let i = 1; i <= 90; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const ds = localDate(d);
      for (const t of ['17:30','19:00','20:00']) ins.run(ds, t);
    }
  });

  try {
    runInTx();
    console.log('Database automatisch gevuld met pakketten en beschikbaarheid.');
  } catch (e) {
    console.error('AutoSeed mislukt:', e.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
async function initDb() {
  // Probeer eerst node:sqlite (ingebouwd, geen WASM, schrijft direct naar schijf)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB_PATH);
    db = new NativeDb(raw);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    initSchema();
    autoSeed();
    _mode = 'native';
    console.log('Database: node:sqlite (native)');
    return db;
  } catch (e) {
    console.warn('node:sqlite niet beschikbaar, gebruik sql.js als fallback:', e.message);
  }

  // Fallback: sql.js (WASM)
  const initSqlJs = require('sql.js');
  const wasmPath  = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const raw = buf ? new SQL.Database(buf) : new SQL.Database();
  db = new SqljsDb(raw);
  db.exec('PRAGMA foreign_keys = ON');
  initSchema();
  autoSeed();
  _mode = 'sqljs';

  // Sla bij afsluiten altijd op
  const saveOnExit = () => sqljsSaveSync(raw);
  process.on('exit', saveOnExit);
  process.on('SIGINT',  () => { saveOnExit(); process.exit(0); });
  process.on('SIGTERM', () => { saveOnExit(); process.exit(0); });

  console.log('Database: sql.js (WASM fallback)');
  return db;
}

function getDb() {
  if (!db) throw new Error('Database niet geïnitialiseerd. Roep initDb() aan bij opstarten.');
  return db;
}

module.exports = { initDb, getDb };
