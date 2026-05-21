// Initializes the Supabase client as a global so all other JS files can use it
// without imports. This works because all scripts share the same window scope
// and are loaded in order via <script> tags in index.html.
const supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
