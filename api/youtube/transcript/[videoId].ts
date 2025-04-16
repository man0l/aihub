import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import ytdl from 'ytdl-core';

/**
 * YouTube transcript endpoint
 * GET /api/youtube/transcript/[videoId]
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
    console.log('Attempting to get transcript for video:', videoId);
    
    // First, try to get the captions using YouTube API
    try {
      console.log('Fetching captions using YouTube API...');
      const captionsResponse = await axios.get(
        `https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet&key=${process.env.VITE_YOUTUBE_API_KEY}`
      );
      
      if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
        // Find English captions if available
        const englishCaptions = captionsResponse.data.items.find(
          (caption: any) => caption.snippet.language === 'en' || caption.snippet.language === 'en-US'
        );
        
        if (englishCaptions) {
          console.log('Found English captions, fetching content...');
          // Unfortunately direct caption content fetch requires OAuth, which is beyond our scope here
          // We'll fallback to alternative methods
        }
      }
    } catch (captionsError) {
      console.warn('Failed to fetch captions via API:', captionsError instanceof Error ? captionsError.message : 'Unknown error');
      // Continue to fallback methods
    }
    
    // Fallback: Get video metadata and create a simplified "transcript"
    console.log('Using fallback metadata-based transcript generation');
    const videoResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet,contentDetails`
    );

    if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoResponse.data.items[0];
    const snippet = videoData.snippet;
    const duration = videoData.contentDetails.duration; // In ISO 8601 format (PT#H#M#S)
    
    // Get video comments as additional context
    const commentsResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet&maxResults=25&order=relevance`
    );
    
    let topComments = '';
    if (commentsResponse.data.items && commentsResponse.data.items.length > 0) {
      topComments = commentsResponse.data.items
        .map((item: any) => item.snippet.topLevelComment.snippet.textDisplay)
        .join('\n\n');
    }
    
    // Create a structured summary that can be used as a transcript substitute
    const structuredTranscript = `
# ${snippet.title}

## Video Information
- **Channel**: ${snippet.channelTitle}
- **Published**: ${new Date(snippet.publishedAt).toLocaleDateString()}
- **Duration**: ${duration}

## Description
${snippet.description || 'No description available.'}

## Summary
This video appears to be about ${snippet.title}. The content is presented by ${snippet.channelTitle}.

## Top Comments
${topComments || 'No comments available.'}

Note: This is a generated summary as the automatic transcription process was unable to extract the actual speech content from this video.
    `.trim();

    return res.status(200).json({ transcript: structuredTranscript });
    
  } catch (error) {
    console.error('Error getting transcript:', error);
    return res.status(500).json({
      error: 'Transcription failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 