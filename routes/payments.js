const express = require('express');
const router = express.Router();
const { createMollieClient } = require('@mollie/api-client');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { sendOrderConfirmation } = require('../emails/mailer');

function getMollie() {
  return createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });
}

// POST /api/payments/create  — maak een betaling aan voor een pakket
router.post('/create', async (req, res) => {
  const { packageSlug, customerName, customerEmail, customerPhone, customerLevel, notes } = req.body;

  if (!packageSlug || !customerName || !customerEmail) {
    return res.status(400).json({ error: 'Vereiste velden ontbreken.' });
  }

  const db = getDb();
  const pkg = db.prepare('SELECT * FROM packages WHERE slug = ? AND active = 1').get(packageSlug);
  if (!pkg) return res.status(404).json({ error: 'Pakket niet gevonden.' });

  // Klant opslaan of ophalen
  let customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(customerEmail);
  if (!customer) {
    const info = db.prepare(
      'INSERT INTO customers (name, email, phone, level, notes) VALUES (?, ?, ?, ?, ?)'
    ).run(customerName, customerEmail, customerPhone || null, customerLevel || null, notes || null);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid);
  }

  const orderUuid   = uuidv4();
  const accessToken = uuidv4().replace(/-/g, '');
  const expiresAt   = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO orders (uuid, customer_id, package_id, package_name, lessons_total, amount_cents, access_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderUuid, customer.id, pkg.id, pkg.name, pkg.lessons, pkg.price, accessToken, expiresAt);

  const order = db.prepare('SELECT * FROM orders WHERE uuid = ?').get(orderUuid);

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

  try {
    const mollie = getMollie();
    const payment = await mollie.payments.create({
      amount:      { currency: 'EUR', value: (pkg.price / 100).toFixed(2) },
      description: `Manthano — ${pkg.name}`,
      redirectUrl: `${baseUrl}/bevestiging.html?token=${accessToken}`,
      webhookUrl:  `${baseUrl}/api/payments/webhook`,
      metadata:    { orderUuid, accessToken },
    });

    db.prepare('UPDATE orders SET mollie_id = ?, mollie_status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(payment.id, payment.status, order.id);

    res.json({ checkoutUrl: payment.links.checkout.href });
  } catch (err) {
    console.error('Mollie fout:', err);
    res.status(500).json({ error: 'Betaling aanmaken mislukt.' });
  }
});

// POST /api/payments/create-digital  — betaling voor digitaal product
router.post('/create-digital', async (req, res) => {
  const { productSlug, customerName, customerEmail } = req.body;
  if (!productSlug || !customerName || !customerEmail) {
    return res.status(400).json({ error: 'Vereiste velden ontbreken.' });
  }

  const db = getDb();
  const product = db.prepare('SELECT * FROM digital_products WHERE slug = ? AND active = 1').get(productSlug);
  if (!product) return res.status(404).json({ error: 'Product niet gevonden.' });

  const orderUuid   = uuidv4();
  const accessToken = uuidv4().replace(/-/g, '');

  db.prepare(`
    INSERT INTO digital_orders (uuid, customer_name, customer_email, product_id, amount_cents, access_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderUuid, customerName, customerEmail, product.id, product.price, accessToken);

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

  try {
    const mollie = getMollie();
    const payment = await mollie.payments.create({
      amount:      { currency: 'EUR', value: (product.price / 100).toFixed(2) },
      description: `Manthano — ${product.name}`,
      redirectUrl: `${baseUrl}/bevestiging.html?token=${accessToken}&type=digital`,
      webhookUrl:  `${baseUrl}/api/payments/webhook-digital`,
      metadata:    { orderUuid, accessToken, type: 'digital' },
    });

    db.prepare('UPDATE digital_orders SET mollie_id = ?, updated_at = datetime(\'now\') WHERE uuid = ?')
      .run(payment.id, orderUuid);

    res.json({ checkoutUrl: payment.links.checkout.href });
  } catch (err) {
    console.error('Mollie fout:', err);
    res.status(500).json({ error: 'Betaling aanmaken mislukt.' });
  }
});

// POST /api/payments/webhook  — Mollie webhook voor pakket-betalingen
router.post('/webhook', async (req, res) => {
  const mollieId = req.body.id;
  if (!mollieId) return res.status(200).end();

  try {
    const mollie = getMollie();
    const payment = await mollie.payments.get(mollieId);
    const { orderUuid, accessToken } = payment.metadata || {};

    if (!orderUuid) return res.status(200).end();

    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE uuid = ?').get(orderUuid);
    if (!order) return res.status(200).end();

    db.prepare(`
      UPDATE orders SET mollie_status = ?, updated_at = datetime('now')
      ${payment.status === 'paid' ? ", status = 'paid', paid_at = datetime('now')" : ''}
      WHERE id = ?
    `).run(payment.status, order.id);

    if (payment.status === 'paid' && order.status !== 'paid') {
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
      await sendOrderConfirmation(customer, order, accessToken).catch(console.error);
    }
  } catch (err) {
    console.error('Webhook fout:', err);
  }
  res.status(200).end();
});

// POST /api/payments/webhook-digital
router.post('/webhook-digital', async (req, res) => {
  const mollieId = req.body.id;
  if (!mollieId) return res.status(200).end();

  try {
    const mollie = getMollie();
    const payment = await mollie.payments.get(mollieId);
    const { orderUuid } = payment.metadata || {};
    if (!orderUuid) return res.status(200).end();

    const db = getDb();
    if (payment.status === 'paid') {
      db.prepare(`
        UPDATE digital_orders SET status = 'paid', paid_at = datetime('now') WHERE uuid = ?
      `).run(orderUuid);
    }
  } catch (err) {
    console.error('Webhook-digital fout:', err);
  }
  res.status(200).end();
});

// GET /api/payments/status/:token  — check betalingsstatus via access token
router.get('/status/:token', (req, res) => {
  const db = getDb();
  const order = db.prepare('SELECT o.*, c.name, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.access_token = ?').get(req.params.token);
  if (order) return res.json({ type: 'lesson', status: order.status, packageName: order.package_name });

  const dOrder = db.prepare('SELECT * FROM digital_orders WHERE access_token = ?').get(req.params.token);
  if (dOrder) return res.json({ type: 'digital', status: dOrder.status });

  res.status(404).json({ error: 'Bestelling niet gevonden.' });
});

module.exports = router;
