import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { AxiosInstance } from 'axios';
import ytdl from '@distube/ytdl-core';
import { ConfigService } from './ConfigService.js';

interface VideoInfo {
  title: string;
  author: {
    name: string;
  };
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
}

/**
 * YouTube Service - Responsible for downloading and processing YouTube videos
 */
export class YouTubeService {
  private config: ConfigService;
  private axiosClient: AxiosInstance;
  
  constructor(configService: ConfigService, axiosClient: AxiosInstance) {
    this.config = configService;
    this.axiosClient = axiosClient;
  }
  
  /**
   * Downloads a YouTube video as audio using the official YouTube Data API
   */
  async downloadVideo(videoId: string): Promise<string> {
    // Ensure temp directory exists
    this.config.ensureTempDirExists();
    
    const outputFilePath = path.join(this.config.tempDir, `${videoId}.mp4`);
    
    try {
      // Clean up any existing file before starting
      if (fs.existsSync(outputFilePath)) {
        console.log(`Removing existing file at ${outputFilePath}`);
        fs.unlinkSync(outputFilePath);
      }

      // First get video details using the Data API
      const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${this.config.youtubeApiKey}`;
      const videoDetailsResponse = await this.axiosClient.get(videoDetailsUrl);
      
      if (!videoDetailsResponse.data.items?.length) {
        throw new Error('Video not found or not accessible');
      }
      
      const videoDetails = videoDetailsResponse.data.items[0];
      console.log(`Video details retrieved for ${videoId}:`, {
        title: videoDetails.snippet.title,
        duration: videoDetails.contentDetails.duration,
        status: videoDetails.status
      });
      
      // Get the direct media URLs using ytdl (which we still need for this part)
      console.log(`Getting media formats for ${videoId}...`);
      const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      console.log(`Available formats for ${videoId}:`, {
        count: info.formats.length,
        audioFormats: info.formats.filter(f => f.hasAudio && !f.hasVideo).length,
        videoFormats: info.formats.filter(f => f.hasVideo).length
      });
      
      // Get the audio-only format with the best quality
      const audioFormat = ytdl.chooseFormat(info.formats, {
        quality: 'highestaudio',
        filter: 'audioonly'
      });
      
      if (!audioFormat?.url) {
        throw new Error('No suitable audio format found');
      }

      console.log(`Selected audio format for ${videoId}:`, {
        quality: audioFormat.quality,
        container: audioFormat.container,
        codecs: audioFormat.codecs,
        bitrate: audioFormat.bitrate
      });
      
      // Download the audio using our authenticated axios client
      console.log(`Starting download for ${videoId}...`);
      const response = await this.axiosClient.get(audioFormat.url, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Range': 'bytes=0-'
        },
        maxRedirects: 5,
        timeout: 30000 // 30 second timeout
      });
      
      // Save the stream to file
      console.log(`Creating write stream to ${outputFilePath}...`);
      const writer = fs.createWriteStream(outputFilePath);
      
      // Add error handler for the write stream
      writer.on('error', (err: Error) => {
        console.error(`Error writing to file for ${videoId}:`, err);
      });
      
      // Add error handler for the response data stream
      response.data.on('error', (err: Error) => {
        console.error(`Error in download stream for ${videoId}:`, err);
      });
      
      // Add progress logging
      let downloadedBytes = 0;
      response.data.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes % (1024 * 1024) === 0) { // Log every MB
          console.log(`Downloaded ${downloadedBytes / (1024 * 1024)} MB for ${videoId}`);
        }
      });
      
      console.log(`Starting pipeline for ${videoId}...`);
      await pipeline(response.data, writer);
      
      // Verify the file exists and has content
      const stats = fs.statSync(outputFilePath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      console.log(`Downloaded YouTube video ${videoId} to ${outputFilePath} (${stats.size} bytes)`);
      return outputFilePath;
      
    } catch (error) {
      console.error(`Error downloading YouTube video ${videoId}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Clean up any partial file that might have been created
      if (fs.existsSync(outputFilePath)) {
        fs.unlinkSync(outputFilePath);
      }
      
      throw new Error(`Failed to download YouTube video ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Creates a placeholder audio file when download fails
   * This allows the processing pipeline to continue
   */
  private createPlaceholderAudio(filePath: string): void {
    try {
      // Write a minimal valid MP4 file (this is just a placeholder)
      // In a real implementation, you might want to use a proper silent audio file
      const placeholderData = Buffer.from('00000018667479706D703432000000006D703432', 'hex');
      fs.writeFileSync(filePath, placeholderData);
    } catch (error) {
      console.error(`Error creating placeholder audio:`, error);
      // Create an empty file as a last resort
      fs.writeFileSync(filePath, '');
    }
  }
  
  /**
   * Gets information about a YouTube video
   */
  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const info = await ytdl.getInfo(videoUrl);
      
      return {
        title: info.videoDetails.title,
        author: {
          name: info.videoDetails.author.name
        },
        videoId: info.videoDetails.videoId,
        videoUrl: videoUrl,
        thumbnailUrl: info.videoDetails.thumbnails[0]?.url || ''
      };
    } catch (error) {
      console.error(`Error getting info for YouTube video ${videoId}:`, error);
      throw new Error(`Failed to get YouTube video info: ${(error as Error).message}`);
    }
  }
  
  /**
   * Fetches the transcription for a YouTube video using the YouTube API
   */
  async fetchTranscription(videoId: string): Promise<string | null> {
    try {
      // For YouTube Data API v3, we need to use proper authentication
      // Note: Getting captions requires OAuth 2.0 with specific scopes, not just an API key
      // As a workaround, we'll use ytdl-core to get captions directly
      
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      try {
        const info = await ytdl.getInfo(videoUrl);
        
        // Get available captions/tracks
        const tracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        
        if (tracks.length === 0) {
          console.log(`No caption tracks found for video ${videoId}`);
          return null;
        }
        
        // Prefer English captions, fall back to first available
        const englishTrack = tracks.find(track => 
          track.languageCode === 'en' || 
          track.languageCode === 'en-US' || 
          track.name?.simpleText?.toLowerCase().includes('english')
        );
        
        const captionTrack = englishTrack || tracks[0];
        
        if (!captionTrack?.baseUrl) {
          console.log(`No valid caption URL found for video ${videoId}`);
          return null;
        }
        
        // Fetch the actual captions XML
        const captionResponse = await this.axiosClient.get(captionTrack.baseUrl);
        
        if (!captionResponse.data) {
          return null;
        }
        
        // Parse the XML and extract text
        // For now, we'll just return the raw data
        // A proper implementation would parse the XML
        return this.parseCaptionData(captionResponse.data);
      } catch (infoError) {
        console.error(`Error getting caption info for ${videoId}:`, infoError);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching transcription for video ${videoId}:`, error);
      return null;
    }
  }
  
  /**
   * Simple parser for YouTube caption data
   */
  private parseCaptionData(captionData: string): string {
    try {
      // This is a very simple parser for the YouTube caption format
      // It extracts text from XML and joins it into paragraphs
      const textLines: string[] = [];
      
      // Extract text between <text> tags
      const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
      let match;
      
      while ((match = textRegex.exec(captionData)) !== null) {
        // Remove HTML entities and trim
        const text = match[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();
        
        if (text) {
          textLines.push(text);
        }
      }
      
      return textLines.join('\n');
    } catch (parseError) {
      console.error('Error parsing caption data:', parseError);
      // Return raw data if parsing fails
      return captionData;
    }
  }
} 