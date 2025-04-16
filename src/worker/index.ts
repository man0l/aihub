/**
 * Worker Script - YouTube Video Processing Worker
 * 
 * This script processes YouTube videos by fetching transcriptions and media,
 * then storing them in AWS S3.
 */

// Import required dependencies
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { SupabaseClient } from '@supabase/supabase-js';

// Import our TypeScript services
import { ConfigService } from './services/ConfigService.js';
import { ClientFactory } from './services/ClientFactory.js';
import { YouTubeService } from './services/YouTubeService.js';
import { StorageService } from './services/StorageService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { WebsiteProcessor } from './services/WebsiteProcessor.js';

// Export all classes/services that are used in tests
export { ConfigService } from './services/ConfigService.js';
export { ClientFactory } from './services/ClientFactory.js';
export { YouTubeService } from './services/YouTubeService.js';
export { StorageService } from './services/StorageService.js';
export { DatabaseService } from './services/DatabaseService.js';
export { WebsiteProcessor } from './services/WebsiteProcessor.js';

// Initialize environment variables
dotenv.config();

// Type definition for queued job
interface VideoJob {
  videoId: string;
  userId: string;
  sourceUrl: string;
  collectionId?: string;
  documentId?: string;
}

interface WebsiteJob {
  url: string;
  document_id: string;
  user_id: string;
  collection_id?: string;
}

/**
 * Video Processor - Responsible for processing YouTube videos
 */
class VideoProcessor {
  private youtubeService: YouTubeService;
  private storageService: StorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  
  constructor(youtubeService: YouTubeService, storageService: StorageService, databaseService: DatabaseService, configService: ConfigService) {
    this.youtubeService = youtubeService;
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.config = configService;
  }
  
  /**
   * Process a video job from the queue
   */
  async processVideo(job: VideoJob) {
    const { videoId, userId, sourceUrl, documentId } = job;
    
    console.log(`Processing video ${videoId} for user ${userId}`);
    
    try {
      // Step 1: Get video info
      const videoInfo = await this.youtubeService.getVideoInfo(videoId);
      console.log(`Video info retrieved: ${videoInfo.title}`);
      
      // Step 2: Try to get transcription using YouTube API first
      let transcription = await this.youtubeService.fetchTranscription(videoId);
      
      // If no transcription is available from YouTube API, download the video and transcribe it
      if (!transcription) {
        console.log(`No transcription available from YouTube API for ${videoId}, downloading video...`);
        
        try {
          // Download video audio
          const audioFilePath = await this.youtubeService.downloadVideo(videoId);
          console.log(`Video downloaded to ${audioFilePath}`);
          
          // Upload to S3
          const s3Key = `raw-media/${userId}/${videoId}.mp4`;
          await this.storageService.uploadFile(audioFilePath, s3Key);
          console.log(`Audio uploaded to S3: ${s3Key}`);
          
          // Clean up the temporary file
          this.config.cleanupTempFiles(audioFilePath);
          
          // At this point, we would normally send the audio for transcription
          // For now, we'll create a placeholder transcription from the video metadata
          transcription = `Title: ${videoInfo.title}\nChannel: ${videoInfo.author.name}\n\nThis is a placeholder transcription as the automatic transcription process was unable to extract the speech content.`;
          
        } catch (downloadError) {
          console.error(`Error downloading video ${videoId}:`, downloadError);
          throw downloadError;
        }
      }
      
      // Step 3: Update or create document with transcription
      // If documentId is provided, pass it to the function for direct updating
      let docResult;
      
      if (documentId) {
        // Update the existing document directly
        console.log(`Updating existing document ${documentId} with transcription for video ${videoId}`);
        const updateResult = await this.databaseService.updateDocumentStatus(
          documentId,
          'transcribed',
          {
            original_content: transcription,
            transcription: transcription,
          }
        );
        
        // Format result to match createDocumentFromTranscription response
        docResult = {
          success: !updateResult.error,
          document: { id: documentId },
          error: updateResult.error
        };
      } else {
        // Create or find document with transcription
        docResult = await this.databaseService.createDocumentFromTranscription(
          videoId,
          transcription,
          sourceUrl,
          userId
        );
      }
      
      if (!docResult.success) {
        throw new Error(`Failed to update/create document: ${docResult.error}`);
      }
      
      console.log(`Video processing complete for ${videoId}`);
      return docResult;
    } catch (error) {
      console.error(`Error processing video ${videoId}:`, error);
      throw error;
    }
  }
}

// Export VideoProcessor class
export { VideoProcessor };

/**
 * Worker - Manages the worker lifecycle and queue processing
 */
class Worker {
  private videoProcessor: VideoProcessor;
  private websiteProcessor: WebsiteProcessor;
  private databaseService: DatabaseService;
  private isRunning: boolean;
  
  constructor(videoProcessor: VideoProcessor, websiteProcessor: WebsiteProcessor, databaseService: DatabaseService) {
    this.videoProcessor = videoProcessor;
    this.websiteProcessor = websiteProcessor;
    this.databaseService = databaseService;
    this.isRunning = false;
  }
  
  /**
   * Start the worker
   */
  async start() {
    if (this.isRunning) {
      console.log('Worker is already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Video processing worker started');
    
    // Process messages in a loop
    while (this.isRunning) {
      try {
        // Process video queue
        await this.processVideoQueue();
        
        // Process website queue
        await this.processWebsiteQueue();
        
        // Wait before checking again
        await this.sleep(1000);
      } catch (error) {
        console.error('Error processing queue:', error);
        // Still wait before retrying
        await this.sleep(5000);
      }
    }
  }
  
  /**
   * Process the video queue
   */
  async processVideoQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveVideoMessage();
    
    if (error) {
      console.error('Error receiving message from video queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in video queue, waiting...');
      return;
    }
    
    console.log(`Received message from video queue: ${data.msg_id}`);
    
    try {
      // The message is now an object, not a JSON string that needs parsing
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      console.log('Processing message with video ID:', messageBody.video_id || messageBody.videoId);
      
      // Process the video with fields in both formats for compatibility
      await this.videoProcessor.processVideo({
        videoId: messageBody.video_id || messageBody.videoId,
        userId: messageBody.user_id || messageBody.userId,
        sourceUrl: messageBody.source_url || messageBody.sourceUrl,
        collectionId: messageBody.collection_id || messageBody.collectionId,
        documentId: messageBody.document_id || messageBody.documentId
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteVideoMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from video queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // In a real implementation, we might want to move this message to a dead-letter queue
      // or mark it for retry after some backoff period
      // For now, we'll delete it to prevent it from blocking the queue
      await this.databaseService.deleteVideoMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from video queue to prevent blocking`);
    }
  }
  
  /**
   * Process the website queue
   */
  async processWebsiteQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveWebsiteMessage();
    
    if (error) {
      console.error('Error receiving message from website queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in website queue, waiting...');
      return;
    }
    
    console.log(`Received message from website queue: ${data.msg_id}`);
    
    try {
      // The message is now an object, not a JSON string that needs parsing
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      // Process the website
      await this.websiteProcessor.processWebsite({
        url: messageBody.url,
        document_id: messageBody.document_id,
        user_id: messageBody.user_id,
        collection_id: messageBody.collection_id
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteWebsiteMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from website queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // In a real implementation, we might want to move this message to a dead-letter queue
      // or mark it for retry after some backoff period
      // For now, we'll delete it to prevent it from blocking the queue
      await this.databaseService.deleteWebsiteMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from website queue to prevent blocking`);
    }
  }
  
  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Stop the worker
   */
  stop() {
    console.log('Stopping worker...');
    this.isRunning = false;
  }
}

// Export Worker class
export { Worker };

/**
 * Application - Main application class
 */
class Application {
  private configService: ConfigService;
  private clientFactory: ClientFactory;
  private supabaseClient: SupabaseClient;
  private youtubeService: YouTubeService;
  private storageService: StorageService;
  private databaseService: DatabaseService;
  private videoProcessor: VideoProcessor;
  private websiteProcessor: WebsiteProcessor;
  private worker: Worker;
  
  constructor() {
    // Initialize services
    this.configService = new ConfigService();
    this.clientFactory = new ClientFactory(this.configService);
    
    // Create clients
    this.supabaseClient = this.clientFactory.createSupabaseClient();
    const s3Client = this.clientFactory.createS3Client();
    const axiosClient = this.clientFactory.createAxiosClient();
    
    // Create services
    this.storageService = new StorageService(this.configService);
    this.youtubeService = new YouTubeService(this.configService, axiosClient);
    this.databaseService = new DatabaseService(this.supabaseClient);
    
    // Create processors
    this.videoProcessor = new VideoProcessor(
      this.youtubeService,
      this.storageService,
      this.databaseService,
      this.configService
    );
    
    this.websiteProcessor = new WebsiteProcessor(
      this.storageService,
      this.databaseService,
      this.configService
    );
    
    // Create worker
    this.worker = new Worker(
      this.videoProcessor,
      this.websiteProcessor,
      this.databaseService
    );
    
    // Set up graceful shutdown
    this.setupGracefulShutdown();
  }
  
  /**
   * Set up graceful shutdown handlers
   */
  setupGracefulShutdown() {
    // Handle process termination signals
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    
    console.log('Graceful shutdown handlers registered');
  }
  
  /**
   * Shut down the application gracefully
   */
  async shutdown() {
    console.log('Shutting down...');
    
    // Stop the worker
    this.worker.stop();
    
    // Allow some time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Shutdown complete');
    process.exit(0);
  }
  
  /**
   * Start the application
   */
  async start() {
    console.log('Starting application...');
    
    // Ensure environment variables are properly set
    if (!this.configService.supabaseUrl || !this.configService.supabaseKey) {
      throw new Error('Supabase environment variables are not set');
    }
    
    if (!this.configService.s3AccessKey || !this.configService.s3SecretKey) {
      throw new Error('AWS environment variables are not set');
    }
    
    // Start the worker
    await this.worker.start();
  }
}

// Export Application class
export { Application }; 