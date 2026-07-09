// Benötigt das supabase-js CDN-Script (siehe <head> der HTML-Seiten) und config.js.
const supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
