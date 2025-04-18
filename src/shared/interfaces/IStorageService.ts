export interface IStorageService {
  uploadFile(filePath: string, key: string): Promise<string>;
  uploadString(data: string, key: string, contentType?: string): Promise<string>;
  downloadFile(key: string, outputPath: string): Promise<string>;
  getString(key: string): Promise<string>;
  setBucket(bucket: string): void;
} 