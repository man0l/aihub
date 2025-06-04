import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { 
  VideoDownloader, 
  VideoFormat, 
  VideoInfo, 
  DownloadProgress,
  DownloaderOptions
} from '../interfaces/VideoServices.js';

export interface OxylabsOptions extends DownloaderOptions {
  username: string;
  password: string;
  apiHost?: string;
  storageType?: 'local' | 's3';
  storageUrl?: string;
  preferredLanguage?: string;
}

/**
 * OxylabsAdapter - Adapter for the Oxylabs YouTube Downloader API
 * Implements the VideoDownloader interface
 * 
 * This adapter uses Oxylabs' "youtube_download" source to directly download
 * YouTube videos to S3 storage with proper path structure matching the worker.
 */
export class OxylabsAdapter implements VideoDownloader {
  private username: string;
  private password: string;
  private readonly userId?: string;
  private storageType: 'local' | 's3';
  private storageUrl?: string;
  private preferredLanguage: string;
  private apiBaseUrl: string;
  private bucketName = 'bobi-transcribe-demo-raw-media-input';

  constructor(options: OxylabsOptions) {
    this.username = options.username;
    this.password = options.password;
    this.userId = options.userId;
    this.storageType = options.storageType || 's3';
    this.storageUrl = options.storageUrl;
    this.preferredLanguage = options.preferredLanguage || 'en';
    this.apiBaseUrl = options.apiHost || 'https://data.oxylabs.io/v1/queries';
    
    // Validate credentials
    if (!this.username || !this.password) {
      throw new Error('Oxylabs credentials are required. Please set OXYLABS_API_USER and OXYLABS_API_PASS environment variables.');
    }
    
    console.log(`OxylabsAdapter initialized with userId: ${this.userId || 'none'}, storageType: ${this.storageType}, username: ${this.username}, apiHost: ${this.apiBaseUrl}`);
  }

  /**
   * Get video information
   */
  async getInfo(videoUrl: string): Promise<VideoInfo> {
    const videoId = this.extractVideoId(videoUrl);
    
    try {
      // Return available formats for YouTube downloads
      return {
        id: videoId,
        title: `YouTube Video ${videoId}`,
        formats: [
          {
            formatId: '1080',
            container: 'mp4',
            quality: '1080p',
            audioOnly: false,
            videoOnly: false,
            vcodec: 'h264',
            acodec: 'aac',
          },
          {
            formatId: '720',
            container: 'mp4',
            quality: '720p',
            audioOnly: false,
            videoOnly: false,
            vcodec: 'h264',
            acodec: 'aac',
          },
          {
            formatId: '480',
            container: 'mp4',
            quality: '480p',
            audioOnly: false,
            videoOnly: false,
            vcodec: 'h264',
            acodec: 'aac',
          },
          {
            formatId: 'audio',
            container: 'm4a',
            quality: 'high',
            audioOnly: true,
            videoOnly: false,
            acodec: 'aac',
          }
        ],
        videoId,
        videoUrl,
      };
    } catch (error) {
      console.error(`Error getting info for YouTube video ${videoId}:`, error);
      throw new Error(`Failed to get YouTube video info: ${(error as Error).message}`);
    }
  }

  /**
   * Get available formats for a video
   */
  async getFormats(videoUrl: string): Promise<VideoFormat[]> {
    const info = await this.getInfo(videoUrl);
    return info.formats;
  }

  /**
   * Get the best audio format from available formats
   */
  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    // Filter for audio-only formats
    const audioFormats = formats.filter(format => format.audioOnly);
    
    if (audioFormats.length === 0) {
      return null;
    }
    
    // Return the audio format
    return audioFormats[0];
  }

  /**
   * Download a video using Oxylabs YouTube Download API
   */
  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    try {
      // Report initial progress
      if (onProgress) {
        onProgress({
          percent: 0,
          size: 0,
          sizeUnit: 'MB',
          speed: 0,
          speedUnit: 'MB/s'
        });
      }

      if (this.storageType === 's3') {
        // Use S3 storage with proper path structure
        await this.downloadToS3(videoId, format, onProgress);
      } else {
        // Fallback to local download (not recommended for production)
        await this.downloadDirectly(videoId, format, outputPath, onProgress);
      }
      
      // Report complete progress
      if (onProgress) {
        onProgress({
          percent: 100,
          size: 1, // We don't know the actual size until download completes
          sizeUnit: 'MB',
          speed: 0,
          speedUnit: 'MB/s'
        });
      }

      console.log(`Successfully downloaded YouTube video ${videoId} using Oxylabs`);
    } catch (error) {
      console.error(`Error downloading YouTube video ${videoId}:`, error);
      throw new Error(`Failed to download YouTube video: ${(error as Error).message}`);
    }
  }

  /**
   * Download video directly to S3 using Oxylabs YouTube Download API
   */
  private async downloadToS3(
    videoId: string,
    format: VideoFormat,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    try {
      // Construct S3 path matching worker structure: raw-media/{userId}/{videoId}/
      const s3Path = `raw-media/${this.userId || 'unknown'}/${videoId}/`;
      // Don't include s3:// prefix - Oxylabs expects just bucket/path format
      const storageUrl = `${this.bucketName}/${s3Path}`;

      // Determine video quality based on format
      let videoQuality = '720'; // default
      if (format.formatId === '1080') videoQuality = '1080';
      else if (format.formatId === '720') videoQuality = '720';
      else if (format.formatId === '480') videoQuality = '480';

      // Determine download type
      const downloadType = format.audioOnly ? 'audio' : 'video';

      // Submit the job to Oxylabs YouTube Download API
      const payload = {
        source: 'youtube_download',
        query: videoId,
        storage_type: 's3',
        storage_url: storageUrl,
        context: [
          {
            key: 'download_type',
            value: downloadType
          },
          {
            key: 'video_quality',
            value: videoQuality
          }
        ]
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64')
      };

      console.log(`Submitting Oxylabs job for video ${videoId} with payload:`, JSON.stringify(payload, null, 2));

      const response = await axios.post(this.apiBaseUrl, payload, { headers });
      const jobInfo = response.data;
      
      console.log(`Job submitted to Oxylabs:`, jobInfo);
      
      if (!jobInfo.id) {
        throw new Error('No job ID returned from Oxylabs API');
      }
      
      // Poll for job status
      let jobStatus = 'pending';
      let retries = 0;
      const maxRetries = 120; // Wait up to 10 minutes (120 * 5s)
      
      while (jobStatus === 'pending' && retries < maxRetries) {
        // Report progress
        if (onProgress) {
          onProgress({
            percent: Math.min(90, Math.floor(retries / maxRetries * 100)),
            size: 0,
            sizeUnit: 'MB',
            speed: 0,
            speedUnit: 'MB/s'
          });
        }
        
        // Wait 5 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check job status
        const statusResponse = await axios.get(`${this.apiBaseUrl}/${jobInfo.id}`, { headers });
        const statusData = statusResponse.data;
        jobStatus = statusData.status;
        
        console.log(`Job status for ${videoId}: ${jobStatus}`);
        
        // If job is done, log the results
        if (jobStatus === 'done' && statusData.results) {
          console.log(`Download completed for ${videoId}. Files available at: s3://${storageUrl}`);
          if (statusData.results.length > 0) {
            console.log(`Download results:`, statusData.results);
          }
        }
        
        retries++;
      }
      
      if (jobStatus !== 'done') {
        throw new Error(`Job did not complete successfully. Status: ${jobStatus}. Waited ${retries * 5} seconds.`);
      }
      
      console.log(`Successfully downloaded YouTube video ${videoId} to S3: s3://${storageUrl}`);
    } catch (error) {
      console.error(`Error in downloadToS3 for video ${videoId}:`, error);
      throw new Error(`Failed to download YouTube video to S3: ${(error as Error).message}`);
    }
  }

  /**
   * Download video directly (fallback method for local storage)
   */
  private async downloadDirectly(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    try {
      // Determine video quality based on format
      let videoQuality = '720'; // default
      if (format.formatId === '1080') videoQuality = '1080';
      else if (format.formatId === '720') videoQuality = '720';
      else if (format.formatId === '480') videoQuality = '480';

      // Determine download type
      const downloadType = format.audioOnly ? 'audio' : 'video';

      // Submit the job to Oxylabs YouTube Download API (without S3 storage)
      const payload = {
        source: 'youtube_download',
        query: videoId,
        context: [
          {
            key: 'download_type',
            value: downloadType
          },
          {
            key: 'video_quality',
            value: videoQuality
          }
        ]
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64')
      };

      const response = await axios.post(this.apiBaseUrl, payload, { headers });
      const jobInfo = response.data;
      
      console.log(`Job submitted to Oxylabs:`, jobInfo);
      
      if (!jobInfo.id) {
        throw new Error('No job ID returned from Oxylabs API');
      }
      
      // Poll for job status
      let jobStatus = 'pending';
      let retries = 0;
      const maxRetries = 120; // Wait up to 10 minutes
      
      while (jobStatus === 'pending' && retries < maxRetries) {
        // Report progress
        if (onProgress) {
          onProgress({
            percent: Math.min(90, Math.floor(retries / maxRetries * 100)),
            size: 0,
            sizeUnit: 'MB',
            speed: 0,
            speedUnit: 'MB/s'
          });
        }
        
        // Wait 5 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check job status
        const statusResponse = await axios.get(`${this.apiBaseUrl}/${jobInfo.id}`, { headers });
        jobStatus = statusResponse.data.status;
        
        console.log(`Job status for ${videoId}: ${jobStatus}`);
        retries++;
      }
      
      if (jobStatus !== 'done') {
        throw new Error(`Job did not complete successfully. Status: ${jobStatus}`);
      }
      
      // Get the results and save to local file
      const resultsResponse = await axios.get(`${this.apiBaseUrl}/${jobInfo.id}/results?type=raw`, { 
        headers,
        responseType: 'stream'
      });
      
      // Write the results to the output file
      const writer = fs.createWriteStream(outputPath);
      
      await new Promise<void>((resolve, reject) => {
        resultsResponse.data.pipe(writer);
        writer.on('finish', () => resolve());
        writer.on('error', (err) => reject(err));
      });
      
      console.log(`Downloaded YouTube video ${videoId} to ${outputPath}`);
    } catch (error) {
      console.error(`Error in downloadDirectly for video ${videoId}:`, error);
      throw new Error(`Failed to download YouTube video: ${(error as Error).message}`);
    }
  }

  /**
   * Download captions for a video
   */
  async downloadCaptions(videoId: string, language: string = this.preferredLanguage): Promise<string | null> {
    try {
      // Oxylabs YouTube Download API doesn't have a specific endpoint for captions
      // This would need to be implemented separately or as part of the video download
      console.log(`Captions download not implemented for Oxylabs adapter`);
      return null;
    } catch (error) {
      console.error(`Error downloading captions for video ${videoId}:`, error);
      return null;
    }
  }

  /**
   * Extract video ID from YouTube URL
   */
  private extractVideoId(url: string): string {
    // Handle both full URLs and direct video IDs
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      // If it's not a URL but just an ID
      return url;
    }
    
    // Extract from youtube.com URLs
    const matchYoutube = url.match(/[?&]v=([^&]+)/);
    if (matchYoutube) {
      return matchYoutube[1];
    }
    
    // Extract from youtu.be URLs
    const matchYoutuBe = url.match(/youtu\.be\/([^?&]+)/);
    if (matchYoutuBe) {
      return matchYoutuBe[1];
    }
    
    throw new Error('Invalid YouTube URL or video ID');
  }
} 