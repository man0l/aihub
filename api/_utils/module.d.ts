declare module '../_utils/auth.js' {
  import { VercelRequest } from '@vercel/node';
  import { SupabaseClient, User } from '@supabase/supabase-js';
  
  export interface AuthResult {
    user: User | null;
    supabaseClient: SupabaseClient;
    error: string | null;
  }
  
  export function getUserFromHeader(req: VercelRequest): Promise<AuthResult>;
} 