import { createClient } from '@supabase/supabase-js';
import { S3Client } from '@aws-sdk/client-s3';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from './ConfigService.js';

/**
 * Client Factory - Responsible for creating and managing external service clients
 */
export class ClientFactory {
  private config: ConfigService;
  
  constructor(configService: ConfigService) {
    this.config = configService;
  }
  
  createSupabaseClient() {
    return createClient(this.config.supabaseUrl, this.config.supabaseKey);
  }
  
  createS3Client() {
    return new S3Client({
      region: this.config.s3Region,
      credentials: {
        accessKeyId: this.config.s3AccessKey,
        secretAccessKey: this.config.s3SecretKey
      }
    });
  }
  
  createAxiosClient(): AxiosInstance {
    return axios.create();
  }
} 