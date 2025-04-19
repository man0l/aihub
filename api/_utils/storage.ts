import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from './config';

/**
 * Storage Service - Responsible for S3 operations
 */
export class StorageService {
  private configService: ConfigService;
  private mediaS3Client: S3Client;
  private documentsS3Client: S3Client;

  constructor(configService: ConfigService) {
    this.configService = configService;

    // Create S3 client for media uploads
    const mediaClientConfig: any = {
      region: this.configService.s3BucketRegion,
      credentials: {
        accessKeyId: this.configService.s3AccessKey,
        secretAccessKey: this.configService.s3SecretKey,
      },
      forcePathStyle: true,
      useRegionalEndpoint: true,
      bucketEndpoint: false
    };

    // Create S3 client for document uploads
    const documentsClientConfig: any = {
      region: this.configService.documentsBucketRegion,
      credentials: {
        accessKeyId: this.configService.s3AccessKey,
        secretAccessKey: this.configService.s3SecretKey,
      },
      forcePathStyle: true,
      useRegionalEndpoint: true,
      bucketEndpoint: false
    };

    // Override endpoint if custom endpoint is specified
    if (this.configService.awsEndpoint) {
      mediaClientConfig.endpoint = this.configService.awsEndpoint;
      documentsClientConfig.endpoint = this.configService.awsEndpoint;
    }

    this.mediaS3Client = new S3Client(mediaClientConfig);
    this.documentsS3Client = new S3Client(documentsClientConfig);
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
    const client = isDocument ? this.documentsS3Client : this.mediaS3Client;
    const bucket = isDocument ? this.configService.documentsBucket : this.configService.s3Bucket;
    const region = isDocument ? this.configService.documentsBucketRegion : this.configService.s3BucketRegion;

    try {
      // Create a new Upload
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        },
      });

      // Complete the upload
      const result = await upload.done();
      console.log(`File uploaded successfully to ${result.Location || 'S3'}`);
      
      // Return the location or construct the URL
      return result.Location || `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    } catch (error: any) {
      console.error('Error uploading file to S3:', error);
      
      // Check for PermanentRedirect error
      if (error.name === 'PermanentRedirect' && error.Endpoint) {
        console.warn(`Bucket requires specific endpoint: ${error.Endpoint}`);
        // Consider updating client configuration based on this information
      }
      
      throw new Error(`Failed to upload file to S3: ${error.message || String(error)}`);
    }
  }
} 