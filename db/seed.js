require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('./database');

const db = getDb();

// Packages
const pkgs = [
  { slug: 'losse-les', name: 'Losse les', lessons: 1, price: 6500, per_hour: 6500, saving: 'Flexibel', featured: 0, sort_order: 1 },
  { slug: 'pakket-4', name: 'Pakket 4 lessen', lessons: 4, price: 23000, per_hour: 5750, saving: 'Bespaar 12%', featured: 1, sort_order: 2 },
  { slug: 'pakket-8', name: 'Pakket 8 lessen', lessons: 8, price: 40000, per_hour: 5000, saving: 'Bespaar 23%', featured: 0, sort_order: 3 },
];

const insertPkg = db.prepare(`
  INSERT OR REPLACE INTO packages (slug, name, lessons, price, per_hour, saving, featured, active, sort_order)
  VALUES (@slug, @name, @lessons, @price, @per_hour, @saving, @featured, 1, @sort_order)
`);

for (const p of pkgs) {
  insertPkg.run(p);
}

// Digital products
const insertDp = db.prepare(`
  INSERT OR REPLACE INTO digital_products (slug, name, description, price, active)
  VALUES (@slug, @name, @description, @price, 1)
`);
insertDp.run({
  slug: 'studieplanner',
  name: 'Digitale studieplanner',
  description: 'Een handige digitale studieplanner om je schooljaar overzichtelijk te houden. Direct te downloaden na betaling.',
  price: 1250,
});

// Seed availability for the next 60 days (weekdays, 17:30 / 19:00 / 20:00)
const insertSlot = db.prepare(`
  INSERT OR IGNORE INTO availability (date, slot_time, max_spots, booked, active)
  VALUES (?, ?, 1, 0, 1)
`);

const now = new Date();
for (let i = 1; i <= 90; i++) {
  const d = new Date(now);
  d.setDate(d.getDate() + i);
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) continue;
  const dateStr = d.toISOString().slice(0, 10);
  for (const t of ['17:30', '19:00', '20:00']) {
    insertSlot.run(dateStr, t);
  }
}

console.log('✅ Database gevuld met pakketten en beschikbaarheid.');
