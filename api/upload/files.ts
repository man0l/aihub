import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Process file uploads
 * POST /api/upload/files
 * 
 * This endpoint creates pre-signed URLs for direct upload to S3.
 * It takes a list of file metadata (name, type, size) and returns
 * pre-signed URLs for each file along with upload instructions.
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

  try {
    // Get file metadata from request
    const { files, collectionId } = req.body;
    
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ message: 'No file metadata provided' });
    }

    // Initialize S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'eu-central-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    });

    const bucketName = process.env.RAW_MEDIA_BUCKET || '';
    if (!bucketName) {
      throw new Error('S3 bucket name not configured');
    }

    // Create pre-signed URLs for each file
    const uploadUrls = await Promise.all(
      files.map(async (file: any) => {
        // Generate a unique key for the file
        const fileKey = `uploads/${user.id}/${Date.now()}-${file.name}`;
        
        // Create a PutObject command
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          ContentType: file.type
        });
        
        // Generate pre-signed URL valid for 10 minutes
        const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

        // Create a document record in Supabase
        const { data: document, error } = await supabaseClient
          .from('documents')
          .insert({
            title: file.name,
            content_type: getFileType(file.name),
            user_id: user.id,
            collection_id: collectionId || null,
            processing_status: 'pending_upload'
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating document record:', error);
          throw error;
        }

        return {
          id: document.id,
          fileName: file.name,
          fileType: file.type,
          uploadUrl,
          fileKey,
          status: 'pending_upload',
          message: 'Ready for upload'
        };
      })
    );

    return res.status(200).json(uploadUrls);
  } catch (error) {
    console.error('File upload preparation failed:', error);
    return res.status(500).json({
      message: 'Failed to prepare file uploads',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Helper function to determine content type based on file extension
function getFileType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  if (!ext) return 'unknown';
  
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'document';
    case 'txt':
      return 'text';
    case 'md':
      return 'markdown';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      return 'image';
    default:
      return 'unknown';
  }
} 