import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { AxiosInstance } from 'axios';
import ytdl from 'ytdl-core';
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
   * Downloads a YouTube video as audio
   */
  async downloadVideo(videoId: string): Promise<string> {
    // Ensure temp directory exists
    this.config.ensureTempDirExists();
    
    const outputFilePath = path.join(this.config.tempDir, `${videoId}.mp4`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
      const audioStream = ytdl(videoUrl, { 
        quality: 'lowestaudio',
        filter: 'audioonly' 
      });
      
      const fileWriteStream = fs.createWriteStream(outputFilePath);
      await pipeline(audioStream, fileWriteStream);
      
      console.log(`Downloaded YouTube video ${videoId} to ${outputFilePath}`);
      return outputFilePath;
    } catch (error) {
      console.error(`Error downloading YouTube video ${videoId}:`, error);
      throw new Error(`Failed to download YouTube video: ${(error as Error).message}`);
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
      // First, get the caption track info
      const captionResponse = await this.axiosClient.get(
        `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${this.config.youtubeApiKey}`
      );
      
      if (!captionResponse.data.items || captionResponse.data.items.length === 0) {
        console.log(`No captions found for video ${videoId}`);
        return null;
      }
      
      // Find English captions
      const englishCaptions = captionResponse.data.items.find(
        (caption: any) => caption.snippet.language === 'en'
      );
      
      if (!englishCaptions) {
        console.log(`No English captions found for video ${videoId}`);
        return null;
      }
      
      // Get the transcript
      const transcriptResponse = await this.axiosClient.get(
        `https://www.googleapis.com/youtube/v3/captions/${englishCaptions.id}?key=${this.config.youtubeApiKey}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.youtubeApiKey}`
          }
        }
      );
      
      if (!transcriptResponse.data) {
        return null;
      }
      
      // Process the transcript data
      const transcript = transcriptResponse.data;
      return transcript;
    } catch (error) {
      console.error(`Error fetching transcription for video ${videoId}:`, error);
      return null;
    }
  }
} 