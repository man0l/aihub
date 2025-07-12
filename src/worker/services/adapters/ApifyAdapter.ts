import { ApifyClient } from 'apify-client';
import { ConfigService } from '../ConfigService.js';
import { VideoDownloader, VideoFormat, VideoInfo, DownloadProgress } from '../interfaces/VideoServices.js';
import fs from 'fs';

interface ApifyVideoInput {
  url: string;
  method: string;
}

interface ApifyTaskInput {
  preferredFormat: string;
  preferredQuality: string;
  s3AccessKeyId: string;
  s3Bucket: string;
  s3Region: string;
  s3SecretAccessKey: string;
  videos: ApifyVideoInput[];
  [key: string]: any; // Add index signature for Dictionary compatibility
}

interface ApifyRunResult {
  id: string;
  defaultDatasetId: string;
  status: string;
}

export class ApifyAdapter implements VideoDownloader {
  private client: ApifyClient;
  private config: ConfigService;
  private taskId: string;

  constructor(config: ConfigService) {
    this.config = config;
    this.client = new ApifyClient({
      token: config.apifyApiToken
    });
    this.taskId = 'wowC9hvZlDxfm4Cfy';
  }

  async getInfo(videoUrl: string): Promise<VideoInfo> {
    // Extract video ID from URL
    const videoId = this.extractVideoId(videoUrl);
    
    // Apify doesn't provide video info directly
    // Return basic info structure for compatibility
    return {
      id: videoId,
      title: `Video ${videoId}`,
      formats: [],
      author: { name: 'Unknown' },
      videoId: videoId,
      videoUrl: videoUrl,
      thumbnailUrl: ''
    };
  }

  async getFormats(videoUrl: string): Promise<VideoFormat[]> {
    // Apify handles format selection internally
    // Return a basic format for compatibility
    return [
      {
        formatId: 'apify-m4a',
        container: 'm4a',
        quality: '240p',
        audioOnly: true,
        videoOnly: false,
        acodec: 'aac',
        abr: 128
      }
    ];
  }

  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    // Return the first (and only) format
    return formats.length > 0 ? formats[0] : null;
  }

  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    console.log(`Starting Apify download for video ${videoId}`);

    try {
      // Construct the YouTube URL
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      // Get storage config
      const storageConfig = this.config.getStorageConfig();
      const storageServiceConfig = this.config.getStorageServiceConfig();
      
      // Prepare the task input
      const taskInput: ApifyTaskInput = {
        preferredFormat: 'm4a',
        preferredQuality: '240p',
        s3AccessKeyId: storageConfig.accessKeyId,
        s3Bucket: storageServiceConfig.buckets.rawMedia,
        s3Region: storageConfig.region,
        s3SecretAccessKey: storageConfig.secretAccessKey,
        videos: [
          {
            url: videoUrl,
            method: 'GET'
          }
        ]
      };

      console.log(`Submitting Apify task for video ${videoId}`);
      console.log('Task input:', {
        ...taskInput,
        s3AccessKeyId: '[REDACTED]',
        s3SecretAccessKey: '[REDACTED]'
      });

      // Run the Apify task
      const run: ApifyRunResult = await this.client.task(this.taskId).call(taskInput as any);
      
      console.log(`Apify task submitted successfully. Run ID: ${run.id}`);
      console.log(`Task status: ${run.status}`);

      // The Apify actor handles the S3 upload automatically
      // Create a placeholder file for compatibility with the existing pipeline
      fs.writeFileSync(outputPath, 'placeholder-apify-download');
      
      console.log(`Apify download completed for video ${videoId}`);
      console.log(`File should be available at S3 bucket: ${storageServiceConfig.buckets.rawMedia}`);

    } catch (error) {
      console.error(`Apify download failed for video ${videoId}:`, error);
      
      // Enhanced error handling
      if (error instanceof Error) {
        throw new Error(`Apify download failed: ${error.message}`);
      } else {
        throw new Error(`Apify download failed: ${String(error)}`);
      }
    }
  }

  async downloadCaptions(videoId: string, language?: string): Promise<string | null> {
    // Apify doesn't provide caption extraction
    // Return null to indicate no captions available
    return null;
  }

  private extractVideoId(videoUrl: string): string {
    // Extract video ID from various YouTube URL formats
    const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
    const match = videoUrl.match(regex);
    return match ? match[1] : videoUrl;
  }
} 