import { createClient } from '@supabase/supabase-js';

// The default key below is a Supabase publishable key (browser-safe by design).
// Prefer Vercel environment variables when configuring a deployment. Never use
// a service_role or secret key in this client-side module.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://cltxzwfuzlgunnoqavwx.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_TnpZ8j7xSPmNhv2GzWCCxA_3Lf06bQr';

export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
