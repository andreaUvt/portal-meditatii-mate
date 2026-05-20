// src/lib/supabase.js
// ─────────────────────────────────────────────────────────────
// Supabase client – single import used everywhere in the app.
// Never import createClient elsewhere; always use this module.
// ─────────────────────────────────────────────────────────────
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL      = window.__ENV?.SUPABASE_URL      || import.meta?.env?.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.__ENV?.SUPABASE_ANON_KEY || import.meta?.env?.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase credentials.\n' +
    'Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Store session in localStorage – fine for a single-user admin panel
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
