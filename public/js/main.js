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

// ── Cookie banner
(function () {
  if (localStorage.getItem('cookie_ok')) return;
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;
  requestAnimationFrame(() => banner.classList.add('visible'));
  document.getElementById('cookie-accept')?.addEventListener('click', () => {
    localStorage.setItem('cookie_ok', '1');
    banner.classList.remove('visible');
  });
  document.getElementById('cookie-decline')?.addEventListener('click', () => {
    localStorage.setItem('cookie_ok', '0');
    banner.classList.remove('visible');
  });
})();

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

// ── Scroll reveal
(function () {
  if (!window.IntersectionObserver) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });

  document.querySelectorAll(
    '.card,.svc-card,.rev-card,.p-card,.upsell,' +
    '.section-heading,.about-wrap>div,.svc-stack>article,' +
    '.form-card,.c-item,.foot-col'
  ).forEach((el, i, arr) => {
    el.classList.add('reveal');
    // Stagger siblings in the same grid/flex parent
    const siblings = Array.from(el.parentElement.children).filter(c => c.classList.contains('reveal'));
    const idx = siblings.indexOf(el);
    if (idx === 1) el.classList.add('d1');
    if (idx === 2) el.classList.add('d2');
    if (idx === 3) el.classList.add('d3');
    io.observe(el);
  });
})();

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
