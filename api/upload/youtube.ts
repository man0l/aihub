import { VercelRequest, VercelResponse } from '@vercel/node';
import { getUserFromHeader } from '../_utils/auth.js';
import axios from 'axios';
import ytdl from 'ytdl-core';

/**
 * Process YouTube sources
 * POST /api/upload/youtube
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
  
  const { sources, options } = req.body;

  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ message: 'No sources provided' });
  }

  try {
    const results: Array<{
      id: string;
      title: string;
      status: string;
      message: string;
    }> = [];

    for (const source of sources) {
      console.log('Processing YouTube source:', source.url);
      
      // Extract video ID
      const videoId = await extractVideoId(source.url);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }
      
      // Get video metadata
      const videoMetadata = await getVideoMetadata(videoId);
      const title = `${videoMetadata.title} - ${videoMetadata.channelTitle}`;
      
      console.log('Creating document for video:', title);
      
      // Create initial document record with queued status
      const { data: document, error: createError } = await supabaseClient
        .from('documents')
        .insert({
          title,
          content_type: 'youtube',
          source_url: `https://youtube.com/watch?v=${videoId}`,
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
      
      // Enqueue the video for processing using the database function
      console.log('Enqueueing video for processing:', videoId);
      const { data, error } = await supabaseClient.rpc('enqueue_video_processing', {
        p_video_id: videoId,
        p_user_id: user.id,
        p_source_url: `https://youtube.com/watch?v=${videoId}`,
        p_collection_id: options?.collectionId || null
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
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error('YouTube processing failed:', error);
    return res.status(500).json({
      message: 'Failed to queue YouTube sources for processing',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Extracts the YouTube video ID from a URL
 */
async function extractVideoId(url: string): Promise<string | null> {
  try {
    if (ytdl.validateURL(url)) {
      return ytdl.getVideoID(url);
    }
    return null;
  } catch (error) {
    console.error('Error extracting video ID:', error);
    return null;
  }
}

/**
 * Gets video metadata from the YouTube API
 */
async function getVideoMetadata(videoId: string) {
  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet`
    );

    if (!response.data.items || response.data.items.length === 0) {
      throw new Error('Video not found');
    }

    return response.data.items[0].snippet;
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    throw new Error(`Failed to fetch video metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 