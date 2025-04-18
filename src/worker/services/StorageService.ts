import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from './ConfigService.js';
import { IStorageService } from '../../shared/interfaces/IStorageService.js';
import { StorageConfig } from '../../shared/interfaces/StorageConfig.js';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

/**
 * Storage Service - Responsible for S3 operations
 */
export class StorageService implements IStorageService {
  private s3Client: S3Client;
  private currentBucket: string;
  private readonly storageConfig: StorageConfig;

  constructor(private configService: ConfigService) {
    this.storageConfig = configService.getStorageConfig();
    this.currentBucket = ''; // Will be set via setBucket

    const clientConfig: any = {
      region: this.storageConfig.region,
      credentials: {
        accessKeyId: this.storageConfig.accessKeyId,
        secretAccessKey: this.storageConfig.secretAccessKey,
      }
    };

    if (this.storageConfig.endpoint) {
      clientConfig.endpoint = this.storageConfig.endpoint;
      clientConfig.forcePathStyle = true;
    }

    this.s3Client = new S3Client(clientConfig);
  }

  /**
   * Sets the current bucket for operations
   * @param bucket - The bucket name to use
   */
  setBucket(bucket: string): void {
    this.currentBucket = bucket;
  }

  /**
   * Uploads a file to S3
   * @param filePath - Path to the file to upload
   * @param key - S3 key (object name)
   * @returns The URL of the uploaded file
   */
  async uploadFile(filePath: string, key: string): Promise<string> {
    if (!this.currentBucket) {
      throw new Error('Bucket not set. Call setBucket() before performing operations.');
    }

    const fileStream = fs.createReadStream(filePath);
    const fileExtension = path.extname(filePath);
    const contentType = this.getContentType(fileExtension);

    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.currentBucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
      },
    });

    try {
      const result = await upload.done();
      console.log(`File uploaded successfully to ${result.Location}`);
      return result.Location || `s3://${this.currentBucket}/${key}`;
    } catch (error) {
      console.error('Error uploading file to S3:', error);
      throw new Error(`Failed to upload file to S3: ${error}`);
    }
  }

  /**
   * Uploads string data to S3
   * @param data - The string data to upload
   * @param key - S3 key (object name)
   * @param contentType - The content type (MIME type)
   * @returns The URL of the uploaded object
   */
  async uploadString(data: string, key: string, contentType: string = 'application/json'): Promise<string> {
    if (!this.currentBucket) {
      throw new Error('Bucket not set. Call setBucket() before performing operations.');
    }

    const params = {
      Bucket: this.currentBucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    };

    try {
      const command = new PutObjectCommand(params);
      await this.s3Client.send(command);
      return `s3://${this.currentBucket}/${key}`;
    } catch (error) {
      console.error('Error uploading string data to S3:', error);
      throw new Error(`Failed to upload string data to S3: ${error}`);
    }
  }

  /**
   * Downloads a file from S3
   * @param key - S3 key (object name)
   * @param outputPath - Path where to save the downloaded file
   * @returns The path to the downloaded file
   */
  async downloadFile(key: string, outputPath: string): Promise<string> {
    if (!this.currentBucket) {
      throw new Error('Bucket not set. Call setBucket() before performing operations.');
    }

    const command = new GetObjectCommand({
      Bucket: this.currentBucket,
      Key: key,
    });

    try {
      const response = await this.s3Client.send(command);
      const writeStream = fs.createWriteStream(outputPath);
      
      if (response.Body instanceof Readable) {
        await new Promise<void>((resolve, reject) => {
          (response.Body as Readable)
            .pipe(writeStream)
            .on('finish', () => resolve())
            .on('error', reject);
        });
      } else {
        throw new Error('Response body is not a readable stream');
      }

      console.log(`File downloaded successfully to ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('Error downloading file from S3:', error);
      throw new Error(`Failed to download file from S3: ${error}`);
    }
  }

  /**
   * Gets a string from S3
   * @param key - S3 key (object name)
   * @returns The string content of the object
   */
  async getString(key: string): Promise<string> {
    if (!this.currentBucket) {
      throw new Error('Bucket not set. Call setBucket() before performing operations.');
    }

    const command = new GetObjectCommand({
      Bucket: this.currentBucket,
      Key: key,
    });

    try {
      const response = await this.s3Client.send(command);
      
      if (response.Body) {
        const streamToString = async (stream: Readable): Promise<string> => {
          return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          });
        };
        
        if (response.Body instanceof Readable) {
          return await streamToString(response.Body);
        } else {
          throw new Error('Response body is not a readable stream');
        }
      } else {
        throw new Error('Response body is empty');
      }
    } catch (error) {
      console.error('Error getting string from S3:', error);
      throw new Error(`Failed to get string from S3: ${error}`);
    }
  }

  /**
   * Gets the MIME content type based on file extension
   * @param extension - File extension with dot (e.g., '.mp3')
   * @returns The corresponding MIME type
   */
  private getContentType(extension: string): string {
    // Normalize extension - ensure it starts with a dot and is lowercase
    const normalizedExt = extension.startsWith('.')
      ? extension.toLowerCase()
      : `.${extension.toLowerCase()}`;

    const contentTypes: Record<string, string> = {
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      
      // Text
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.csv': 'text/csv',
      
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      
      // Images
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      
      // Subtitles
      '.srt': 'text/plain',
      '.vtt': 'text/vtt',
      
      // Data
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.yaml': 'application/yaml',
      '.yml': 'application/yaml',
      
      // Archives
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.7z': 'application/x-7z-compressed'
    };

    return contentTypes[normalizedExt] || 'application/octet-stream';
  }
} 