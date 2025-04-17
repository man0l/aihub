import { ProgressTracker } from '../interfaces/VideoServices.js';

export class ConsoleProgressTracker implements ProgressTracker {
  private startTime: number;
  private lastProgressTime: number;
  private updateInterval: number;

  constructor(updateIntervalMs: number = 1000) {
    this.startTime = Date.now();
    this.lastProgressTime = this.startTime;
    this.updateInterval = updateIntervalMs;
  }

  onProgress(bytesDownloaded: number, totalBytes?: number): void {
    const now = Date.now();
    if (now - this.lastProgressTime >= this.updateInterval) {
      const mbDownloaded = bytesDownloaded / (1024 * 1024);
      const message = totalBytes
        ? `Downloaded ${mbDownloaded.toFixed(2)}MB of ${(totalBytes / (1024 * 1024)).toFixed(2)}MB (${((bytesDownloaded / totalBytes) * 100).toFixed(1)}%)`
        : `Downloaded ${mbDownloaded.toFixed(2)}MB`;
      
      console.log(message);
      this.lastProgressTime = now;
    }
  }

  onComplete(totalBytes: number): void {
    const duration = (Date.now() - this.startTime) / 1000;
    const mbTotal = totalBytes / (1024 * 1024);
    console.log(`Download complete: ${mbTotal.toFixed(2)}MB in ${duration.toFixed(1)} seconds (${(mbTotal / duration).toFixed(2)}MB/s)`);
  }

  onError(error: Error): void {
    console.error('Download error:', error.message);
  }
} 