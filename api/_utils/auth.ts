import { VercelRequest } from '@vercel/node';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

interface AuthResult {
  user: User | null;
  supabaseClient: SupabaseClient;
  error: string | null;
}

/**
 * Authenticates a user from the Authorization header
 * Returns the user object and a Supabase client with the user's token
 */
export async function getUserFromHeader(req: VercelRequest): Promise<AuthResult> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.warn('No authorization header provided');
      return { 
        user: null, 
        supabaseClient: createEmptyClient(),
        error: 'No authorization header'
      };
    }

    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = authHeader;
    }

    if (!token) {
      console.warn('No token extracted from header');
      return { 
        user: null, 
        supabaseClient: createEmptyClient(),
        error: 'No token provided'
      };
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
    
    // Create initial client with anonymous key
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Authentication failed:', error?.message || 'No user data');
      return { 
        user: null, 
        supabaseClient: createEmptyClient(),
        error: error?.message || 'Invalid or expired token'
      };
    }
    
    console.log('Authentication successful for user:', user.id);
    
    // Create authenticated client for the user
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    
    return {
      user,
      supabaseClient,
      error: null
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      user: null,
      supabaseClient: createEmptyClient(),
      error: error instanceof Error ? error.message : 'Unknown authentication error'
    };
  }
}

/**
 * Creates an empty Supabase client (for error cases)
 */
function createEmptyClient(): SupabaseClient {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://example.com';
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'dummy-key';
  return createClient(supabaseUrl, supabaseKey);
} 