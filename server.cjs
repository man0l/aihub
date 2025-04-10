// Load environment variables
require('dotenv').config();

// Set NODE_ENV if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
console.log(`Server running in ${process.env.NODE_ENV} mode`);

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');
const ytdl = require('ytdl-core');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// For debugging
console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Not set');
console.log('Supabase Key:', supabaseKey ? 'Set' : 'Not set');
console.log('YouTube API Key:', process.env.VITE_YOUTUBE_API_KEY ? 'Set' : 'Not set');
console.log('OpenAI API Key:', process.env.VITE_OPENAI_API_KEY ? 'Set' : 'Not set');

// Helper functions for YouTube processing
async function extractVideoId(url) {
  try {
    if (ytdl.validateURL(url)) {
      return ytdl.getVideoID(url);
    }
    return null;
  } catch (error) {
    console.error('Error extracting video ID:', error);
    return null;
  }
}

async function getVideoMetadata(videoId) {
  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet`
    );

    if (!response.data.items || response.data.items.length === 0) {
      throw new Error('Video not found');
    }

    return response.data.items[0].snippet;
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    throw new Error(`Failed to fetch video metadata: ${error.message}`);
  }
}

async function getVideoTranscript(videoId) {
  try {
    console.log('Attempting to get transcript for video:', videoId);
    
    // First, try to get the captions using YouTube API
    try {
      console.log('Fetching captions using YouTube API...');
      const captionsResponse = await axios.get(
        `https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet&key=${process.env.VITE_YOUTUBE_API_KEY}`
      );
      
      if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
        // Find English captions if available
        const englishCaptions = captionsResponse.data.items.find(
          caption => caption.snippet.language === 'en' || caption.snippet.language === 'en-US'
        );
        
        if (englishCaptions) {
          console.log('Found English captions, fetching content...');
          // Unfortunately direct caption content fetch requires OAuth, which is beyond our scope here
          // We'll fallback to alternative methods
        }
      }
    } catch (captionsError) {
      console.warn('Failed to fetch captions via API:', captionsError.message);
      // Continue to fallback methods
    }
    
    // Fallback: Get video metadata and create a simplified "transcript"
    console.log('Using fallback metadata-based transcript generation');
    const videoResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet,contentDetails`
    );

    if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
      throw new Error('Video not found');
    }

    const videoData = videoResponse.data.items[0];
    const snippet = videoData.snippet;
    const duration = videoData.contentDetails.duration; // In ISO 8601 format (PT#H#M#S)
    
    // Get video comments as additional context
    const commentsResponse = await axios.get(
      `https://www.googleapis.com/youtube/v3/commentThreads?videoId=${videoId}&key=${process.env.VITE_YOUTUBE_API_KEY}&part=snippet&maxResults=25&order=relevance`
    );
    
    let topComments = '';
    if (commentsResponse.data.items && commentsResponse.data.items.length > 0) {
      topComments = commentsResponse.data.items
        .map(item => item.snippet.topLevelComment.snippet.textDisplay)
        .join('\n\n');
    }
    
    // Create a structured summary that can be used as a transcript substitute
    const structuredTranscript = `
# ${snippet.title}

## Video Information
- **Channel**: ${snippet.channelTitle}
- **Published**: ${new Date(snippet.publishedAt).toLocaleDateString()}
- **Duration**: ${duration}

## Description
${snippet.description || 'No description available.'}

## Summary
This video appears to be about ${snippet.title}. The content is presented by ${snippet.channelTitle}.

## Top Comments
${topComments || 'No comments available.'}

Note: This is a generated summary as the automatic transcription process was unable to extract the actual speech content from this video.
    `.trim();

    return structuredTranscript;
    
  } catch (error) {
    console.error('Error getting transcript:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

async function generateSummary(text, type) {
  try {
    const prompt = type === 'short' 
      ? `Please provide a friendly and conversational summary of the following text. Break it down into easy-to-digest main points and subpoints. For each point, include relatable everyday analogies that help explain the concepts in a way that's both memorable and easy to understand.

The summary should:
- Use a warm, conversational tone like you're explaining to a friend
- Include 3-5 main points with subpoints
- Provide clear, relatable examples and analogies for each point
- Take about 1-5 minutes to read (approximately 250-750 words)
- Make complex ideas accessible and memorable

Original text to summarize:`
      : `Please provide a comprehensive yet friendly and conversational summary of the following text. Break it down into detailed main points and subpoints, enriched with stories, examples, and everyday analogies that make the concepts more relatable and easier to understand.

The summary should:
- Use a warm, engaging tone like you're having an in-depth conversation with a friend
- Include 5-8 main points with detailed subpoints
- Provide multiple analogies and examples for each major concept
- Take about 10-20 minutes to read (approximately 2000-4000 words)
- Make complex ideas accessible while preserving important details
- Include relevant stories that help illustrate key points
- Provide deeper insights and connections between concepts
- End with key takeaways and practical applications

Original text to summarize:`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: prompt
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.7,
        max_tokens: type === 'short' ? 2048 : 4096
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.VITE_OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0]?.message?.content;
  } catch (error) {
    console.error(`Error generating ${type} summary:`, error);
    throw new Error(`Failed to generate ${type} summary: ${error.message}`);
  }
}

async function generateAudio(text, supabaseClient) {
  try {
    // Check if text is too long for a single TTS request
    const MAX_TTS_LENGTH = 4000; // OpenAI TTS limit
    
    // Split long text into chunks that fit within TTS limits
    const getTextChunks = (text) => {
      const chunks = [];
      
      if (text.length <= MAX_TTS_LENGTH) {
        return [text];
      }
      
      // Split by sentences while preserving punctuation
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length <= MAX_TTS_LENGTH) {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        } else {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = sentence;
        }
      }
      
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      
      return chunks;
    };
    
    const chunks = getTextChunks(text);
    console.log(`Text split into ${chunks.length} chunks for audio generation`);
    
    // For long texts with many chunks, we'll just process the first few to keep processing time reasonable
    const MAX_CHUNKS = 3;
    const chunksToProcess = chunks.slice(0, MAX_CHUNKS);
    
    if (chunks.length > MAX_CHUNKS) {
      console.log(`Processing only first ${MAX_CHUNKS} chunks out of ${chunks.length} total`);
    }
    
    // Generate audio for each chunk
    const audioBlobs = [];
    
    for (let i = 0; i < chunksToProcess.length; i++) {
      console.log(`Generating audio for chunk ${i+1}/${chunksToProcess.length}`);
      
      const response = await axios.post(
        'https://api.openai.com/v1/audio/speech',
        {
          model: "tts-1",
          voice: "alloy",
          input: chunksToProcess[i]
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.VITE_OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );
      
      audioBlobs.push(response.data);
    }
    
    // Combine audio blobs if we have multiple
    let finalAudioData;
    if (audioBlobs.length === 1) {
      finalAudioData = audioBlobs[0];
    } else {
      // Simple concatenation - note this won't create perfect transitions
      // For production, consider using a proper audio library for joining
      const totalLength = audioBlobs.reduce((acc, blob) => acc + blob.length, 0);
      finalAudioData = Buffer.concat(audioBlobs, totalLength);
    }

    // Upload to Supabase storage
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const fileName = `audio-summaries/${timestamp}-${randomString}.mp3`;

    const { data, error } = await supabaseClient.storage
      .from('media')
      .upload(fileName, finalAudioData, {
        contentType: 'audio/mpeg',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: { publicUrl } } = supabaseClient.storage
      .from('media')
      .getPublicUrl(fileName);

    return publicUrl;
  } catch (error) {
    console.error('Error generating audio:', error);
    throw new Error(`Failed to generate audio: ${error.message}`);
  }
}

// Middleware for authentication
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.warn('No authorization header provided');
      return res.status(401).json({ message: 'No authorization header' });
    }

    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = authHeader;
    }

    if (!token) {
      console.warn('No token extracted from header');
      return res.status(401).json({ message: 'No token provided' });
    }

    console.log('Attempting authentication with token');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Authentication failed:', error?.message || 'No user data');
      return res.status(401).json({ 
        message: 'Invalid or expired token',
        error: error?.message 
      });
    }
    
    console.log('Authentication successful for user:', user.id);
    
    // Create a new Supabase client with the user's JWT
    // This is crucial for RLS policies to work properly
    req.supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    
    req.user = {
      id: user.id,
      email: user.email || ''
    };
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      message: 'Authentication failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get user collections
app.get('/api/upload/collections', authenticateUser, async (req, res) => {
  try {
    console.log('Getting collections for user:', req.user.id);
    
    const { data, error } = await req.supabaseClient
      .from('collections')
      .select('id, name')
      .eq('user_id', req.user.id);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Collections retrieved:', data?.length || 0);
    res.json(data || []);
  } catch (error) {
    console.error('Failed to fetch collections:', error);
    res.status(500).json({
      message: 'Failed to fetch collections',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create new collection
app.post('/api/upload/collections', authenticateUser, async (req, res) => {
  const { name } = req.body;
  
  if (!name?.trim()) {
    console.log('Collection name missing in request');
    return res.status(400).json({ message: 'Collection name is required' });
  }

  try {
    console.log('Creating collection:', name, 'for user:', req.user.id);
    
    const { data, error } = await req.supabaseClient
      .from('collections')
      .insert({
        name: name.trim(),
        user_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }
    
    console.log('Collection created:', data?.id);
    res.json(data);
  } catch (error) {
    console.error('Failed to create collection:', error);
    res.status(500).json({
      message: 'Failed to create collection',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// YouTube processing route
app.post('/api/upload/youtube', authenticateUser, async (req, res) => {
  const { sources, options } = req.body;

  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ message: 'No sources provided' });
  }

  try {
    const results = [];

    for (const source of sources) {
      console.log('Processing YouTube source:', source.url);
      
      // Extract video ID
      const videoId = await extractVideoId(source.url);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }
      
      // Get video metadata
      const videoMetadata = await getVideoMetadata(videoId);
      const title = `${videoMetadata.title} - ${videoMetadata.channelTitle}`;
      
      console.log('Creating document for video:', title);
      
      // Create initial document record
      const { data: document, error: createError } = await req.supabaseClient
        .from('documents')
        .insert({
          title,
          content_type: 'youtube',
          source_url: `https://youtube.com/watch?v=${videoId}`,
          user_id: req.user.id,
          collection_id: options.collectionId || null,
          processing_status: 'processing'
        })
        .select()
        .single();

      if (createError) {
        console.error('Error creating document:', createError);
        throw createError;
      }

      console.log('Document created, ID:', document.id);
      
      try {
        // Get transcript
        console.log('Getting transcript for video:', videoId);
        const transcript = await getVideoTranscript(videoId);
        
        if (!transcript) {
          throw new Error('Failed to get video transcript');
        }
        
        console.log('Transcript retrieved, generating summaries');
        
        // Generate summaries
        const summaries = {};
        
        // Generate short form summary if enabled
        if (options.generateShortForm !== false) {
          console.log('Generating short form summary');
          const shortSummary = await generateSummary(transcript, 'short');
          let shortAudioUrl = null;
          
          if (options.generateAudio !== false) {
            console.log('Generating audio for short summary');
            shortAudioUrl = await generateAudio(shortSummary, req.supabaseClient);
          }
          
          summaries.shortForm = {
            text: shortSummary,
            audioUrl: shortAudioUrl
          };
        }
        
        // Generate long form summary if enabled
        if (options.generateLongForm !== false) {
          console.log('Generating long form summary');
          const longSummary = await generateSummary(transcript, 'long');
          let longAudioUrl = null;
          
          if (options.generateAudio !== false) {
            console.log('Generating audio for long summary');
            longAudioUrl = await generateAudio(longSummary, req.supabaseClient);
          }
          
          summaries.longForm = {
            text: longSummary,
            audioUrl: longAudioUrl
          };
        }
        
        // Update document with processed content
        console.log('Updating document with processed content');
        await req.supabaseClient
          .from('documents')
          .update({
            transcription: transcript,
            short_summary: summaries.shortForm?.text,
            short_summary_audio: summaries.shortForm?.audioUrl,
            long_summary: summaries.longForm?.text,
            long_summary_audio: summaries.longForm?.audioUrl,
            processing_status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
          
        console.log('Document successfully processed');
        
        results.push({
          id: document.id,
          title,
          status: 'completed'
        });
      } catch (processingError) {
        console.error('Processing error:', processingError);
        
        // Update document with error status
        await req.supabaseClient
          .from('documents')
          .update({
            processing_status: 'error',
            updated_at: new Date().toISOString()
          })
          .eq('id', document.id);
          
        results.push({
          id: document.id,
          title,
          status: 'error',
          error: processingError.message
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('YouTube processing failed:', error);
    res.status(500).json({
      message: 'Failed to process YouTube sources',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Website route
app.post('/api/upload/websites', authenticateUser, async (req, res) => {
  const { urls, options } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ message: 'No URLs provided' });
  }

  try {
    // Mock success response for now
    res.json([{
      id: 'mock-id',
      title: 'Mock Website Processing',
      status: 'completed'
    }]);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process websites',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// File upload route
app.post('/api/upload/files', authenticateUser, upload.array('files'), async (req, res) => {
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ message: 'No files provided' });
  }

  try {
    // Mock success response for now
    res.json([{
      id: 'mock-id',
      title: 'Mock File Processing',
      status: 'completed'
    }]);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to process files',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// YouTube audio extraction endpoint for transcription
app.get('/api/youtube/audio/:videoId', async (req, res) => {
  const { videoId } = req.params;
  
  try {
    // Verify video exists and is accessible
    const info = await ytdl.getInfo(videoId);
    
    // Get audio-only format URL
    const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio', filter: 'audioonly' });
    
    if (!audioFormat || !audioFormat.url) {
      throw new Error('Could not find audio format for this video');
    }
    
    res.json({ audioUrl: audioFormat.url });
  } catch (error) {
    console.error('YouTube audio extraction error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 