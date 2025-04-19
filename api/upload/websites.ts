import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';

// Define an interface for the result items
interface ProcessingResult {
  id: string | number;
  title: string;
  status: string;
  message: string;
}

/**
 * Process website sources
 * POST /api/upload/websites
 * 
 * This endpoint enqueues website URLs for asynchronous processing
 * using PostgreSQL message queue (PGMQ).
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
  
  const { urls, options } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ message: 'No URLs provided' });
  }

  try {
    const results: ProcessingResult[] = [];

    for (const url of urls) {
      console.log(`Enqueueing website for processing: ${url}`);
      
      try {
        // Create initial document record with queued status
        const { data: document, error: createError } = await supabaseClient
          .from('documents')
          .insert({
            title: `Processing: ${new URL(url).hostname}`,
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
          throw createError;
        }

        console.log('Document created, ID:', document.id);
        
        // Enqueue the website for processing using the database function
        const { data, error } = await supabaseClient.rpc('enqueue_website_processing', {
          p_url: url,
          p_user_id: user.id,
          p_document_id: document.id,
          p_collection_id: options?.collectionId || null
        });

        if (error) {
          console.error('Error enqueueing website:', error);
          throw error;
        }

        console.log('Website successfully enqueued for processing, job ID:', data);

        results.push({
          id: document.id,
          title: document.title,
          status: 'queued',
          message: 'Website has been queued for processing'
        });
      } catch (urlError) {
        console.error(`Error processing URL ${url}:`, urlError);
        
        results.push({
          id: 'error',
          title: `Failed: ${url}`,
          status: 'error',
          message: urlError instanceof Error ? urlError.message : 'Unknown error'
        });
      }
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