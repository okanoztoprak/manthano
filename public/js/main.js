/* ══════════════════════════════════════════════════
   MANTHANO — Gedeelde JavaScript
   ══════════════════════════════════════════════════ */

// ── Mobile hamburger
(function () {
  const burger = document.getElementById('burger');
  const mob    = document.getElementById('mob-menu');
  if (!burger || !mob) return;

  burger.addEventListener('click', () => {
    burger.classList.toggle('open');
    mob.classList.toggle('open');
  });

  document.querySelectorAll('.mobile-menu a').forEach(a => {
    a.addEventListener('click', () => {
      burger.classList.remove('open');
      mob.classList.remove('open');
    });
  });
})();

// ── Aktieve nav link markeren
(function () {
  const path = window.location.pathname.replace(/\/$/, '') || '/index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(a => {
    const href = new URL(a.href, window.location.href).pathname.replace(/\/$/, '');
    if (href === path || (path === '' && href === '/index.html')) {
      a.classList.add('active');
    }
  });
})();

// ── Hulpfuncties
function formatEuro(cents) {
  return '€' + (cents / 100).toFixed(2).replace('.', ',');
}

function showAlert(el, msg, type = 'success') {
  el.textContent = msg;
  el.className = `alert alert-${type} show`;
}

function setLoading(btn, loading, text) {
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Even geduld…`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || text || btn.innerHTML;
    btn.disabled = false;
  }
}

// ── Smooth scroll voor hash-links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// ── Contact formulier (homepage)
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = form.querySelector('[type=submit]');
    const alert = document.getElementById('contact-alert');
    setLoading(btn, true);
    // Eenvoudige mailto fallback — vervang door echte backend call indien gewenst
    await new Promise(r => setTimeout(r, 800));
    setLoading(btn, false);
    showAlert(alert, 'Bedankt voor je bericht! Ik reageer binnen 24 uur. 🙌', 'success');
    form.reset();
  });
})();
