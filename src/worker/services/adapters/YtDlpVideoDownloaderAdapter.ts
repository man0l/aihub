import { VideoDownloader } from '../interfaces/VideoServices.js';
import { YtDlpAdapter } from './YtDlpAdapter.js';
import { VideoFormat, VideoInfo, DownloadProgress } from '../interfaces/VideoServices.js';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import { DownloaderOptions } from '../interfaces/VideoServices.js';
import { CaptionService } from '../CaptionService.js';
import { DefaultCaptionParserFactory } from '../factories/CaptionParserFactory.js';

export class YtDlpVideoDownloaderAdapter implements VideoDownloader {
  private ytDlpAdapter: YtDlpAdapter;
  private readonly userId?: string;

  constructor(private readonly options: DownloaderOptions = {}) {
    this.userId = options.userId;
    // Only log details when debugging is enabled
    if (process.env.DEBUG_DOWNLOADER === 'true') {
      console.log(`YtDlpVideoDownloaderAdapter initialized with userId: ${this.userId || 'none'}`);
    }
    const captionService = new CaptionService(new DefaultCaptionParserFactory(), this.userId);
    this.ytDlpAdapter = new YtDlpAdapter(options, captionService);
  }

  async getInfo(videoUrl: string): Promise<VideoInfo> {
    const videoId = this.extractVideoId(videoUrl);
    const info = await this.ytDlpAdapter.getVideoInfo(videoId);
    return {
      id: info.id,
      title: info.title,
      formats: info.formats.map(f => ({
        formatId: f.formatId,
        container: f.container,
        quality: f.quality,
        audioOnly: f.audioOnly,
        videoOnly: f.videoOnly,
        acodec: f.acodec,
        vcodec: f.vcodec,
        abr: f.abr,
        vbr: f.vbr
      }))
    };
  }

  async getFormats(videoUrl: string): Promise<VideoFormat[]> {
    const videoId = this.extractVideoId(videoUrl);
    const info = await this.ytDlpAdapter.getVideoInfo(videoId);
    return info.formats.map(f => ({
      formatId: f.formatId,
      container: f.container,
      quality: f.quality,
      audioOnly: f.audioOnly,
      videoOnly: f.videoOnly,
      acodec: f.acodec,
      vcodec: f.vcodec,
      abr: f.abr,
      vbr: f.vbr
    }));
  }

  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    const audioFormats = formats.filter(f => f.audioOnly);
    if (audioFormats.length === 0) return null;

    // Sort by audio bitrate (higher is better)
    return audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  }

  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    return this.ytDlpAdapter.downloadVideo(videoId, format, outputPath, onProgress);
  }

  async downloadCaptions(videoId: string, language?: string): Promise<string | null> {
    // Delegate to the YtDlpAdapter's implementation
    return this.ytDlpAdapter.downloadCaptions(videoId, language);
  }

  private extractVideoId(url: string): string {
    const match = url.match(/[?&]v=([^&]+)/);
    if (!match) throw new Error('Invalid YouTube URL');
    return match[1];
  }
} 