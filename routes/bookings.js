const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { sendBookingConfirmation } = require('../emails/mailer');
const { requireAdmin } = require('../middleware/auth');

// GET /api/bookings/availability?month=YYYY-MM
// Geeft beschikbare slots terug (publiek toegankelijk — alleen free slots)
router.get('/availability', (req, res) => {
  const db = getDb();
  const month = req.query.month; // YYYY-MM

  let rows;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    rows = db.prepare(`
      SELECT date, slot_time, (max_spots - booked) AS available
      FROM availability
      WHERE date LIKE ? AND active = 1 AND (max_spots - booked) > 0
        AND date >= date('now')
      ORDER BY date, slot_time
    `).all(`${month}%`);
  } else {
    rows = db.prepare(`
      SELECT date, slot_time, (max_spots - booked) AS available
      FROM availability
      WHERE active = 1 AND (max_spots - booked) > 0
        AND date >= date('now')
        AND date <= date('now', '+90 days')
      ORDER BY date, slot_time
    `).all();
  }

  // Groepeer per datum
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push({ time: r.slot_time, available: r.available });
  }

  res.json(grouped);
});

// POST /api/bookings/book  — boek een les (vereist geldige access token)
router.post('/book', async (req, res) => {
  const { token, date, slotTime, notes } = req.body;
  if (!token || !date || !slotTime) {
    return res.status(400).json({ error: 'Vereiste velden ontbreken.' });
  }

  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE access_token = ? AND status = ?').get(token, 'paid');
  if (!order) return res.status(403).json({ error: 'Geen geldige betaalde bestelling gevonden.' });

  if (order.lessons_used >= order.lessons_total) {
    return res.status(400).json({ error: 'Alle lessen in dit pakket zijn al geboekt.' });
  }

  const slot = db.prepare(`
    SELECT * FROM availability WHERE date = ? AND slot_time = ? AND active = 1 AND (max_spots - booked) > 0
  `).get(date, slotTime);

  if (!slot) return res.status(409).json({ error: 'Dit tijdslot is niet meer beschikbaar.' });

  const bookingUuid = uuidv4();

  const bookTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO bookings (uuid, order_id, avail_id, date, slot_time, status, notes)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(bookingUuid, order.id, slot.id, date, slotTime, notes || null);

    db.prepare('UPDATE availability SET booked = booked + 1 WHERE id = ?').run(slot.id);
    db.prepare('UPDATE orders SET lessons_used = lessons_used + 1, updated_at = datetime(\'now\') WHERE id = ?').run(order.id);
  });

  bookTx();

  const booking = db.prepare('SELECT * FROM bookings WHERE uuid = ?').get(bookingUuid);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);

  await sendBookingConfirmation(customer, booking, order).catch(console.error);

  res.json({ success: true, bookingId: bookingUuid });
});

// GET /api/bookings/my-lessons/:token  — haal lessen op voor een bestelling
router.get('/my-lessons/:token', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE access_token = ?').get(req.params.token);
  if (!order) return res.status(404).json({ error: 'Bestelling niet gevonden.' });

  const bookings = db.prepare(`
    SELECT * FROM bookings WHERE order_id = ? ORDER BY date, slot_time
  `).all(order.id);

  const customer = db.prepare('SELECT name, email, level FROM customers WHERE id = ?').get(order.customer_id);

  res.json({
    order: {
      packageName: order.package_name,
      lessonsTotal: order.lessons_total,
      lessonsUsed: order.lessons_used,
      lessonsRemaining: order.lessons_total - order.lessons_used,
      status: order.status,
      expiresAt: order.expires_at,
      paidAt: order.paid_at,
    },
    customer,
    bookings,
  });
});

// ── ADMIN ROUTES ──

// GET /api/bookings/admin/all
router.get('/admin/all', requireAdmin, (req, res) => {
  const db = getDb();
  const bookings = db.prepare(`
    SELECT b.*, c.name AS customer_name, c.email AS customer_email,
           o.package_name, o.lessons_total
    FROM bookings b
    JOIN orders o ON o.id = b.order_id
    JOIN customers c ON c.id = o.customer_id
    ORDER BY b.date DESC, b.slot_time DESC
  `).all();
  res.json(bookings);
});

// POST /api/bookings/admin/availability  — stel beschikbaarheid in
router.post('/admin/availability', requireAdmin, (req, res) => {
  const { date, slotTime, maxSpots, active } = req.body;
  if (!date || !slotTime) return res.status(400).json({ error: 'date en slotTime vereist.' });

  const db = getDb();
  db.prepare(`
    INSERT INTO availability (date, slot_time, max_spots, booked, active)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(date, slot_time) DO UPDATE SET max_spots = excluded.max_spots, active = excluded.active
  `).run(date, slotTime, maxSpots || 1, active !== false ? 1 : 0);

  res.json({ success: true });
});

// DELETE /api/bookings/admin/availability/:date/:time  — verwijder een slot
router.delete('/admin/availability/:date/:time', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE availability SET active = 0 WHERE date = ? AND slot_time = ?')
    .run(req.params.date, req.params.time);
  res.json({ success: true });
});

// POST /api/bookings/admin/bulk-availability  — maak meerdere slots aan
router.post('/admin/bulk-availability', requireAdmin, (req, res) => {
  const { startDate, endDate, times, skipWeekends } = req.body;
  if (!startDate || !endDate || !times?.length) {
    return res.status(400).json({ error: 'startDate, endDate en times vereist.' });
  }

  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO availability (date, slot_time, max_spots, booked, active)
    VALUES (?, ?, 1, 0, 1)
  `);

  const insertMany = db.transaction(() => {
    let d = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    while (d <= end) {
      const dow = d.getDay();
      if (!skipWeekends || (dow !== 0 && dow !== 6)) {
        const dateStr = d.toISOString().slice(0, 10);
        for (const t of times) {
          insert.run(dateStr, t);
          count++;
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return count;
  });

  const count = insertMany();
  res.json({ success: true, slotsCreated: count });
});

// PUT /api/bookings/admin/booking/:id/zoom  — voeg Zoom link toe
router.put('/admin/booking/:id/zoom', requireAdmin, (req, res) => {
  const { zoomLink } = req.body;
  const db = getDb();
  db.prepare('UPDATE bookings SET zoom_link = ? WHERE id = ?').run(zoomLink, req.params.id);
  res.json({ success: true });
});

// PUT /api/bookings/admin/booking/:id/status
router.put('/admin/booking/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'cancelled', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Ongeldige status.' });
  }
  const db = getDb();
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

module.exports = router;
