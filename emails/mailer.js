const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const baseUrl = () => process.env.BASE_URL || 'http://localhost:3000';

function mailStyle() {
  return `
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #FFFBF0; margin: 0; padding: 0; }
      .wrap { max-width: 560px; margin: 32px auto; background: #fff; border: 2px solid #1A1A2E; border-radius: 16px; overflow: hidden; box-shadow: 4px 4px 0 #1A1A2E; }
      .header { background: #FFD166; padding: 28px 32px; border-bottom: 2px solid #1A1A2E; }
      .header h1 { margin: 0; font-size: 24px; color: #1A1A2E; font-weight: 900; }
      .body { padding: 28px 32px; }
      .body p { color: #3D3D5C; line-height: 1.7; margin-bottom: 14px; font-size: 15px; }
      .card { background: #FFFBF0; border: 2px solid #EEE8D5; border-radius: 12px; padding: 18px 22px; margin: 18px 0; }
      .card .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
      .card .label { color: #7A7A9A; font-weight: 700; }
      .card .val { color: #1A1A2E; font-weight: 800; }
      .btn { display: inline-block; background: #06D6A0; color: #1A1A2E; text-decoration: none; padding: 14px 28px; border-radius: 50px; font-weight: 900; font-size: 15px; border: 2px solid #1A1A2E; box-shadow: 3px 3px 0 #1A1A2E; }
      .footer { background: #1A1A2E; padding: 16px 32px; text-align: center; }
      .footer p { color: rgba(255,255,255,.4); font-size: 12px; margin: 0; }
    </style>
  `;
}

async function sendOrderConfirmation(customer, order, accessToken) {
  if (!process.env.SMTP_USER) return;
  const transport = createTransport();
  const lessonsUrl = `${baseUrl()}/mijn-lessen.html?token=${accessToken}`;

  await transport.sendMail({
    from:    process.env.EMAIL_FROM || 'simone@manthano.nl',
    to:      customer.email,
    subject: `Betaling bevestigd — ${order.package_name} ✅`,
    html: `<!DOCTYPE html><html><head>${mailStyle()}</head><body>
      <div class="wrap">
        <div class="header"><h1>Manthano 🎉</h1></div>
        <div class="body">
          <p>Hoi <strong>${customer.name}</strong>!</p>
          <p>Je betaling is geslaagd. Fijn dat je voor Manthano hebt gekozen — ik kijk ernaar uit om met je aan de slag te gaan!</p>
          <div class="card">
            <div class="row"><span class="label">Pakket</span><span class="val">${order.package_name}</span></div>
            <div class="row"><span class="label">Aantal lessen</span><span class="val">${order.lessons_total} lessen</span></div>
            <div class="row"><span class="label">Bedrag</span><span class="val">€${(order.amount_cents / 100).toFixed(2)}</span></div>
            <div class="row"><span class="label">Geldig tot</span><span class="val">${order.expires_at ? order.expires_at.slice(0, 10) : '—'}</span></div>
          </div>
          <p>Klik hieronder om je lessen in te plannen op een tijdstip dat jou uitkomt:</p>
          <p style="text-align:center;margin:24px 0"><a class="btn" href="${lessonsUrl}">Mijn lessen inplannen 📅</a></p>
          <p style="font-size:13px;color:#7A7A9A">Of kopieer deze link: <a href="${lessonsUrl}">${lessonsUrl}</a></p>
          <p>Vragen? Stuur me gerust een berichtje via <a href="mailto:simone@manthano.nl">simone@manthano.nl</a>.</p>
          <p>Tot snel!<br><strong>Simone — Manthano</strong></p>
        </div>
        <div class="footer"><p>© ${new Date().getFullYear()} Manthano · simone@manthano.nl</p></div>
      </div>
    </body></html>`,
  });
}

async function sendBookingConfirmation(customer, booking, order) {
  if (!process.env.SMTP_USER) return;
  const transport = createTransport();
  const lessonsUrl = `${baseUrl()}/mijn-lessen.html?token=${order.access_token}`;

  const dateNl = new Date(booking.date).toLocaleDateString('nl-NL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  await transport.sendMail({
    from:    process.env.EMAIL_FROM || 'simone@manthano.nl',
    to:      customer.email,
    subject: `Les ingepland — ${dateNl} om ${booking.slot_time} ✅`,
    html: `<!DOCTYPE html><html><head>${mailStyle()}</head><body>
      <div class="wrap">
        <div class="header"><h1>Les bevestigd! 📅</h1></div>
        <div class="body">
          <p>Hoi <strong>${customer.name}</strong>!</p>
          <p>Je les is ingepland. Hieronder vind je de details:</p>
          <div class="card">
            <div class="row"><span class="label">Datum</span><span class="val">${dateNl}</span></div>
            <div class="row"><span class="label">Tijdstip</span><span class="val">${booking.slot_time}</span></div>
            <div class="row"><span class="label">Duur</span><span class="val">1 uur (online)</span></div>
            ${booking.zoom_link ? `<div class="row"><span class="label">Zoom</span><span class="val"><a href="${booking.zoom_link}">${booking.zoom_link}</a></span></div>` : ''}
            <div class="row"><span class="label">Lessen resterend</span><span class="val">${order.lessons_total - order.lessons_used}</span></div>
          </div>
          ${!booking.zoom_link ? '<p>Ik stuur je de Zoom-link uiterlijk een uur van tevoren.</p>' : ''}
          <p style="text-align:center;margin:24px 0"><a class="btn" href="${lessonsUrl}">Mijn lessen bekijken 📋</a></p>
          <p>Tot ${dateNl.split(' ')[0]}!<br><strong>Simone — Manthano</strong></p>
        </div>
        <div class="footer"><p>© ${new Date().getFullYear()} Manthano · simone@manthano.nl</p></div>
      </div>
    </body></html>`,
  });
}

module.exports = { sendOrderConfirmation, sendBookingConfirmation };
