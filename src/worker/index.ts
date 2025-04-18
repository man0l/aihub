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
import axios from 'axios';

// Import our TypeScript services
import { ConfigService } from './services/ConfigService.js';
import { ClientFactory } from './services/ClientFactory.js';
import { YouTubeService } from './services/YouTubeService.js';
import { StorageService } from './services/StorageService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { WebsiteProcessor } from './services/WebsiteProcessor.js';
import { StorageServiceFactory } from './services/StorageServiceFactory.js';
import { IStorageService } from './services/interfaces/IStorageService.js';

// Export all classes/services that are used in tests
export { ConfigService } from './services/ConfigService.js';
export { ClientFactory } from './services/ClientFactory.js';
export { YouTubeService } from './services/YouTubeService.js';
export { StorageService } from './services/StorageService.js';
export { DatabaseService } from './services/DatabaseService.js';
export { WebsiteProcessor } from './services/WebsiteProcessor.js';

// Initialize environment variables
dotenv.config();

// Type definitions for queued jobs
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

interface DocumentJob {
  documentId: string;
  userId: string;
  sourceUrl: string;
  collectionId?: string;
}

/**
 * Document Processor - Responsible for processing uploaded documents
 */
class DocumentProcessor {
  private storageService: IStorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  
  constructor(
    storageService: IStorageService,
    databaseService: DatabaseService,
    configService: ConfigService
  ) {
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.config = configService;
  }

  /**
   * Process a document job from the queue
   */
  async processDocument(job: DocumentJob) {
    const { documentId, userId, sourceUrl } = job;
    
    console.log(`Processing document ${documentId} for user ${userId}`);
    
    try {
      // Download the document from S3
      const tempFilePath = path.join(this.config.tempDir, `${documentId}-${path.basename(sourceUrl)}`);
      await this.storageService.downloadFile(sourceUrl.replace('s3://', ''), tempFilePath);
      console.log(`Document downloaded to ${tempFilePath}`);

      // TODO: Add document processing logic here
      // For now, we'll just update the status to show it's been processed
      const updateResult = await this.databaseService.updateDocumentStatus(
        documentId,
        'completed',
        {
          processing_status: 'completed',
          // Add any additional fields that would be populated during processing
        }
      );

      if (updateResult.error) {
        throw new Error(`Failed to update document status: ${updateResult.error.message}`);
      }

      // Clean up temporary file
      this.config.cleanupTempFiles(tempFilePath);
      
      console.log(`Document processing complete for ${documentId}`);
      return { success: true, document: { id: documentId } };
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      
      // Update document status to error
      await this.databaseService.updateDocumentStatus(
        documentId,
        'error',
        {
          processing_status: 'error',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        }
      );
      
      throw error;
    }
  }
}

// Export DocumentProcessor class
export { DocumentProcessor };

/**
 * Video Processor - Responsible for processing YouTube videos
 */
class VideoProcessor {
  private youtubeService: YouTubeService;
  private storageService: IStorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  
  constructor(
    youtubeService: YouTubeService, 
    storageService: IStorageService,
    databaseService: DatabaseService, 
    configService: ConfigService
  ) {
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
      // Get video info first
      const info = await this.youtubeService.getVideoInfo(videoId);
      console.log(`Video info retrieved: ${info.title}`);

      // Update YouTubeService with userId for this request
      this.youtubeService = new YouTubeService(
        this.config, 
        this.youtubeService['axiosClient'], 
        'yt-dlp',
        userId
      );

      // Step 1: Try to get transcription using YouTube API first
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
          transcription = `Title: ${info.title}\nChannel: ${info.author?.name || 'Unknown'}\n\nThis is a placeholder transcription as the automatic transcription process was unable to extract the speech content.`;
          
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
  private documentProcessor: DocumentProcessor;
  private databaseService: DatabaseService;
  private isRunning: boolean;
  
  constructor(
    videoProcessor: VideoProcessor, 
    websiteProcessor: WebsiteProcessor, 
    documentProcessor: DocumentProcessor,
    databaseService: DatabaseService
  ) {
    this.videoProcessor = videoProcessor;
    this.websiteProcessor = websiteProcessor;
    this.documentProcessor = documentProcessor;
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
    console.log('Worker started');
    
    await this.processQueues();
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
   * Process the document queue
   */
  async processDocumentQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveDocumentMessage();
    
    if (error) {
      console.error('Error receiving message from document queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in document queue, waiting...');
      return;
    }
    
    console.log(`Received message from document queue: ${data.msg_id}`);
    
    try {
      // Parse the message
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      console.log('Processing document:', messageBody.documentId || messageBody.document_id);
      
      // Process the document
      await this.documentProcessor.processDocument({
        documentId: messageBody.documentId || messageBody.document_id,
        userId: messageBody.userId || messageBody.user_id,
        sourceUrl: messageBody.sourceUrl || messageBody.source_url,
        collectionId: messageBody.collectionId || messageBody.collection_id
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteDocumentMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from document queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // Delete the message to prevent queue blocking
      await this.databaseService.deleteDocumentMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from document queue to prevent blocking`);
    }
  }

  /**
   * Process messages in a loop
   */
  async processQueues() {
    while (this.isRunning) {
      try {
        // Process all queues
        // await this.processVideoQueue();
        // await this.processWebsiteQueue();
        await this.processDocumentQueue();
        
        // Wait before checking again
        await this.sleep(1000);
      } catch (error) {
        console.error('Error processing queues:', error);
        await this.sleep(5000);
      }
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
  private supabaseClient: SupabaseClient;
  private storageService: IStorageService;
  private youtubeService: YouTubeService;
  private databaseService: DatabaseService;
  private videoProcessor: VideoProcessor;
  private websiteProcessor: WebsiteProcessor;
  private documentProcessor: DocumentProcessor;
  private worker: Worker;
  
  constructor() {
    // Create config service first
    this.configService = new ConfigService();
    
    // Create Supabase client
    this.supabaseClient = createClient(
      this.configService.supabaseUrl,
      this.configService.supabaseKey
    );
    
    // Create services
    this.storageService = StorageServiceFactory.getStorageService('documents', this.configService);
    
    // Create axios client for YouTube API
    const axiosClient = axios.create({
      baseURL: 'https://www.googleapis.com/youtube/v3',
      params: {
        key: this.configService.youtubeApiKey
      }
    });
    
    this.youtubeService = new YouTubeService(this.configService, axiosClient, 'yt-dlp');
    this.databaseService = new DatabaseService(this.supabaseClient);
    
    // Create processors
    this.videoProcessor = new VideoProcessor(
      this.youtubeService,
      StorageServiceFactory.getStorageService('rawMedia', this.configService),
      this.databaseService,
      this.configService
    );
    
    this.websiteProcessor = new WebsiteProcessor(
      StorageServiceFactory.getStorageService('rawMedia', this.configService),
      this.databaseService,
      this.configService
    );

    this.documentProcessor = new DocumentProcessor(
      this.storageService,
      this.databaseService,
      this.configService
    );
    
    // Create worker with all processors
    this.worker = new Worker(
      this.videoProcessor,
      this.websiteProcessor,
      this.documentProcessor,
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