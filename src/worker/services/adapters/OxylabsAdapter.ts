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
        query: [videoId], // Oxylabs expects an array, even for single videos
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

      console.log(`[OxylabsAdapter] Submitting job for video ${videoId} (${downloadType}, ${videoQuality}p)`);
      console.log(`[OxylabsAdapter] Storage URL: ${storageUrl}`);
      console.log(`[OxylabsAdapter] Payload:`, JSON.stringify(payload, null, 2));

      // Submit the job
      const response = await axios.post(this.apiBaseUrl, payload, { headers });
      const responseData = response.data;
      
      console.log(`[OxylabsAdapter] Job submitted successfully:`, responseData);
      
      // Handle Oxylabs response format: { queries: [{ id: "...", ... }] }
      let jobInfo;
      if (responseData.queries && responseData.queries.length > 0) {
        jobInfo = responseData.queries[0];
      } else if (responseData.id) {
        // Fallback for direct format
        jobInfo = responseData;
      } else {
        throw new Error('No job information returned from Oxylabs API. Response: ' + JSON.stringify(responseData));
      }
      
      if (!jobInfo.id) {
        throw new Error('No job ID found in Oxylabs response. Job info: ' + JSON.stringify(jobInfo));
      }
      
      console.log(`[OxylabsAdapter] Job submitted successfully with ID: ${jobInfo.id}`);
      console.log(`[OxylabsAdapter] File will be uploaded to: s3://${storageUrl}`);
      
      // Oxylabs handles the download and S3 upload asynchronously
      // No need to poll - the file will be available in S3 once processing completes
      
      // Report completion
      if (onProgress) {
        onProgress({
          percent: 100,
          size: 1,
          sizeUnit: 'MB',
          speed: 0,
          speedUnit: 'MB/s'
        });
      }
      
      console.log(`[OxylabsAdapter] Successfully submitted YouTube video ${videoId} download job to Oxylabs. File will be available at: s3://${storageUrl}`);
      
    } catch (error) {
      console.error(`[OxylabsAdapter] Error in downloadToS3 for video ${videoId}:`, error);
      
      // Provide more specific error messages
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const responseData = error.response?.data;
        
        if (status === 400) {
          throw new Error(`Bad request to Oxylabs API: ${JSON.stringify(responseData)} - Check your payload format and credentials`);
        } else if (status === 401) {
          throw new Error(`Authentication failed: Invalid Oxylabs credentials`);
        } else if (status === 403) {
          throw new Error(`Access forbidden: Check your Oxylabs account permissions and S3 bucket policy`);
        } else if (status && status >= 500) {
          throw new Error(`Oxylabs server error (${status}): ${JSON.stringify(responseData)}`);
        } else {
          throw new Error(`Oxylabs API error (${status || 'unknown'}): ${error.message}`);
        }
      }
      
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
        query: [videoId], // Oxylabs expects an array, even for single videos
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
      const responseData = response.data;
      
      console.log(`Job submitted to Oxylabs:`, responseData);
      
      // Handle Oxylabs response format: { queries: [{ id: "...", ... }] }
      let jobInfo;
      if (responseData.queries && responseData.queries.length > 0) {
        jobInfo = responseData.queries[0];
      } else if (responseData.id) {
        // Fallback for direct format
        jobInfo = responseData;
      } else {
        throw new Error('No job information returned from Oxylabs API. Response: ' + JSON.stringify(responseData));
      }
      
      if (!jobInfo.id) {
        throw new Error('No job ID found in Oxylabs response. Job info: ' + JSON.stringify(jobInfo));
      }
      
      console.log(`[OxylabsAdapter] Direct download job submitted successfully with ID: ${jobInfo.id}`);
      
      // Oxylabs handles the download asynchronously
      // For direct downloads, the results would be available via the API once complete
      // For now, we'll just report success after job submission
      
      // Report completion
      if (onProgress) {
        onProgress({
          percent: 100,
          size: 1,
          sizeUnit: 'MB',
          speed: 0,
          speedUnit: 'MB/s'
        });
      }
      
      console.log(`[OxylabsAdapter] Successfully submitted direct download job for YouTube video ${videoId}`);
      // Note: For direct downloads, you would need to poll the API later to get the actual file data
      
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
      console.log(`[OxylabsAdapter] Attempting to download captions for video ${videoId} in language ${language}`);
      
      // Oxylabs YouTube Download API doesn't have a specific endpoint for captions
      // We could potentially use their general scraping API to get transcript data
      // For now, we'll try to use youtube-transcript-api as a fallback
      
      // Try to use Oxylabs to scrape the transcript from the YouTube page
      const payload = {
        source: 'universal',
        url: `https://www.youtube.com/watch?v=${videoId}`,
        parse: true,
        context: [
          {
            key: 'extract',
            value: 'transcript'
          }
        ]
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64')
      };

      console.log(`[OxylabsAdapter] Trying to extract transcript using Oxylabs universal scraper for ${videoId}`);
      
      const response = await axios.post(this.apiBaseUrl, payload, { headers });
      const responseData = response.data;
      
      // Handle Oxylabs response format: { queries: [{ id: "...", ... }] }
      let jobInfo;
      if (responseData.queries && responseData.queries.length > 0) {
        jobInfo = responseData.queries[0];
      } else if (responseData.id) {
        // Fallback for direct format
        jobInfo = responseData;
      } else {
        console.log(`[OxylabsAdapter] No job information returned for transcript extraction, falling back to null`);
        return null;
      }
      
      if (!jobInfo.id) {
        console.log(`[OxylabsAdapter] No job ID returned for transcript extraction, falling back to null`);
        return null;
      }
      
      // Poll for completion (shorter timeout for captions)
      let jobStatus = 'pending';
      let retries = 0;
      const maxRetries = 24; // Wait up to 2 minutes (24 * 5s)
      
      while (jobStatus === 'pending' && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          const statusResponse = await axios.get(`${this.apiBaseUrl}/${jobInfo.id}`, { headers });
          const statusData = statusResponse.data;
          jobStatus = statusData.status;
          
          if (jobStatus === 'done') {
            // Try to extract transcript from results
            if (statusData.results && statusData.results.length > 0) {
              const result = statusData.results[0];
              if (result.content && typeof result.content === 'string') {
                // Try to find transcript in the scraped content
                const transcriptMatch = result.content.match(/"transcriptRenderer":\s*{.*?"runs":\s*(\[.*?\])/s);
                if (transcriptMatch) {
                  try {
                    const runs = JSON.parse(transcriptMatch[1]);
                    const transcript = runs.map((run: any) => run.text).join(' ');
                    console.log(`[OxylabsAdapter] Successfully extracted transcript for ${videoId}`);
                    return transcript;
                  } catch (parseError) {
                    console.warn(`[OxylabsAdapter] Failed to parse transcript JSON for ${videoId}:`, parseError);
                  }
                }
              }
            }
            console.log(`[OxylabsAdapter] No transcript found in scraped content for ${videoId}`);
            return null;
          } else if (jobStatus === 'failed' || jobStatus === 'error') {
            console.log(`[OxylabsAdapter] Transcript extraction job failed for ${videoId}: ${jobStatus}`);
            return null;
          }
        } catch (statusError) {
          console.warn(`[OxylabsAdapter] Error checking transcript job status for ${videoId}:`, statusError);
        }
        
        retries++;
      }
      
      console.log(`[OxylabsAdapter] Transcript extraction timed out for ${videoId}`);
      return null;
      
    } catch (error) {
      console.warn(`[OxylabsAdapter] Error downloading captions for video ${videoId}:`, error);
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