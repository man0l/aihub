import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from './config.js';

/**
 * Storage Service - Responsible for S3 operations
 */
export class StorageService {
  private configService: ConfigService;
  private mediaS3Client: S3Client | null = null;
  private documentsS3Client: S3Client | null = null;
  private isConfigured: boolean = false;
  private detectedDocumentRegion: string | null = null;

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.initializeClients();
  }

  /**
   * Initialize S3 clients with proper configuration
   */
  private initializeClients(): void {
    // Validate AWS credentials
    const { valid, message } = this.configService.validateAwsCredentials();
    if (!valid) {
      console.error(`S3 client initialization failed: ${message}`);
      this.isConfigured = false;
      return;
    }

    try {
      // Create S3 client for media uploads
      const mediaClientConfig: any = {
        region: this.configService.s3BucketRegion,
        credentials: {
          accessKeyId: this.configService.s3AccessKey,
          secretAccessKey: this.configService.s3SecretKey,
        }
      };

      // Create S3 client for document uploads
      const documentsClientConfig: any = {
        region: this.detectedDocumentRegion || this.configService.documentsBucketRegion,
        credentials: {
          accessKeyId: this.configService.s3AccessKey,
          secretAccessKey: this.configService.s3SecretKey,
        }
      };

      // Only use custom endpoint for non-AWS S3 services
      // For AWS S3, we let the SDK handle region routing automatically
      if (this.configService.awsEndpoint && !this.configService.awsEndpoint.includes('amazonaws.com')) {
        mediaClientConfig.endpoint = this.configService.awsEndpoint;
        documentsClientConfig.endpoint = this.configService.awsEndpoint;
        
        // Use path style for custom S3 endpoints only
        mediaClientConfig.forcePathStyle = true;
        documentsClientConfig.forcePathStyle = true;
      }

      // Log configuration (without credentials)
      console.log('Initializing S3 clients with config:', {
        mediaRegion: mediaClientConfig.region,
        documentsRegion: documentsClientConfig.region,
        detectedRegion: this.detectedDocumentRegion,
        customEndpoint: !!mediaClientConfig.endpoint,
        usingPathStyle: !!mediaClientConfig.forcePathStyle
      });

      this.mediaS3Client = new S3Client(mediaClientConfig);
      this.documentsS3Client = new S3Client(documentsClientConfig);
      this.isConfigured = true;
    } catch (error) {
      console.error('Failed to initialize S3 clients:', error);
      this.isConfigured = false;
    }
  }

  /**
   * Extract region from endpoint URL
   * @param endpoint - S3 endpoint URL
   * @returns The region extracted from the URL or null if not found
   */
  private extractRegionFromEndpoint(endpoint: string): string | null {
    // Attempt to extract region from standard AWS S3 endpoint URLs like s3.us-west-2.amazonaws.com
    const match = endpoint.match(/s3\.([a-z0-9-]+)\.amazonaws\.com/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  /**
   * Uploads a buffer to S3
   * @param buffer - The buffer to upload
   * @param key - S3 key (object name)
   * @param contentType - The content type (MIME type)
   * @param isDocument - Whether this is a document upload
   * @returns The URL of the uploaded file
   */
  async uploadBuffer(buffer: Buffer, key: string, contentType: string, isDocument: boolean = false): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('Storage service is not properly configured. AWS credentials may be missing.');
    }

    const client = isDocument ? this.documentsS3Client : this.mediaS3Client;
    if (!client) {
      throw new Error(`S3 client not initialized for ${isDocument ? 'documents' : 'media'} uploads.`);
    }

    const bucket = isDocument ? this.configService.documentsBucket : this.configService.s3Bucket;
    const region = isDocument 
      ? (this.detectedDocumentRegion || this.configService.documentsBucketRegion) 
      : this.configService.s3BucketRegion;

    console.log(`Uploading file to S3 bucket '${bucket}' in region '${region}'`);

    try {
      // Create a new Upload
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ACL: 'public-read' // Make files publicly accessible
        },
      });

      // Complete the upload
      const result = await upload.done();
      console.log(`File uploaded successfully to ${result.Location || 'S3'}`);
      
      // Return the location or construct the URL
      if (result.Location) {
        return result.Location;
      }
      
      // Construct URL based on whether we're using a custom endpoint
      const endpoint = this.configService.awsEndpoint;
      if (endpoint && !endpoint.includes('amazonaws.com')) {
        // For custom S3 endpoints
        return `${endpoint}/${bucket}/${key}`;
      }
      
      // Standard AWS S3 URL
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error: any) {
      console.error('Error uploading file to S3:', error);
      
      // Check for common S3 errors
      if (error.name === 'PermanentRedirect' && error.Endpoint) {
        console.warn(`Bucket requires specific endpoint: ${error.Endpoint}`);
        
        // Try to extract the region from the endpoint
        const correctRegion = this.extractRegionFromEndpoint(error.Endpoint);
        if (correctRegion) {
          console.log(`Detected correct region: ${correctRegion}, will retry with this region`);
          
          // Store the detected region and reinitialize clients
          this.detectedDocumentRegion = correctRegion;
          this.initializeClients();
          
          // Retry the upload with the new client (recursive call)
          if (this.isConfigured) {
            console.log(`Retrying upload with region: ${correctRegion}`);
            return this.uploadBuffer(buffer, key, contentType, isDocument);
          }
        }
        
        throw new Error(`S3 bucket '${bucket}' is in a different region. Please update the DOCUMENTS_BUCKET_REGION environment variable to '${correctRegion || 'the correct region'}'.`);
      }
      
      if (error.name === 'InvalidAccessKeyId') {
        throw new Error('The AWS Access Key ID is invalid. Please check your credentials.');
      }
      
      if (error.name === 'SignatureDoesNotMatch') {
        throw new Error('The AWS signature is invalid. Secret key may be incorrect.');
      }
      
      if (error.name === 'NoSuchBucket') {
        throw new Error(`S3 bucket '${bucket}' does not exist. Please create it first.`);
      }
      
      throw new Error(`Failed to upload file to S3: ${error.message || String(error)}`);
    }
  }
} 