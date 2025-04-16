import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

/**
 * YouTube metadata endpoint
 * GET /api/youtube/metadata/[videoId]
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
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet`
    );

    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    return res.status(200).json(response.data.items[0].snippet);
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    
    return res.status(500).json({ 
      error: 'Failed to fetch video metadata',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 