import { VideoSource } from './types';

// Maximum retries for API calls
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const API_TIMEOUT = 30000; // 30 seconds

enum TranscriptionErrorType {
  NETWORK = 'NETWORK',
  API = 'API',
  VALIDATION = 'VALIDATION',
  TIMEOUT = 'TIMEOUT',
  AUDIO_FETCH = 'AUDIO_FETCH',
  WHISPER = 'WHISPER',
  HTML = 'HTML'
}

class TranscriptionError extends Error {
  constructor(
    message: string,
    public type: TranscriptionErrorType,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  context: string,
  retries = MAX_RETRIES,
  initialDelay = INITIAL_RETRY_DELAY
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      console.error(`Attempt ${i + 1} failed for ${context}:`, {
        error: lastError,
        type: error instanceof TranscriptionError ? error.type : 'UNKNOWN',
        message: lastError.message
      });
      
      if (error instanceof TranscriptionError) {
        // Don't retry validation errors, HTML errors, or audio fetch errors
        if (error.type === TranscriptionErrorType.VALIDATION || 
            error.type === TranscriptionErrorType.HTML ||
            error.type === TranscriptionErrorType.AUDIO_FETCH) {
          throw error;
        }
      }
      
      if (i < retries - 1) {
        const waitTime = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw new TranscriptionError(
    `${context} failed after ${retries} attempts: ${lastError?.message}`,
    TranscriptionErrorType.NETWORK,
    lastError
  );
}

export async function getVideoTranscript(videoId: string): Promise<string> {
  if (!videoId) {
    throw new TranscriptionError(
      'No video ID provided',
      TranscriptionErrorType.VALIDATION
    );
  }

  try {
    // Get video metadata first
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${import.meta.env.VITE_YOUTUBE_API_KEY}&part=snippet`
    );

    if (!response.ok) {
      throw new TranscriptionError(
        `Failed to fetch video metadata: ${response.statusText}`,
        TranscriptionErrorType.API
      );
    }

    const data = await response.json();
    const video = data.items?.[0]?.snippet;
    
    if (!video) {
      throw new TranscriptionError(
        'Video not found or is not accessible',
        TranscriptionErrorType.VALIDATION
      );
    }

    // Try to get audio transcription
    try {
      // Get audio URL with proper error handling
      const audioResponse = await fetch(`/api/youtube/audio/${videoId}`);
      const contentType = audioResponse.headers.get('content-type');
      
      // Check for HTML response or non-JSON content type
      if (!audioResponse.ok || 
          contentType?.includes('text/html') || 
          !contentType?.includes('application/json')) {
        let errorMessage: string;
        
        if (contentType?.includes('text/html')) {
          errorMessage = 'Received HTML response instead of audio data';
          throw new TranscriptionError(errorMessage, TranscriptionErrorType.HTML);
        }
        
        if (!contentType?.includes('application/json')) {
          errorMessage = `Invalid content type received: ${contentType}`;
          throw new TranscriptionError(errorMessage, TranscriptionErrorType.AUDIO_FETCH);
        }
        
        try {
          const errorData = await audioResponse.json();
          errorMessage = errorData.error || audioResponse.statusText;
        } catch (parseError) {
          errorMessage = 'Failed to parse error response';
        }
        
        throw new TranscriptionError(
          `Failed to get audio URL: ${errorMessage}`,
          TranscriptionErrorType.AUDIO_FETCH
        );
      }

      const audioData = await audioResponse.json();
      const audioUrl = audioData.audioUrl;
      
      if (!audioUrl) {
        throw new TranscriptionError(
          'No audio URL returned from API',
          TranscriptionErrorType.AUDIO_FETCH
        );
      }

      // Validate audio URL format
      try {
        new URL(audioUrl);
      } catch (urlError) {
        throw new TranscriptionError(
          'Invalid audio URL format',
          TranscriptionErrorType.AUDIO_FETCH
        );
      }

      // Fetch the audio file with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

      try {
        const audioDataResponse = await fetch(audioUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!audioDataResponse.ok) {
          throw new TranscriptionError(
            `Failed to fetch audio data: ${audioDataResponse.statusText}`,
            TranscriptionErrorType.AUDIO_FETCH
          );
        }

        const audioBlob = await audioDataResponse.blob();
        if (audioBlob.size === 0) {
          throw new TranscriptionError(
            'Received empty audio data',
            TranscriptionErrorType.VALIDATION
          );
        }

        // Create form data for Whisper API
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.mp4');
        formData.append('model', 'whisper-1');
        formData.append('language', 'en');

        // Send to Whisper API with timeout
        const whisperController = new AbortController();
        const whisperTimeout = setTimeout(() => whisperController.abort(), API_TIMEOUT);

        try {
          const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`
            },
            body: formData,
            signal: whisperController.signal
          });

          clearTimeout(whisperTimeout);

          if (!whisperResponse.ok) {
            const errorData = await whisperResponse.json().catch(() => ({ error: { message: whisperResponse.statusText } }));
            throw new TranscriptionError(
              `Whisper API error: ${errorData.error?.message || whisperResponse.statusText}`,
              TranscriptionErrorType.WHISPER
            );
          }

          const whisperData = await whisperResponse.json();
          if (!whisperData.text) {
            throw new TranscriptionError(
              'No transcription text received from Whisper API',
              TranscriptionErrorType.WHISPER
            );
          }

          return whisperData.text;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new TranscriptionError(
              'Transcription request timed out',
              TranscriptionErrorType.TIMEOUT
            );
          }
          throw error;
        } finally {
          clearTimeout(whisperTimeout);
        }
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (transcriptionError) {
      console.error('Transcription failed:', {
        error: transcriptionError,
        type: transcriptionError instanceof TranscriptionError ? transcriptionError.type : 'UNKNOWN',
        message: transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error'
      });
      
      // Create a structured fallback content with error context
      const fallbackContent = `
Title: ${video.title}

Channel: ${video.channelTitle}
Published: ${new Date(video.publishedAt).toLocaleDateString()}

Description:
${video.description || 'No description available.'}

Note: This is fallback content as automatic transcription failed.
Error: ${transcriptionError instanceof Error ? transcriptionError.message : 'Unknown error'}
Error Type: ${transcriptionError instanceof TranscriptionError ? transcriptionError.type : 'UNKNOWN'}

Please note that this is not a transcript but rather the video's metadata as the transcription process encountered an error.
      `.trim();

      // Return fallback content but also log the error for monitoring
      console.warn('Using fallback content due to transcription failure:', {
        videoId,
        error: transcriptionError,
        type: transcriptionError instanceof TranscriptionError ? transcriptionError.type : 'UNKNOWN'
      });

      return fallbackContent;
    }
  } catch (error) {
    console.error('Error getting video transcript:', {
      error,
      type: error instanceof TranscriptionError ? error.type : 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    
    if (error instanceof TranscriptionError) {
      throw error;
    }

    throw new TranscriptionError(
      `Failed to process video: ${error instanceof Error ? error.message : 'Unknown error'}`,
      TranscriptionErrorType.API,
      error instanceof Error ? error : undefined
    );
  }
}

function extractVideoId(url: string): string | null {
  try {
    const videoUrl = new URL(url);
    let videoId = '';

    if (videoUrl.hostname === 'youtu.be') {
      videoId = videoUrl.pathname.slice(1);
    } else if (videoUrl.hostname === 'www.youtube.com' || videoUrl.hostname === 'youtube.com') {
      if (videoUrl.pathname === '/watch') {
        videoId = videoUrl.searchParams.get('v') || '';
      } else if (videoUrl.pathname.startsWith('/embed/')) {
        videoId = videoUrl.pathname.split('/')[2];
      } else if (videoUrl.pathname.startsWith('/v/')) {
        videoId = videoUrl.pathname.split('/')[2];
      }
    }

    return videoId || null;
  } catch {
    return null;
  }
}

function extractPlaylistId(url: string): string | null {
  try {
    const playlistUrl = new URL(url);
    return playlistUrl.searchParams.get('list');
  } catch {
    return null;
  }
}

function extractChannelId(url: string): string | null {
  try {
    const channelUrl = new URL(url);
    const paths = channelUrl.pathname.split('/');
    const channelIndex = paths.indexOf('channel');
    return channelIndex !== -1 ? paths[channelIndex + 1] : null;
  } catch {
    return null;
  }
}

async function fetchPlaylistVideos(playlistId: string): Promise<string[]> {
  const videoIds: string[] = [];
  let pageToken = '';

  do {
    const response = await retryOperation(
      () => fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlistId}&key=${import.meta.env.VITE_YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`
      ),
      'Fetch playlist videos'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist videos: ${response.statusText}`);
    }

    const data = await response.json();
    const items = data.items || [];
    
    items.forEach((item: any) => {
      if (item.contentDetails?.videoId) {
        videoIds.push(item.contentDetails.videoId);
      }
    });

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return videoIds;
}

async function fetchChannelVideos(channelId: string): Promise<string[]> {
  const videoIds: string[] = [];
  let pageToken = '';

  do {
    const response = await retryOperation(
      () => fetch(
        `https://www.googleapis.com/youtube/v3/search?part=id&type=video&channelId=${channelId}&maxResults=50&key=${import.meta.env.VITE_YOUTUBE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`
      ),
      'Fetch channel videos'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch channel videos: ${response.statusText}`);
    }

    const data = await response.json();
    const items = data.items || [];
    
    items.forEach((item: any) => {
      if (item.id?.videoId) {
        videoIds.push(item.id.videoId);
      }
    });

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return videoIds;
}

export async function extractVideoIds(source: VideoSource): Promise<string[]> {
  const videoIds: string[] = [];

  try {
    switch (source.type) {
      case 'video':
        const videoId = extractVideoId(source.url);
        if (videoId) videoIds.push(videoId);
        break;

      case 'playlist':
        const playlistId = extractPlaylistId(source.url);
        if (playlistId) {
          const ids = await fetchPlaylistVideos(playlistId);
          videoIds.push(...ids);
        }
        break;

      case 'channel':
        const channelId = extractChannelId(source.url);
        if (channelId) {
          const ids = await fetchChannelVideos(channelId);
          videoIds.push(...ids);
        }
        break;
    }

    return videoIds;
  } catch (error) {
    console.error('Error extracting video IDs:', error);
    throw error;
  }
}

export function validateYouTubeUrl(url: string): boolean {
  try {
    const videoUrl = new URL(url);
    return videoUrl.hostname === 'youtu.be' || 
           videoUrl.hostname === 'www.youtube.com' || 
           videoUrl.hostname === 'youtube.com';
  } catch {
    return false;
  }
}