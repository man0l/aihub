import axios from 'axios';
import { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'buffer';

/**
 * Generates a summary of the provided text
 * @param text - The text to summarize
 * @param type - The type of summary to generate (short or comprehensive)
 * @returns The generated summary
 */
export async function generateSummary(text: string, type: 'short' | 'comprehensive'): Promise<string> {
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

    return response.data.choices[0]?.message?.content || '';
  } catch (error) {
    console.error(`Error generating ${type} summary:`, error);
    throw new Error(`Failed to generate ${type} summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generates audio from text using OpenAI's TTS API
 * @param text - The text to convert to audio
 * @param supabaseClient - The authenticated Supabase client
 * @returns The URL to the generated audio file
 */
export async function generateAudio(text: string, supabaseClient: SupabaseClient): Promise<string> {
  try {
    // Check if text is too long for a single TTS request
    const MAX_TTS_LENGTH = 4000; // OpenAI TTS limit
    
    // Split long text into chunks that fit within TTS limits
    const getTextChunks = (text: string): string[] => {
      const chunks: string[] = [];
      
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
    const audioBlobs: Buffer[] = [];
    
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
      
      audioBlobs.push(Buffer.from(response.data));
    }
    
    // Combine audio blobs if we have multiple
    let finalAudioData: Buffer;
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
    throw new Error(`Failed to generate audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 