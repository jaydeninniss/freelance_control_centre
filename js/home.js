// Section init pattern: each section exposes a global initSectionName() function.
// router.js calls window['init' + Section]() after injecting the section HTML,
// if that function exists. Future phases follow the same convention:
//   initFinance(), initTasks(), initCrm(), initProjects(), initDocuments()

let _clockInterval = null;

function initHome() {
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');

  if (!timeEl || !dateEl) return;

  // Clear any previous interval if the user navigates away and back
  if (_clockInterval) clearInterval(_clockInterval);

  function tick() {
    const now = new Date();

    // HH:MM:SS — 24-hour, zero-padded
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    timeEl.textContent = `${hh}:${mm}:${ss}`;

    // e.g. "Wednesday, May 20 2026"
    dateEl.textContent = now.toLocaleDateString('en-CA', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/Vancouver'
    });
  }

  tick(); // run immediately so there's no 1-second blank delay
  _clockInterval = setInterval(tick, 1000);
}
