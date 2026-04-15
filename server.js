require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const paymentsRouter = require('./routes/payments');
const bookingsRouter = require('./routes/bookings');
const ordersRouter   = require('./routes/orders');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:     ["'self'", 'fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
    },
  },
}));

// ── Rate limiting
app.use('/api/payments', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ── Body parsing
// Mollie webhook stuurt form-encoded body
app.use('/api/payments/webhook',         express.urlencoded({ extended: false }));
app.use('/api/payments/webhook-digital', express.urlencoded({ extended: false }));
app.use(express.json());

// ── API routes
app.use('/api/payments', paymentsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/orders',   ordersRouter);

// ── Static files
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA fallback (voor alle niet-API routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Globale foutafhandeling: altijd JSON teruggeven voor /api routes
app.use((err, req, res, next) => {
  console.error('Server fout:', err.message, err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: err.message || 'Interne serverfout.' });
  }
  next(err);
});

// ── Init DB en start server
const { initDb } = require('./db/database');

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 Manthano server draait op http://localhost:${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin/`);
    console.log(`   Modus: ${process.env.NODE_ENV || 'development'}\n`);
  });
}).catch(err => {
  console.error('Database initialisatie mislukt:', err);
  process.exit(1);
});
