import { VideoDownloadService } from '../VideoDownloadService.js';
import { YtDlpAdapter } from '../adapters/YtDlpAdapter.js';
import { FileManagerImpl } from '../implementations/FileManagerImpl.js';
import { ConsoleProgressTracker } from '../implementations/ConsoleProgressTracker.js';
import { DownloaderOptions } from '../interfaces/VideoServices.js';

export class VideoDownloadServiceFactory {
  static create(options: DownloaderOptions = {}): VideoDownloadService {
    const ytDlpAdapter = new YtDlpAdapter(options);
    const fileManager = new FileManagerImpl();
    const progressTracker = new ConsoleProgressTracker();

    return new VideoDownloadService(
      ytDlpAdapter,  // VideoInfoProvider
      ytDlpAdapter,  // VideoFormatSelector
      ytDlpAdapter,  // VideoDownloader
      fileManager,
      progressTracker,
      options
    );
  }
} 