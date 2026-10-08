import { createClient } from '@supabase/supabase-js';

// These are public browser credentials (the publishable key is designed to be visible).
// Defaults keep preview/production deploys working without Vercel-specific build secrets;
// environment variables can override them when deploying against another Supabase project.
const defaultSupabaseUrl = 'https://zcamuvnupukwvzzqgcga.supabase.co';
const defaultPublishableKey = 'sb_publishable_AKR2wRnnC4YgJyjyJhicoQ_snOWth5j';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || defaultSupabaseUrl;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  defaultPublishableKey;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
