import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { VideoFormat, VideoInfo } from './interfaces/VideoServices.js';
import {
  VideoInfoProvider,
  VideoFormatSelector,
  VideoDownloader,
  FileManager,
  ProgressTracker,
  DownloaderOptions
} from './interfaces/VideoServices.js';
import { DefaultCaptionParserFactory } from './factories/CaptionParserFactory.js';
import { CaptionService } from './CaptionService.js';

export class VideoDownloadService {
  constructor(
    private readonly infoProvider: VideoInfoProvider,
    private readonly formatSelector: VideoFormatSelector,
    private readonly downloader: VideoDownloader,
    private readonly fileManager: FileManager,
    private readonly progressTracker: ProgressTracker,
    private readonly captionService: CaptionService,
    private readonly options: DownloaderOptions = {}
  ) {}

  async downloadVideo(videoId: string, outputDir: string): Promise<string> {
    const outputFilePath = path.join(outputDir, `${videoId}.mp4`);
    
    try {
      // Ensure output directory exists
      this.fileManager.ensureDirectory(outputDir);
      
      // Clean up any existing file
      if (this.fileManager.exists(outputFilePath)) {
        console.log(`Removing existing file at ${outputFilePath}`);
        this.fileManager.cleanup(outputFilePath);
      }

      // Get video info and formats
      const info = await this.infoProvider.getVideoInfo(videoId);
      
      console.log(`Available formats:`, {
        count: info.formats.length,
        audioFormats: info.formats.filter(f => !f.videoOnly).length,
        videoFormats: info.formats.filter(f => !f.audioOnly).length
      });
      
      // Select best audio format
      const audioFormat = this.formatSelector.selectBestAudioFormat(info.formats);
      if (!audioFormat) {
        throw new Error('No suitable audio format found');
      }

      console.log(`Selected audio format:`, {
        quality: audioFormat.quality,
        container: audioFormat.container,
        codecs: audioFormat.acodec,
        bitrate: audioFormat.abr
      });
      
      // Download the audio
      console.log(`Starting download to ${outputFilePath}...`);
      await this.downloader.downloadVideo(videoId, audioFormat, outputFilePath, (progress) => {
        // Convert size to bytes based on unit
        let totalBytes = progress.size;
        switch (progress.sizeUnit.toLowerCase()) {
          case 'kb':
          case 'kib':
            totalBytes *= 1024;
            break;
          case 'mb':
          case 'mib':
            totalBytes *= 1024 * 1024;
            break;
          case 'gb':
          case 'gib':
            totalBytes *= 1024 * 1024 * 1024;
            break;
        }
        
        // Calculate downloaded bytes based on percentage
        const downloadedBytes = Math.floor(totalBytes * (progress.percent / 100));
        this.progressTracker.onProgress(downloadedBytes, totalBytes);
      });
      
      // Verify download
      if (!this.fileManager.exists(outputFilePath)) {
        throw new Error('Download failed: Output file not found');
      }
      
      const stats = await fs.promises.stat(outputFilePath);
      this.progressTracker.onComplete(stats.size);
      return outputFilePath;
      
    } catch (error) {
      // Clean up on error
      if (this.fileManager.exists(outputFilePath)) {
        this.fileManager.cleanup(outputFilePath);
      }
      
      this.progressTracker.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
      const info = await this.infoProvider.getVideoInfo(videoId);
      return {
        id: info.id,
        title: info.title,
        formats: info.formats
      };
    } catch (error) {
      throw new Error(`Failed to get video info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Downloads and extracts transcription from video captions
   * @param videoId The ID of the video to get captions from
   * @returns The extracted transcription text, or null if no captions available
   */
  async getTranscription(videoId: string): Promise<string | null> {
    try {
      return await this.downloader.downloadCaptions(videoId);
    } catch (error) {
      console.error(`Failed to get transcription for video ${videoId}:`, error);
      return null;
    }
  }
} 