import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/**
 * Config Service - Responsible for environment variables and configuration
 */
export class ConfigService {
  // Supabase
  supabaseUrl: string;
  supabaseKey: string;

  // AWS
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  awsEndpoint: string | undefined;

  // S3 buckets
  projectPrefix: string;
  rawMediaBucket: string;
  processedTranscriptsBucket: string;
  s3Bucket: string; // For backward compatibility

  // API keys
  openaiApiKey: string | undefined;
  youtubeApiKey: string;

  // Other configuration
  tempDir: string;

  constructor() {
    // Initialize environment variables
    dotenv.config();
    
    // Map environment variables to class properties with aliases for backward compatibility
    // Supabase
    this.supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    
    // AWS
    this.s3Region = process.env.AWS_REGION || '';
    this.s3AccessKey = process.env.AWS_ACCESS_KEY_ID || '';
    this.s3SecretKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    this.awsEndpoint = process.env.AWS_ENDPOINT;
    
    // S3 buckets
    this.projectPrefix = process.env.PROJECT_PREFIX || '';
    this.rawMediaBucket = `${this.projectPrefix}-${process.env.RAW_MEDIA_BUCKET}`;
    this.processedTranscriptsBucket = `${this.projectPrefix}-${process.env.PROCESSED_TRANSCRIPTS_BUCKET}`;
    
    // Default to raw media bucket for backward compatibility
    this.s3Bucket = this.rawMediaBucket;
    
    // API keys
    this.openaiApiKey = process.env.VITE_OPENAI_API_KEY;
    this.youtubeApiKey = process.env.VITE_YOUTUBE_API_KEY || '';
    
    // Set up temp directory
    this.tempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
    this.ensureTempDirExists();
    
    // Validate required environment variables
    this.validateEnvironment();
  }

  /**
   * Validates that all required environment variables are set
   */
  private validateEnvironment(): void {
    const requiredVars = [
      { name: 'VITE_SUPABASE_URL', value: this.supabaseUrl },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', value: this.supabaseKey },
      { name: 'AWS_REGION', value: this.s3Region },
      { name: 'AWS_ACCESS_KEY_ID', value: this.s3AccessKey },
      { name: 'AWS_SECRET_ACCESS_KEY', value: this.s3SecretKey },
      { name: 'VITE_YOUTUBE_API_KEY', value: this.youtubeApiKey },
      { name: 'PROJECT_PREFIX', value: this.projectPrefix },
      { name: 'RAW_MEDIA_BUCKET', value: this.rawMediaBucket },
      { name: 'PROCESSED_TRANSCRIPTS_BUCKET', value: this.processedTranscriptsBucket }
    ];
    
    const missingVars = requiredVars.filter(({ value }) => !value);
    
    if (missingVars.length > 0) {
      const missingVarNames = missingVars.map(({ name }) => name).join(', ');
      console.warn(`Missing required environment variables: ${missingVarNames}`);
      console.warn('Worker may not function correctly without these variables set.');
    }
  }

  /**
   * Ensures the temporary directory exists
   */
  ensureTempDirExists(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      console.log(`Created temp directory at ${this.tempDir}`);
    }
  }

  /**
   * Cleans up temporary files
   */
  cleanupTempFiles(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted temporary file: ${filePath}`);
      }
    } catch (error) {
      console.error(`Error cleaning up temporary file ${filePath}:`, error);
    }
  }
} 