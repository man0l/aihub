import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { getUserFromHeader } from '../_utils/auth.js';

/**
 * GET /api/upload/collections - Get user collections
 * POST /api/upload/collections - Create a new collection
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Authenticate user
  const { user, supabaseClient, error: authError } = await getUserFromHeader(req);
  
  if (authError || !user) {
    return res.status(401).json({ message: 'Unauthorized', error: authError });
  }
  
  if (req.method === 'GET') {
    try {
      console.log('Getting collections for user:', user.id);
      
      const { data, error } = await supabaseClient
        .from('collections')
        .select('id, name')
        .eq('user_id', user.id);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      console.log('Collections retrieved:', data?.length || 0);
      return res.status(200).json(data || []);
    } catch (error) {
      console.error('Failed to fetch collections:', error);
      return res.status(500).json({
        message: 'Failed to fetch collections',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (req.method === 'POST') {
    const { name } = req.body;
    
    if (!name?.trim()) {
      console.log('Collection name missing in request');
      return res.status(400).json({ message: 'Collection name is required' });
    }

    try {
      console.log('Creating collection:', name, 'for user:', user.id);
      
      const { data, error } = await supabaseClient
        .from('collections')
        .insert({
          name: name.trim(),
          user_id: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      console.log('Collection created:', data?.id);
      return res.status(201).json(data);
    } catch (error) {
      console.error('Failed to create collection:', error);
      return res.status(500).json({
        message: 'Failed to create collection',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else {
    return res.status(405).json({ message: 'Method not allowed' });
  }
} 