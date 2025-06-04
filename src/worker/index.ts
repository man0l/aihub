/**
 * Worker Script - YouTube Video Processing Worker
 * 
 * This script processes YouTube videos by fetching transcriptions and media,
 * then storing them in AWS S3.
 */

// Import required dependencies
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { fileTypeFromFile } from 'file-type';
import { PDFExtract } from 'pdf.js-extract';
import { PDFDocument } from 'pdf-lib';
import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import { Canvas } from 'canvas';

// Import our TypeScript services
import { ConfigService } from './services/ConfigService.js';
import { ClientFactory } from './services/ClientFactory.js';
import { YouTubeService } from './services/YouTubeService.js';
import { StorageService } from './services/StorageService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { WebsiteProcessor } from './services/WebsiteProcessor.js';
import { StorageServiceFactory } from './services/StorageServiceFactory.js';
import { IStorageService } from './services/interfaces/IStorageService.js';

// Import event scheduler for summary generation
import { EventSchedulerFactory } from './services/factories/EventSchedulerFactory.js';
import { SummaryType } from './services/interfaces/EventServices.js';

// Export all classes/services that are used in tests
export { ConfigService } from './services/ConfigService.js';
export { ClientFactory } from './services/ClientFactory.js';
export { YouTubeService } from './services/YouTubeService.js';
export { StorageService } from './services/StorageService.js';
export { DatabaseService } from './services/DatabaseService.js';
export { WebsiteProcessor } from './services/WebsiteProcessor.js';

// Initialize environment variables
dotenv.config();

interface ProcessingOptions {
  generateShortForm?: boolean;
  generateLongForm?: boolean;
  generateAudio?: boolean;
  collectionId?: string;
}

interface VideoJob {
  videoId: string;
  userId: string;
  sourceUrl: string;
  collectionId?: string;
  documentId?: string;
  processingOptions?: ProcessingOptions;
}

interface WebsiteJob {
  url: string;
  document_id: string;
  user_id: string;
  collection_id?: string;
  processingOptions?: ProcessingOptions;
}

interface WebsiteProcessorOptions {
  url: string;
  document_id: string;
  user_id: string;
  collection_id?: string;
  processingOptions?: ProcessingOptions;
}

interface DocumentJob {
  documentId: string;
  userId: string;
  sourceUrl: string;
  collectionId?: string;
  processingOptions?: ProcessingOptions;
}

/**
 * Document Processor - Responsible for processing uploaded documents
 */
class DocumentProcessor {
  private storageService: IStorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  
  constructor(
    storageService: IStorageService,
    databaseService: DatabaseService,
    configService: ConfigService
  ) {
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.config = configService;
  }

  /**
   * Checks if a PDF document is likely a scanned document
   * @param pdfText - The extracted text from the PDF
   * @param pdfBuffer - The raw PDF buffer
   * @returns True if the PDF is likely a scanned document
   */
  private isLikelyScannedPdf(pdfText: string, pdfBuffer: Buffer): boolean {
    // Check 1: Minimal or no text
    const hasMinimalText = !pdfText || pdfText.trim().length < 100;

    // Check 2: Text-to-size ratio (scanned documents usually have a high file size relative to text content)
    const textToSizeRatio = pdfText ? pdfText.length / pdfBuffer.length : 0;
    const hasLowTextToSizeRatio = textToSizeRatio < 0.001; // Threshold determined empirically

    // Check 3: Look for image-related PDF operators that are common in scanned documents
    const pdfString = pdfBuffer.toString('utf8', 0, Math.min(10000, pdfBuffer.length));
    const hasImageOperators = 
      pdfString.includes('/XObject') && 
      (pdfString.includes('/Image') || pdfString.includes('/Subtype/Image'));

    // Check 4: Check for device RGB or CMYK color space which is common in scanned PDFs
    const hasColorSpace = 
      pdfString.includes('/DeviceRGB') || 
      pdfString.includes('/DeviceCMYK');

    // If the PDF has minimal text OR low text-to-size ratio AND has image operators
    // it's likely a scanned document
    return (hasMinimalText || hasLowTextToSizeRatio) && (hasImageOperators || hasColorSpace);
  }

  /**
   * Process a document job from the queue
   */
  async processDocument(job: DocumentJob) {
    const { documentId, userId, sourceUrl, collectionId, processingOptions } = job;
    
    console.log(`Processing document ${documentId} for user ${userId}`);
    console.log(`Source URL: ${sourceUrl}`);
    console.log('Processing options:', processingOptions);
    
    try {
      // Update document status to processing
      await this.databaseService.updateDocumentStatus(
        documentId,
        'processing'
      );

      // Parse the URL to extract the bucket and key
      let s3Key: string;
      let bucketName: string;
      
      if (sourceUrl.startsWith('s3://')) {
        // Format: s3://bucket-name/path/to/file.ext
        const urlWithoutProtocol = sourceUrl.replace('s3://', '');
        const parts = urlWithoutProtocol.split('/');
        
        // The first part is the bucket name, the rest is the key
        bucketName = parts[0];
        s3Key = parts.slice(1).join('/');
      } else if (sourceUrl.includes('.amazonaws.com')) {
        // Format: https://bucket-name.s3.region.amazonaws.com/path/to/file.ext
        // or: https://s3.region.amazonaws.com/bucket-name/path/to/file.ext
        const url = new URL(sourceUrl);
        const pathParts = decodeURIComponent(url.pathname).split('/').filter(p => p);
        
        if (url.hostname.includes('.s3.')) {
          // Virtual hosted-style URL
          bucketName = url.hostname.split('.')[0];
          s3Key = pathParts.join('/');
        } else {
          // Path-style URL
          bucketName = pathParts[0];
          s3Key = pathParts.slice(1).join('/');
        }
      } else {
        throw new Error(`Invalid source URL format: ${sourceUrl}`);
      }
      
      // Set the correct bucket
      this.storageService.setBucket(bucketName);
      console.log(`Using bucket: ${bucketName}, key: ${s3Key}`);

      // Download the document from S3 using just the document ID and file extension
      const fileExtension = path.extname(decodeURIComponent(path.basename(sourceUrl)));
      const tempFilePath = path.join(this.config.tempDir, `${documentId}${fileExtension}`);
      await this.storageService.downloadFile(s3Key, tempFilePath);
      console.log(`Document downloaded to ${tempFilePath}`);

      try {
        // Extract text content from the document
        const extractedText = await this.extractDocumentContent(tempFilePath);
        console.log(`Successfully extracted text from document ${documentId}`);

        // Schedule summary generation events with processing options
        if (userId && extractedText) {
          console.log(`Scheduling summary generation for document ${documentId}`);
          await this.scheduleSummaryGeneration(documentId, userId, extractedText, {
            ...processingOptions,
            collectionId
          });
        }

        // Upload extracted text to S3
        // Use the same bucket as the original document
        const contentKey = `extracted-content/${userId}/${documentId}.txt`;
        const contentUrl = await this.storageService.uploadString(
          extractedText,
          contentKey,
          'text/plain'
        );
        console.log(`Extracted text uploaded to S3: ${contentUrl}`);

        // Update document with extracted content
        const updateResult = await this.databaseService.updateDocumentStatus(
          documentId,
          'completed',
          {
            processing_status: 'completed',
            original_content: sourceUrl, // Original file URL
            transcription: extractedText // Store the extracted text directly
          }
        );

        if (updateResult.error) {
          throw new Error(`Failed to update document status: ${updateResult.error.message}`);
        }
      } catch (extractionError: any) {
        console.error(`Error extracting content from document ${documentId}:`, extractionError);
        
        // Log the exact error for debugging
        console.error(`Document extraction failed with error type: ${extractionError.constructor?.name || 'Unknown'}`);
        console.error(`Full error details: ${JSON.stringify({
          message: extractionError.message,
          stack: extractionError.stack
        }, null, 2)}`);
        
        // Update document status to error with the specific extraction error
        await this.databaseService.updateDocumentStatus(
          documentId,
          'error',
          {
            processing_status: 'error',
            error_message: extractionError instanceof Error ? extractionError.message : 'Unknown error during extraction'
          }
        );
        
        console.log(`Document ${documentId} marked as error due to extraction failure`);
        throw extractionError;
      } finally {
        // Clean up temporary file
        this.config.cleanupTempFiles(tempFilePath);
      }
      
      console.log(`Document processing complete for ${documentId}`);
      return { success: true, document: { id: documentId } };
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      
      // Update document status to error
      await this.databaseService.updateDocumentStatus(
        documentId,
        'error',
        {
          processing_status: 'error',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        }
      );
      
      throw error;
    }
  }

  /**
   * Schedules both short and long summary generation events for document content
   */
  private async scheduleSummaryGeneration(
    documentId: string, 
    userId: string, 
    extractedText: string,
    processingOptions?: ProcessingOptions
  ): Promise<void> {
    try {
      console.log(`Creating event scheduler for document ${documentId} with userId ${userId}`);
      const eventScheduler = EventSchedulerFactory.create();

      // Schedule short summary only if explicitly enabled
      if (processingOptions?.generateShortForm === true) {
        console.log(`Scheduling short summary for document ${documentId}`);
        await eventScheduler.scheduleSummaryGeneration({
          userId: userId,
          documentId: documentId,
          transcriptText: extractedText,
          summaryType: 'short',
          processingOptions
        });
      } else {
        console.log('Skipping short summary generation as it is not explicitly enabled');
      }

      // Schedule long summary only if explicitly enabled
      if (processingOptions?.generateLongForm === true) {
        console.log(`Scheduling long summary for document ${documentId}`);
        await eventScheduler.scheduleSummaryGeneration({
          userId: userId,
          documentId: documentId,
          transcriptText: extractedText,
          summaryType: 'long',
          processingOptions
        }, 1); // 1 minute delay for long summary
      } else {
        console.log('Skipping long summary generation as it is not explicitly enabled');
      }

      console.log(`Summary generation scheduling completed for document ${documentId}`);
    } catch (error) {
      console.error('Failed to schedule summary generation:', error);
      // Don't throw the error as this is a non-critical operation
    }
  }

  /**
   * Extract text content from a document file
   * @param filePath - Path to the document file
   * @returns Extracted text content
   */
  private async extractDocumentContent(filePath: string): Promise<string> {
    console.log(`Extracting content from file: ${filePath}`);
    
    try {
      // First try to determine file type using file-type library for more accurate detection
      const fileType = await fileTypeFromFile(filePath);
      // Get extension from the file path as fallback
      const extension = path.extname(filePath).toLowerCase();
      
      // Use detected mime type if available, or fallback to extension-based detection
      const mimeType = fileType?.mime || '';
      console.log(`File type detection: MIME=${mimeType}, Extension=${extension}`);
      
      // Handle different file types
      if (mimeType.includes('pdf') || extension === '.pdf') {
        // PDF files
        try {
          const pdfBuffer = fs.readFileSync(filePath);
          console.log(`PDF size: ${pdfBuffer.length} bytes`);
          
          // Validate PDF structure first
          let isValidPdf = false;
          let validationError = null;
          try {
            console.log('Validating PDF structure...');
            const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
            const pageCount = pdfDoc.getPageCount();
            console.log(`PDF validation successful - document has ${pageCount} pages`);
            isValidPdf = true;
          } catch (validError: any) {
            validationError = validError;
            console.error('PDF validation failed:', validError.message);
          }
          
          // If PDF is not valid, provide detailed diagnostics and throw error immediately
          if (!isValidPdf) {
            const stats = fs.statSync(filePath);
            let pdfDiagnostics = `[PDF validation failed: ${validationError?.message || 'Unknown error'}]\n\n`;
            
            // Add file information
            pdfDiagnostics += `File Information:\n`;
            pdfDiagnostics += `Filename: ${path.basename(filePath)}\n`;
            pdfDiagnostics += `Size: ${stats.size} bytes\n`;
            pdfDiagnostics += `Last Modified: ${stats.mtime.toISOString()}\n\n`;
            
            // Check for PDF header
            const isPdfHeader = pdfBuffer.length > 5 && pdfBuffer.toString('ascii', 0, 5).startsWith('%PDF');
            pdfDiagnostics += `PDF Header Check: ${isPdfHeader ? 'Present' : 'Missing'}\n`;
            
            // Check if file might be encrypted/password protected
            const encryptedMarkers = ['Encrypt', '/Encrypt', 'Encryption', '/Encryption'];
            const bufferStr = pdfBuffer.toString('utf8', 0, Math.min(5000, pdfBuffer.length));
            const mightBeEncrypted = encryptedMarkers.some(marker => bufferStr.includes(marker));
            
            if (mightBeEncrypted) {
              pdfDiagnostics += 'This PDF appears to be encrypted or password-protected.\n';
            }
            
            // Throw an error with the diagnostics - don't proceed with extraction
            console.error('Invalid PDF file detected, halting extraction process');
            throw new Error(`Invalid PDF file: ${pdfDiagnostics}`);
          }
          
          // Attempt to extract text from PDF
          try {
            // First try with pdf-parse
            const pdfData = await pdfParse(pdfBuffer);
            
            // Check if this might be a scanned PDF with minimal text
            if (this.isLikelyScannedPdf(pdfData.text, pdfBuffer)) {
              console.log('PDF appears to be a scanned document. Attempting OCR...');
              throw new Error('Scanned document detected');
            }
            
            return pdfData.text || 'No text content extracted from PDF';
          } catch (primaryParseError: any) {
            console.log('Primary PDF parser failed, trying alternative parser...');
            
            // If primary parser fails, try pdf.js-extract
            try {
              const pdfExtract = new PDFExtract();
              const data = await pdfExtract.extractBuffer(pdfBuffer, {});
              
              if (data && data.pages && data.pages.length > 0) {
                console.log(`Alternative parser extracted ${data.pages.length} pages`);
                // Combine all text content from all pages
                const textContent = data.pages
                  .map(page => page.content
                    .map(item => item.str)
                    .join(' '))
                  .join('\n\n');
                
                // Check again if this might be a scanned PDF
                if (this.isLikelyScannedPdf(textContent, pdfBuffer)) {
                  console.log('PDF appears to be a scanned document based on content analysis. Attempting OCR...');
                  throw new Error('Scanned document detected');
                }
                
                return textContent || 'No text content extracted from PDF with alternative parser';
              } else {
                console.log('Alternative parser found no content, likely a scanned document.');
                throw new Error('No content extracted from PDF');
              }
            } catch (alternativeParseError: any) {
              console.log('Text extraction methods failed or scanned document detected, trying OCR...');
              
              // Check if a valid PDF file before attempting OCR
              if (!isValidPdf) {
                throw new Error('Cannot perform OCR on an invalid PDF structure');
              }
              
              // Both text extraction methods failed, try OCR as last resort
              try {
                console.log('Starting OCR processing...');
                
                // Set up PDF.js
                const pdfjsLib = pdfjs;
                pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
                
                // Load the PDF document
                const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
                const pdfDocument = await loadingTask.promise;
                
                console.log(`PDF document loaded for OCR, it has ${pdfDocument.numPages} pages`);
                
                // We'll process only up to a certain number of pages to avoid long processing times
                const maxPages = Math.min(20, pdfDocument.numPages);
                let ocrText = '';
                
                // Set up temporary directory for page images
                const tempImageDir = path.join(this.config.tempDir, `ocr-${Date.now()}`);
                if (!fs.existsSync(tempImageDir)) {
                  fs.mkdirSync(tempImageDir, { recursive: true });
                }
                
                // Initialize Tesseract worker with English language
                console.log('Initializing OCR engine...');
                const worker = await createWorker('eng');
                
                try {
                  // First, render all pages to images
                  const imagePaths: string[] = [];
                  
                  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                    console.log(`Rendering page ${pageNum} for OCR...`);
                    
                    // Get the page
                    const page = await pdfDocument.getPage(pageNum);
                    
                    // Set scale and viewport for a good resolution for OCR (higher is better for OCR accuracy)
                    const scale = 1.5; // Compromise between quality and performance
                    const viewport = page.getViewport({ scale });
                    
                    // Create a canvas for rendering
                    const canvas = new Canvas(viewport.width, viewport.height);
                    const context = canvas.getContext('2d') as any;
                    
                    // Render PDF page to canvas
                    await page.render({
                      canvasContext: context,
                      viewport
                    }).promise;
                    
                    // Save canvas as image file
                    const tempImagePath = path.join(tempImageDir, `page-${pageNum}.png`);
                    const buffer = canvas.toBuffer('image/png');
                    fs.writeFileSync(tempImagePath, buffer);
                    imagePaths.push(tempImagePath);
                  }
                  
                  // Now process all images with OCR
                  console.log(`Starting OCR on ${imagePaths.length} pages...`);
                  
                  // Process pages in batches for better performance
                  const batchSize = 3; // Process 3 pages at a time
                  
                  for (let i = 0; i < imagePaths.length; i += batchSize) {
                    const batch = imagePaths.slice(i, i + batchSize);
                    const batchPromises = batch.map(async (imagePath, index) => {
                      const pageNum = i + index + 1;
                      console.log(`OCR processing page ${pageNum}...`);
                      const { data: { text } } = await worker.recognize(imagePath);
                      return { pageNum, text };
                    });
                    
                    const results = await Promise.all(batchPromises);
                    
                    // Add each page's text to the full text in page order
                    results.sort((a, b) => a.pageNum - b.pageNum)
                      .forEach(result => {
                        ocrText += `\n\n--- Page ${result.pageNum} ---\n\n${result.text}`;
                      });
                      
                    // Log progress
                    console.log(`OCR completed for batch ${i / batchSize + 1} of ${Math.ceil(imagePaths.length / batchSize)}`);
                  }
                  
                  // Clean up all image files
                  imagePaths.forEach(imagePath => {
                    if (fs.existsSync(imagePath)) {
                      fs.unlinkSync(imagePath);
                    }
                  });
                } finally {
                  // Terminate worker and clean up resources
                  await worker.terminate();
                  
                  // Remove temp directory
                  if (fs.existsSync(tempImageDir)) {
                    fs.rmSync(tempImageDir, { recursive: true, force: true });
                  }
                }
                
                if (ocrText.trim()) {
                  console.log('OCR processing completed successfully!');
                  return `[OCR EXTRACTED TEXT]\n\n${ocrText.trim()}\n\n[Note: This text was extracted using OCR and may contain errors]`;
                } else {
                  throw new Error('OCR did not extract any text');
                }
              } catch (ocrError: any) {
                console.error('OCR processing failed:', ocrError);
                throw new Error(`All text extraction methods failed: ${ocrError.message}`);
              }
            }
          }
        } catch (pdfError: any) {
          console.error('PDF parsing error:', pdfError);
          
          // If PDF parsing fails, try to get file info
          const stats = fs.statSync(filePath);
          const fileInfo = {
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            filename: path.basename(filePath)
          };
          
          // Throw error with diagnostic info instead of returning it as content
          throw new Error(`PDF parsing failed: ${pdfError.message || 'Unknown error'}\n\nFile Information:\nFilename: ${fileInfo.filename}\nSize: ${fileInfo.size} bytes\nLast Modified: ${fileInfo.modified.toISOString()}`);
        }
      } 
      else if (mimeType.includes('msword') || mimeType.includes('officedocument.wordprocessing') || 
               extension === '.docx' || extension === '.doc') {
        // Word documents
        try {
          const docBuffer = fs.readFileSync(filePath);
          console.log(`Word document size: ${docBuffer.length} bytes`);
          
          const result = await mammoth.extractRawText({ buffer: docBuffer });
          return result.value || 'No text content extracted from Word document';
        } catch (docError: any) {
          console.error('Word document parsing error:', docError);
          
          // Throw error with diagnostic info instead of returning as content
          const stats = fs.statSync(filePath);
          throw new Error(`Word document parsing failed: ${docError.message || 'Unknown error'}\n\nFile Information:\nFilename: ${path.basename(filePath)}\nSize: ${stats.size} bytes\nLast Modified: ${stats.mtime.toISOString()}`);
        }
      } 
      else if (mimeType.includes('text/plain') || extension === '.txt' || extension === '.rtf') {
        // Text files
        try {
          return fs.readFileSync(filePath, 'utf8');
        } catch (textError: any) {
          console.error('Text file reading error:', textError);
          
          // Try reading as binary and converting to string
          try {
            const buffer = fs.readFileSync(filePath);
            return buffer.toString('utf8', 0, Math.min(buffer.length, 10000)) + 
                  (buffer.length > 10000 ? '\n[Content truncated due to size]' : '');
          } catch (binaryError: any) {
            // Throw an error instead of returning diagnostic message
            throw new Error(`Failed to read text file: ${textError.message || 'Unknown error'}`);
          }
        }
      } 
      else if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || 
               extension === '.xlsx' || extension === '.xls' || extension === '.ods') {
        // Spreadsheets (would need xlsx library)
        return `[This is a spreadsheet file. Text extraction requires specific processing.]`;
      } 
      else {
        // For other file types, try to read as text but warn about potential issues
        console.warn(`Unsupported file type: ${mimeType || extension}, attempting to read as text`);
        try {
          // Try text first
          return fs.readFileSync(filePath, 'utf8');
        } catch (readError) {
          // If text reading fails, try to read as binary and check for PDF or Word magic numbers
          try {
            const buffer = fs.readFileSync(filePath);
            
            // Check first few bytes to detect file type
            const isPDF = buffer.length > 4 && buffer.toString('ascii', 0, 4) === '%PDF';
            const isDocx = buffer.length > 4 && buffer.toString('hex', 0, 4).toLowerCase() === '504b0304'; // ZIP format (DOCX is a ZIP)
            
            if (isPDF) {
              return `[File appears to be a PDF but could not be parsed. Size: ${buffer.length} bytes]`;
            } else if (isDocx) {
              return `[File appears to be a Word document but could not be parsed. Size: ${buffer.length} bytes]`;
            }
            
            // Return info about the binary file
            return `[Unable to extract text from file. Binary file detected, size: ${buffer.length} bytes]`;
          } catch (binaryError: any) {
            throw new Error(`Unable to extract text from file: ${binaryError.message || 'Unknown error'}`);
          }
        }
      }
    } catch (error) {
      console.error('Error extracting document content:', error);
      throw new Error(`Failed to extract document content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export DocumentProcessor class
export { DocumentProcessor };

/**
 * Video Processor - Responsible for processing YouTube videos
 */
class VideoProcessor {
  private youtubeService: YouTubeService;
  private storageService: IStorageService;
  private databaseService: DatabaseService;
  private config: ConfigService;
  
  constructor(
    youtubeService: YouTubeService, 
    storageService: IStorageService,
    databaseService: DatabaseService, 
    configService: ConfigService
  ) {
    this.youtubeService = youtubeService;
    this.storageService = storageService;
    this.databaseService = databaseService;
    this.config = configService;
  }
  
  /**
   * Process a video job from the queue
   */
  async processVideo(job: VideoJob) {
    const { videoId, userId, sourceUrl, documentId, processingOptions } = job;
    
    console.log(`Processing video ${videoId} for user ${userId}`);
    console.log('Processing options:', processingOptions);
    
    try {
      // Get video info first
      const info = await this.youtubeService.getVideoInfo(videoId);
      console.log(`Video info retrieved: ${info.title}`);

      // Update YouTubeService with userId for this request
      this.youtubeService = new YouTubeService(
        this.config, 
        this.youtubeService['axiosClient'], 
        'oxylabs',
        userId
      );

      // Step 1: Try to get transcription using YouTube API first
      let transcription = await this.youtubeService.fetchTranscription(videoId);
      
      // If no transcription is available from YouTube API, download the video and transcribe it
      if (!transcription) {
        console.log(`No transcription available from YouTube API for ${videoId}, downloading video...`);
        
        try {
          // Download video audio
          const audioFilePath = await this.youtubeService.downloadVideo(videoId);
          console.log(`Video downloaded to ${audioFilePath}`);
          
          // Upload to S3 with the same extension as the downloaded file
          const fileExtension = path.extname(audioFilePath); // Get the file extension including the dot
          const s3Key = `raw-media/${userId}/${videoId}${fileExtension}`;
          await this.storageService.uploadFile(audioFilePath, s3Key);
          console.log(`Audio uploaded to S3: ${s3Key}`);
          
          // Clean up the temporary file
          this.config.cleanupTempFiles(audioFilePath);
          
          // At this point, we would normally send the audio for transcription
          // For now, we'll create a placeholder transcription from the video metadata
          transcription = `Title: ${info.title}\nChannel: ${info.author?.name || 'Unknown'}\n\nThis is a placeholder transcription as the automatic transcription process was unable to extract the speech content.`;
          
        } catch (downloadError) {
          console.error(`Error downloading video ${videoId}:`, downloadError);
          throw downloadError;
        }
      }
      
      // If we have transcription and documentId, schedule summaries
      if (transcription && documentId) {
        const eventScheduler = EventSchedulerFactory.create();
        
        // Schedule short summary only if enabled in processing options
        if (processingOptions?.generateShortForm) {
          console.log(`Scheduling short summary for video ${videoId}`);
          await eventScheduler.scheduleSummaryGeneration({
            userId,
            documentId,
            transcriptText: transcription,
            summaryType: 'short',
            processingOptions
          });
        } else {
          console.log('Skipping short summary generation as it is not enabled in processing options');
        }
        
        // Schedule long summary only if enabled in processing options
        if (processingOptions?.generateLongForm) {
          console.log(`Scheduling long summary for video ${videoId}`);
          await eventScheduler.scheduleSummaryGeneration({
            userId,
            documentId,
            transcriptText: transcription,
            summaryType: 'long',
            processingOptions
          }, 1); // 1 minute delay
        } else {
          console.log('Skipping long summary generation as it is not enabled in processing options');
        }
      }
      
      // Step 3: Update or create document with transcription
      // If documentId is provided, pass it to the function for direct updating
      let docResult;
      
      if (documentId) {
        // Update the existing document directly
        console.log(`Updating existing document ${documentId} with transcription for video ${videoId}`);
        const updateResult = await this.databaseService.updateDocumentStatus(
          documentId,
          'transcribed',
          {
            original_content: transcription,
            transcription: transcription,
          }
        );
        
        // Format result to match createDocumentFromTranscription response
        docResult = {
          success: !updateResult.error,
          document: { id: documentId },
          error: updateResult.error
        };
      } else {
        // Create or find document with transcription
        docResult = await this.databaseService.createDocumentFromTranscription(
          videoId,
          transcription,
          sourceUrl,
          userId
        );
      }
      
      if (!docResult.success) {
        throw new Error(`Failed to update/create document: ${docResult.error}`);
      }
      
      console.log(`Video processing complete for ${videoId}`);
      return docResult;
    } catch (error) {
      console.error(`Error processing video ${videoId}:`, error);
      throw error;
    }
  }
}

// Export VideoProcessor class
export { VideoProcessor };

/**
 * Worker - Manages the worker lifecycle and queue processing
 */
class Worker {
  private videoProcessor: VideoProcessor;
  private websiteProcessor: WebsiteProcessor;
  private documentProcessor: DocumentProcessor;
  private databaseService: DatabaseService;
  private isRunning: boolean;
  
  constructor(
    videoProcessor: VideoProcessor, 
    websiteProcessor: WebsiteProcessor, 
    documentProcessor: DocumentProcessor,
    databaseService: DatabaseService
  ) {
    this.videoProcessor = videoProcessor;
    this.websiteProcessor = websiteProcessor;
    this.documentProcessor = documentProcessor;
    this.databaseService = databaseService;
    this.isRunning = false;
  }
  
  /**
   * Start the worker
   */
  async start() {
    if (this.isRunning) {
      console.log('Worker is already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Worker started');
    
    await this.processQueues();
  }
  
  /**
   * Process the video queue
   */
  async processVideoQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveVideoMessage();
    
    if (error) {
      console.error('Error receiving message from video queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in video queue, waiting...');
      return;
    }
    
    console.log(`Received message from video queue: ${data.msg_id}`);
    
    try {
      // The message is now an object, not a JSON string that needs parsing
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      console.log('Processing message with video ID:', messageBody.video_id || messageBody.videoId);
      
      // Process the video with fields in both formats for compatibility
      await this.videoProcessor.processVideo({
        videoId: messageBody.video_id || messageBody.videoId,
        userId: messageBody.user_id || messageBody.userId,
        sourceUrl: messageBody.source_url || messageBody.sourceUrl,
        collectionId: messageBody.collection_id || messageBody.collectionId,
        documentId: messageBody.document_id || messageBody.documentId,
        processingOptions: messageBody.processingOptions || {}
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteVideoMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from video queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // In a real implementation, we might want to move this message to a dead-letter queue
      // or mark it for retry after some backoff period
      // For now, we'll delete it to prevent it from blocking the queue
      await this.databaseService.deleteVideoMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from video queue to prevent blocking`);
    }
  }
  
  /**
   * Process the website queue
   */
  async processWebsiteQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveWebsiteMessage();
    
    if (error) {
      console.error('Error receiving message from website queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in website queue, waiting...');
      return;
    }
    
    console.log(`Received message from website queue: ${data.msg_id}`);
    
    try {
      // The message is now an object, not a JSON string that needs parsing
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      // Process the website
      await this.websiteProcessor.processWebsite({
        url: messageBody.url,
        document_id: messageBody.document_id,
        user_id: messageBody.user_id,
        collection_id: messageBody.collection_id,
        processingOptions: messageBody.processingOptions || {}
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteWebsiteMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from website queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // In a real implementation, we might want to move this message to a dead-letter queue
      // or mark it for retry after some backoff period
      // For now, we'll delete it to prevent it from blocking the queue
      await this.databaseService.deleteWebsiteMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from website queue to prevent blocking`);
    }
  }
  
  /**
   * Process the document queue
   */
  async processDocumentQueue() {
    // Try to receive a message from the queue
    const { data, error } = await this.databaseService.receiveDocumentMessage();
    
    if (error) {
      console.error('Error receiving message from document queue:', error);
      return;
    }
    
    if (!data) {
      console.log('No messages in document queue, waiting...');
      return;
    }
    
    console.log(`Received message from document queue: ${data.msg_id}`);
    
    try {
      // Parse the message
      const messageBody = typeof data.message === 'string' 
        ? JSON.parse(data.message) 
        : data.message;
      
      console.log('Processing document:', messageBody.documentId || messageBody.document_id);
      
      // Process the document
      await this.documentProcessor.processDocument({
        documentId: messageBody.documentId || messageBody.document_id,
        userId: messageBody.userId || messageBody.user_id,
        sourceUrl: messageBody.sourceUrl || messageBody.source_url,
        collectionId: messageBody.collectionId || messageBody.collection_id,
        processingOptions: messageBody.processingOptions || {}
      });
      
      // Delete the message from the queue
      await this.databaseService.deleteDocumentMessage(data.msg_id);
      console.log(`Message ${data.msg_id} deleted from document queue`);
      
    } catch (processError) {
      console.error(`Error processing message ${data.msg_id}:`, processError);
      
      // Delete the message to prevent queue blocking
      await this.databaseService.deleteDocumentMessage(data.msg_id);
      console.log(`Failed message ${data.msg_id} deleted from document queue to prevent blocking`);
    }
  }

  /**
   * Process messages in a loop
   */
  async processQueues() {
    while (this.isRunning) {
      try {
        // Process all queues
        await this.processVideoQueue();
        await this.processWebsiteQueue();
        await this.processDocumentQueue();
        
        // Wait before checking again
        await this.sleep(1000);
      } catch (error) {
        console.error('Error processing queues:', error);
        await this.sleep(5000);
      }
    }
  }
  
  /**
   * Sleep for a given number of milliseconds
   */
  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Stop the worker
   */
  stop() {
    console.log('Stopping worker...');
    this.isRunning = false;
  }
}

// Export Worker class
export { Worker };

/**
 * Application - Main application class
 */
class Application {
  private configService: ConfigService;
  private supabaseClient: SupabaseClient;
  private storageService: IStorageService;
  private youtubeService: YouTubeService;
  private databaseService: DatabaseService;
  private videoProcessor: VideoProcessor;
  private websiteProcessor: WebsiteProcessor;
  private documentProcessor: DocumentProcessor;
  private worker: Worker;
  
  constructor() {
    // Create config service first
    this.configService = new ConfigService();
    
    // Create Supabase client
    this.supabaseClient = createClient(
      this.configService.supabaseUrl,
      this.configService.supabaseKey
    );
    
    // Create services
    this.storageService = StorageServiceFactory.getStorageService('documents', this.configService);
    
    // Create axios client for YouTube API
    const axiosClient = axios.create({
      baseURL: 'https://www.googleapis.com/youtube/v3',
      params: {
        key: this.configService.youtubeApiKey
      }
    });
    
    this.youtubeService = new YouTubeService(this.configService, axiosClient, 'oxylabs');
    this.databaseService = new DatabaseService(this.supabaseClient);
    
    // Create processors
    this.videoProcessor = new VideoProcessor(
      this.youtubeService,
      StorageServiceFactory.getStorageService('rawMedia', this.configService),
      this.databaseService,
      this.configService
    );
    
    this.websiteProcessor = new WebsiteProcessor(
      StorageServiceFactory.getStorageService('documents', this.configService),
      this.databaseService,
      this.configService
    );

    this.documentProcessor = new DocumentProcessor(
      this.storageService,
      this.databaseService,
      this.configService
    );
    
    // Create worker with all processors
    this.worker = new Worker(
      this.videoProcessor,
      this.websiteProcessor,
      this.documentProcessor,
      this.databaseService
    );
    
    // Set up graceful shutdown
    this.setupGracefulShutdown();
  }
  
  /**
   * Set up graceful shutdown handlers
   */
  setupGracefulShutdown() {
    // Handle process termination signals
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    
    console.log('Graceful shutdown handlers registered');
  }
  
  /**
   * Shut down the application gracefully
   */
  async shutdown() {
    console.log('Shutting down...');
    
    // Stop the worker
    this.worker.stop();
    
    // Allow some time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Shutdown complete');
    process.exit(0);
  }
  
  /**
   * Start the application
   */
  async start() {
    console.log('Starting application...');
    
    // Ensure environment variables are properly set
    if (!this.configService.supabaseUrl || !this.configService.supabaseKey) {
      throw new Error('Supabase environment variables are not set');
    }
    
    if (!this.configService.s3AccessKey || !this.configService.s3SecretKey) {
      throw new Error('AWS environment variables are not set');
    }
    
    // Start the worker
    await this.worker.start();
  }
}

// Export Application class
export { Application }; 