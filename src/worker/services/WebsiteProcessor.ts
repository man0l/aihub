import axios from 'axios';
import * as cheerio from 'cheerio';
import { ConfigService } from './ConfigService.js';
import { DatabaseService } from './DatabaseService.js';
import { IStorageService } from './interfaces/IStorageService.js';
import OpenAI from 'openai';
import { EventSchedulerFactory } from './factories/EventSchedulerFactory.js';
import { SummaryType } from './interfaces/EventServices.js';

interface WebsiteMetadata {
  title: string;
  description: string;
  favicon: string;
  url: string;
  content: string;
  ai_content?: string;
}

/**
 * WebsiteProcessor - Responsible for processing website content
 */
export class WebsiteProcessor {
  private storageService: IStorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  private openai: OpenAI | null = null;
  
  constructor(
    storageService: IStorageService,
    databaseService: DatabaseService,
    configService: ConfigService
  ) {
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.config = configService;
    this.initializeOpenAI();
  }
  
  /**
   * Initialize OpenAI client
   */
  private initializeOpenAI() {
    if (this.config.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: this.config.openaiApiKey
      });
      console.log('OpenAI client initialized for content extraction');
    } else {
      console.warn('OpenAI API key not provided, AI content extraction will be skipped');
    }
  }
  
  /**
   * Process a website URL job
   */
  async processWebsite(job: { 
    url: string; 
    document_id: string; 
    user_id: string;
    collection_id?: string;
    processingOptions?: {
      ai_content_extraction?: boolean;
    };
  }): Promise<boolean> {
    console.log(`Processing website: ${job.url} for document ${job.document_id}`);
    
    try {
      // Update document status to processing
      await this.databaseService.updateDocumentStatus(
        job.document_id,
        'processing'
      );
      
      // Extract content from website
      const websiteData = await this.extractWebsiteContent(job.url);
      console.log(`Website extracted: ${websiteData.title}`);
      
      // Get the documents bucket configuration
      const storageServiceConfig = this.config.getStorageServiceConfig();
      const documentsBucket = storageServiceConfig.buckets.documents;
      
      if (!documentsBucket) {
        throw new Error('Documents bucket is not configured');
      }
      
      // Set the bucket for website content storage
      this.storageService.setBucket(documentsBucket);
      
      // Generate a unique key for S3
      const date = new Date();
      const formattedDate = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      const urlObj = new URL(job.url);
      const sanitizedHostname = urlObj.hostname.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const contentKey = `websites/${job.user_id}/${formattedDate}-${job.document_id}-${sanitizedHostname}.json`;
      
      // Upload content to S3
      await this.storageService.uploadString(
        JSON.stringify(websiteData, null, 2),
        contentKey,
        'application/json'
      );
      
      // Use AI-extracted content if enabled and available, otherwise use regular content
      const useAiContent = job.processingOptions?.ai_content_extraction !== false && websiteData.ai_content;
      const finalContent = useAiContent ? (websiteData.ai_content || '') : (websiteData.content || '');
      
      // Update document with extracted data
      await this.databaseService.updateDocumentStatus(
        job.document_id,
        'completed',
        {
          title: websiteData.title || new URL(job.url).hostname,
          original_content: `s3://${documentsBucket}/${contentKey}`,
          transcription: finalContent // Store the valuable content
        }
      );

      // Schedule summary generation events
      try {
        console.log(`Scheduling summary generation for document ${job.document_id}`);
        const eventScheduler = EventSchedulerFactory.create();

        // Schedule short summary immediately
        await eventScheduler.scheduleSummaryGeneration({
          userId: job.user_id,
          documentId: job.document_id,
          transcriptText: finalContent,
          summaryType: 'short'
        });
        console.log(`Short summary scheduled for document ${job.document_id}`);

        // Schedule long summary with a delay
        await eventScheduler.scheduleSummaryGeneration({
          userId: job.user_id,
          documentId: job.document_id,
          transcriptText: finalContent,
          summaryType: 'long'
        }, 1); // 1 minute delay
        console.log(`Long summary scheduled for document ${job.document_id}`);
      } catch (eventError) {
        console.error('Failed to schedule summary generation:', eventError);
        // Don't throw the error as this is a non-critical operation
      }
      
      console.log(`Website processing completed for document ${job.document_id}`);
      return true;
    } catch (error) {
      console.error(`Error processing website ${job.url}:`, error);
      
      // Update document with error status
      await this.databaseService.updateDocumentStatus(
        job.document_id,
        'error',
        {
          error_message: error instanceof Error ? error.message : 'Unknown error'
        }
      );
      
      return false;
    }
  }
  
  /**
   * Extract content from a website
   */
  private async extractWebsiteContent(url: string): Promise<WebsiteMetadata> {
    try {
      console.log(`Extracting content from ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 30000, // 30 second timeout
        maxContentLength: 10 * 1024 * 1024 // 10MB max
      });
      
      const $ = cheerio.load(response.data);
      
      // Extract metadata
      const title = $('title').text().trim() || new URL(url).hostname;
      const description = $('meta[name="description"]').attr('content') || 
                         $('meta[property="og:description"]').attr('content') || 
                         '';
      
      const favicon = $('link[rel="icon"]').attr('href') || 
                    $('link[rel="shortcut icon"]').attr('href') || 
                    '/favicon.ico';
      
      // Build absolute favicon URL if relative
      const faviconUrl = favicon.startsWith('http') 
        ? favicon 
        : new URL(favicon, url).toString();
      
      // Remove scripts, styles, and other non-content elements
      $('script, style, iframe, noscript, svg').remove();
      
      // Extract main content - try to find main content area
      let content = '';
      const possibleContentSelectors = [
        'article', 'main', '[role="main"]', '.content', '.article', '.post', '#content', '#main'
      ];
      
      for (const selector of possibleContentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().trim();
          break;
        }
      }
      
      // If no content found via selectors, use body content
      if (!content) {
        content = $('body').text().trim();
      }
      
      // Clean up content (remove excessive whitespace)
      content = content
        .replace(/\s+/g, ' ')
        .trim();
      
      // Create result object
      const result: WebsiteMetadata = { 
        title, 
        description, 
        favicon: faviconUrl, 
        url,
        content
      };
      
      // Use OpenAI to extract valuable content if available
      if (this.openai) {
        try {
          console.log('Using OpenAI to extract valuable content');
          
          // Extract most valuable content using OpenAI
          result.ai_content = await this.extractValuableContentWithAI(content, title, url);
          
          console.log('Successfully extracted valuable content with OpenAI');
        } catch (aiError) {
          console.error('Error extracting content with OpenAI:', aiError);
          // Continue with regular content if AI extraction fails
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error fetching website content:', error);
      throw new Error(`Failed to fetch website content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Extract the most valuable content from a webpage using OpenAI
   */
  private async extractValuableContentWithAI(content: string, title: string, url: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }
   
    
    const prompt = `
    You are a content extraction expert. Your task is to extract only the most valuable content from this webpage.
    
    WEBPAGE TITLE: ${title}
    WEBPAGE URL: ${url}
    
    INSTRUCTIONS:
    1. Focus ONLY on the main content of the page.
    2. EXCLUDE navigation menus, headers, footers, sidebars, ads, and other non-essential elements.
    3. Preserve the actual factual content in its original wording.
    4. Organize the content in a clean, readable format.
    5. If the text appears to be a blog post or article, focus on the article body.
    6. If it's a product page, focus on the product description, features, and specifications.
    7. Maintain all relevant facts, figures, and data from the original content.
    8. DO NOT summarize or paraphrase the content - extract it intact.
    
    WEBPAGE CONTENT:
    ${content}
    
    EXTRACTED VALUABLE CONTENT:
    `;
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use model with higher context length
      messages: [
        { role: 'system', content: 'You are a content extraction expert that identifies and extracts only the most valuable content from webpages.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3, // Lower temperature for more focused extraction
    });
    
    const extractedContent = response.choices[0]?.message?.content;
    if (!extractedContent) {
      throw new Error('OpenAI returned empty content');
    }
    
    return extractedContent.trim();
  }
} 