document.addEventListener('DOMContentLoaded', () => {
  const authGate = document.getElementById('auth-gate');
  const app = document.getElementById('app');
  const unlockBtn = document.getElementById('unlock-btn');
  const passwordInput = document.getElementById('password-input');
  const rememberMe = document.getElementById('remember-me');
  const authError = document.getElementById('auth-error');

  // ── Cookie helpers ────────────────────────────────────────
  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict`;
  }

  function getCookie(name) {
    return document.cookie.split('; ').reduce((acc, part) => {
      const [k, v] = part.split('=');
      return k === name ? v : acc;
    }, null);
  }

  // ── SHA-256 hash via Web Crypto ───────────────────────────
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Auth flow ─────────────────────────────────────────────
  function revealApp() {
    authGate.style.display = 'none';
    app.style.display = 'flex';
    initRouter();
    const startSection = window.location.hash.replace('#', '') || 'home';
    navigate(startSection);
  }

  function checkCookieAuth() {
    return getCookie('fcc_auth') === 'authenticated';
  }

  if (checkCookieAuth()) {
    revealApp();
  } else {
    authGate.style.display = 'flex';
    app.style.display = 'none';
    passwordInput.focus();
  }

  // ── Unlock button ─────────────────────────────────────────
  async function attemptUnlock() {
    const password = passwordInput.value;
    if (!password) return;

    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Checking…';

    const hash = await sha256(password);

    if (hash === CONFIG.PASSWORD_HASH) {
      if (rememberMe.checked) {
        setCookie('fcc_auth', 'authenticated', CONFIG.REMEMBER_ME_DAYS);
      } else {
        // Session-only cookie (no expiry)
        document.cookie = `fcc_auth=authenticated; path=/; SameSite=Strict`;
      }
      revealApp();
    } else {
      authError.textContent = 'Incorrect password.';
      passwordInput.value = '';
      passwordInput.focus();
      unlockBtn.disabled = false;
      unlockBtn.textContent = 'Unlock';
    }
  }

  unlockBtn.addEventListener('click', attemptUnlock);
  passwordInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptUnlock();
  });

  // ── Sidebar nav ───────────────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.section));
  });
});
