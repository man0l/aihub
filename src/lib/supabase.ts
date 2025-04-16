import { createClient } from '@supabase/supabase-js';
import { Database } from './database.types.js';

// Determine if we're likely in a browser environment without checking browser-specific objects
// We'll use a feature detection approach that works in both browser and Node.js
let isBrowser = false;
let supabaseUrl = '';
let supabaseAnonKey = '';

// Check if import.meta.env is defined (Vite browser environment)
try {
  // @ts-ignore - At runtime in Vite, this will exist
  if (typeof import.meta.env !== 'undefined') {
    isBrowser = true;
    // @ts-ignore - Vite-specific, will be available at runtime in browser
    supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    // @ts-ignore - Vite-specific, will be available at runtime in browser
    supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  }
} catch (e) {
  // We're in Node.js - The try-catch ensures we don't crash in Node.js
  isBrowser = false;
}

// If browser detection failed or we're in Node.js, use process.env
if (!isBrowser || !supabaseUrl || !supabaseAnonKey) {
  supabaseUrl = process.env.VITE_SUPABASE_URL || '';
  supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables, client may not function correctly');
}

// Create and export the Supabase client with database types
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  global: {
    headers: {
      'X-Client-Info': isBrowser ? 'supabase-js-client' : 'supabase-js-server'
    }
  }
});