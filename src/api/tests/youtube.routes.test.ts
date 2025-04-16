import express from 'express';
import request from 'supertest';
import youtubeRoutes from '../routes/youtube.js';
import { getVideoMetadata, getVideoTranscript } from '../utils/youtube.js';
import ytdl from 'ytdl-core';

// Setup test app
const app = express();
app.use(express.json());
app.use('/api/youtube', youtubeRoutes);

// Tests for YouTube API routes
describe('YouTube API Routes', () => {
  // GET /api/youtube/audio/:videoId
  test('GET /audio/:videoId should return audio URL', async () => {
    // Mock ytdl functions
    (ytdl.getInfo as jest.Mock).mockResolvedValueOnce({
      formats: [
        { quality: 'lowestaudio', mimeType: 'audio/mp4', url: 'https://example.com/audio.mp4' },
      ],
    });
    
    (ytdl.chooseFormat as jest.Mock).mockReturnValueOnce({
      url: 'https://example.com/audio.mp4',
    });

    const response = await request(app).get('/api/youtube/audio/mock-video-id');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('audioUrl', 'https://example.com/audio.mp4');
    expect(ytdl.getInfo).toHaveBeenCalledWith('mock-video-id');
    expect(ytdl.chooseFormat).toHaveBeenCalled();
  });

  // GET /api/youtube/audio/:videoId - Error case (no audio found)
  test('GET /audio/:videoId should return 404 when no audio format found', async () => {
    // Mock ytdl functions
    (ytdl.getInfo as jest.Mock).mockResolvedValueOnce({
      formats: [],
    });
    
    (ytdl.chooseFormat as jest.Mock).mockReturnValueOnce(null);

    const response = await request(app).get('/api/youtube/audio/invalid-video-id');
    
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
  });

  // GET /api/youtube/audio/:videoId - Error case (ytdl error)
  test('GET /audio/:videoId should return 500 on ytdl error', async () => {
    // Mock ytdl functions to throw an error
    (ytdl.getInfo as jest.Mock).mockRejectedValueOnce(new Error('Video unavailable'));

    const response = await request(app).get('/api/youtube/audio/error-video-id');
    
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error', 'Video unavailable');
  });

  // GET /api/youtube/metadata/:videoId
  test('GET /metadata/:videoId should return video metadata', async () => {
    // Mock getVideoMetadata
    const mockMetadata = {
      title: 'Test Video',
      channelTitle: 'Test Channel',
      description: 'This is a test video',
      publishedAt: '2023-01-01T00:00:00Z',
    };
    
    (getVideoMetadata as jest.Mock).mockResolvedValueOnce(mockMetadata);

    const response = await request(app).get('/api/youtube/metadata/mock-video-id');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockMetadata);
    expect(getVideoMetadata).toHaveBeenCalledWith('mock-video-id');
  });

  // GET /api/youtube/metadata/:videoId - Error case
  test('GET /metadata/:videoId should return 500 on error', async () => {
    // Mock getVideoMetadata to throw an error
    (getVideoMetadata as jest.Mock).mockRejectedValueOnce(new Error('API error'));

    const response = await request(app).get('/api/youtube/metadata/error-video-id');
    
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error', 'API error');
  });

  // GET /api/youtube/transcript/:videoId
  test('GET /transcript/:videoId should return video transcript', async () => {
    // Mock getVideoTranscript
    const mockTranscript = 'This is the transcript of the test video.';
    (getVideoTranscript as jest.Mock).mockResolvedValueOnce(mockTranscript);

    const response = await request(app).get('/api/youtube/transcript/mock-video-id');
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('transcript', mockTranscript);
    expect(getVideoTranscript).toHaveBeenCalledWith('mock-video-id');
  });

  // GET /api/youtube/transcript/:videoId - Error case
  test('GET /transcript/:videoId should return 500 on error', async () => {
    // Mock getVideoTranscript to throw an error
    (getVideoTranscript as jest.Mock).mockRejectedValueOnce(new Error('Transcription failed'));

    const response = await request(app).get('/api/youtube/transcript/error-video-id');
    
    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error', 'Transcription failed');
  });
}); 