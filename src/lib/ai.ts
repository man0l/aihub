import { supabase } from './supabase';
import { Summary } from './types';
import OpenAI from 'openai';

const SHORT_FORM_PROMPT = `Please provide a friendly and conversational summary of the following text. Break it down into easy-to-digest main points and subpoints. For each point, include relatable everyday analogies that help explain the concepts in a way that's both memorable and easy to understand.

For example, if explaining how a computer processor works, you might say "Think of it like a super-fast chef in a kitchen, taking ingredients (data) and following a recipe (instructions) to create the final dish (output)."

The summary should:
- Use a warm, conversational tone like you're explaining to a friend
- Include 3-5 main points with subpoints
- Provide clear, relatable examples and analogies for each point
- Take about 1-5 minutes to read (approximately 250-750 words)
- Make complex ideas accessible and memorable

Original text to summarize:`;

const LONG_FORM_PROMPT = `Please provide a comprehensive yet friendly and conversational summary of the following text. Break it down into detailed main points and subpoints, enriched with stories, examples, and everyday analogies that make the concepts more relatable and easier to understand.

For each major concept, include:
- A clear explanation in conversational language
- Real-world analogies that relate to everyday experiences
- Practical examples that demonstrate the idea
- Mini-stories that illustrate the concept in action
- Detailed exploration of implications and applications
- Common misconceptions and clarifications
- Historical context or interesting background information where relevant

For example, if explaining blockchain technology, you might say "Imagine you and your friends have a shared notebook where everyone writes down who owes what to whom. Everyone has their own copy, and when someone adds a new entry, everyone checks their copy to make sure it matches - that's basically how blockchain works!"

The summary should:
- Use a warm, engaging tone like you're having an in-depth conversation with a friend
- Include 5-8 main points with detailed subpoints
- Provide multiple analogies and examples for each major concept
- Take about 10-20 minutes to read (approximately 2000-4000 words)
- Make complex ideas accessible while preserving important details
- Include relevant stories that help illustrate key points
- Provide deeper insights and connections between concepts
- End with key takeaways and practical applications

IMPORTANT: The summary MUST be comprehensive enough to take 10-20 minutes to read. If the content seems too short, expand on the concepts with more examples, stories, and detailed explanations.

Original text to summarize:`;

// Constants
const MAX_TTS_LENGTH = 4000;
const MAX_GPT_LENGTH = 16000;
const MIN_SHORT_SUMMARY_LENGTH = 250; // Minimum 250 words for short summary
const MIN_LONG_SUMMARY_LENGTH = 2000; // Minimum 2000 words for long summary
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 10000;
const API_TIMEOUT = 120000; // 2 minutes
const STORAGE_BUCKET = 'media';
const AUDIO_FOLDER = 'audio-summaries';

// Error types
enum AIErrorType {
  NETWORK = 'NETWORK',
  API = 'API',
  VALIDATION = 'VALIDATION',
  TIMEOUT = 'TIMEOUT',
  LENGTH = 'LENGTH',
  OPENAI = 'OPENAI',
  UNKNOWN = 'UNKNOWN',
  CONFIG = 'CONFIG'
}

class AIError extends Error {
  constructor(
    message: string,
    public type: AIErrorType,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AIError';
  }
}

function validateApiKey(): string {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new AIError(
      'OpenAI API key is not configured. Please check your environment variables.',
      AIErrorType.CONFIG
    );
  }
  return apiKey;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

function validateSummaryLength(text: string, type: 'short' | 'long'): void {
  const wordCount = countWords(text);
  const minWords = type === 'short' ? MIN_SHORT_SUMMARY_LENGTH : MIN_LONG_SUMMARY_LENGTH;
  
  if (wordCount < minWords) {
    throw new AIError(
      `Generated ${type} summary is too short (${wordCount} words). Minimum required: ${minWords} words.`,
      AIErrorType.LENGTH
    );
  }
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  context: string,
  retries = MAX_RETRIES,
  initialDelay = INITIAL_RETRY_DELAY
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let i = 0; i < retries; i++) {
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new AIError(
            `Operation timed out after ${API_TIMEOUT}ms`,
            AIErrorType.TIMEOUT
          ));
        }, API_TIMEOUT);
      });

      return await Promise.race([
        operation(),
        timeoutPromise
      ]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      console.error(`Attempt ${i + 1} failed for ${context}:`, {
        error: lastError,
        type: error instanceof AIError ? error.type : AIErrorType.UNKNOWN,
        message: lastError.message
      });
      
      if (error instanceof AIError) {
        // Don't retry configuration, validation or length errors
        if ([AIErrorType.CONFIG, AIErrorType.VALIDATION, AIErrorType.LENGTH].includes(error.type)) {
          throw error;
        }
      }
      
      if (i < retries - 1) {
        const waitTime = Math.min(initialDelay * Math.pow(2, i), MAX_RETRY_DELAY);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw new AIError(
    `${context} failed after ${retries} attempts: ${lastError?.message}`,
    AIErrorType.NETWORK,
    lastError
  );
}

function validateText(text: string): void {
  if (!text || typeof text !== 'string') {
    throw new AIError('No text provided', AIErrorType.VALIDATION);
  }

  const trimmedText = text.trim();
  if (trimmedText.length < 50) {
    throw new AIError(
      'Text is too short for summarization (minimum 50 characters)',
      AIErrorType.VALIDATION
    );
  }

  if (text.length > MAX_GPT_LENGTH) {
    throw new AIError(
      `Text exceeds maximum length of ${MAX_GPT_LENGTH} characters`,
      AIErrorType.VALIDATION
    );
  }
}

// Initialize OpenAI client
function getOpenAIClient(): OpenAI {
  const apiKey = validateApiKey();
  return new OpenAI({
    apiKey,
    baseURL: '/api/openai' // Use the proxy URL from vite config
  });
}

async function generateSummary(text: string, type: 'short' | 'long'): Promise<string> {
  validateText(text);
  const prompt = type === 'short' ? SHORT_FORM_PROMPT : LONG_FORM_PROMPT;
  const openai = getOpenAIClient();
  
  return retryWithBackoff(async () => {
    try {
      const completion = await openai.chat.completions.create({
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
        max_tokens: type === 'short' ? 2048 : 4096,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      });

      const summary = completion.choices[0]?.message?.content;

      if (!summary) {
        throw new AIError(
          'OpenAI API returned empty summary',
          AIErrorType.OPENAI
        );
      }

      // Validate summary length
      validateSummaryLength(summary, type);

      return summary;
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        if (error.status === 401) {
          throw new AIError(
            'Invalid OpenAI API key. Please check your configuration.',
            AIErrorType.CONFIG
          );
        }
        throw new AIError(
          `OpenAI API error (${error.status}): ${error.message}`,
          AIErrorType.OPENAI
        );
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('network')) {
        throw new AIError(
          'Network error during summary generation',
          AIErrorType.NETWORK,
          error
        );
      }

      throw new AIError(
        `Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`,
        AIErrorType.UNKNOWN,
        error instanceof Error ? error : undefined
      );
    }
  }, `${type} summary generation`);
}

async function generateAudioChunk(text: string): Promise<Blob> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new AIError('Empty text provided for audio generation', AIErrorType.VALIDATION);
  }

  if (text.length > MAX_TTS_LENGTH) {
    throw new AIError(
      `Text exceeds maximum length of ${MAX_TTS_LENGTH} characters`,
      AIErrorType.VALIDATION
    );
  }

  const openai = getOpenAIClient();

  return retryWithBackoff(async () => {
    try {
      const response = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: trimmedText,
        response_format: "mp3",
        speed: 1.0
      });

      // Convert the response to a Blob
      const audioData = await response.arrayBuffer();
      const blob = new Blob([audioData], { type: 'audio/mpeg' });

      if (blob.size === 0) {
        throw new AIError('Received empty audio data', AIErrorType.API);
      }

      return blob;
    } catch (error) {
      if (error instanceof AIError) {
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        if (error.status === 401) {
          throw new AIError(
            'Invalid OpenAI API key. Please check your configuration.',
            AIErrorType.CONFIG
          );
        }
        throw new AIError(
          `OpenAI API error (${error.status}): ${error.message}`,
          AIErrorType.API
        );
      }

      // Handle network errors
      if (error instanceof TypeError && error.message.includes('network')) {
        throw new AIError(
          'Network error during audio generation',
          AIErrorType.NETWORK,
          error
        );
      }

      throw new AIError(
        `Failed to generate audio: ${error instanceof Error ? error.message : 'Unknown error'}`,
        AIErrorType.API,
        error instanceof Error ? error : undefined
      );
    }
  }, 'Audio chunk generation');
}

function splitTextForTTS(text: string): string[] {
  if (!text.trim()) {
    throw new AIError('No text provided for splitting', AIErrorType.VALIDATION);
  }

  const chunks: string[] = [];
  let currentChunk = '';
  
  // Split by sentences while preserving punctuation
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
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
}

async function concatenateAudioBlobs(blobs: Blob[]): Promise<Blob> {
  if (blobs.length === 0) {
    throw new AIError('No audio blobs to concatenate', AIErrorType.VALIDATION);
  }

  try {
    // Validate each blob before processing
    for (const blob of blobs) {
      if (blob.size === 0) {
        throw new AIError('Found empty audio blob', AIErrorType.VALIDATION);
      }
      if (blob.type !== 'audio/mpeg') {
        throw new AIError(`Invalid audio format: ${blob.type}`, AIErrorType.VALIDATION);
      }
    }

    const arrayBuffers = await Promise.all(
      blobs.map(blob => blob.arrayBuffer())
    );
    
    const totalLength = arrayBuffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
    if (totalLength === 0) {
      throw new AIError('Total audio length is zero', AIErrorType.VALIDATION);
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const buffer of arrayBuffers) {
      result.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }
    
    const finalBlob = new Blob([result], { type: 'audio/mpeg' });
    if (finalBlob.size === 0) {
      throw new AIError('Generated empty audio file', AIErrorType.VALIDATION);
    }

    return finalBlob;
  } catch (error) {
    if (error instanceof AIError) throw error;

    throw new AIError(
      'Failed to concatenate audio blobs',
      AIErrorType.API,
      error instanceof Error ? error : undefined
    );
  }
}

async function uploadToStorage(blob: Blob, fileName: string): Promise<string> {
  if (blob.size === 0) {
    throw new AIError('Cannot upload empty audio file', AIErrorType.VALIDATION);
  }

  if (blob.type !== 'audio/mpeg') {
    throw new AIError(`Invalid audio format: ${blob.type}`, AIErrorType.VALIDATION);
  }

  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some(b => b.name === STORAGE_BUCKET);

  if (!bucketExists) {
    throw new AIError(`Storage bucket '${STORAGE_BUCKET}' does not exist`, AIErrorType.VALIDATION);
  }

  const { data, error } = await retryWithBackoff(
    () => supabase.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, blob, {
        contentType: 'audio/mpeg',
        cacheControl: '3600',
        upsert: true
      }),
    'Storage upload'
  );

  if (error) {
    throw new AIError(`Storage upload failed: ${error.message}`, AIErrorType.API);
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(fileName);

  if (!publicUrl) {
    throw new AIError('Failed to get public URL for uploaded audio', AIErrorType.API);
  }

  return publicUrl;
}

async function generateAudioSummary(text: string): Promise<string> {
  try {
    validateText(text);
    validateApiKey();
    
    // Split text into chunks
    const chunks = splitTextForTTS(text);
    if (chunks.length === 0) {
      throw new AIError('No valid text chunks for audio generation', AIErrorType.VALIDATION);
    }

    console.log(`Generating audio for ${chunks.length} chunks...`);
    const audioBlobs: Blob[] = [];
    
    // Generate audio for each chunk with progress tracking
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
      const audioBlob = await generateAudioChunk(chunks[i]);
      audioBlobs.push(audioBlob);
    }
    
    console.log('Concatenating audio chunks...');
    const finalAudioBlob = await concatenateAudioBlobs(audioBlobs);
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const fileName = `${AUDIO_FOLDER}/${timestamp}-${randomString}.mp3`;

    console.log('Uploading audio file...');
    return await uploadToStorage(finalAudioBlob, fileName);
  } catch (error) {
    console.error('Failed to generate audio summary:', error);
    
    throw new AIError(
      `Audio generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof AIError ? error.type : AIErrorType.API,
      error instanceof Error ? error : undefined
    );
  }
}

export async function generateFullSummary(text: string, type: 'short' | 'long', generateAudio: boolean): Promise<Summary> {
  try {
    validateText(text);
    validateApiKey(); // Validate API key before starting any operations
    
    // Generate text summary first
    const textSummary = await generateSummary(text, type);
    
    // Generate audio if requested and summary was successful
    let audioUrl: string | undefined;
    if (generateAudio && textSummary) {
      try {
        audioUrl = await generateAudioSummary(textSummary);
      } catch (audioError) {
        console.error(`Failed to generate ${type} form audio:`, audioError);
        // Continue without audio if it fails
      }
    }
    
    return {
      text: textSummary,
      audioUrl
    };
  } catch (error) {
    console.error(`Failed to generate ${type} form summary:`, error);
    throw error instanceof AIError ? error : new AIError(
      `Failed to generate ${type} form summary`,
      AIErrorType.API,
      error instanceof Error ? error : undefined
    );
  }
}