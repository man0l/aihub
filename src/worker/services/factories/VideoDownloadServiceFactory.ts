import { VideoDownloadService } from '../VideoDownloadService.js';
import { YtDlpAdapter } from '../adapters/YtDlpAdapter.js';
import { FileManagerImpl } from '../implementations/FileManagerImpl.js';
import { ConsoleProgressTracker } from '../implementations/ConsoleProgressTracker.js';
import { DownloaderOptions } from '../interfaces/VideoServices.js';
import { CaptionService } from '../CaptionService.js';
import { DefaultCaptionParserFactory } from './CaptionParserFactory.js';

export class VideoDownloadServiceFactory {
  public static create(options: DownloaderOptions = {}): VideoDownloadService {
    const captionService = new CaptionService(new DefaultCaptionParserFactory(), options.userId);
    const ytDlpAdapter = new YtDlpAdapter(options, captionService);
    const fileManager = new FileManagerImpl();
    const progressTracker = new ConsoleProgressTracker();

    return new VideoDownloadService(
      ytDlpAdapter,
      ytDlpAdapter,
      ytDlpAdapter,
      fileManager,
      progressTracker,
      captionService
    );
  }
}