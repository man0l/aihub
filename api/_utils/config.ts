/**
 * Configuration service for API endpoints
 * This class abstracts access to environment variables and configuration
 */
export class ConfigService {
  constructor() {
    // Initialize with environment variables
  }

  // S3 configuration for media files
  get s3AccessKey(): string {
    return process.env.S3_ACCESS_KEY || '';
  }

  get s3SecretKey(): string {
    return process.env.S3_SECRET_KEY || '';
  }

  get s3Bucket(): string {
    return process.env.S3_BUCKET || 'media';
  }

  get s3BucketRegion(): string {
    return process.env.S3_BUCKET_REGION || 'us-east-1';
  }

  // S3 configuration for document files
  get documentsBucket(): string {
    return process.env.DOCUMENTS_BUCKET || 'documents';
  }

  get documentsBucketRegion(): string {
    return process.env.DOCUMENTS_BUCKET_REGION || 'us-east-1';
  }

  // Optional custom AWS endpoint for non-AWS S3 services
  get awsEndpoint(): string {
    return process.env.AWS_ENDPOINT || '';
  }
} 