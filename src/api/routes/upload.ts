import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateUser } from '../middleware/auth.js';
import { extractVideoId, extractPlaylistId, getPlaylistVideos, getVideoMetadata } from '../utils/youtube.js';
import { generateSummary, generateAudio } from '../utils/openai.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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

  try {
    // Create a typed response
    const results: ProcessingResult[] = [{
      id: 'mock-id',
      title: 'Mock File Processing',
      status: 'completed'
    }];
    
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 