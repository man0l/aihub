import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import {
  VideoInfoProvider,
  VideoFormatSelector,
  VideoDownloader,
  VideoFormat,
  VideoInfo,
  DownloadProgress,
  DownloaderOptions
} from '../interfaces/VideoServices.js';

export class YtDlpAdapter implements VideoInfoProvider, VideoFormatSelector, VideoDownloader {
  private options: DownloaderOptions;

  constructor(options: DownloaderOptions = {}) {
    this.options = options;
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--dump-json',
        '--no-playlist'
      ]);

      let stdout = '';
      let stderr = '';

      ytDlp.stdout.on('data', (data) => {
        stdout += data;
      });

      ytDlp.stderr.on('data', (data) => {
        stderr += data;
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const info = JSON.parse(stdout);
          resolve({
            id: info.id,
            title: info.title,
            formats: info.formats.map((f: any) => ({
              formatId: f.format_id,
              filesize: f.filesize,
              container: f.ext,
              quality: f.quality || 'unknown',
              audioOnly: !f.width && !f.height,
              videoOnly: !f.acodec || f.acodec === 'none',
              resolution: f.width && f.height ? `${f.width}x${f.height}` : undefined,
              fps: f.fps,
              vcodec: f.vcodec,
              acodec: f.acodec,
              abr: f.abr,
              vbr: f.vbr
            }))
          });
        } catch (error: unknown) {
          reject(new Error(`Failed to parse yt-dlp output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  selectBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    const audioFormats = formats.filter(f => f.audioOnly);
    if (audioFormats.length === 0) return null;

    // Sort by quality (higher is better) and filesize (smaller is better)
    return audioFormats.sort((a, b) => {
      if (a.quality === b.quality) {
        return (a.filesize || Infinity) - (b.filesize || Infinity);
      }
      return a.quality === 'tiny' ? -1 : 1;
    })[0];
  }

  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-f', format.formatId,
        '-o', outputPath,
        '--no-playlist',
        '--newline'
      ]);

      let stderr = '';

      ytDlp.stderr.on('data', (data) => {
        stderr += data;
      });

      ytDlp.stdout.on('data', (data) => {
        const output = data.toString();
        if (onProgress) {
          // Parse progress information from yt-dlp output
          const progressMatch = output.match(/(\d+\.\d+)% of ~?\s*(\d+\.\d+)(\w+) at\s*(\d+\.\d+)(\w+)\/s/);
          if (progressMatch) {
            const [, percent, size, sizeUnit, speed, speedUnit] = progressMatch;
            onProgress({
              percent: parseFloat(percent),
              downloaded: 0, // We don't get this info directly from yt-dlp
              total: parseFloat(size),
              speed: parseFloat(speed)
            });
          }
        }
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }
        resolve();
      });
    });
  }
} 