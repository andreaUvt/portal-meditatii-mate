// src/modules/auth.js
// ─────────────────────────────────────────────────────────────
// Authentication helpers.
// Only the tutor (admin) needs an account.
// Parents never log in – they use phone-number lookup.
// ─────────────────────────────────────────────────────────────
import { supabase } from '../lib/supabase.js';

/**
 * Sign in as admin with email + password.
 * Supabase hashes passwords with bcrypt; we never see the plaintext.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ session, error }}
 */
export async function adminSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { session: data?.session ?? null, error };
}

/**
 * Sign out the current admin session.
 */
export async function adminSignOut() {
  await supabase.auth.signOut();
}

/**
 * Returns the current session or null.
 * Use this on page load to restore state without a round-trip.
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * Subscribe to auth state changes.
 * Callback receives (event, session).
 * Returns an unsubscribe function.
 */
export function onAuthChange(callback) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}
