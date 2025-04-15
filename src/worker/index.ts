/**
 * Worker Script - YouTube Video Processing Worker
 * 
 * This script processes YouTube videos by fetching transcriptions and media,
 * then storing them in AWS S3.
 */

// Import required dependencies
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import ytdl from 'ytdl-core';
import fs from 'fs';
import path from 'path';
import { SupabaseClient } from '@supabase/supabase-js';

// Import our TypeScript services
import { ConfigService } from './services/ConfigService.js';
import { ClientFactory } from './services/ClientFactory.js';
import { YouTubeService } from './services/YouTubeService.js';
import { StorageService } from './services/StorageService.js';
import { DatabaseService } from './services/DatabaseService.js';

// Initialize environment variables
dotenv.config();

/**
 * Video Processor - Responsible for orchestrating the video processing workflow
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
  
  async processVideo(job: { videoId: string; userId: string; sourceUrl: string }) {
    const { videoId, userId, sourceUrl } = job;
    console.log(`Processing video: ${videoId}`);
    
    try {
      // Update status to processing
      await this.databaseService.updateVideoProcessingStatus(videoId, userId, 'processing');
      
      // 1. Try to get YouTube transcription first
      let transcription = await this.youtubeService.fetchTranscription(videoId);
      let videoUrl = null;
      let audioUrl = null;
      let transcriptionUrl = null;
      
      // 2. If no transcription, download video and upload to S3
      if (!transcription) {
        console.log(`No transcription available for ${videoId}, downloading video...`);
        const videoPath = await this.youtubeService.downloadVideo(videoId);
        const audioPath = path.join(this.config.tempDir, `${videoId}.mp3`);
        
        // Upload to S3 with proper path structure
        videoUrl = await this.storageService.uploadFile(videoPath, `users/${userId}/videos/${videoId}.mp4`);
        audioUrl = await this.storageService.uploadFile(audioPath, `users/${userId}/audio/${videoId}.mp3`);
        
        // Clean up temp files
        fs.unlinkSync(videoPath);
        fs.unlinkSync(audioPath);
      } else {
        // If we have a transcription, save it to S3
        const transcriptionFilePath = path.join(this.config.tempDir, `${videoId}.txt`);
        fs.writeFileSync(transcriptionFilePath, transcription);
        
        // Upload transcription to the processed transcripts bucket
        transcriptionUrl = await this.storageService.uploadFile(
          transcriptionFilePath, 
          `users/${userId}/transcripts/${videoId}.txt`
        );
        
        // Clean up temp file
        fs.unlinkSync(transcriptionFilePath);
      }
      
      // 3. Update the video processing record
      await this.databaseService.updateVideoProcessingStatus(videoId, userId, 'completed', {
        transcription,
        video_url: videoUrl,
        audio_url: audioUrl,
        transcription_url: transcriptionUrl,
        completed_at: new Date()
      });
      
      console.log(`Successfully processed video: ${videoId}`);
      
      // 4. Create a document in the documents table
      if (transcription) {
        await this.databaseService.createDocumentFromTranscription(
          videoId, transcription, sourceUrl, userId
        );
      }
      
      return { success: true };
    } catch (error) {
      console.error(`Error processing video ${videoId}:`, error);
      
      // Update status to error
      await this.databaseService.updateVideoProcessingStatus(videoId, userId, 'error', {
        error_message: (error as Error).message
      });
      
      return { success: false, error: (error as Error).message };
    }
  }
}

/**
 * Worker - Responsible for managing the worker lifecycle and processing queue messages
 */
class Worker {
  private videoProcessor: VideoProcessor;
  private databaseService: DatabaseService;
  private isRunning: boolean;
  
  constructor(videoProcessor: VideoProcessor, databaseService: DatabaseService) {
    this.videoProcessor = videoProcessor;
    this.databaseService = databaseService;
    this.isRunning = false;
  }
  
  async start() {
    if (this.isRunning) {
      console.log('Worker is already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Video processing worker started');
    console.log('Using PGMQ extension version 1.4.4');
    
    // Start the worker loop
    this.processQueue().catch(error => {
      console.error('Worker error:', error);
      this.isRunning = false;
    });
  }
  
  async processQueue() {
    while (this.isRunning) {
      try {
        console.log('Attempting to receive message from queue...');
        
        // Dequeue a message from the video processing queue
        const { data: message, error } = await this.databaseService.receiveMessageFromQueue();
        
        if (error) {
          console.error('Error receiving message from queue:', error);
          console.error('Error details:', JSON.stringify(error));
          await this.sleep(5000);  // Wait 5 seconds before retry
          continue;
        }
        
        if (!message || !message.message_id) {
          console.log('No messages in queue, waiting...');
          await this.sleep(10000);  // Wait 10 seconds before checking again
          continue;
        }
        
        console.log(`Processing message: ${message.message_id}, type: ${typeof message.message_id}`);
        const job = JSON.parse(message.message);
        
        // Process the job
        const result = await this.videoProcessor.processVideo(job);
        
        if (result.success) {
          // If successful, delete the message from the queue
          console.log(`Deleting message ${message.message_id}, type: ${typeof message.message_id}`);
          
          const { error: deleteError } = await this.databaseService.deleteMessageFromQueue(message.message_id);
            
          if (deleteError) {
            console.error('Error deleting message from queue:', deleteError);
            console.error('Delete error details:', JSON.stringify(deleteError));
          } else {
            console.log(`Successfully completed job for message: ${message.message_id}`);
          }
        } else {
          // If failed, we let the visibility timeout expire and the message will be retried
          console.log(`Failed to process job for message: ${message.message_id}, will be retried`);
        }
      } catch (error) {
        console.error('Error in worker loop:', error);
        await this.sleep(5000);  // Wait 5 seconds before retry
      }
    }
  }
  
  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  stop() {
    this.isRunning = false;
    console.log('Worker stopped');
  }
}

/**
 * Application - Responsible for bootstrapping the application
 */
class Application {
  private configService: ConfigService;
  private clientFactory: ClientFactory;
  private supabaseClient: SupabaseClient;
  private youtubeService: YouTubeService;
  private storageService: StorageService;
  private databaseService: DatabaseService;
  private videoProcessor: VideoProcessor;
  private worker: Worker;
  
  constructor() {
    // Initialize services using our TypeScript implementations
    this.configService = new ConfigService();
    this.clientFactory = new ClientFactory(this.configService);
    
    // Create clients
    this.supabaseClient = this.clientFactory.createSupabaseClient();
    
    // Initialize service layer
    this.youtubeService = new YouTubeService(this.configService, this.clientFactory.createAxiosClient());
    this.storageService = new StorageService(this.configService);
    this.databaseService = new DatabaseService(this.supabaseClient);
    
    // Initialize processor
    this.videoProcessor = new VideoProcessor(
      this.youtubeService,
      this.storageService,
      this.databaseService,
      this.configService
    );
    
    // Initialize worker
    this.worker = new Worker(this.videoProcessor, this.databaseService);
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }
  
  setupGracefulShutdown() {
    // Handle graceful shutdown
    process.on('SIGTERM', this.shutdown.bind(this));
    process.on('SIGINT', this.shutdown.bind(this));
    
    console.log('Graceful shutdown handlers registered');
  }
  
  async shutdown() {
    console.log('Received shutdown signal, shutting down gracefully...');
    
    // Stop the worker
    if (this.worker) {
      this.worker.stop();
      console.log('Worker stopped');
    }
    
    // Allow some time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Exit process
    console.log('Exiting process');
    process.exit(0);
  }
  
  async start() {
    await this.worker.start();
  }
}

// Bootstrap the application only when this is the main module
if (process.env.NODE_ENV !== 'test') {
  const app = new Application();
  app.start().catch(console.error);
}

// Export classes for testing
export {
  ConfigService,
  ClientFactory,
  YouTubeService,
  StorageService,
  DatabaseService,
  VideoProcessor,
  Worker,
  Application
}; 