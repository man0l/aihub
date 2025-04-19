/**
 * Configuration service for API endpoints
 * This class abstracts access to environment variables and configuration
 */
export class ConfigService {
  private cachedEnv: Record<string, string> = {};

  constructor() {
    // Initialize and cache environment variables
    this.refreshEnvironmentCache();
  }

  // Refresh environment variable cache
  private refreshEnvironmentCache(): void {
    // Cache common environment variables to avoid repeated access
    this.cachedEnv = {
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || '',
      S3_SECRET_KEY: process.env.S3_SECRET_KEY || '',
      S3_BUCKET: process.env.S3_BUCKET || 'media',
      S3_BUCKET_REGION: process.env.S3_BUCKET_REGION || 'eu-central-1',
      DOCUMENTS_BUCKET: process.env.DOCUMENTS_BUCKET || 'documents',
      DOCUMENTS_BUCKET_REGION: process.env.DOCUMENTS_BUCKET_REGION || 'eu-central-1',
      AWS_ENDPOINT: process.env.AWS_ENDPOINT || '',
      // Fallbacks to other credentials if S3 specific ones aren't provided
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || ''
    };

    // Log environment status (without exposing secrets)
    console.log('Environment configuration loaded:', {
      s3AccessKeyConfigured: !!this.cachedEnv.S3_ACCESS_KEY || !!this.cachedEnv.AWS_ACCESS_KEY_ID,
      s3SecretKeyConfigured: !!this.cachedEnv.S3_SECRET_KEY || !!this.cachedEnv.AWS_SECRET_ACCESS_KEY,
      s3Bucket: this.cachedEnv.S3_BUCKET,
      s3Region: this.cachedEnv.S3_BUCKET_REGION,
      documentsBucket: this.cachedEnv.DOCUMENTS_BUCKET,
      documentsRegion: this.cachedEnv.DOCUMENTS_BUCKET_REGION,
      customEndpoint: !!this.cachedEnv.AWS_ENDPOINT
    });
  }

  // Validate S3 credentials
  validateAwsCredentials(): { valid: boolean; message: string } {
    const accessKey = this.s3AccessKey;
    const secretKey = this.s3SecretKey;

    if (!accessKey) {
      return { 
        valid: false, 
        message: 'Missing S3 Access Key. Please set S3_ACCESS_KEY or AWS_ACCESS_KEY_ID environment variable.' 
      };
    }

    if (!secretKey) {
      return { 
        valid: false, 
        message: 'Missing S3 Secret Key. Please set S3_SECRET_KEY or AWS_SECRET_ACCESS_KEY environment variable.' 
      };
    }

    return { valid: true, message: 'AWS credentials validated' };
  }

  // S3 configuration for media files
  get s3AccessKey(): string {
    return this.cachedEnv.S3_ACCESS_KEY || this.cachedEnv.AWS_ACCESS_KEY_ID;
  }

  get s3SecretKey(): string {
    return this.cachedEnv.S3_SECRET_KEY || this.cachedEnv.AWS_SECRET_ACCESS_KEY;
  }

  get s3Bucket(): string {
    return this.cachedEnv.S3_BUCKET;
  }

  get s3BucketRegion(): string {
    return this.cachedEnv.S3_BUCKET_REGION;
  }

  // S3 configuration for document files
  get documentsBucket(): string {
    return this.cachedEnv.DOCUMENTS_BUCKET;
  }

  get documentsBucketRegion(): string {
    return this.cachedEnv.DOCUMENTS_BUCKET_REGION;
  }

  // Optional custom AWS endpoint for non-AWS S3 services
  get awsEndpoint(): string {
    return this.cachedEnv.AWS_ENDPOINT;
  }
} 