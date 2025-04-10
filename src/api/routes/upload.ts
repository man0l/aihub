import { Router, Request, Response } from 'express';
import { processWebsites, processFiles, processYouTubeSources } from '../../lib/processing';
import { validateYouTubeUrl } from '../../lib/youtube';
import { VideoSource, ProcessingOptions } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import multer from 'multer';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Get user collections
// @ts-ignore - Ignoring type issues with Express router
router.get('/collections', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('collections')
      .select('id, name')
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch collections',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create new collection
// @ts-ignore - Ignoring type issues with Express router
router.post('/collections', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const { name } = req.body;
  
  if (!name?.trim()) {
    return res.status(400).json({ message: 'Collection name is required' });
  }

  try {
    const { data, error } = await supabase
      .from('collections')
      .insert({
        name: name.trim(),
        user_id: req.user.id,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to create collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process YouTube sources
// @ts-ignore - Ignoring type issues with Express router
router.post('/youtube', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const { sources, options }: { 
    sources: VideoSource[], 
    options: ProcessingOptions 
  } = req.body;

  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ message: 'No sources provided' });
  }

  // Validate YouTube URLs
  const invalidUrls = sources.filter(source => !validateYouTubeUrl(source.url));
  if (invalidUrls.length > 0) {
    return res.status(400).json({ message: 'Invalid YouTube URLs provided' });
  }

  try {
    const results = await processYouTubeSources(sources, req.user.id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process YouTube sources',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process websites
// @ts-ignore - Ignoring type issues with Express router
router.post('/websites', authenticateUser, async (req: AuthenticatedRequest, res: Response) => {
  const { urls, options }: { 
    urls: string[], 
    options: ProcessingOptions 
  } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ message: 'No URLs provided' });
  }

  try {
    const results = await processWebsites(urls, req.user.id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process websites',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Process files
// @ts-ignore - Ignoring type issues with Express router
router.post('/files', authenticateUser, upload.array('files'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ message: 'No files provided' });
  }

  const options: ProcessingOptions = JSON.parse(req.body.options || '{}');

  try {
    // Convert multer files to the format expected by processFiles
    const files = (req.files as Express.Multer.File[]).map(file => ({
      name: file.originalname,
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
      lastModified: Date.now(),
      type: file.mimetype
    }));

    const results = await processFiles(files as any, req.user.id, options);
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 