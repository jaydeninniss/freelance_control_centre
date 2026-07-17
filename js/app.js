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
    initSidebarReorder();
    initRouter();
    const startSection = window.location.hash.replace('#', '') || 'home';
    navigate(startSection);
  }

  function checkCookieAuth() {
    return getCookie('fcc_auth') === 'authenticated';
  }

  revealApp();

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
    btn.addEventListener('click', () => {
      if (document.getElementById('sidebar').classList.contains('reorder-mode')) return;
      navigate(btn.dataset.section);
    });
  });
});

// ── Sidebar Reorder ────────────────────────────────────────
function initSidebarReorder() {
  const sidebar  = document.getElementById('sidebar');
  const navItems = sidebar.querySelector('.nav-items');
  const toggle   = document.getElementById('sidebar-reorder-toggle');

  // Restore saved order
  const saved = localStorage.getItem('fcc_nav_order');
  if (saved) {
    try {
      const order = JSON.parse(saved);
      const btns  = [...navItems.querySelectorAll('.nav-btn')];
      const known = new Set(order);
      const ordered = order.map(s => btns.find(b => b.dataset.section === s)).filter(Boolean);
      btns.filter(b => !known.has(b.dataset.section)).forEach(b => ordered.push(b));
      ordered.forEach(b => navItems.appendChild(b));
    } catch (_) {}
  }

  let reorderMode = false;

  function saveOrder() {
    const order = [...navItems.querySelectorAll('.nav-btn')].map(b => b.dataset.section);
    localStorage.setItem('fcc_nav_order', JSON.stringify(order));
  }

  function setDraggable(enabled) {
    navItems.querySelectorAll('.nav-btn').forEach(b => { b.draggable = enabled; });
  }

  toggle.addEventListener('click', () => {
    reorderMode = !reorderMode;
    sidebar.classList.toggle('reorder-mode', reorderMode);
    toggle.title = reorderMode ? 'Done reordering' : 'Reorder tabs';
    setDraggable(reorderMode);
  });

  let dragSrc = null;

  navItems.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('.nav-btn');
    if (dragSrc) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrc.dataset.section);
      setTimeout(() => dragSrc.classList.add('dragging'), 0);
    }
  });

  navItems.addEventListener('dragend', () => {
    navItems.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('dragging', 'drag-over'));
    dragSrc = null;
  });

  navItems.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const over = e.target.closest('.nav-btn');
    if (over && over !== dragSrc) {
      navItems.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('drag-over'));
      over.classList.add('drag-over');
    }
  });

  navItems.addEventListener('dragleave', e => {
    if (!navItems.contains(e.relatedTarget)) {
      navItems.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('drag-over'));
    }
  });

  navItems.addEventListener('drop', e => {
    e.preventDefault();
    const over = e.target.closest('.nav-btn');
    if (!over || !dragSrc || over === dragSrc) return;

    const btns = [...navItems.querySelectorAll('.nav-btn')];
    const fromIdx = btns.indexOf(dragSrc);
    const toIdx   = btns.indexOf(over);

    if (fromIdx < toIdx) {
      over.after(dragSrc);
    } else {
      over.before(dragSrc);
    }

    navItems.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('drag-over'));
    saveOrder();
  });
}
