import { VideoDownloader } from '../interfaces/VideoServices.js';
import { YtdlAdapter } from './YtdlAdapter.js';
import { YtDlpVideoDownloaderAdapter } from './YtDlpVideoDownloaderAdapter.js';
import { DownloaderOptions } from '../interfaces/VideoServices.js';

export type DownloaderType = 'ytdl' | 'yt-dlp';

export class VideoDownloaderFactory {
  private static instance: VideoDownloaderFactory;
  private downloaders: Map<DownloaderType, VideoDownloader> = new Map();
  private options: DownloaderOptions;

  private constructor(options: DownloaderOptions = {}) {
    this.options = options;
    this.initializeDownloaders();
  }

  private initializeDownloaders() {
    this.downloaders.clear();
    this.downloaders.set('ytdl', new YtdlAdapter());
    this.downloaders.set('yt-dlp', new YtDlpVideoDownloaderAdapter(this.options));
  }

  public static getInstance(options: DownloaderOptions = {}): VideoDownloaderFactory {
    // If instance exists but userId is different, reinitialize downloaders
    if (VideoDownloaderFactory.instance && 
        VideoDownloaderFactory.instance.options.userId !== options.userId) {
      // Only log user ID changes when debugging is enabled
      if (process.env.DEBUG_DOWNLOADER === 'true') {
        console.log(`Updating VideoDownloaderFactory userId from ${VideoDownloaderFactory.instance.options.userId || 'none'} to ${options.userId || 'none'}`);
      }
      VideoDownloaderFactory.instance.options = options;
      VideoDownloaderFactory.instance.initializeDownloaders();
    }
    // If no instance exists, create one
    else if (!VideoDownloaderFactory.instance) {
      VideoDownloaderFactory.instance = new VideoDownloaderFactory(options);
    }
    return VideoDownloaderFactory.instance;
  }

  public getDownloader(type: DownloaderType = 'ytdl'): VideoDownloader {
    const downloader = this.downloaders.get(type);
    if (!downloader) {
      throw new Error(`Video downloader type '${type}' not found`);
    }
    return downloader;
  }
} 