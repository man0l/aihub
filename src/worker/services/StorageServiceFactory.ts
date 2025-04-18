import { ConfigService } from './ConfigService.js';
import { StorageService } from './StorageService.js';
import { IStorageService } from './interfaces/IStorageService.js';
import { StorageServiceConfig } from './interfaces/StorageConfig.js';

export class StorageServiceFactory {
  private static instances: Map<string, IStorageService> = new Map();

  /**
   * Gets a storage service instance for a specific bucket type
   * @param bucketType - The type of bucket to get a storage service for
   * @param configService - The config service instance
   * @returns A storage service instance configured for the specified bucket
   */
  static getStorageService(
    bucketType: keyof StorageServiceConfig['buckets'],
    configService: ConfigService
  ): IStorageService {
    const config = configService.getStorageServiceConfig();
    const bucketName = config.buckets[String(bucketType)];

    if (!bucketName) {
      throw new Error(`Bucket type '${String(bucketType)}' is not configured`);
    }

    // Check if we already have an instance for this bucket
    const existingInstance = this.instances.get(bucketName);
    if (existingInstance) {
      return existingInstance;
    }

    // Create a new instance
    const storageService = new StorageService(configService);
    storageService.setBucket(bucketName);
    
    // Cache the instance
    this.instances.set(bucketName, storageService);
    
    return storageService;
  }

  /**
   * Clears all cached storage service instances
   */
  static clearInstances(): void {
    this.instances.clear();
  }
} 