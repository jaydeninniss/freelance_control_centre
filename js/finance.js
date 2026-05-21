// ─────────────────────────────────────────────────────────────
// Finance Tab — all 4 calculators in one file.
// Called by the router's section init pattern: initFinance()
// Each sub-calculator is namespaced (tt*, qc*, bgt*, cf*).
// ─────────────────────────────────────────────────────────────

// ── Shared utilities ──────────────────────────────────────────

function setText(id, v) {
  const e = document.getElementById(id);
  if (e) e.textContent = v;
}

function fmtRound(n) {
  return '$' + Math.round(Math.abs(n)).toLocaleString('en-CA');
}

function fmtDec(n) {
  return '$' + Number(Math.abs(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPlain(n) {
  return '$' + Math.round(n).toLocaleString('en-CA');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

let _fiToastTimer;
function fiToast(msg) {
  const el = document.getElementById('fi-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_fiToastTimer);
  _fiToastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Finance init + sub-tab switching ─────────────────────────

function initFinance() {
  // Wire sub-tab buttons
  document.querySelectorAll('.finance-tab').forEach(btn => {
    btn.addEventListener('click', () => fiSwitchTab(btn.dataset.tab));
  });

  // Init all calculators (DOM is fresh each time section loads)
  ttInit();
  qcInit();
  bgtInit();
  cfInit();

  // Document-level listeners (tooltips + Escape key for modal)
  document.addEventListener('click', _fiHandleDocClick);
  document.addEventListener('keydown', _fiHandleDocKey);
}

function fiSwitchTab(tab) {
  document.querySelectorAll('.finance-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.finance-panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tab}`)
  );
}

function _fiHandleDocClick(e) {
  if (!e.target.closest('.help')) {
    document.querySelectorAll('.help.open').forEach(h => h.classList.remove('open'));
  }
}

function _fiHandleDocKey(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('tt-modal');
    if (modal) modal.classList.remove('open');
    ttCancelEdit();
  }
}


// ══════════════════════════════════════════════════════════════
//  TAX TRACKER
// ══════════════════════════════════════════════════════════════

const TT_KEY = 'fcc_tax_tracker';
const TT_OLD_KEY = 'taxtracker_bc_2026'; // migrate old data

let TT = { invoices: [], wsBalance: 0, expenses: 0 };

const TT_TAX = {
  rate: 0.25,
  cpp: { rate: 0.119, ceiling: 74600, exemption: 3500, max: 8460.90 },
  fed: { bpa: 16129, brackets: [[0,58523,0.14],[58523,117045,0.205],[117045,181440,0.26],[181440,258482,0.29],[258482,Infinity,0.33]] },
  bc:  { bpa: 11981, brackets: [[0,50363,0.056],[50363,100728,0.077],[100728,115648,0.105],[115648,140430,0.1229],[140430,190405,0.147],[190405,265545,0.168],[265545,Infinity,0.205]] }
};

function ttSave() {
  try { localStorage.setItem(TT_KEY, JSON.stringify(TT)); } catch(e) {}
}

function ttLoad() {
  try {
    // Try new namespaced key first, then migrate from old standalone app key
    let raw = localStorage.getItem(TT_KEY);
    if (!raw) {
      raw = localStorage.getItem(TT_OLD_KEY);
      if (raw) {
        localStorage.setItem(TT_KEY, raw);
        localStorage.removeItem(TT_OLD_KEY);
      }
    }
    if (raw) TT = JSON.parse(raw);
  } catch(e) {}
}

function ttCalcCPP(inc) {
  return Math.min(
    (Math.max(0, Math.min(inc, TT_TAX.cpp.ceiling) - TT_TAX.cpp.exemption)) * TT_TAX.cpp.rate,
    TT_TAX.cpp.max
  );
}

function ttCalcBracket(taxable, brackets) {
  let t = 0;
  for (const [lo, hi, r] of brackets) {
    if (taxable <= lo) break;
    t += (Math.min(taxable, hi) - lo) * r;
  }
  return t;
}

function ttCalcTax(gross, expenses) {
  if (gross <= 0) return null;
  const netIncome = Math.max(0, gross - (expenses || 0));
  const cpp  = ttCalcCPP(netIncome);
  const half = cpp / 2;
  const net  = netIncome - half;
  const fed  = Math.max(0, ttCalcBracket(Math.max(0, net - TT_TAX.fed.bpa), TT_TAX.fed.brackets) - half * 0.15);
  const bc   = Math.max(0, ttCalcBracket(Math.max(0, net - TT_TAX.bc.bpa),  TT_TAX.bc.brackets)  - half * 0.056);
  return { cpp, fed, bc, total: cpp + fed + bc, netIncome };
}

function ttSum(key) {
  return TT.invoices.reduce((s, i) => s + i[key], 0);
}

function ttRender() {
  ttRenderHeader();
  ttRenderProgress();
  ttRenderBreakdown();
  ttRenderLedger();
}

function ttRenderHeader() {
  const earned = ttSum('amount'), tax = ttSum('tax'), ws = TT.wsBalance;
  const n = TT.invoices.length;

  setText('tt-h-earned', fmtRound(earned));
  setText('tt-h-tax', fmtRound(tax));
  setText('tt-h-ws', fmtRound(ws));

  const pctEl = document.getElementById('tt-h-pct');
  if (!pctEl) return;
  if (tax > 0) {
    const p = (ws / tax) * 100;
    pctEl.textContent = Math.round(Math.min(p, 999)) + '%';
    pctEl.style.color = p >= 100 ? 'var(--accent)' : p >= 60 ? 'var(--text-primary)' : p >= 35 ? 'var(--warning)' : 'var(--danger)';
  } else {
    pctEl.textContent = '—';
    pctEl.style.color = 'var(--text-muted)';
  }

  setText('tt-ledger-count', n > 0 ? `${n} invoice${n !== 1 ? 's' : ''}` : '');
}

function ttRenderProgress() {
  const tax = ttSum('tax'), ws = TT.wsBalance;
  const fill = document.getElementById('tt-prog-fill');
  if (!fill) return;

  if (tax <= 0) {
    fill.style.width = '0%';
    fill.style.background = 'var(--text-muted)';
    setText('tt-prog-pct', '');
    setText('tt-prog-saved', '$0 saved');
    setText('tt-prog-target', 'no invoices yet');
    return;
  }

  const p = Math.min((ws / tax) * 100, 100);
  fill.style.width = p + '%';
  setText('tt-prog-pct', Math.round(p) + '%');
  setText('tt-prog-saved', fmtRound(ws) + ' saved');
  setText('tt-prog-target', fmtRound(tax) + ' target');
  fill.style.background = p >= 100 ? 'var(--accent)' : p >= 60 ? 'var(--text-secondary)' : p >= 35 ? 'var(--warning)' : 'var(--danger)';
}

function ttRenderBreakdown() {
  const income = ttSum('amount');
  const expenses = TT.expenses || 0;
  const tax = ttCalcTax(income, expenses);

  if (!tax) {
    ['tt-bd-cpp','tt-bd-fed','tt-bd-bc','tt-bd-total','tt-bd-saving','tt-bd-diff','tt-bd-net'].forEach(id => {
      setText(id, '—');
      const e = document.getElementById(id);
      if (e) e.style.color = '';
    });
    const netRow = document.getElementById('tt-bd-net-row');
    if (netRow) netRow.style.display = 'none';
    return;
  }

  const netRow = document.getElementById('tt-bd-net-row');
  if (netRow) netRow.style.display = expenses > 0 ? 'flex' : 'none';
  if (expenses > 0) setText('tt-bd-net', fmtRound(tax.netIncome));

  const saving = income * TT_TAX.rate;
  const diff = saving - tax.total;

  setText('tt-bd-cpp', fmtRound(tax.cpp));
  setText('tt-bd-fed', fmtRound(tax.fed));
  setText('tt-bd-bc', fmtRound(tax.bc));
  setText('tt-bd-total', fmtRound(tax.total));
  setText('tt-bd-saving', fmtRound(saving));

  const el = document.getElementById('tt-bd-diff');
  if (el) {
    el.textContent = (diff >= 0 ? '+' : '−') + fmtRound(Math.abs(diff));
    el.style.color = diff >= 0 ? 'var(--accent)' : 'var(--danger)';
  }
}

function ttRenderLedger() {
  const empty = document.getElementById('tt-ledger-empty');
  const wrap  = document.getElementById('tt-ledger-wrap');
  const body  = document.getElementById('tt-ledger-body');
  const totals = document.getElementById('tt-ledger-totals');
  if (!empty || !wrap || !body) return;

  if (TT.invoices.length === 0) {
    empty.style.display = 'block';
    wrap.style.display  = 'none';
    return;
  }

  empty.style.display = 'none';
  wrap.style.display  = 'block';

  const sorted = [...TT.invoices].sort((a, b) => b.date.localeCompare(a.date));
  body.innerHTML = sorted.map(inv => `
    <tr data-id="${inv.id}">
      <td class="date-col">${esc(inv.date)}</td>
      <td class="desc-col" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(inv.desc)}">${esc(inv.desc)}</td>
      <td class="amt-col r">${fmtDec(inv.amount)}</td>
      <td class="tax-col r">${fmtRound(inv.tax)}</td>
      <td style="width:70px">
        <div class="tt-row-actions">
          <button class="tt-icon-btn" onclick="ttStartEdit(${inv.id})" title="Edit">✎</button>
          <button class="tt-icon-btn del" onclick="ttDel(${inv.id})" title="Delete">✕</button>
        </div>
      </td>
    </tr>
  `).join('');

  if (totals) {
    totals.innerHTML = `
      <div class="tt-lt-item"><div class="tt-lt-label">Total Invoiced</div><div class="tt-lt-value">${fmtDec(ttSum('amount'))}</div></div>
      <div class="tt-lt-item"><div class="tt-lt-label">Total to Set Aside</div><div class="tt-lt-value">${fmtRound(ttSum('tax'))}</div></div>
    `;
  }
}

// ── Tax Tracker actions (global — called from inline onclick) ─

function ttAddInvoice() {
  const raw = parseFloat(document.getElementById('tt-f-amount').value);
  if (!raw || raw <= 0) { fiToast('Enter a valid invoice amount.'); return; }

  const desc = document.getElementById('tt-f-desc').value.trim() || 'Invoice';
  const date = document.getElementById('tt-f-date').value || todayStr();
  const tax  = Math.round(raw * TT_TAX.rate);

  TT.invoices.unshift({ id: Date.now(), date, desc, amount: raw, tax });
  ttSave(); ttRender();

  document.getElementById('tt-f-amount').value = '';
  document.getElementById('tt-f-desc').value   = '';
  document.getElementById('tt-f-date').value   = todayStr();
  setText('tt-preview', '$0');

  fiToast(`Added ${fmtDec(raw)} — transfer ${fmtRound(tax)} to Wealthsimple`);
}

function ttDel(id) {
  TT.invoices = TT.invoices.filter(i => i.id !== id);
  ttSave(); ttRender();
  fiToast('Invoice removed.');
}

function ttStartEdit(id) {
  const inv = TT.invoices.find(i => i.id === id);
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!inv || !row) return;

  const cells = row.querySelectorAll('td');
  cells[0].innerHTML = `<input class="tt-edit-input" type="date" value="${esc(inv.date)}" style="width:105px">`;
  cells[1].innerHTML = `<input class="tt-edit-input" type="text" value="${esc(inv.desc)}">`;
  cells[2].innerHTML = `<input class="tt-edit-input" type="number" value="${inv.amount}" step="0.01" style="width:85px;text-align:right" oninput="ttLiveEditTax(${id},this.value)">`;
  cells[3].innerHTML = `<span id="tt-et-${id}" style="color:var(--text-secondary);font-variant-numeric:tabular-nums">${fmtRound(inv.tax)}</span>`;
  cells[4].innerHTML = `<div class="tt-row-actions" style="opacity:1">
    <button class="tt-icon-btn save" onclick="ttCommitEdit(${id})">✓</button>
    <button class="tt-icon-btn del"  onclick="ttCancelEdit()">✕</button>
  </div>`;

  cells[2].querySelector('input').focus();
}

function ttLiveEditTax(id, v) {
  const el = document.getElementById(`tt-et-${id}`);
  if (el) el.textContent = fmtRound(Math.round((parseFloat(v) || 0) * TT_TAX.rate));
}

function ttCommitEdit(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  const inputs = row.querySelectorAll('input');
  const amt = parseFloat(inputs[2].value);
  if (!amt || amt <= 0) { fiToast('Enter a valid amount.'); return; }

  const inv = TT.invoices.find(i => i.id === id);
  if (inv) {
    inv.date   = inputs[0].value || todayStr();
    inv.desc   = inputs[1].value.trim() || 'Invoice';
    inv.amount = amt;
    inv.tax    = Math.round(amt * TT_TAX.rate);
  }

  ttSave(); ttRender();
  fiToast('Invoice updated.');
}

function ttCancelEdit() { ttRender(); }

function ttSetWSBalance() {
  const v = Math.max(0, Math.round(parseFloat(document.getElementById('tt-ws-bal').value) || 0));
  TT.wsBalance = v;
  const inp = document.getElementById('tt-ws-bal');
  if (inp) inp.value = v || '';
  ttSave(); ttRender();
  fiToast(`Balance updated to ${fmtRound(v)}`);
}

function ttSetExpenses() {
  const v = Math.max(0, Math.round(parseFloat(document.getElementById('tt-exp-input').value) || 0));
  TT.expenses = v;
  const inp = document.getElementById('tt-exp-input');
  if (inp) inp.value = v || '';
  ttSave(); ttRenderBreakdown();
  fiToast(`Expenses updated to ${fmtRound(v)}`);
}

function ttPreviewTax() {
  const v = parseFloat(document.getElementById('tt-f-amount').value) || 0;
  setText('tt-preview', '$' + Math.round(v * TT_TAX.rate).toLocaleString('en-CA'));
}

function ttConfirmReset() {
  const modal = document.getElementById('tt-modal');
  if (modal) modal.classList.add('open');
}

function ttCloseModal() {
  const modal = document.getElementById('tt-modal');
  if (modal) modal.classList.remove('open');
}

function ttDoReset() {
  TT = { invoices: [], wsBalance: 0, expenses: 0 };
  ttSave(); ttRender();
  const wsBal = document.getElementById('tt-ws-bal');
  if (wsBal) wsBal.value = '';
  const expInp = document.getElementById('tt-exp-input');
  if (expInp) expInp.value = '';
  ttCloseModal();
  fiToast('All data cleared.');
}

function ttToggleTip(el) {
  const isOpen = el.classList.contains('open');
  document.querySelectorAll('.help.open').forEach(h => h.classList.remove('open'));
  if (!isOpen) el.classList.add('open');
}

// ── BC Tax Estimator (in Tax Tracker tab) ────────────────────

function ttEstCalcFedTax(taxable) {
  let tax = 0;
  if (taxable > 246752) { tax += (taxable - 246752) * 0.33; taxable = 246752; }
  if (taxable > 165430) { tax += (taxable - 165430) * 0.29; taxable = 165430; }
  if (taxable > 111733) { tax += (taxable - 111733) * 0.26; taxable = 111733; }
  if (taxable > 57375)  { tax += (taxable - 57375)  * 0.205; taxable = 57375; }
  tax += taxable * 0.15;
  return tax;
}

function ttEstCalcBCTax(taxable) {
  let tax = 0;
  if (taxable > 259829) { tax += (taxable - 259829) * 0.205; taxable = 259829; }
  if (taxable > 240716) { tax += (taxable - 240716) * 0.168; taxable = 240716; }
  if (taxable > 131220) { tax += (taxable - 131220) * 0.147; taxable = 131220; }
  if (taxable > 104835) { tax += (taxable - 104835) * 0.129; taxable = 104835; }
  if (taxable > 93476)  { tax += (taxable - 93476)  * 0.122; taxable = 93476;  }
  if (taxable > 45654)  { tax += (taxable - 45654)  * 0.077; taxable = 45654;  }
  tax += taxable * 0.0506;
  return tax;
}

function ttEstCalc() {
  const gross      = parseFloat(document.getElementById('tt-est-income').value)     || 0;
  const deductions = parseFloat(document.getElementById('tt-est-deductions').value) || 0;
  const net        = Math.max(0, gross - deductions);
  const cppBase    = Math.max(0, net - 3500);
  const cpp        = Math.min(cppBase * 0.119, 8068);
  const fedPersonal = 15705;
  const bcPersonal  = 11981;
  const fedTaxable  = Math.max(0, net - fedPersonal);
  const bcTaxable   = Math.max(0, net - bcPersonal);
  const fedTax      = Math.max(0, ttEstCalcFedTax(fedTaxable));
  const bcTax       = Math.max(0, ttEstCalcBCTax(bcTaxable));
  const total       = cpp + fedTax + bcTax;
  const effRate     = gross > 0 ? total / gross * 100 : 0;

  setText('tt-est-net',   fmtPlain(net));
  setText('tt-est-cpp',   fmtPlain(cpp));
  setText('tt-est-fed',   fmtPlain(fedTax));
  setText('tt-est-bc',    fmtPlain(bcTax));
  setText('tt-est-total', fmtPlain(total));
  setText('tt-est-rate',  effRate.toFixed(1) + '%');

  const bt = document.getElementById('tt-est-bracket-table');
  if (!bt) return;
  bt.innerHTML = '';
  const rows = [
    ['Federal bracket 1 (up to $57,375 @ 15%)',       fmtPlain(Math.min(fedTaxable, 57375) * 0.15)],
    ['Federal bracket 2 ($57,375–$111,733 @ 20.5%)',  fedTaxable > 57375 ? fmtPlain((Math.min(fedTaxable, 111733) - 57375) * 0.205) : '—'],
    ['BC bracket 1 (up to $45,654 @ 5.06%)',          fmtPlain(Math.min(bcTaxable, 45654) * 0.0506)],
    ['BC bracket 2 ($45,654–$93,476 @ 7.7%)',         bcTaxable > 45654 ? fmtPlain((Math.min(bcTaxable, 93476) - 45654) * 0.077) : '—'],
    ['CPP (self-employed, both halves @ 11.9%)',       fmtPlain(cpp)],
  ];
  rows.forEach(([label, val]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${label}</td><td>${val}</td>`;
    bt.appendChild(tr);
  });
}

// ── Tax Tracker init ──────────────────────────────────────────

function ttInit() {
  ttLoad();

  // Restore persisted inputs
  const wsBal = document.getElementById('tt-ws-bal');
  if (wsBal && TT.wsBalance) wsBal.value = TT.wsBalance;
  const expInp = document.getElementById('tt-exp-input');
  if (expInp && TT.expenses) expInp.value = TT.expenses;
  const fDate = document.getElementById('tt-f-date');
  if (fDate) fDate.value = todayStr();

  ttRender();
  ttEstCalc();

  // Keyboard shortcuts
  const fAmount = document.getElementById('tt-f-amount');
  if (fAmount) fAmount.addEventListener('keydown', e => { if (e.key === 'Enter') ttAddInvoice(); });
  const fDesc = document.getElementById('tt-f-desc');
  if (fDesc) fDesc.addEventListener('keydown', e => { if (e.key === 'Enter') fAmount && fAmount.focus(); });
  const wsBal2 = document.getElementById('tt-ws-bal');
  if (wsBal2) wsBal2.addEventListener('keydown', e => { if (e.key === 'Enter') ttSetWSBalance(); });
  const expInp2 = document.getElementById('tt-exp-input');
  if (expInp2) expInp2.addEventListener('keydown', e => { if (e.key === 'Enter') ttSetExpenses(); });
}


// ══════════════════════════════════════════════════════════════
//  QUOTE CALCULATOR
// ══════════════════════════════════════════════════════════════

const QC_FIELDS = ['qc-baseRate', 'qc-travel', 'qc-gear', 'qc-rush', 'qc-license'];

function qcCalc() {
  const base    = +document.getElementById('qc-baseRate').value;
  const travel  = +document.getElementById('qc-travel').value;
  const gear    = +document.getElementById('qc-gear').value;
  const rush    = +document.getElementById('qc-rush').value;
  const license = +document.getElementById('qc-license').value;

  setText('qc-baseRateVal', fmtPlain(base));
  setText('qc-travelVal',   fmtPlain(travel));
  setText('qc-gearVal',     fmtPlain(gear));
  setText('qc-rushVal',     rush + '%');
  setText('qc-licenseVal',  fmtPlain(license));

  const rushAmt  = base * (rush / 100);
  const total    = base + rushAmt + travel + gear + license;
  const afterFees = total * 0.97;
  const takeHome  = afterFees * 0.70;
  const hourly    = base / 8;

  setText('qc-quoteTotal', fmtPlain(total));
  setText('qc-afterFees',  fmtPlain(afterFees));
  setText('qc-takeHome',   fmtPlain(takeHome));
  setText('qc-hourly',     fmtPlain(hourly) + '/hr');

  // Persist to sessionStorage
  try {
    const s = {};
    QC_FIELDS.forEach(id => { s[id] = document.getElementById(id).value; });
    const active = document.querySelector('#qc-rate-types .qc-rt.active');
    if (active) s.activeType = active.dataset.type;
    sessionStorage.setItem('fcc_quote', JSON.stringify(s));
  } catch(e) {}
}

function qcInit() {
  // Restore session state
  try {
    const raw = sessionStorage.getItem('fcc_quote');
    if (raw) {
      const s = JSON.parse(raw);
      QC_FIELDS.forEach(id => { if (s[id] !== undefined) document.getElementById(id).value = s[id]; });
      if (s.activeType) {
        document.querySelectorAll('#qc-rate-types .qc-rt').forEach(b =>
          b.classList.toggle('active', b.dataset.type === s.activeType)
        );
      }
    }
  } catch(e) {}

  // Rate type buttons
  document.querySelectorAll('#qc-rate-types .qc-rt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#qc-rate-types .qc-rt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('qc-baseRate').value = btn.dataset.base;
      qcCalc();
    });
  });

  // Slider listeners
  QC_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', qcCalc);
  });

  qcCalc();
}


// ══════════════════════════════════════════════════════════════
//  BUDGET CALCULATOR
// ══════════════════════════════════════════════════════════════

const BGT_FIELDS = [
  'bgt-income', 'bgt-other-income',
  'bgt-rent', 'bgt-utilities', 'bgt-food', 'bgt-transport', 'bgt-personal',
  'bgt-gear', 'bgt-software', 'bgt-web', 'bgt-marketing', 'bgt-biz-other'
];

function bgtGet(id) { return +(document.getElementById(id) || {}).value || 0; }

function bgtCalc() {
  const income   = bgtGet('bgt-income') + bgtGet('bgt-other-income');
  const bizExp   = bgtGet('bgt-gear') + bgtGet('bgt-software') + bgtGet('bgt-web')
                 + bgtGet('bgt-marketing') + bgtGet('bgt-biz-other');
  const livExp   = bgtGet('bgt-rent') + bgtGet('bgt-utilities') + bgtGet('bgt-food')
                 + bgtGet('bgt-transport') + bgtGet('bgt-personal');

  const netIncome  = income - bizExp;
  const taxSavings = Math.max(0, Math.round(netIncome * 0.30));
  const taxInp = document.getElementById('bgt-tax');
  if (taxInp) taxInp.value = taxSavings;

  const totalExp = bizExp + livExp;
  const net      = income - totalExp - taxSavings;

  setText('bgt-m-income',   fmtPlain(income));
  setText('bgt-m-expenses', fmtPlain(totalExp));
  setText('bgt-m-tax',      fmtPlain(taxSavings));

  const netEl = document.getElementById('bgt-m-net');
  if (netEl) {
    netEl.textContent = fmtPlain(net);
    netEl.className = 'fi-metric-value ' + (net > 200 ? 'good' : net > 0 ? 'warn' : 'bad');
  }

  const pct = Math.min(100, Math.max(0, income > 0 ? (net / income) * 100 : 0));
  const bar = document.getElementById('bgt-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.style.background = net > 200 ? 'var(--accent)' : net > 0 ? 'var(--warning)' : 'var(--danger)';
  }
  setText('bgt-bar-left',  net >= 0 ? 'Surplus' : 'Deficit');
  setText('bgt-bar-right', fmtPlain(Math.abs(net)) + (net >= 0 ? ' left' : ' short'));

  // Persist to sessionStorage
  try {
    const s = {};
    BGT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) s[id] = el.value; });
    sessionStorage.setItem('fcc_budget', JSON.stringify(s));
  } catch(e) {}
}

function bgtInit() {
  // Restore session state
  try {
    const raw = sessionStorage.getItem('fcc_budget');
    if (raw) {
      const s = JSON.parse(raw);
      BGT_FIELDS.forEach(id => { if (s[id] !== undefined) { const el = document.getElementById(id); if (el) el.value = s[id]; } });
    }
  } catch(e) {}

  BGT_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', bgtCalc);
  });

  bgtCalc();
}


// ══════════════════════════════════════════════════════════════
//  CASH FLOW CALCULATOR
// ══════════════════════════════════════════════════════════════

const CF_DEFAULTS = [
  {
    id: 'income', label: 'Income', isIncome: true, expanded: true,
    items: [
      { label: 'Freelance income (photo/video/broadcast)', amount: 3500, freq: 'monthly' },
      { label: 'FIFA / event work income',                  amount: 0,    freq: 'monthly' },
      { label: 'Other income',                              amount: 0,    freq: 'monthly' },
    ]
  },
  {
    id: 'housing', label: 'Housing', isIncome: false, expanded: true,
    items: [
      { label: 'Rent',                       amount: 1400, freq: 'monthly' },
      { label: 'Utilities (hydro, internet)', amount: 200,  freq: 'monthly' },
      { label: 'Phone',                      amount: 80,   freq: 'monthly' },
      { label: "Renter's insurance",         amount: 30,   freq: 'monthly' },
    ]
  },
  {
    id: 'personal', label: 'Personal & Living', isIncome: false, expanded: true,
    items: [
      { label: 'Groceries',                   amount: 400, freq: 'monthly' },
      { label: 'Transport / gas',             amount: 150, freq: 'monthly' },
      { label: 'Eating out',                  amount: 100, freq: 'monthly' },
      { label: 'Entertainment / streaming',   amount: 50,  freq: 'monthly' },
      { label: 'Personal care / misc',        amount: 80,  freq: 'monthly' },
      { label: 'Clothing',                    amount: 50,  freq: 'monthly' },
    ]
  },
  {
    id: 'business', label: 'Business Expenses (deductible)', isIncome: false, expanded: true,
    items: [
      { label: 'Gear insurance / maintenance',         amount: 80, freq: 'monthly' },
      { label: 'Software (Adobe, Lightroom, etc.)',    amount: 60, freq: 'monthly' },
      { label: 'Website / domain / hosting',           amount: 20, freq: 'monthly' },
      { label: 'Marketing / portfolio costs',          amount: 50, freq: 'monthly' },
    ]
  },
  {
    id: 'savings', label: 'Savings', isIncome: false, expanded: true,
    items: [
      { label: 'Tax savings (Wealthsimple)', amount: 1050, freq: 'monthly' },
      { label: 'Emergency fund',             amount: 100,  freq: 'monthly' },
      { label: 'Other savings',              amount: 0,    freq: 'monthly' },
    ]
  },
  {
    id: 'debt', label: 'Debt Repayment', isIncome: false, expanded: false,
    items: [
      { label: 'Credit cards',  amount: 0, freq: 'monthly' },
      { label: 'Student loans', amount: 0, freq: 'monthly' },
      { label: 'Other loans',   amount: 0, freq: 'monthly' },
    ]
  }
];

// Deep clone helper
function cfCloneDefaults() {
  return CF_DEFAULTS.map(cat => ({
    ...cat,
    items: cat.items.map(item => ({ ...item }))
  }));
}

let CF = cfCloneDefaults();

function cfToMonthly(amount, freq) {
  switch (freq) {
    case 'weekly':    return amount * 4.33;
    case 'biweekly':  return amount * 2.165;
    case 'monthly':   return amount;
    case 'annually':  return amount / 12;
    default:          return amount;
  }
}

function cfCatMonthly(cat) {
  return cat.items.reduce((sum, item) => sum + cfToMonthly(item.amount || 0, item.freq), 0);
}

function cfCalcTotals() {
  let income = 0, expenses = 0;
  CF.forEach(cat => {
    const monthly = cfCatMonthly(cat);
    if (cat.isIncome) income += monthly;
    else expenses += monthly;
  });
  return { income, expenses, cashFlow: income - expenses };
}

function cfSave() {
  try { sessionStorage.setItem('fcc_cashflow', JSON.stringify(CF)); } catch(e) {}
}

function cfLoad() {
  try {
    const raw = sessionStorage.getItem('fcc_cashflow');
    if (raw) CF = JSON.parse(raw);
  } catch(e) {}
}

function cfRender() {
  const root = document.getElementById('cf-root');
  if (!root) return;

  const { income, expenses, cashFlow } = cfCalcTotals();
  const annualProj = cashFlow * 12;
  const isPos = cashFlow >= 0;

  root.innerHTML = `
    <div class="cf-layout">
      <!-- Categories -->
      <div id="cf-categories">
        ${CF.map((cat, catIdx) => `
          <div class="cf-category ${cat.expanded ? 'expanded' : ''}" data-cat="${catIdx}">
            <div class="cf-cat-header" onclick="cfToggleCategory(${catIdx})">
              <span class="cf-cat-title">${esc(cat.label)}</span>
              <div class="cf-cat-right">
                <span class="cf-cat-subtotal">${fmtPlain(cfCatMonthly(cat))}/mo</span>
                <span class="cf-cat-chevron">▶</span>
              </div>
            </div>
            <div class="cf-cat-body">
              ${cat.items.map((item, itemIdx) => `
                <div class="cf-line-item">
                  <div class="cf-line-label">
                    <input type="text"
                      value="${esc(item.label)}"
                      placeholder="Label"
                      onchange="cfUpdateLabel(${catIdx},${itemIdx},this.value)">
                  </div>
                  <input class="cf-amount-input" type="number" min="0" step="1"
                    value="${item.amount}"
                    oninput="cfUpdateAmount(${catIdx},${itemIdx},this.value)">
                  <select class="cf-freq-select" onchange="cfUpdateFreq(${catIdx},${itemIdx},this.value)">
                    <option value="weekly"   ${item.freq==='weekly'   ? 'selected':''}>Weekly</option>
                    <option value="biweekly" ${item.freq==='biweekly' ? 'selected':''}>Biweekly</option>
                    <option value="monthly"  ${item.freq==='monthly'  ? 'selected':''}>Monthly</option>
                    <option value="annually" ${item.freq==='annually' ? 'selected':''}>Annually</option>
                  </select>
                  <button class="cf-line-remove" onclick="cfRemoveLine(${catIdx},${itemIdx})" title="Remove">✕</button>
                </div>
              `).join('')}
              <button class="cf-add-line-btn" onclick="cfAddLine(${catIdx})">+ Add a line</button>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Results -->
      <div class="cf-results">
        <div class="cf-results-card">
          <div class="cf-results-title">Monthly Cash Flow</div>
          <div class="cf-results-cashflow ${isPos ? 'positive' : cashFlow < 0 ? 'negative' : 'neutral'}">
            ${isPos ? '+' : '−'}${fmtPlain(Math.abs(cashFlow)).replace('$','')}
          </div>
          <div class="cf-results-label">${isPos ? 'surplus' : 'deficit'} per month</div>

          <div class="cf-split-bar-wrap">
            <div class="cf-split-bar-bg">
              <div class="cf-split-bar-income" style="width:${income > 0 ? Math.min(100, income / (income + expenses) * 100) : 0}%"></div>
            </div>
            <div class="cf-split-bar-labels">
              <span style="color:var(--accent)">Income ${fmtPlain(income)}</span>
              <span style="color:var(--danger)">Expenses ${fmtPlain(expenses)}</span>
            </div>
          </div>

          <div class="fi-divider"></div>

          <div class="cf-results-row"><span class="r-label">Monthly income</span><span class="r-val">${fmtPlain(income)}</span></div>
          <div class="cf-results-row"><span class="r-label">Monthly expenses</span><span class="r-val">${fmtPlain(expenses)}</span></div>
          <div class="cf-results-row"><span class="r-label">Net cash flow</span><span class="r-val" style="color:${isPos ? 'var(--accent)' : 'var(--danger)'}">${isPos ? '+' : ''}${fmtPlain(cashFlow).replace('$', isPos ? '$' : '−$')}</span></div>
          <div class="cf-results-row"><span class="r-label">Annual projection</span><span class="r-val" style="color:${annualProj >= 0 ? 'var(--accent)' : 'var(--danger)'}">${annualProj >= 0 ? '+' : '−'}${fmtPlain(Math.abs(annualProj))}</span></div>

          <button class="cf-start-over-btn" onclick="cfReset()">Start Over</button>
        </div>
      </div>
    </div>
  `;
}

function cfToggleCategory(catIdx) {
  CF[catIdx].expanded = !CF[catIdx].expanded;
  cfSave();
  cfRender();
}

function cfUpdateLabel(catIdx, itemIdx, val) {
  CF[catIdx].items[itemIdx].label = val;
  cfSave();
  // Update subtotals without full re-render (label change doesn't affect totals)
}

function cfUpdateAmount(catIdx, itemIdx, val) {
  CF[catIdx].items[itemIdx].amount = parseFloat(val) || 0;
  cfSave();
  cfRenderResults();
}

function cfUpdateFreq(catIdx, itemIdx, val) {
  CF[catIdx].items[itemIdx].freq = val;
  cfSave();
  cfRenderResults();
}

function cfAddLine(catIdx) {
  CF[catIdx].items.push({ label: '', amount: 0, freq: 'monthly' });
  cfSave();
  cfRender();
}

function cfRemoveLine(catIdx, itemIdx) {
  if (CF[catIdx].items.length <= 1) { fiToast('Keep at least one line per category.'); return; }
  CF[catIdx].items.splice(itemIdx, 1);
  cfSave();
  cfRender();
}

// Lightweight results-only update (avoids full DOM re-render on amount/freq change)
function cfRenderResults() {
  const { income, expenses, cashFlow } = cfCalcTotals();
  const annualProj = cashFlow * 12;
  const isPos = cashFlow >= 0;

  // Update category subtotals
  document.querySelectorAll('.cf-category').forEach((el, idx) => {
    const sub = el.querySelector('.cf-cat-subtotal');
    if (sub && CF[idx]) sub.textContent = fmtPlain(cfCatMonthly(CF[idx])) + '/mo';
  });

  // Update results card
  const cfVal = document.querySelector('.cf-results-cashflow');
  if (cfVal) {
    cfVal.textContent = (isPos ? '+' : '−') + fmtPlain(Math.abs(cashFlow)).replace('$', '');
    cfVal.className = 'cf-results-cashflow ' + (isPos ? 'positive' : cashFlow < 0 ? 'negative' : 'neutral');
  }

  document.querySelectorAll('.cf-results-row .r-val').forEach((el, i) => {
    switch(i) {
      case 0: el.textContent = fmtPlain(income); break;
      case 1: el.textContent = fmtPlain(expenses); break;
      case 2:
        el.textContent = (isPos ? '+' : '−') + fmtPlain(Math.abs(cashFlow));
        el.style.color = isPos ? 'var(--accent)' : 'var(--danger)';
        break;
      case 3:
        el.textContent = (annualProj >= 0 ? '+' : '−') + fmtPlain(Math.abs(annualProj));
        el.style.color = annualProj >= 0 ? 'var(--accent)' : 'var(--danger)';
        break;
    }
  });

  // Update bar
  const barFill = document.querySelector('.cf-split-bar-income');
  if (barFill && income > 0) {
    barFill.style.width = Math.min(100, income / (income + expenses) * 100) + '%';
  }

  // Update label
  const lbl = document.querySelector('.cf-results-label');
  if (lbl) lbl.textContent = (isPos ? 'surplus' : 'deficit') + ' per month';
}

function cfReset() {
  CF = cfCloneDefaults();
  try { sessionStorage.removeItem('fcc_cashflow'); } catch(e) {}
  cfRender();
  fiToast('Cash flow reset to defaults.');
}

function cfInit() {
  cfLoad();
  cfRender();
}
