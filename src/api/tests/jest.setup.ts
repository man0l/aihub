import { SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => {
  const mockSelect = jest.fn().mockReturnThis();
  const mockEq = jest.fn().mockReturnThis();
  const mockFrom = jest.fn().mockReturnValue({
    select: mockSelect,
    eq: mockEq,
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
  });
  
  const mockRpc = jest.fn().mockReturnValue({
    data: 'mock-job-id',
    error: null,
  });
  
  const mockAuth = {
    getUser: jest.fn(),
  };
  
  const mockStorage = {
    from: jest.fn().mockReturnValue({
      upload: jest.fn(),
      getPublicUrl: jest.fn(),
    }),
  };
  
  return {
    createClient: jest.fn().mockImplementation(() => ({
      from: mockFrom,
      rpc: mockRpc,
      auth: mockAuth,
      storage: mockStorage,
    })),
    SupabaseClient: jest.fn(),
  };
});

// Mock Express middleware
jest.mock('../middleware/auth.js', () => ({
  authenticateUser: jest.fn((req, res, next) => {
    req.user = {
      id: 'mock-user-id',
      email: 'test@example.com',
    };
    req.supabaseClient = {} as SupabaseClient;
    next();
  }),
}));

// Mock OpenAI utilities
jest.mock('../utils/openai.js', () => ({
  generateSummary: jest.fn().mockResolvedValue('Mock summary content'),
  generateAudio: jest.fn().mockResolvedValue('https://example.com/audio.mp3'),
}));

// Mock YouTube utilities
jest.mock('../utils/youtube.js', () => ({
  extractVideoId: jest.fn().mockResolvedValue('mock-video-id'),
  getVideoMetadata: jest.fn().mockResolvedValue({
    title: 'Mock Video Title',
    channelTitle: 'Mock Channel',
    description: 'Mock video description',
    publishedAt: new Date().toISOString(),
  }),
  getVideoTranscript: jest.fn().mockResolvedValue('Mock video transcript'),
}));

// Mock ytdl-core
jest.mock('ytdl-core', () => ({
  getInfo: jest.fn().mockResolvedValue({
    formats: [
      { quality: 'lowestaudio', mimeType: 'audio/mp4', url: 'https://example.com/audio.mp4' },
    ],
  }),
  chooseFormat: jest.fn().mockReturnValue({
    url: 'https://example.com/audio.mp4',
  }),
}));

// Mock multer
jest.mock('multer', () => {
  const multerMock = () => ({
    array: () => (req: any, res: any, next: () => void) => {
      req.files = [
        {
          originalname: 'test.pdf',
          buffer: Buffer.from('mock file content'),
          mimetype: 'application/pdf',
          size: 1024,
        },
      ];
      next();
    },
  });
  multerMock.memoryStorage = jest.fn();
  return multerMock;
});

// Global beforeAll and afterAll hooks
global.beforeAll(() => {
  // Any setup before all tests
});

global.afterAll(() => {
  // Any cleanup after all tests
}); 