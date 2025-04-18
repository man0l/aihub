import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateUser } from '../middleware/auth.js';
import { extractVideoId, extractPlaylistId, getPlaylistVideos, getVideoMetadata } from '../utils/youtube.js';
import { generateSummary, generateAudio } from '../utils/openai.js';
import { StorageService } from '../../worker/services/StorageService.js';
import { ConfigService } from '../../worker/services/ConfigService.js';
import { IStorageService } from '../../shared/interfaces/IStorageService.js';
import { StorageConfig, StorageServiceConfig } from '../../shared/interfaces/StorageConfig.js';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper function to check if a buffer is a valid PDF (has PDF header)
function isValidPDF(buffer: Buffer): boolean {
  // PDF files start with the magic bytes "%PDF-"
  return buffer.length > 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
}

// Helper function to check if a buffer is a valid Word document
function isValidDocx(buffer: Buffer): boolean {
  // DOCX files are ZIP files that start with PK magic bytes
  return buffer.length > 4 && 
         buffer[0] === 0x50 && buffer[1] === 0x4B && 
         buffer[2] === 0x03 && buffer[3] === 0x04;
}

// Define supported file types for document processing
const SUPPORTED_MIME_TYPES = [
  // PDF files
  'application/pdf',
  // Word documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Text files
  'text/plain',
  'text/rtf',
  'application/rtf',
  // Excel files
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // OpenOffice formats
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation'
];

const SUPPORTED_FILE_EXTENSIONS = [
  // PDF
  '.pdf',
  // Word
  '.doc', '.docx',
  // Text
  '.txt', '.rtf',
  // Excel
  '.xls', '.xlsx',
  // OpenOffice
  '.odt', '.ods', '.odp'
];

// Define types for API responses
interface CollectionResponse {
  id: string;
  name: string;
}

interface ProcessingResult {
  id: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  message?: string;
}

// Get user collections
router.get('/collections', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user || !req.supabaseClient) {
      res.status(401).json({ message: 'User not authenticated' });
      return;
    }

    console.log('Getting collections for user:', req.user.id);
    
    const { data, error } = await req.supabaseClient
      .from('collections')
      .select('id, name')
      .eq('user_id', req.user.id);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Collections retrieved:', data?.length || 0);
    res.json(data || []);
  } catch (error) {
    console.error('Failed to fetch collections:', error);
    res.status(500).json({
      message: 'Failed to fetch collections',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create new collection
router.post('/collections', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.supabaseClient) {
    res.status(401).json({ message: 'User not authenticated' });
    return;
  }

  const { name } = req.body;
  
  if (!name?.trim()) {
    console.log('Collection name missing in request');
    res.status(400).json({ message: 'Collection name is required' });
    return;
  }

  try {
    console.log('Creating collection:', name, 'for user:', req.user.id);
    
    const { data, error } = await req.supabaseClient
      .from('collections')
      .insert({
        name: name.trim(),
        user_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Collection created:', data?.id);
    res.json(data);
  } catch (error) {
    console.error('Failed to create collection:', error);
    res.status(500).json({
      message: 'Failed to create collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process YouTube sources
router.post('/youtube', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.supabaseClient) {
    res.status(401).json({ message: 'User not authenticated' });
    return;
  }

  const { sources, options } = req.body;

  if (!Array.isArray(sources) || sources.length === 0) {
    res.status(400).json({ message: 'No sources provided' });
    return;
  }

  try {
    const results: ProcessingResult[] = [];

    for (const source of sources) {
      console.log('Processing YouTube source:', source.url);
      
      let videosToProcess: Array<{id: string, title?: string}> = [];
      
      if (source.type === 'playlist') {
        // Handle playlist
        const playlistId = extractPlaylistId(source.url);
        if (!playlistId) {
          throw new Error('Invalid YouTube playlist URL');
        }
        
        console.log('Fetching videos from playlist:', playlistId);
        videosToProcess = await getPlaylistVideos(playlistId);
        console.log(`Found ${videosToProcess.length} videos in playlist`);
      } else {
        // Handle single video
        const videoId = await extractVideoId(source.url);
        if (!videoId) {
          throw new Error('Invalid YouTube URL');
        }
        videosToProcess = [{ id: videoId }];
      }
      
      // Process each video
      for (const video of videosToProcess) {
        try {
          // Get video metadata if not already provided by playlist
          const videoMetadata = video.title ? 
            { title: video.title } : 
            await getVideoMetadata(video.id);
            
          const title = video.title || `${videoMetadata.title} - ${videoMetadata.channelTitle}`;
          
          console.log('Creating document for video:', title);
          
          // Create initial document record with queued status
          const { data: document, error: createError } = await req.supabaseClient
            .from('documents')
            .insert({
              title,
              content_type: 'youtube',
              source_url: `https://youtube.com/watch?v=${video.id}`,
              user_id: req.user.id,
              collection_id: options?.collectionId || null,
              processing_status: 'queued',
              video_id: video.id
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating document:', createError);
            throw createError;
          }

          console.log('Document created, ID:', document.id);
          
          // Enqueue the video for processing
          console.log('Enqueueing video for processing:', video.id);
          const { data, error } = await req.supabaseClient.rpc('enqueue_video_processing', {
            p_video_id: video.id,
            p_user_id: req.user.id,
            p_source_url: `https://youtube.com/watch?v=${video.id}`,
            p_collection_id: options?.collectionId || null,
            p_document_id: document.id
          });

          if (error) {
            console.error('Error enqueueing video:', error);
            throw error;
          }

          console.log('Video successfully enqueued for processing, job ID:', data);

          results.push({
            id: document.id,
            title,
            status: 'queued',
            message: 'Video has been queued for processing'
          });
        } catch (videoError) {
          console.error('Error processing video:', video.id, videoError);
          results.push({
            id: video.id,
            title: video.title || video.id,
            status: 'error',
            message: videoError instanceof Error ? videoError.message : 'Unknown error'
          });
        }
      }
    }

    res.json(results);
  } catch (error) {
    console.error('YouTube processing failed:', error);
    res.status(500).json({
      message: 'Failed to queue YouTube sources for processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process websites
router.post('/websites', authenticateUser, async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.supabaseClient) {
    res.status(401).json({ message: 'User not authenticated' });
    return;
  }

  const { urls, options } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ message: 'No URLs provided' });
    return;
  }

  try {
    // Create a typed response
    const results: ProcessingResult[] = [{
      id: 'mock-id',
      title: 'Mock Website Processing',
      status: 'completed'
    }];
    
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process websites',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process files
router.post('/files', authenticateUser, upload.array('files'), async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.supabaseClient) {
    res.status(401).json({ message: 'User not authenticated' });
    return;
  }

  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    res.status(400).json({ message: 'No files provided' });
    return;
  }

  const options = JSON.parse(req.body.options || '{}');
  const configService = new ConfigService();
  const storageService = new StorageService(configService);
  
  try {
    const results: ProcessingResult[] = [];
    
    for (const file of req.files as Express.Multer.File[]) {
      try {
        // Validate file type
        const fileExtension = path.extname(file.originalname).toLowerCase();
        const isValidMimeType = SUPPORTED_MIME_TYPES.includes(file.mimetype);
        const isValidExtension = SUPPORTED_FILE_EXTENSIONS.includes(fileExtension);
        
        if (!isValidMimeType && !isValidExtension) {
          console.warn(`Unsupported file type: ${file.mimetype}, extension: ${fileExtension}`);
          results.push({
            id: uuidv4(),
            title: file.originalname,
            status: 'error',
            message: `Unsupported file type. Supported formats include PDF, Word, Text, Excel, and OpenOffice documents.`
          });
          continue; // Skip processing this file
        }
        
        // Additional validation for specific file types
        if (fileExtension === '.pdf' && !isValidPDF(file.buffer)) {
          console.warn(`Invalid PDF file: ${file.originalname} - Missing PDF header`);
          results.push({
            id: uuidv4(),
            title: file.originalname,
            status: 'error',
            message: `Invalid PDF file. The file does not have a valid PDF header.`
          });
          continue; // Skip processing this file
        }
        
        if ((fileExtension === '.docx') && !isValidDocx(file.buffer)) {
          console.warn(`Invalid DOCX file: ${file.originalname} - Missing DOCX header`);
          results.push({
            id: uuidv4(),
            title: file.originalname,
            status: 'error',
            message: `Invalid Word document. The file does not have a valid document format.`
          });
          continue; // Skip processing this file
        }
        
        // Get the documents bucket for storage
        const storageServiceConfig = configService.getStorageServiceConfig();
        const documentsBucket = storageServiceConfig.buckets.documents;
        
        if (!documentsBucket) {
          throw new Error('Documents bucket is not configured');
        }
        
        // Set the bucket for the storage service
        storageService.setBucket(documentsBucket);
        
        // Generate a unique filename
        const uniqueFilename = `${uuidv4()}${fileExtension}`;
        const documentKey = `${req.user.id}/${uniqueFilename}`;
        
        console.log(`Uploading file to bucket: ${documentsBucket}, key: ${documentKey}`);
        
        // Upload file to S3 using the buffer directly
        const fileBuffer = file.buffer;
        
        // Upload the file buffer directly
        const s3Url = await storageService.uploadBuffer(
          fileBuffer,
          documentKey,
          file.mimetype
        );
        
        console.log(`File uploaded to S3: ${s3Url}`);
        
        // Create document record in database
        const { data: document, error: createError } = await req.supabaseClient
          .from('documents')
          .insert({
            title: file.originalname,
            content_type: file.mimetype,
            source_url: s3Url,
            user_id: req.user.id,
            collection_id: options.collectionId || null,
            processing_status: 'queued',
            video_id: null  // We'll update this after we get the document ID
          })
          .select()
          .single();
    
        if (createError) {
          throw createError;
        }

        // Update the document to set video_id equal to document.id
        const { error: updateError } = await req.supabaseClient
          .from('documents')
          .update({ video_id: document.id })
          .eq('id', document.id);

        if (updateError) {
          console.error('Error updating document video_id:', updateError);
          throw updateError;
        }
    
        // Enqueue document for processing
        const { data: queueResult, error: queueError } = await req.supabaseClient.rpc(
          'enqueue_document_processing',
          {
            p_document_id: document.id,
            p_user_id: req.user.id,
            p_source_url: s3Url,
            p_collection_id: options.collectionId || null
          }
        );
    
        if (queueError) {
          throw queueError;
        }
    
        results.push({
          id: document.id,
          title: file.originalname,
          status: 'queued',
          message: 'Document has been queued for processing'
        });

      } catch (fileError) {
        console.error('Error processing file:', file.originalname, fileError);
        results.push({
          id: uuidv4(),
          title: file.originalname,
          status: 'error',
          message: fileError instanceof Error ? fileError.message : 'Unknown error'
        });
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('Failed to process files:', error);
    res.status(500).json({
      message: 'Failed to process files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 