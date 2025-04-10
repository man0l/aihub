import { supabase } from './supabase';
import { ProcessingOptions, ProcessingResult, VideoSource, DocumentSummaries } from './types';
import { extractVideoIds, getVideoTranscript } from './youtube';
import { generateFullSummary } from './ai';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';

// Maximum retries for operations
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

async function retryOperation<T>(
  operation: () => Promise<T>,
  context: string,
  maxRetries = MAX_RETRIES,
  initialDelay = INITIAL_RETRY_DELAY
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      console.error(`Attempt ${i + 1} failed for ${context}:`, lastError);
      
      if (i < maxRetries - 1) {
        const waitTime = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  
  throw new Error(`${context} failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function processYouTubeSources(
  sources: VideoSource[],
  userId: string,
  options: ProcessingOptions = {}
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];

  for (const source of sources) {
    try {
      const videoIds = await extractVideoIds(source);
      
      for (const videoId of videoIds) {
        try {
          // Get video metadata first
          const response = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${import.meta.env.VITE_YOUTUBE_API_KEY}&part=snippet`
          );

          if (!response.ok) {
            throw new Error('Failed to fetch video metadata');
          }

          const data = await response.json();
          const video = data.items?.[0]?.snippet;
          
          if (!video) {
            throw new Error('Video not found');
          }

          const title = `${video.title} - ${video.channelTitle}`;

          // Create initial document record
          const { data: document, error: createError } = await supabase
            .from('documents')
            .insert({
              title,
              content_type: 'youtube',
              source_url: `https://youtube.com/watch?v=${videoId}`,
              user_id: userId,
              collection_id: options.collectionId,
              processing_status: 'processing'
            })
            .select()
            .single();

          if (createError) throw createError;

          try {
            // Get transcript with improved error handling
            const transcript = await retryOperation(
              () => getVideoTranscript(videoId),
              'Video transcription'
            );

            if (!transcript) {
              throw new Error('Failed to get video transcript');
            }

            // Generate summaries based on options
            const summaries: DocumentSummaries = {};

            // Generate short form summary if enabled
            if (options.generateShortForm !== false) {
              summaries.shortForm = await retryOperation(
                () => generateFullSummary(transcript, 'short', options.generateAudio !== false),
                'Short form summary'
              );
            }

            // Generate long form summary if enabled
            if (options.generateLongForm !== false) {
              summaries.longForm = await retryOperation(
                () => generateFullSummary(transcript, 'long', options.generateAudio !== false),
                'Long form summary'
              );
            }

            // Update document with processed content
            await supabase
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

            results.push({
              id: document.id,
              title,
              status: 'completed'
            });
          } catch (error) {
            console.error('Processing error:', error);
            
            // Update document with error status and message
            await supabase
              .from('documents')
              .update({
                processing_status: 'error',
                updated_at: new Date().toISOString()
              })
              .eq('id', document.id);

            throw error;
          }
        } catch (error) {
          console.error(`Error processing video ${videoId}:`, error);
          results.push({
            id: '',
            title: `Video ${videoId}`,
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      console.error(`Error processing source ${source.url}:`, error);
      results.push({
        id: '',
        title: source.url,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

export async function processFiles(
  files: File[],
  userId: string,
  options: ProcessingOptions = {}
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];

  for (const file of files) {
    try {
      // Create initial document record
      const { data: document, error: createError } = await supabase
        .from('documents')
        .insert({
          title: file.name,
          content_type: getFileType(file),
          user_id: userId,
          collection_id: options.collectionId,
          processing_status: 'processing'
        })
        .select()
        .single();

      if (createError) throw createError;

      // Process the file content
      const content = await extractDocumentContent(file);

      // Generate summaries based on options
      const summaries: DocumentSummaries = {};

      // Generate short form summary if enabled
      if (options.generateShortForm !== false) {
        summaries.shortForm = await generateFullSummary(content, 'short', options.generateAudio !== false);
      }

      // Generate long form summary if enabled
      if (options.generateLongForm !== false) {
        summaries.longForm = await generateFullSummary(content, 'long', options.generateAudio !== false);
      }

      // Update document with processed content
      await supabase
        .from('documents')
        .update({
          original_content: content,
          short_summary: summaries.shortForm?.text,
          short_summary_audio: summaries.shortForm?.audioUrl,
          long_summary: summaries.longForm?.text,
          long_summary_audio: summaries.longForm?.audioUrl,
          processing_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      results.push({
        id: document.id,
        title: file.name,
        status: 'completed'
      });
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error);
      results.push({
        id: '',
        title: file.name,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

export async function processWebsites(
  urls: string[],
  userId: string,
  options: ProcessingOptions = {}
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];

  for (const url of urls) {
    try {
      // Create initial document record
      const { data: document, error: createError } = await supabase
        .from('documents')
        .insert({
          title: url,
          content_type: 'webpage',
          source_url: url,
          user_id: userId,
          collection_id: options.collectionId,
          processing_status: 'processing'
        })
        .select()
        .single();

      if (createError) throw createError;

      // Fetch and process the webpage
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch webpage: ${response.statusText}`);
      }

      const html = await response.text();
      const content = extractWebContent(html);
      const title = extractWebTitle(html) || url;

      // Generate summaries based on options
      const summaries: DocumentSummaries = {};

      // Generate short form summary if enabled
      if (options.generateShortForm !== false) {
        summaries.shortForm = await generateFullSummary(content, 'short', options.generateAudio !== false);
      }

      // Generate long form summary if enabled
      if (options.generateLongForm !== false) {
        summaries.longForm = await generateFullSummary(content, 'long', options.generateAudio !== false);
      }

      // Update document with processed content
      await supabase
        .from('documents')
        .update({
          title,
          original_content: content,
          short_summary: summaries.shortForm?.text,
          short_summary_audio: summaries.shortForm?.audioUrl,
          long_summary: summaries.longForm?.text,
          long_summary_audio: summaries.longForm?.audioUrl,
          processing_status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', document.id);

      results.push({
        id: document.id,
        title,
        status: 'completed'
      });
    } catch (error) {
      console.error(`Error processing website ${url}:`, error);
      results.push({
        id: '',
        title: url,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}

function extractWebContent(html: string): string {
  const $ = cheerio.load(html);
  return $('article, main, .content, #content').text() || $('body').text();
}

function extractWebTitle(html: string): string {
  const $ = cheerio.load(html);
  return $('title').text();
}

function getFileType(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'doc';
    case 'txt':
      return 'txt';
    default:
      return 'unknown';
  }
}

async function extractDocumentContent(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const type = getFileType(file);
  
  switch (type) {
    case 'pdf':
      const pdf = await import('pdf-parse');
      const data = await pdf.default(buffer);
      return data.text;
      
    case 'doc':
    case 'docx':
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
      
    case 'txt':
      return new TextDecoder().decode(buffer);
      
    default:
      throw new Error('Unsupported file type');
  }
}