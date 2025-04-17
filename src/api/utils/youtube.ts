import axios from 'axios';
import ytdl from 'ytdl-core';

/**
 * Extracts the YouTube video ID from a URL
 */
export async function extractVideoId(url: string): Promise<string | null> {
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
 * Extracts the playlist ID from a YouTube URL
 */
export function extractPlaylistId(url: string): string | null {
  try {
    const videoUrl = new URL(url);
    const playlistId = videoUrl.searchParams.get('list');
    if (playlistId?.startsWith('PL')) {
      return playlistId;
    }
    return null;
  } catch (error) {
    console.error('Error extracting playlist ID:', error);
    return null;
  }
}

/**
 * Gets all video IDs from a YouTube playlist
 */
export async function getPlaylistVideos(playlistId: string): Promise<Array<{id: string, title: string}>> {
  try {
    const videos: Array<{id: string, title: string}> = [];
    let nextPageToken: string | undefined = undefined;
    
    do {
      const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/playlistItems`, {
          params: {
            part: 'snippet',
            maxResults: 50,
            playlistId: playlistId,
            key: process.env.VITE_YOUTUBE_API_KEY,
            pageToken: nextPageToken
          }
        }
      );

      if (!response.data.items) {
        break;
      }

      const items = response.data.items.map((item: any) => ({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title
      }));
      
      videos.push(...items);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return videos;
  } catch (error) {
    console.error('Error fetching playlist videos:', error);
    throw new Error(`Failed to fetch playlist videos: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Gets video metadata from the YouTube API
 */
export async function getVideoMetadata(videoId: string) {
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

/**
 * Gets a transcript for a YouTube video
 * Falls back to generating a structured summary if no captions are available
 */
export async function getVideoTranscript(videoId: string): Promise<string> {
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
      throw new Error('Video not found');
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

    return structuredTranscript;
    
  } catch (error) {
    console.error('Error getting transcript:', error);
    throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 