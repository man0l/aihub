import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * File upload webhook endpoint
 * POST /api/upload/webhooks
 * 
 * This endpoint handles notifications when file uploads are completed.
 * It updates the document status and triggers processing.
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
  
  // Verify webhook secret to ensure request is legitimate
  const webhookSecret = process.env.UPLOAD_WEBHOOK_SECRET;
  const providedSecret = req.headers['x-webhook-secret'];
  
  if (!webhookSecret || providedSecret !== webhookSecret) {
    console.warn('Invalid webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { documentId, userId, fileKey, status } = req.body;
    
    if (!documentId || !userId || !fileKey) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Create a Supabase client with service role key for admin access
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    );
    
    // Update document status
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        processing_status: status === 'success' ? 'uploaded' : 'upload_failed',
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId)
      .eq('user_id', userId);
    
    if (updateError) {
      console.error('Error updating document status:', updateError);
      throw updateError;
    }
    
    // If upload was successful, enqueue the document for processing
    if (status === 'success') {
      console.log(`Enqueueing document ${documentId} for processing`);
      
      // Enqueue processing job
      const { error: queueError } = await supabase.rpc('enqueue_file_processing', {
        p_document_id: documentId,
        p_user_id: userId,
        p_file_key: fileKey
      });
      
      if (queueError) {
        console.error('Error enqueueing document for processing:', queueError);
        throw queueError;
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      message: `Document ${documentId} status updated to ${status === 'success' ? 'uploaded' : 'upload_failed'}`
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return res.status(500).json({
      error: 'Failed to process webhook',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 