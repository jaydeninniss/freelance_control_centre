// Initializes the Supabase client as a global so all other JS files can use it
// without imports. This works because all scripts share the same window scope
// and are loaded in order via <script> tags in index.html.
// Wrapped in try/catch so a missing or malformed config.js doesn't block the rest of the app.
let supabaseClient = null;
try {
  if (typeof CONFIG !== 'undefined' && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
    supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
} catch(e) {
  console.warn('Supabase init skipped:', e.message);
}
