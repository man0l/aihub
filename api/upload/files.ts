import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';

/**
 * Process file upload sources
 * POST /api/upload/files
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
  const { files, options } = body;

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ message: 'No files provided' });
  }

  // Define result type
  type FileResult = {
    id: string;
    title: string;
    status: 'queued' | 'error';
    message: string;
  };

  try {
    const results: FileResult[] = [];

    for (const file of files) {
      if (!file.url || !file.name) {
        results.push({
          id: '',
          title: file.name || 'Unknown file',
          status: 'error',
          message: 'Missing file URL or name'
        });
        continue;
      }

      console.log('Processing file:', file.name, file.url);
      
      // Create initial document record with queued status
      const { data: document, error: createError } = await supabaseClient
        .from('documents')
        .insert({
          title: file.name,
          content_type: 'file',
          source_url: file.url,
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
          title: file.name,
          status: 'error',
          message: `Failed to create document: ${createError.message}`
        });
        continue;
      }

      console.log('Document created, ID:', document.id);
      
      // Enqueue the file for processing
      const { data, error } = await supabaseClient.rpc('enqueue_file_processing', {
        p_url: file.url,
        p_file_name: file.name,
        p_mime_type: file.type || 'application/octet-stream',
        p_user_id: user.id,
        p_collection_id: options?.collectionId || null,
        p_document_id: document.id
      });

      if (error) {
        console.error('Error enqueueing file:', error);
        results.push({
          id: document.id,
          title: file.name,
          status: 'error',
          message: `Failed to enqueue processing: ${error.message}`
        });
        continue;
      }

      console.log('File successfully enqueued for processing, job ID:', data);

      results.push({
        id: document.id,
        title: file.name,
        status: 'queued',
        message: 'File has been queued for processing'
      });
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error('File processing failed:', error);
    return res.status(500).json({
      message: 'Failed to queue files for processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 