const VALID_SECTIONS = ['home', 'finance', 'tasks', 'crm', 'projects', 'documents'];

async function navigate(section) {
  if (!VALID_SECTIONS.includes(section)) section = 'home';

  // Update hash without triggering another hashchange
  if (window.location.hash !== `#${section}`) {
    history.replaceState(null, '', `#${section}`);
  }

  // Update active sidebar button
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  // Fetch and inject section HTML
  const panel = document.getElementById('section-panel');
  try {
    const res = await fetch(`sections/${section}.html`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    panel.innerHTML = await res.text();

    // Section init pattern: after injecting HTML, call initSectionName() if it exists.
    // Each section's JS file exposes a global init function following this convention:
    //   home → initHome(), finance → initFinance(), tasks → initTasks(), etc.
    // Future phases just need to define their init function — the router wires it up automatically.
    const initFn = 'init' + section.charAt(0).toUpperCase() + section.slice(1);
    if (typeof window[initFn] === 'function') window[initFn]();
  } catch (err) {
    panel.innerHTML = `<div class="section-placeholder">
      <h2 class="section-title">Error</h2>
      <p class="section-subtitle">Could not load section: ${section}</p>
    </div>`;
  }
}

function initRouter() {
  window.addEventListener('hashchange', () => {
    const section = window.location.hash.replace('#', '') || 'home';
    navigate(section);
  });
}
