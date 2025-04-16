import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase.js';

// Extend the Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      supabaseClient?: SupabaseClient;
    }
  }
}

export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.warn('No authorization header provided');
      res.status(401).json({ message: 'No authorization header' });
      return;
    }

    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = authHeader;
    }

    if (!token) {
      console.warn('No token extracted from header');
      res.status(401).json({ message: 'No token provided' });
      return;
    }

    console.log('Attempting authentication with token');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Authentication failed:', error?.message || 'No user data');
      res.status(401).json({ 
        message: 'Invalid or expired token',
        error: error?.message 
      });
      return;
    }
    
    console.log('Authentication successful for user:', user.id);
    
    // Create a new Supabase client with the user's JWT
    // This is crucial for RLS policies to work properly
    const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
    
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    
    req.supabaseClient = supabaseClient;
    req.user = {
      id: user.id,
      email: user.email || ''
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      message: 'Authentication failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default { authenticateUser }; 