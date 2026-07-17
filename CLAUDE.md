# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

This is a static HTML/CSS/JS application with no build step. Open `index.html` directly in a browser or serve it with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

`config.js` is excluded from git (listed in `.gitignore`). Copy it from a secure source or create one with:

```js
const CONFIG = {
  SUPABASE_URL: '...',
  SUPABASE_ANON_KEY: '...',
  CLAUDE_API_KEY: '...',
  PASSWORD_HASH: '...',  // SHA-256 of the app password
  REMEMBER_ME_DAYS: 30
};
```

To generate a `PASSWORD_HASH`, open `password-hash-helper.html` in a browser.

## Architecture

**Single-page app, no framework, no bundler.** Everything shares `window` scope via ordered `<script>` tags in `index.html`:

1. `config.js` — defines `CONFIG` global (credentials, password hash)
2. `js/supabase.js` — creates `supabaseClient` global from the CDN-loaded Supabase SDK
3. `js/router.js` — defines `navigate(section)` and `initRouter()`
4. `js/home.js`, `js/finance.js`, `js/tasks.js` — section modules
5. `js/app.js` — auth gate, bootstrap, sidebar navigation

**Section init pattern.** `router.js` fetches `sections/<name>.html`, injects it into `#section-panel`, then calls `window['init' + Name]()` automatically. Adding a new section requires: a `sections/<name>.html` file, a `js/<name>.js` that exposes `initName()` globally, a `<script>` tag in `index.html`, and a nav button with `data-section="<name>"`.

**Authentication.** The auth gate is currently bypassed — `app.js` calls `revealApp()` directly without checking the password cookie. The underlying SHA-256 / cookie logic is still in place and can be re-enabled by restoring the `checkCookieAuth()` branch.

**Data persistence by section:**
- **Tasks** — `localStorage` under key `fcc_tasks`. Stores `{ columns, tasks, projects }`. Seeded with example tasks on first load. All IDs are strings (from `tkNextId()`) — keep them strings to avoid `===` failures when IDs pass through HTML `onclick` attributes.
- **Finance (Tax Tracker)** — `localStorage` under key `fcc_tax_tracker`. Migrates old data from `taxtracker_bc_2026` key on first load.
- **Finance (Quote / Budget / Cash Flow)** — `sessionStorage` only (cleared on tab close).

**CSS load order matters.** `style/main.css` → `style/sidebar.css` → `style/components.css` → section-specific files. CSS custom properties (design tokens) are defined in `main.css`.

## Unimplemented sections

Three nav buttons exist but their sections are stubs (`sections/crm.html`, `sections/projects.html`, `sections/documents.html`). To implement one, follow the section init pattern: add a `js/<name>.js` exposing `initName()`, a `<script>` tag in `index.html`, and flesh out the HTML.

## Finance calculators

`js/finance.js` contains four sub-calculators, each with its own namespace prefix:

| Prefix | Calculator |
|--------|-----------|
| `tt*`  | Tax Tracker (invoice ledger + BC/federal tax breakdown) |
| `qc*`  | Quote Calculator (day rate + modifiers) |
| `bgt*` | Budget Calculator (income vs. expenses) |
| `cf*`  | Cash Flow (categorised income/expense planner) |

Tax rates and brackets are hardcoded in `TT_TAX` (2026 BC values). The `ttEstCalc*` functions use a separate, slightly different bracket set for the standalone estimator widget — keep them in sync when updating tax year data.
