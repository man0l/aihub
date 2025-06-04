import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { AxiosInstance } from 'axios';
import { ConfigService } from './ConfigService.js';
import { VideoDownloaderFactory, DownloaderType } from './adapters/VideoDownloaderFactory.js';
import { VideoFormat, VideoInfo, DownloadProgress, VideoDownloader } from './interfaces/VideoServices.js';
import { YtDlpAdapter } from './adapters/YtDlpAdapter.js';
import { DefaultCaptionParserFactory } from './factories/CaptionParserFactory.js';
import { CaptionService } from './CaptionService.js';

/**
 * YouTube Service - Responsible for downloading and processing YouTube videos
 */
export class YouTubeService {
  private config: ConfigService;
  private axiosClient: AxiosInstance;
  private downloaderFactory: VideoDownloaderFactory;
  private downloaderType: DownloaderType;
  private captionService: CaptionService;
  
  constructor(
    configService: ConfigService, 
    axiosClient: AxiosInstance,
    downloaderType: DownloaderType = 'oxylabs',
    private readonly userId?: string
  ) {
    this.config = configService;
    this.axiosClient = axiosClient;
    this.downloaderFactory = VideoDownloaderFactory.getInstance({ userId });
    this.downloaderType = downloaderType;
    this.captionService = new CaptionService(new DefaultCaptionParserFactory(), userId);
  }

  /**
   * Sets the downloader type to use
   */
  setDownloaderType(type: DownloaderType): void {
    this.downloaderType = type;
  }
  
  /**
   * Downloads a YouTube video as audio using the configured downloader
   */
  async downloadVideo(videoId: string): Promise<string> {
    // Ensure temp directory exists
    this.config.ensureTempDirExists();
    
    const outputFilePath = path.join(this.config.tempDir, `${videoId}_${Date.now()}.m4a`);
    let tempFilePath: string | null = null;
    
    try {
      // First get video details using the Data API
      const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${this.config.youtubeApiKey}`;
      const videoDetailsResponse = await this.axiosClient.get(videoDetailsUrl);
      
      if (!videoDetailsResponse.data.items?.length) {
        throw new Error('Video not found or not accessible');
      }
      
      const videoDetails = videoDetailsResponse.data.items[0];
      console.log(`Video details retrieved for ${videoId}:`, {
        title: videoDetails.snippet.title.substring(0, 30) + (videoDetails.snippet.title.length > 30 ? '...' : ''),
        duration: videoDetails.contentDetails.duration
      });
      
      const downloader = this.downloaderFactory.getDownloader(this.downloaderType);
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      // Get available formats
      console.log(`Getting media formats for ${videoId}...`);
      const formats = await downloader.getFormats(videoUrl);
      console.log(`Available formats for ${videoId}: ${formats.filter((f: VideoFormat) => !f.videoOnly).length} audio, ${formats.filter((f: VideoFormat) => !f.audioOnly).length} video`);
      
      // Get the best audio format
      const audioFormat = downloader.getBestAudioFormat(formats);
      if (!audioFormat) {
        throw new Error('No suitable audio format found');
      }

      console.log(`Selected audio format: ${audioFormat.quality}, ${audioFormat.container}, bitrate: ${audioFormat.abr || 'unknown'}`);
      
      // Create a temporary file path for the download
      tempFilePath = path.join(this.config.tempDir, `${videoId}_${Date.now()}_temp.m4a`);
      
      // Download the audio
      console.log(`Starting download for ${videoId}...`);
      
      // Track last logged percentage to avoid duplicate logs
      let lastLoggedPercent = -1;
      
      await downloader.downloadVideo(videoId, audioFormat, tempFilePath, (progress: DownloadProgress) => {
        // Only log at 0%, 25%, 50%, 75%, and 100% to reduce log volume
        const percent = Math.floor(progress.percent);
        if (percent % 25 === 0 && percent !== lastLoggedPercent) {
          console.log(`Download progress: ${percent}% (${progress.size}${progress.sizeUnit} at ${progress.speed}${progress.speedUnit}/s)`);
          lastLoggedPercent = percent;
        }
      });
      
      // Verify the temporary file exists and has content
      if (!fs.existsSync(tempFilePath)) {
        throw new Error(`Temporary file not found after download: ${tempFilePath}`);
      }
      
      const stats = fs.statSync(tempFilePath);
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      // Move the temporary file to the final location
      console.log(`Download complete. Moving to final location...`);
      fs.renameSync(tempFilePath, outputFilePath);
      tempFilePath = null; // Clear tempFilePath since we moved it successfully
      
      console.log(`Successfully downloaded video ${videoId} (${Math.round(stats.size / 1024 / 1024 * 10) / 10} MB)`);
      return outputFilePath;
      
    } catch (error: unknown) {
      console.error(`Error downloading YouTube video ${videoId}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Clean up temporary file if it exists
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`Cleaned up temporary file ${tempFilePath}`);
        } catch (cleanupError: unknown) {
          console.error(`Error cleaning up temporary file ${tempFilePath}:`, cleanupError);
        }
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
      const downloader = this.downloaderFactory.getDownloader(this.downloaderType);
      const info = await downloader.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      return {
        id: videoId,
        title: info.title,
        formats: info.formats,
        author: info.author,
        videoId: info.videoId,
        videoUrl: info.videoUrl,
        thumbnailUrl: info.thumbnailUrl
      };
    } catch (error) {
      console.error(`Error getting info for YouTube video ${videoId}:`, error);
      throw new Error(`Failed to get YouTube video info: ${(error as Error).message}`);
    }
  }
  
  /**
   * Fetches the transcription for a YouTube video using the configured downloader
   * @param videoId The ID of the YouTube video to fetch captions for
   * @param preferredLanguage Optional preferred language code (e.g., 'bg' for Bulgarian, 'default' for video's primary language)
   * @returns The transcription text or null if no captions were found
   */
  async fetchTranscription(videoId: string, preferredLanguage: string = 'default'): Promise<string | null> {
    try {
      const downloader = this.downloaderFactory.getDownloader(this.downloaderType);
      
      // First, try to get video details to help determine the likely language
      let detectedVideoLanguage: string | null = null;
      
      try {
        // Get video details using the YouTube Data API
        const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${this.config.youtubeApiKey}`;
        const videoResponse = await this.axiosClient.get(videoDetailsUrl);
        
        if (videoResponse.data?.items?.length > 0) {
          const videoDetails = videoResponse.data.items[0].snippet;
          
          // Try to detect language from the video's metadata
          detectedVideoLanguage = videoDetails.defaultLanguage || videoDetails.defaultAudioLanguage;
          
          // Only log if we have meaningful language info or title contains special characters
          const title = videoDetails.title || '';
          const hasCyrillic = /[\u0400-\u04FF]/.test(title);
          
          if (detectedVideoLanguage || hasCyrillic) {
            console.log(`Video "${title.substring(0, 40)}${title.length > 40 ? '...' : ''}" - detected language: ${detectedVideoLanguage || (hasCyrillic ? 'Cyrillic (likely bg)' : 'unknown')}`);
          }
          
          // Language detection heuristic based on title for Cyrillic languages
          if (!detectedVideoLanguage && hasCyrillic) {
            detectedVideoLanguage = 'bg'; // Assume Bulgarian for videos with Cyrillic titles
          }
        }
      } catch (metadataError) {
        console.error('Error fetching video metadata');
      }
      
      // Next, use YouTube Data API to get available caption tracks
      let targetLanguage = preferredLanguage;
      
      if (preferredLanguage === 'default') {
        try {
          const captionsUrl = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${this.config.youtubeApiKey}`;
          const response = await this.axiosClient.get(captionsUrl);
          
          if (response.data?.items?.length > 0) {
            const captionTracks = response.data.items;
            
            // Log available languages (concisely)
            const trackLanguages = captionTracks.map((track: any) => 
              `${track.snippet.language}${track.snippet.trackKind !== 'ASR' ? '' : '(auto)'}`).join(', ');
            console.log(`Available captions: ${trackLanguages}`);
            
            // First try to find a track explicitly marked as default
            const defaultTrack = captionTracks.find((track: any) => 
              track.snippet.isDefault === true);
              
            // Then try to find a non-ASR (manual) track
            const manualTrack = captionTracks.find((track: any) => 
              track.snippet.trackKind !== 'ASR');
              
            // Then consider ASR (auto-generated) tracks
            const asrTrack = captionTracks.find((track: any) => 
              track.snippet.trackKind === 'ASR');
            
            // Choose the best available track with this priority
            const bestTrack = defaultTrack || manualTrack || asrTrack;
            
            if (bestTrack) {
              targetLanguage = bestTrack.snippet.language;
              console.log(`Selected caption track: ${targetLanguage}${bestTrack.snippet.trackKind !== 'ASR' ? '' : ' (auto)'}`);
            } else if (detectedVideoLanguage) {
              targetLanguage = detectedVideoLanguage;
              console.log(`Using language from video metadata: ${targetLanguage}`);
            }
          } else if (detectedVideoLanguage) {
            targetLanguage = detectedVideoLanguage;
            console.log(`Using language from video metadata: ${targetLanguage}`);
          }
        } catch (apiError: any) {
          if (detectedVideoLanguage) {
            targetLanguage = detectedVideoLanguage;
            console.log(`Using language from video metadata: ${targetLanguage}`);
          }
        }
      }
      
      // Simplified caption retrieval strategy log
      const strategies = [targetLanguage];
      if (targetLanguage !== 'default') strategies.push('default');
      if (detectedVideoLanguage === 'bg' && targetLanguage !== 'bg') strategies.push('bg');
      if (targetLanguage !== 'en' && preferredLanguage !== 'en') strategies.push('en');
      
      console.log(`Caption strategy: ${strategies.join(' → ')}`);
      
      // First attempt: Use the determined language
      let transcription = await downloader.downloadCaptions(videoId, targetLanguage);
      
      // Second attempt: Try with 'default' option
      if (!transcription && targetLanguage !== 'default') {
        transcription = await downloader.downloadCaptions(videoId, 'default');
      }
      
      // Third attempt: Try Bulgarian specifically for Bulgarian content
      const isBulgarianContent = detectedVideoLanguage === 'bg';
      if (!transcription && isBulgarianContent && targetLanguage !== 'bg') {
        transcription = await downloader.downloadCaptions(videoId, 'bg');
      }
      
      // Fourth attempt: Try English as last resort
      if (!transcription && targetLanguage !== 'en' && preferredLanguage !== 'en') {
        transcription = await downloader.downloadCaptions(videoId, 'en');
      }
      
      // Log final result (success/failure only)
      console.log(transcription ? `Captions retrieved successfully (${transcription.length} chars)` : `No captions found for video ${videoId}`);
      
      return transcription;
    } catch (error) {
      console.error(`Error fetching transcription:`, error);
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