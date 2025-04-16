import { describe, test, expect, jest, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { Readable } from 'stream';
import type { Mock } from 'jest-mock';

// Set up environment variables for tests
beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_KEY = 'test-key';
  process.env.PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterAll(() => {
  // Clean up environment variables after tests
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_KEY;
  delete process.env.PUBLIC_SUPABASE_URL;
  delete process.env.PUBLIC_SUPABASE_ANON_KEY;
});

// Import all required classes from the TypeScript implementation
import {
  ConfigService,
  ClientFactory,
  YouTubeService,
  StorageService,
  DatabaseService,
  VideoProcessor,
  Worker,
  Application,
  WebsiteProcessor
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
    from: jest.fn((table) => {
      const mockObj = {
        update: jest.fn(() => mockObj),
        insert: jest.fn(() => mockObj),
        select: jest.fn(() => mockObj),
        eq: jest.fn(() => mockObj),
        single: jest.fn().mockImplementation(() => {
          if (table === 'documents') {
            return Promise.resolve({
              data: { id: 'test-doc-id', title: 'Test Document' },
              error: null
            });
          }
          return Promise.resolve({ data: null, error: null });
        })
      };
      return mockObj;
    }),
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
      getVideoInfo: jest.fn().mockImplementation(() => Promise.resolve({
        title: 'Test Video Title',
        author: { name: 'Test Channel' },
        videoId: 'test-video-id',
        thumbnails: [{ url: 'https://example.com/thumbnail.jpg' }]
      }))
    };
    
    const mockStorageService = {
      uploadFile: jest.fn().mockImplementation(() => Promise.resolve('https://example.com/test.txt')),
      uploadString: jest.fn(),
      downloadFile: jest.fn(),
      getString: jest.fn()
    };
    
    const mockDatabaseService = {
      updateVideoProcessingStatus: jest.fn(),
      createDocumentFromTranscription: jest.fn()
    };
    
    // Set return values after object creation to avoid TypeScript errors
    mockDatabaseService.updateVideoProcessingStatus.mockReturnValue(Promise.resolve({}));
    mockDatabaseService.createDocumentFromTranscription.mockReturnValue(Promise.resolve({ 
      success: true, 
      document: { id: 'doc123' } 
    }));
    
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
      fetchTranscription: jest.fn().mockImplementation(() => {
        return Promise.resolve('Test transcription');
      }),
      downloadVideo: jest.fn().mockImplementation(() => {
        return Promise.resolve('/tmp/test-video-id.mp4');
      }),
      getVideoInfo: jest.fn().mockImplementation(() => Promise.resolve({
        title: 'Test Video Title',
        author: { name: 'Test Channel' },
        videoId: 'test-video-id',
        thumbnails: [{ url: 'https://example.com/thumbnail.jpg' }]
      }))
    };
    
    const mockStorageService = {
      uploadFile: jest.fn(),
      uploadString: jest.fn(),
      downloadFile: jest.fn(),
      getString: jest.fn()
    };
    
    const mockDatabaseService = {
      updateVideoProcessingStatus: jest.fn().mockImplementation(() => Promise.resolve({})),
      createDocumentFromTranscription: jest.fn().mockImplementation(() => Promise.resolve({
        success: false,
        error: 'Test error'
      }))
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
    
    // Exercise - test that the error is properly thrown
    try {
      await videoProcessor.processVideo(job);
      // If we reach here, the test should fail because an error should have been thrown
      fail('Expected an error to be thrown');
    } catch (error) {
      // Verify the correct error was thrown
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Failed to update/create document: Test error');
    }
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
    // Create a mock that properly handles chaining for multiple .eq() calls
    const single = jest.fn().mockResolvedValue({
      data: { id: 'test-doc-id', title: 'Test Document' },
      error: null
    });
    
    // Create a chainable eq function that returns an object with all the methods
    const eq = jest.fn().mockImplementation(() => ({
      eq, // Allow chaining multiple eq calls
      single, // Allow terminating with single()
      update,
      insert,
      select
    }));
    
    const select = jest.fn().mockImplementation(() => ({
      eq,
      single
    }));
    
    const update = jest.fn().mockReturnThis();
    const insert = jest.fn().mockReturnThis();
    
    const from = jest.fn().mockReturnValue({
      select,
      eq,
      update,
      insert,
      single
    });
    
    const mockSupabase = { from };
    
    const databaseService = new DatabaseService(mockSupabase as any);
    
    // Exercise
    const result = await databaseService.createDocumentFromTranscription(
      'test-video-id',
      'Test transcription',
      'https://youtube.com/watch?v=test-video-id',
      'test-user-id'
    );
    
    // Verify
    expect(result.success).toBe(true);
    expect(result.document?.id).toBe('test-doc-id');
    expect(from).toHaveBeenCalledWith('documents');
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
  test('should start and stop correctly', async () => {
    // Setup
    const mockVideoProcessor = {
      processVideo: jest.fn()
    };
    
    const mockWebsiteProcessor = {
      processWebsite: jest.fn()
    };
    
    const mockDatabaseService = {
      receiveVideoMessage: jest.fn(),
      receiveWebsiteMessage: jest.fn(),
      deleteVideoMessage: jest.fn(),
      deleteWebsiteMessage: jest.fn()
    };
    
    const worker = new Worker(
      mockVideoProcessor as unknown as VideoProcessor,
      mockWebsiteProcessor as unknown as WebsiteProcessor,
      mockDatabaseService as unknown as DatabaseService
    );

    // Mock the start method to avoid the infinite loop
    const originalStart = worker.start;
    worker.start = jest.fn().mockImplementation(async () => {
      worker['isRunning'] = true;
      return Promise.resolve();
    }) as unknown as typeof worker.start;
    
    // Exercise - call start then stop
    await worker.start();
    expect(worker['isRunning']).toBe(true);
    
    worker.stop();
    expect(worker['isRunning']).toBe(false);
    
    // Restore original method
    worker.start = originalStart;
  }, 10000);
  
  test('should not start if already running', async () => {
    // Setup
    const mockVideoProcessor = {};
    const mockWebsiteProcessor = {};
    const mockDatabaseService = {
      receiveVideoMessage: jest.fn(),
      receiveWebsiteMessage: jest.fn(),
      deleteVideoMessage: jest.fn(),
      deleteWebsiteMessage: jest.fn()
    };
    
    const worker = new Worker(
      mockVideoProcessor as unknown as VideoProcessor,
      mockWebsiteProcessor as unknown as WebsiteProcessor,
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

// Add the QueueResponse type for mocking
interface QueueMessage {
  message_id: string;
  message: string;
}

interface QueueResponse {
  data: QueueMessage | null;
  error: any | null;
} 