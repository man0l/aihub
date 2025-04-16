import { Request, Response } from 'express';
import request from 'supertest';
import express from 'express';
import uploadRoutes from '../routes/upload.js';
import { authenticateUser } from '../middleware/auth.js';
import { extractVideoId, getVideoMetadata } from '../utils/youtube.js';

// Setup test app
const app = express();
app.use(express.json());
app.use('/api/upload', uploadRoutes);

// Mock data
const mockCollections = [
  { id: 'collection-1', name: 'Test Collection 1', user_id: 'mock-user-id' },
  { id: 'collection-2', name: 'Test Collection 2', user_id: 'mock-user-id' },
];

const mockDocument = {
  id: 'doc-1',
  title: 'Mock Video Title - Mock Channel',
  content_type: 'youtube',
  source_url: 'https://youtube.com/watch?v=mock-video-id',
  user_id: 'mock-user-id',
  collection_id: 'collection-1',
  processing_status: 'queued',
};

// Mock Supabase response
jest.mock('@supabase/supabase-js', () => {
  return {
    createClient: jest.fn().mockImplementation(() => ({
      from: jest.fn().mockImplementation((table) => {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          single: jest.fn().mockImplementation(() => {
            if (table === 'collections') {
              return {
                data: { id: 'new-collection-id', name: 'New Collection', user_id: 'mock-user-id' },
                error: null,
              };
            } else if (table === 'documents') {
              return {
                data: mockDocument,
                error: null,
              };
            }
            return { data: null, error: null };
          }),
        };
      }),
      rpc: jest.fn().mockReturnValue({
        data: 'mock-job-id',
        error: null,
      }),
    })),
  };
});

// Tests for Collection routes
describe('Collection Routes', () => {
  // GET /api/upload/collections
  test('GET /collections should return user collections', async () => {
    // Mock the Supabase response for this specific test
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnValue({
        data: mockCollections,
        error: null,
      }),
    });

    // Setup temporary mock
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = { from: mockFrom } as any;
      next();
    });

    const response = await request(app).get('/api/upload/collections');
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('collections');
  });

  // POST /api/upload/collections
  test('POST /collections should create a new collection', async () => {
    // Mock the Supabase response for this specific test
    const mockInsert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnValue({
        data: { id: 'new-collection-id', name: 'New Collection', user_id: 'mock-user-id' },
        error: null,
      }),
    });
    
    const mockFrom = jest.fn().mockReturnValue({
      insert: mockInsert,
    });

    // Setup temporary mock
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = { from: mockFrom } as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/collections')
      .send({ name: 'New Collection' });
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('name', 'New Collection');
    expect(mockFrom).toHaveBeenCalledWith('collections');
    expect(mockInsert).toHaveBeenCalledWith({
      name: 'New Collection',
      user_id: 'mock-user-id',
    });
  });

  // POST /api/upload/collections - Error case (missing name)
  test('POST /collections should return 400 if name is missing', async () => {
    // Setup temporary mock to include the authentication
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = {} as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/collections')
      .send({});
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message', 'Collection name is required');
  });
});

// Tests for YouTube upload
describe('YouTube Upload Routes', () => {
  // POST /api/upload/youtube
  test('POST /youtube should queue YouTube videos for processing', async () => {
    // Mock the extractVideoId and getVideoMetadata functions
    (extractVideoId as jest.Mock).mockResolvedValueOnce('mock-video-id');
    (getVideoMetadata as jest.Mock).mockResolvedValueOnce({
      title: 'Mock Video Title',
      channelTitle: 'Mock Channel',
    });

    // Mock Supabase client responses
    const mockInsert = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnValue({
        data: mockDocument,
        error: null,
      }),
    });
    
    const mockFrom = jest.fn().mockReturnValue({
      insert: mockInsert,
    });
    
    const mockRpc = jest.fn().mockReturnValue({
      data: 'mock-job-id',
      error: null,
    });

    // Setup temporary mock
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = { 
        from: mockFrom,
        rpc: mockRpc,
      } as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/youtube')
      .send({
        sources: [{ url: 'https://www.youtube.com/watch?v=mock-video-id' }],
        options: { collectionId: 'collection-1' },
      });
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]).toHaveProperty('status', 'queued');
    expect(mockFrom).toHaveBeenCalledWith('documents');
    expect(mockRpc).toHaveBeenCalledWith('enqueue_video_processing', expect.any(Object));
  });

  // POST /api/upload/youtube - Error case (no sources)
  test('POST /youtube should return 400 if no sources provided', async () => {
    // Setup temporary mock to include the authentication
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = {} as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/youtube')
      .send({ sources: [], options: {} });
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message', 'No sources provided');
  });
});

// Tests for Website upload
describe('Website Upload Routes', () => {
  // POST /api/upload/websites
  test('POST /websites should queue websites for processing', async () => {
    // Setup temporary mock for authentication
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = {} as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/websites')
      .send({
        urls: ['https://example.com'],
        options: { collectionId: 'collection-1' },
      });
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]).toHaveProperty('id', 'mock-id');
    expect(response.body[0]).toHaveProperty('status', 'completed');
  });

  // POST /api/upload/websites - Error case (no URLs)
  test('POST /websites should return 400 if no URLs provided', async () => {
    // Setup temporary mock for authentication
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = {} as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/websites')
      .send({ urls: [], options: {} });
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('message', 'No URLs provided');
  });
});

// Tests for File upload
describe('File Upload Routes', () => {
  // POST /api/upload/files
  test('POST /files should process uploaded files', async () => {
    // Setup temporary mock for authentication
    const originalImpl = authenticateUser;
    (authenticateUser as jest.Mock).mockImplementationOnce((req: Request, res: Response, next: () => void) => {
      req.user = { id: 'mock-user-id', email: 'test@example.com' };
      req.supabaseClient = {} as any;
      next();
    });

    const response = await request(app)
      .post('/api/upload/files')
      .attach('files', Buffer.from('mock file content'), 'test.pdf');
    
    // Restore original mock
    (authenticateUser as jest.Mock).mockImplementation(originalImpl);
    
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body[0]).toHaveProperty('id', 'mock-id');
    expect(response.body[0]).toHaveProperty('status', 'completed');
  });

  // The file validation is handled by the multer middleware mock in jest.setup.ts
}); 