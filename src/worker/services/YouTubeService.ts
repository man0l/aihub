import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { AxiosInstance } from 'axios';
import { ConfigService } from './ConfigService.js';
import { VideoDownloaderFactory, DownloaderType } from './adapters/VideoDownloaderFactory.js';
import { VideoFormat, VideoInfo } from './interfaces/VideoServices.js';
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
    downloaderType: DownloaderType = 'ytdl'
  ) {
    this.config = configService;
    this.axiosClient = axiosClient;
    this.downloaderFactory = VideoDownloaderFactory.getInstance();
    this.downloaderType = downloaderType;
    this.captionService = new CaptionService(new DefaultCaptionParserFactory());
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
      
      const downloader = this.downloaderFactory.getDownloader(this.downloaderType);
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      // Get available formats
      console.log(`Getting media formats for ${videoId}...`);
      const formats = await downloader.getFormats(videoUrl);
      console.log(`Available formats for ${videoId}:`, {
        count: formats.length,
        audioFormats: formats.filter(f => !f.videoOnly).length,
        videoFormats: formats.filter(f => !f.audioOnly).length
      });
      
      // Get the best audio format
      const audioFormat = downloader.getBestAudioFormat(formats);
      if (!audioFormat) {
        throw new Error('No suitable audio format found');
      }

      console.log(`Selected audio format for ${videoId}:`, {
        quality: audioFormat.quality,
        container: audioFormat.container,
        acodec: audioFormat.acodec,
        abr: audioFormat.abr
      });
      
      // Download the audio
      console.log(`Starting download for ${videoId}...`);
      const audioStream = await downloader.downloadAudio(videoUrl, audioFormat);
      
      // Save the stream to file
      console.log(`Creating write stream to ${outputFilePath}...`);
      const writer = fs.createWriteStream(outputFilePath);
      
      // Add error handler for the write stream
      writer.on('error', (err: Error) => {
        console.error(`Error writing to file for ${videoId}:`, err);
      });
      
      // Add progress logging
      let downloadedBytes = 0;
      audioStream.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes % (1024 * 1024) === 0) { // Log every MB
          console.log(`Downloaded ${downloadedBytes / (1024 * 1024)} MB for ${videoId}`);
        }
      });
      
      console.log(`Starting pipeline for ${videoId}...`);
      await pipeline(audioStream, writer);
      
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
   */
  async fetchTranscription(videoId: string): Promise<string | null> {
    try {
      const downloader = this.downloaderFactory.getDownloader(this.downloaderType);
      return await downloader.downloadCaptions(videoId);
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