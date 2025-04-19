import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';
import busboy from 'busboy';
import { Readable } from 'stream';
import { StorageService } from '../_utils/storage';
import { ConfigService } from '../_utils/config';

export const config = {
  api: {
    bodyParser: false,
  },
};

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
  
  // Define result type
  type FileResult = {
    id: string;
    title: string;
    status: 'queued' | 'error';
    message: string;
  };

  try {
    // Initialize storage services
    const configService = new ConfigService();
    const storageService = new StorageService(configService);
    
    // Parse the multipart form data using busboy
    const fileResults: FileResult[] = [];
    let options = {};

    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers });
      let fileCount = 0;
      let filesProcessed = 0;
      let failedFiles = 0;
      
      // Handle file field
      bb.on('file', async (name, file, info) => {
        if (name !== 'files') {
          // Skip non-files field
          file.resume();
          return;
        }

        fileCount++;
        const { filename, mimeType } = info;
        const chunks: Buffer[] = [];

        file.on('data', (chunk) => {
          chunks.push(Buffer.from(chunk));
        });

        file.on('end', async () => {
          try {
            // Combine all chunks into one buffer
            const fileBuffer = Buffer.concat(chunks);
            if (fileBuffer.length === 0) {
              fileResults.push({
                id: '',
                title: filename || 'Unknown file',
                status: 'error',
                message: 'Empty file'
              });
              failedFiles++;
              return;
            }

            // Generate a unique key for the file
            const fileKey = `${user.id}/${Date.now()}_${filename}`;
            
            // Upload the file to AWS S3 using StorageService
            let fileUrl;
            try {
              fileUrl = await storageService.uploadBuffer(fileBuffer, fileKey, mimeType, true);
              console.log('File uploaded to S3:', fileUrl);
            } catch (uploadError) {
              console.error('Error uploading file to storage:', uploadError);
              fileResults.push({
                id: '',
                title: filename || 'Unknown file',
                status: 'error',
                message: `Failed to upload file: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`
              });
              failedFiles++;
              return;
            }
            
            // Create document record
            const { data: document, error: createError } = await supabaseClient
              .from('documents')
              .insert({
                title: filename,
                content_type: 'file',
                source_url: fileUrl,
                user_id: user.id,
                collection_id: (options as any)?.collectionId || null,
                processing_status: 'queued'
              })
              .select()
              .single();

            if (createError) {
              console.error('Error creating document:', createError);
              fileResults.push({
                id: '',
                title: filename || 'Unknown file',
                status: 'error',
                message: `Failed to create document: ${createError.message}`
              });
              failedFiles++;
              return;
            }
            
            // Enqueue the file for processing
            const { data, error } = await supabaseClient.rpc('enqueue_file_processing', {
              p_url: fileUrl,
              p_file_name: filename,
              p_mime_type: mimeType,
              p_user_id: user.id,
              p_collection_id: (options as any)?.collectionId || null,
              p_document_id: document.id
            });

            if (error) {
              console.error('Error enqueueing file:', error);
              fileResults.push({
                id: document.id,
                title: filename || 'Unknown file',
                status: 'error',
                message: `Failed to enqueue processing: ${error.message}`
              });
              failedFiles++;
              return;
            }

            fileResults.push({
              id: document.id,
              title: filename || 'Unknown file',
              status: 'queued',
              message: 'File has been queued for processing'
            });
          } catch (error) {
            console.error('Error processing file:', error);
            fileResults.push({
              id: '',
              title: filename || 'Unknown file',
              status: 'error',
              message: error instanceof Error ? error.message : 'Unknown error'
            });
            failedFiles++;
          } finally {
            filesProcessed++;
            if (filesProcessed === fileCount) {
              resolve();
            }
          }
        });
      });

      // Handle field data (options)
      bb.on('field', (name, val) => {
        if (name === 'options') {
          try {
            options = JSON.parse(val);
          } catch (e) {
            console.error('Error parsing options:', e);
          }
        }
      });

      // Handle parsing complete
      bb.on('close', () => {
        if (fileCount === 0) {
          reject(new Error('No files provided'));
        }
      });

      // Handle potential errors
      bb.on('error', (error) => {
        reject(error);
      });

      // Pipe the request to busboy
      if (req.body) {
        // If we already have the body as a buffer, create a stream from it
        const bufferStream = new Readable();
        bufferStream.push(req.body);
        bufferStream.push(null);
        bufferStream.pipe(bb);
      } else {
        // Otherwise pipe the raw request
        req.pipe(bb);
      }
    }).catch(error => {
      if (error.message === 'No files provided') {
        return res.status(400).json({ message: 'No files provided' });
      }
      throw error;
    });

    return res.status(200).json(fileResults);
  } catch (error) {
    console.error('File processing failed:', error);
    return res.status(500).json({
      message: 'Failed to queue files for processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 