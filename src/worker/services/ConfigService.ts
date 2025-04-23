import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { StorageServiceConfig, StorageConfig } from '../../shared/interfaces/StorageConfig.js';

/**
 * Config Service - Responsible for environment variables and configuration
 */
export class ConfigService {
  // Supabase
  supabaseUrl: string;
  supabaseKey: string;

  // Storage Configuration
  private storageConfig!: StorageConfig;
  private storageServiceConfig!: StorageServiceConfig;

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
    
    // Initialize Storage Configurations
    this.initializeStorageConfig();
    
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
   * Initialize storage configuration from environment variables
   */
  private initializeStorageConfig(): void {
    const projectPrefix = process.env.PROJECT_PREFIX || '';

    this.storageConfig = {
      region: process.env.AWS_REGION || '',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      endpoint: process.env.AWS_ENDPOINT,
      bucket: '' // This will be set by the storage service
    };

    // Ensure document bucket has a default if not explicitly defined
    const documentsBucket = process.env.DOCUMENTS_BUCKET || 'document-upload';

    this.storageServiceConfig = {
      projectPrefix,
      buckets: {
        rawMedia: `${projectPrefix}-${process.env.RAW_MEDIA_BUCKET || 'raw-media'}`,
        processedTranscripts: `${projectPrefix}-${process.env.PROCESSED_TRANSCRIPTS_BUCKET || 'processed-transcripts'}`,
        documents: `${projectPrefix}-${documentsBucket}`
      }
    };

    // Only log storage config if debug mode is enabled
    if (process.env.DEBUG_STORAGE === 'true') {
      console.log('Storage service config:', {
        projectPrefix,
        buckets: this.storageServiceConfig.buckets
      });
    }
  }

  /**
   * Get storage configuration
   */
  getStorageConfig(): StorageConfig {
    return { ...this.storageConfig };
  }

  /**
   * Get storage service configuration
   */
  getStorageServiceConfig(): StorageServiceConfig {
    return { ...this.storageServiceConfig };
  }

  /**
   * Validates that all required environment variables are set
   */
  private validateEnvironment(): void {
    const requiredVars = [
      { name: 'VITE_SUPABASE_URL', value: this.supabaseUrl },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', value: this.supabaseKey },
      { name: 'AWS_REGION', value: this.storageConfig.region },
      { name: 'AWS_ACCESS_KEY_ID', value: this.storageConfig.accessKeyId },
      { name: 'AWS_SECRET_ACCESS_KEY', value: this.storageConfig.secretAccessKey },
      { name: 'VITE_YOUTUBE_API_KEY', value: this.youtubeApiKey },
      { name: 'PROJECT_PREFIX', value: this.storageServiceConfig.projectPrefix },
      { name: 'RAW_MEDIA_BUCKET', value: this.storageServiceConfig.buckets.rawMedia },
      { name: 'PROCESSED_TRANSCRIPTS_BUCKET', value: this.storageServiceConfig.buckets.processedTranscripts }
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

  /**
   * @deprecated Use getStorageServiceConfig().projectPrefix instead
   */
  get projectPrefix(): string {
    return this.storageServiceConfig.projectPrefix;
  }

  /**
   * @deprecated Use getStorageConfig().region instead
   */
  get s3Region(): string {
    return this.storageConfig.region;
  }

  /**
   * @deprecated Use getStorageConfig().accessKeyId instead
   */
  get s3AccessKey(): string {
    return this.storageConfig.accessKeyId;
  }

  /**
   * @deprecated Use getStorageConfig().secretAccessKey instead
   */
  get s3SecretKey(): string {
    return this.storageConfig.secretAccessKey;
  }

  /**
   * @deprecated Use getStorageServiceConfig().buckets.rawMedia instead
   */
  get rawMediaBucket(): string {
    return this.storageServiceConfig.buckets.rawMedia;
  }

  /**
   * @deprecated Use getStorageServiceConfig().buckets.processedTranscripts instead
   */
  get processedTranscriptsBucket(): string {
    return this.storageServiceConfig.buckets.processedTranscripts;
  }
} 