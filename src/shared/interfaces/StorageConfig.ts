export interface StorageConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  bucket: string;
}

export interface StorageServiceConfig {
  projectPrefix: string;
  buckets: {
    rawMedia: string;
    processedTranscripts: string;
    documents?: string;
    [key: string]: string | undefined; // Allow for future bucket types
  };
} 