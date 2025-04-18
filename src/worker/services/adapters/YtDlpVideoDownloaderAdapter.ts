import { VideoDownloaderInterface } from './VideoDownloaderInterface.js';
import { YtDlpAdapter } from './YtDlpAdapter.js';
import { VideoFormat, VideoInfo } from '../interfaces/VideoServices.js';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import fs from 'fs';

export class YtDlpVideoDownloaderAdapter implements VideoDownloaderInterface {
  private ytDlpAdapter: YtDlpAdapter;

  constructor() {
    this.ytDlpAdapter = new YtDlpAdapter();
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

  async downloadAudio(url: string, format: VideoFormat): Promise<NodeJS.ReadableStream> {
    const videoId = this.extractVideoId(url);
    const tempFilePath = `/tmp/${videoId}_${Date.now()}.${format.container}`;
    
    // Create a PassThrough stream that we'll use to pipe the data
    const passThrough = new PassThrough();

    try {
      // Start the download
      await this.ytDlpAdapter.downloadVideo(videoId, {
        formatId: format.formatId,
        container: format.container,
        quality: format.quality,
        audioOnly: true,
        videoOnly: false,
        acodec: format.acodec,
        vcodec: format.vcodec,
        abr: format.abr,
        vbr: format.vbr
      }, tempFilePath);

      // Once download is complete, read the file and pipe it to the stream
      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(passThrough);

      // Clean up the temporary file when the stream ends
      passThrough.on('end', () => {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error(`Error cleaning up temp file ${tempFilePath}:`, err);
        });
      });

      return passThrough;
    } catch (error) {
      passThrough.emit('error', error);
      throw error;
    }
  }

  async downloadCaptions(videoId: string): Promise<string | null> {
    // Delegate to the YtDlpAdapter's implementation
    return this.ytDlpAdapter.downloadCaptions(videoId);
  }

  private extractVideoId(url: string): string {
    const match = url.match(/[?&]v=([^&]+)/);
    if (!match) throw new Error('Invalid YouTube URL');
    return match[1];
  }
} 