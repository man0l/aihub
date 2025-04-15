import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Readable } from 'stream';
import type { Mock } from 'jest-mock';

// Import all required classes from the TypeScript implementation
import {
  ConfigService,
  ClientFactory,
  YouTubeService,
  StorageService,
  DatabaseService,
  VideoProcessor,
  Worker,
  Application
} from './index.js';

// Mock all dependencies
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => Buffer.from('test file content')),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    on: jest.fn((event, callback) => {
      if (event === 'finish' && typeof callback === 'function') {
        setTimeout(() => callback(), 0);
      }
      return {
        on: jest.fn()
      };
    })
  }))
}));

jest.mock('path', () => ({
  join: jest.fn((...args: any[]) => args.join('/')),
  basename: jest.fn((filePath: string) => filePath.split('/').pop() || '')
}));

jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp')
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn()
}));

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn(() => ({
    done: jest.fn().mockImplementation(() => Promise.resolve({ Location: 'https://example.com/test.mp4' }))
  }))
}));

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn().mockImplementation(() => Promise.resolve({
      data: {
        items: [{
          snippet: {
            title: 'Test Video',
            channelTitle: 'Test Channel',
            publishedAt: '2023-01-01',
            description: 'Test Description'
          },
          contentDetails: {
            duration: 'PT10M'
          }
        }]
      }
    }))
  }))
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({}))
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockImplementation(() => Promise.resolve({ data: { id: 'test-doc-id' }, error: null }))
        }))
      }))
    })),
    rpc: jest.fn().mockImplementation(() => Promise.resolve({ data: null, error: null }))
  }))
}));

jest.mock('ytdl-core', () => ({
  getInfo: jest.fn().mockImplementation(() => Promise.resolve({
    player_response: {
      captions: null
    },
    videoDetails: {
      title: 'Test Video',
      author: { name: 'Test Channel' },
      videoId: 'test-video-id',
      thumbnails: [{ url: 'https://example.com/thumbnail.jpg' }]
    }
  })),
  default: jest.fn(() => {
    const readable = new Readable();
    readable._read = () => {};
    readable.push('test data');
    readable.push(null);
    return readable;
  })
}));

describe('Basic Tests', () => {
  test('true should be true', () => {
    expect(true).toBe(true);
  });
});

describe('ConfigService', () => {
  test('should initialize with environment variables', () => {
    // Setup
    const originalEnv = process.env;
    process.env = {
      ...process.env,
      PROJECT_PREFIX: 'test-prefix',
      AWS_REGION: 'eu-central-1',
      RAW_MEDIA_BUCKET: 'test-prefix-raw-media-input',
      PROCESSED_TRANSCRIPTS_BUCKET: 'test-prefix-processed-transcripts-output'
    };
    
    // Exercise
    const configService = new ConfigService();
    
    // Verify
    expect(configService.projectPrefix).toBe('test-prefix');
    expect(configService.s3Region).toBe('eu-central-1');
    expect(configService.rawMediaBucket).toBe('test-prefix-raw-media-input');
    
    // Restore original env
    process.env = originalEnv;
  });
});

describe('VideoProcessor', () => {
  test('should process a video job with transcription', async () => {
    // Setup
    const mockYoutubeService = {
      fetchTranscription: jest.fn().mockImplementation(() => Promise.resolve('Test transcription')),
      downloadVideo: jest.fn().mockImplementation(() => Promise.resolve('/tmp/test-video-id.mp4')),
      getVideoInfo: jest.fn()
    };
    
    const mockStorageService = {
      uploadFile: jest.fn().mockImplementation(() => Promise.resolve('https://example.com/test.txt')),
      uploadString: jest.fn(),
      downloadFile: jest.fn(),
      getString: jest.fn()
    };
    
    const mockDatabaseService = {
      updateVideoProcessingStatus: jest.fn().mockImplementation(() => Promise.resolve({})),
      createDocumentFromTranscription: jest.fn().mockImplementation(() => Promise.resolve({ success: true, document: { id: 'doc123' } })),
      receiveMessageFromQueue: jest.fn(),
      deleteMessageFromQueue: jest.fn()
    };
    
    const mockConfigService = {
      tempDir: '/tmp',
      youtubeApiKey: 'test-key',
      s3Bucket: 'test-bucket',
      rawMediaBucket: 'test-bucket',
      cleanupTempFiles: jest.fn()
    };
    
    const videoProcessor = new VideoProcessor(
      mockYoutubeService as unknown as YouTubeService,
      mockStorageService as unknown as StorageService,
      mockDatabaseService as unknown as DatabaseService,
      mockConfigService as unknown as ConfigService
    );
    
    const job = {
      videoId: 'test-video-id',
      userId: 'test-user-id',
      sourceUrl: 'https://youtube.com/watch?v=test-video-id'
    };
    
    // Exercise
    const result = await videoProcessor.processVideo(job);
    
    // Verify
    expect(result.success).toBe(true);
    expect(mockYoutubeService.fetchTranscription).toHaveBeenCalledWith('test-video-id');
    expect(mockDatabaseService.updateVideoProcessingStatus).toHaveBeenCalledWith(
      'test-video-id',
      'test-user-id',
      'processing'
    );
    expect(mockDatabaseService.createDocumentFromTranscription).toHaveBeenCalledWith(
      'test-video-id',
      'Test transcription',
      'https://youtube.com/watch?v=test-video-id',
      'test-user-id'
    );
  });
  
  test('should handle errors properly', async () => {
    // Setup
    const mockYoutubeService = {
      fetchTranscription: jest.fn().mockImplementation(() => Promise.reject(new Error('Test error'))),
      downloadVideo: jest.fn(),
      getVideoInfo: jest.fn()
    };
    
    const mockStorageService = {
      uploadFile: jest.fn(),
      uploadString: jest.fn(),
      downloadFile: jest.fn(),
      getString: jest.fn()
    };
    
    const mockDatabaseService = {
      updateVideoProcessingStatus: jest.fn().mockImplementation(() => Promise.resolve({})),
      createDocumentFromTranscription: jest.fn(),
      receiveMessageFromQueue: jest.fn(),
      deleteMessageFromQueue: jest.fn()
    };
    
    const mockConfigService = {
      tempDir: '/tmp',
      cleanupTempFiles: jest.fn()
    };
    
    const videoProcessor = new VideoProcessor(
      mockYoutubeService as unknown as YouTubeService,
      mockStorageService as unknown as StorageService,
      mockDatabaseService as unknown as DatabaseService,
      mockConfigService as unknown as ConfigService
    );
    
    const job = {
      videoId: 'test-video-id',
      userId: 'test-user-id',
      sourceUrl: 'https://youtube.com/watch?v=test-video-id'
    };
    
    // Exercise
    const result = await videoProcessor.processVideo(job);
    
    // Verify
    expect(result.success).toBe(false);
    expect(result.error).toBe('Test error');
    expect(mockDatabaseService.updateVideoProcessingStatus).toHaveBeenCalledWith(
      'test-video-id',
      'test-user-id',
      'error',
      expect.objectContaining({
        error_message: 'Test error'
      })
    );
  });
});

describe('DatabaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('should update video processing status', async () => {
    // Setup
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis()
    };
    
    const databaseService = new DatabaseService(mockSupabase as any);
    
    // Exercise
    await databaseService.updateVideoProcessingStatus(
      'test-video-id', 
      'test-user-id', 
      'processing', 
      { extra: 'data' }
    );
    
    // Verify
    expect(mockSupabase.from).toHaveBeenCalledWith('video_processing');
    expect(mockSupabase.update).toHaveBeenCalledWith({
      status: 'processing',
      extra: 'data'
    });
    expect(mockSupabase.eq).toHaveBeenCalledWith('video_id', 'test-video-id');
  });
  
  test('should create document from transcription', async () => {
    // Setup
    const mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockImplementation(() => Promise.resolve({
        data: { id: 'test-doc-id' },
        error: null
      }))
    };
    
    const databaseService = new DatabaseService(mockSupabase as any);
    
    // Exercise
    const result = await databaseService.createDocumentFromTranscription(
      'test-video-id',
      'Test transcription',
      'https://youtube.com/watch?v=test-video-id',
      'test-user-id'
    );
    
    // Verify
    expect(mockSupabase.from).toHaveBeenCalledWith('documents');
    expect(mockSupabase.insert).toHaveBeenCalledWith({
      title: 'YouTube Video: test-video-id',
      original_content: 'Test transcription',
      content_type: 'youtube',
      source_url: 'https://youtube.com/watch?v=test-video-id',
      transcription: 'Test transcription',
      user_id: 'test-user-id',
      processing_status: 'transcribed'
    });
    expect(result.success).toBe(true);
    expect(result.document?.id).toBe('test-doc-id');
  });
  
  test('should return error if no transcription provided', async () => {
    // Setup
    const mockSupabase = {};
    const databaseService = new DatabaseService(mockSupabase as any);
    
    // Exercise
    const result = await databaseService.createDocumentFromTranscription(
      'test-video-id',
      null,
      'https://youtube.com/watch?v=test-video-id',
      'test-user-id'
    );
    
    // Verify
    expect(result.success).toBe(false);
    expect(result.error).toBe('No transcription available');
  });
});

describe('Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test('should start and stop the worker', async () => {
    // Setup
    const mockVideoProcessor = {};
    const mockDatabaseService = {
      receiveMessageFromQueue: jest.fn().mockImplementation(() => Promise.resolve({ data: null, error: null })),
      deleteMessageFromQueue: jest.fn()
    };
    
    const worker = new Worker(
      mockVideoProcessor as unknown as VideoProcessor, 
      mockDatabaseService as unknown as DatabaseService
    );
    
    // Use prototype to mock the method for better type safety
    const processQueueSpy = jest.spyOn(Worker.prototype, 'processQueue')
      .mockImplementation(function() { return Promise.resolve(); });
    
    // Exercise - start the worker
    await worker.start();
    
    // Verify worker started
    expect(worker['isRunning']).toBe(true);
    
    // Exercise - stop the worker
    worker.stop();
    
    // Verify worker stopped
    expect(worker['isRunning']).toBe(false);
    
    // Clean up
    processQueueSpy.mockRestore();
  });
  
  test('should not start if already running', async () => {
    // Setup
    const mockVideoProcessor = {};
    const mockDatabaseService = {
      receiveMessageFromQueue: jest.fn(),
      deleteMessageFromQueue: jest.fn()
    };
    
    const worker = new Worker(
      mockVideoProcessor as unknown as VideoProcessor, 
      mockDatabaseService as unknown as DatabaseService
    );
    Object.defineProperty(worker, 'isRunning', { value: true });
    
    // Mock console.log to check for the message
    const consoleLogSpy = jest.spyOn(console, 'log');
    
    // Exercise
    await worker.start();
    
    // Verify
    expect(consoleLogSpy).toHaveBeenCalledWith('Worker is already running');
    
    // Cleanup
    consoleLogSpy.mockRestore();
  });
}); 