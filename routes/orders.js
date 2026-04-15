const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// GET /api/orders/packages  — alle pakketten (publiek)
router.get('/packages', (req, res) => {
  const db = getDb();
  const pkgs = db.prepare('SELECT * FROM packages WHERE active = 1 ORDER BY sort_order').all();
  res.json(pkgs);
});

// GET /api/orders/digital-products  — digitale producten (publiek)
router.get('/digital-products', (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT id, slug, name, description, price FROM digital_products WHERE active = 1').all();
  res.json(products);
});

// ── ADMIN ROUTES ──

// GET /api/orders/admin/orders  — alle bestellingen
router.get('/admin/orders', requireAdmin, (req, res) => {
  const db = getDb();
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = `
    SELECT o.*, c.name AS customer_name, c.email AS customer_email,
           c.phone AS customer_phone, c.level AS customer_level,
           p.slug AS package_slug
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN packages p ON p.id = o.package_id
  `;
  const params = [];

  if (status) {
    query += ' WHERE o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const orders = db.prepare(query).all(...params);

  const total = status
    ? db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status = ?').get(status).n
    : db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

  res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/orders/admin/orders/:id  — één bestelling
router.get('/admin/orders/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.email AS customer_email,
           c.phone AS customer_phone, c.level AS customer_level, c.notes AS customer_notes
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(req.params.id);

  if (!order) return res.status(404).json({ error: 'Bestelling niet gevonden.' });

  const bookings = db.prepare('SELECT * FROM bookings WHERE order_id = ? ORDER BY date').all(order.id);
  res.json({ order, bookings });
});

// GET /api/orders/admin/stats  — dashboard statistieken
router.get('/admin/stats', requireAdmin, (req, res) => {
  const db = getDb();

  const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS total FROM orders WHERE status = 'paid'").get().total;
  const totalOrders  = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid'").get().n;
  const pending      = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").get().n;
  const totalStudents= db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  const upcomingLessons = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND date >= date('now')").get().n;
  const recentOrders = db.prepare(`
    SELECT o.id, o.package_name, o.amount_cents, o.status, o.created_at,
           c.name AS customer_name, c.email AS customer_email
    FROM orders o JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  const revenueByMonth = db.prepare(`
    SELECT strftime('%Y-%m', paid_at) AS month,
           SUM(amount_cents) AS revenue,
           COUNT(*) AS orders
    FROM orders WHERE status = 'paid'
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();

  res.json({ totalRevenue, totalOrders, pending, totalStudents, upcomingLessons, recentOrders, revenueByMonth });
});

// PUT /api/orders/admin/orders/:id/status
router.put('/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'paid', 'expired', 'refunded'].includes(status)) {
    return res.status(400).json({ error: 'Ongeldige status.' });
  }
  const db = getDb();
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ success: true });
});

// GET /api/orders/admin/customers
router.get('/admin/customers', requireAdmin, (req, res) => {
  const db = getDb();
  const customers = db.prepare(`
    SELECT c.*, COUNT(o.id) AS order_count,
           SUM(CASE WHEN o.status = 'paid' THEN o.amount_cents ELSE 0 END) AS total_spent
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all();
  res.json(customers);
});

module.exports = router;
