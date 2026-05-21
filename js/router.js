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
