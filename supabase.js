/**
 * Supabase client setup for the Flora by Kriti website.
 *
 * Add the Supabase project URL and anon key below. Never put a service-role
 * key in browser code.
 */
const FLORA_SUPABASE_URL = "https://gqaktkmuinvoeqdalpmv.supabase.co";
const FLORA_SUPABASE_ANON_KEY = "sb_publishable_4ELWirRJj4_DpmRrY_evPw_t1LlVFl-";
window.FLORA_TURNSTILE_SITE_KEY = "0x4AAAAAAFhWsdqEzIhVrMra";

if (FLORA_SUPABASE_URL && FLORA_SUPABASE_ANON_KEY) {
  if (!window.supabase?.createClient) {
    throw new Error("Supabase SDK is missing. Load the Supabase SDK before supabase.js.");
  }

  window.floraSupabase = window.supabase.createClient(
    FLORA_SUPABASE_URL,
    FLORA_SUPABASE_ANON_KEY
  );
} else {
  window.floraSupabase = null;
  console.info("Supabase is not configured. Add the project URL and anon key in supabase.js.");
}
