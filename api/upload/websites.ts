import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';

/**
 * Process website sources
 * POST /api/upload/websites
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only handle POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Authenticate user
  const { user, supabaseClient, error: authError } = await getUserFromHeader(req);
  
  if (authError || !user) {
    return res.status(401).json({ message: 'Unauthorized', error: authError });
  }
  
  // Parse request body
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { urls, options } = body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ message: 'No URLs provided' });
  }

  try {
    const results: Array<{
      id: string;
      title: string;
      status: string;
      message: string;
    }> = [];

    for (const url of urls) {
      console.log('Processing website URL:', url);
      
      if (!isValidUrl(url)) {
        results.push({
          id: '',
          title: url,
          status: 'error',
          message: 'Invalid URL format'
        });
        continue;
      }
      
      // Create initial document record with queued status
      const { data: document, error: createError } = await supabaseClient
        .from('documents')
        .insert({
          title: url,
          content_type: 'website',
          source_url: url,
          user_id: user.id,
          collection_id: options?.collectionId || null,
          processing_status: 'queued'
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating document:', createError);
        results.push({
          id: '',
          title: url,
          status: 'error',
          message: `Failed to create document: ${createError.message}`
        });
        continue;
      }

      console.log('Document created, ID:', document.id);
      
      // Enqueue the website for processing using the database function
      console.log('Enqueueing website for processing:', url);
      const { data, error } = await supabaseClient.rpc('enqueue_website_processing', {
        p_url: url,
        p_user_id: user.id,
        p_collection_id: options?.collectionId || null,
        p_document_id: document.id
      });

      if (error) {
        console.error('Error enqueueing website:', error);
        results.push({
          id: document.id,
          title: url,
          status: 'error',
          message: `Failed to enqueue processing: ${error.message}`
        });
        continue;
      }

      console.log('Website successfully enqueued for processing, job ID:', data);

      results.push({
        id: document.id,
        title: url,
        status: 'queued',
        message: 'Website has been queued for processing'
      });
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error('Website processing failed:', error);
    return res.status(500).json({
      message: 'Failed to queue websites for processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Validates a URL
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
} 