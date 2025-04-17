import { VideoDownloaderInterface } from './VideoDownloaderInterface.js';
import { YtdlAdapter } from './YtdlAdapter.js';
import { YtDlpVideoDownloaderAdapter } from './YtDlpVideoDownloaderAdapter.js';

export type DownloaderType = 'ytdl' | 'yt-dlp';

export class VideoDownloaderFactory {
  private static instance: VideoDownloaderFactory;
  private downloaders: Map<DownloaderType, VideoDownloaderInterface>;

  private constructor() {
    this.downloaders = new Map();
    this.downloaders.set('ytdl', new YtdlAdapter());
    this.downloaders.set('yt-dlp', new YtDlpVideoDownloaderAdapter());
  }

  public static getInstance(): VideoDownloaderFactory {
    if (!VideoDownloaderFactory.instance) {
      VideoDownloaderFactory.instance = new VideoDownloaderFactory();
    }
    return VideoDownloaderFactory.instance;
  }

  public getDownloader(type: DownloaderType = 'ytdl'): VideoDownloaderInterface {
    const downloader = this.downloaders.get(type);
    if (!downloader) {
      throw new Error(`Video downloader type '${type}' not found`);
    }
    return downloader;
  }
} 