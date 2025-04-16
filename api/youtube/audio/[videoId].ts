import { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from 'ytdl-core';

/**
 * YouTube audio extraction endpoint
 * GET /api/youtube/audio/[videoId]
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only handle GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { videoId } = req.query;
  
  if (!videoId || typeof videoId !== 'string') {
    return res.status(400).json({ error: 'Video ID is required' });
  }
  
  try {
    // Validate video ID format
    if (!ytdl.validateID(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID format' });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // First check if video exists and is accessible
    try {
      await ytdl.getBasicInfo(videoUrl);
    } catch (infoError) {
      return res.status(404).json({ 
        error: 'Video not found or is not accessible',
        details: infoError instanceof Error ? infoError.message : 'Unknown error'
      });
    }

    // Get video info with audio formats
    const info = await ytdl.getInfo(videoUrl);
    
    // Get the best audio format
    const audioFormat = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    if (!audioFormat) {
      return res.status(404).json({ 
        error: 'No suitable audio format found',
        details: 'Could not find an audio-only format for this video'
      });
    }

    // Validate audio format URL
    if (!audioFormat.url) {
      return res.status(500).json({ 
        error: 'Invalid audio format',
        details: 'Audio URL is missing'
      });
    }

    // Return the audio URL
    return res.status(200).json({ 
      audioUrl: audioFormat.url,
      contentType: audioFormat.mimeType || 'audio/mp4'
    });
  } catch (error) {
    console.error('Error getting audio URL:', error);

    // Check for YouTube error message patterns instead of relying on the class
    if (error instanceof Error && 
        (error.message.includes('Video unavailable') || 
         error.message.includes('private video') ||
         error.message.includes('does not exist'))) {
      return res.status(404).json({ 
        error: 'Video not found or is not accessible',
        details: error.message
      });
    }

    return res.status(500).json({ 
      error: 'Failed to get audio URL',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}