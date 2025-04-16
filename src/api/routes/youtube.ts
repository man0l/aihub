import { Router, Request, Response } from 'express';
import ytdl from 'ytdl-core';
import { authenticateUser } from '../middleware/auth.js';
import { extractVideoId, getVideoMetadata, getVideoTranscript } from '../utils/youtube.js';

const router = Router();

/**
 * YouTube audio extraction endpoint for transcription
 * GET /api/youtube/audio/:videoId
 */
router.get('/audio/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  
  try {
    // Verify video exists and is accessible
    const info = await ytdl.getInfo(videoId);
    
    // Get audio-only format URL
    const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' });
    
    if (!audioFormat || !audioFormat.url) {
      res.status(404).json({ error: 'Could not find audio format for this video' });
      return;
    }
    
    res.json({ audioUrl: audioFormat.url });
  } catch (error) {
    console.error('YouTube audio extraction error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get YouTube video metadata
 * GET /api/youtube/metadata/:videoId
 */
router.get('/metadata/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  
  try {
    const metadata = await getVideoMetadata(videoId);
    res.json(metadata);
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get YouTube video transcript
 * GET /api/youtube/transcript/:videoId
 */
router.get('/transcript/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  
  try {
    const transcript = await getVideoTranscript(videoId);
    res.json({ transcript });
  } catch (error) {
    console.error('Error fetching video transcript:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 