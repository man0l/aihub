import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import fs from 'fs';
import path from 'path';
import {
  VideoInfoProvider,
  VideoFormatSelector,
  VideoDownloader,
  VideoFormat,
  VideoInfo,
  DownloadProgress,
  DownloaderOptions
} from '../interfaces/VideoServices.js';
import { CaptionService } from '../CaptionService.js';
import { getProxyUrl, getProxyConfig } from '../config/ProxyConfig.js';

export class YtDlpAdapter implements VideoInfoProvider, VideoFormatSelector, VideoDownloader {
  private readonly userId?: string;
  private readonly proxyUrl?: string;
  private readonly proxyConfig: ReturnType<typeof getProxyConfig>;

  constructor(
    private readonly options: DownloaderOptions = {},
    private readonly captionService: CaptionService
  ) {
    this.userId = options.userId;
    this.proxyConfig = getProxyConfig();
    this.proxyUrl = getProxyUrl();
    
    // Enhanced proxy logging
    if (this.proxyConfig.enabled) {
      console.log(`[YtDlpAdapter] Proxy enabled - Using ${this.proxyConfig.host}:${this.proxyConfig.port}`);
      console.log(`[YtDlpAdapter] Using rotating proxy with username: ${this.proxyConfig.username}`);
    } else {
      console.log('[YtDlpAdapter] Proxy disabled - Using direct connection');
    }
    console.log(`[YtDlpAdapter] Initialized with userId: ${this.userId}`);
  }

  private getYtDlpArgs(baseArgs: string[]): string[] {
    const args = [...baseArgs];
    if (this.proxyUrl) {
      console.log(`[YtDlpAdapter] Adding proxy arguments to yt-dlp command`);
      args.push('--proxy', this.proxyUrl);
    }
    return args;
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--dump-json',
        '--no-playlist'
      ];

      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs));

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
      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-f', format.formatId,
        '-o', outputPath,
        '--no-playlist',
        '--newline'
      ];

      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs));

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

  async downloadCaptions(videoId: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang', 'en',
        '--skip-download',
        '--sub-format', 'vtt',
        '-o', path.join(tempDir, '%(id)s.%(ext)s')
      ];

      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs));

      let stderr = '';

      ytDlp.stderr.on('data', (data) => {
        stderr += data;
      });

      ytDlp.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Look for the subtitle file
          const files = fs.readdirSync(tempDir);
          const subtitleFile = files.find(f => f.startsWith(videoId) && (f.endsWith('.vtt') || f.endsWith('.srt')));
          
          if (!subtitleFile) {
            resolve(null);
            return;
          }

          // Read and parse the subtitle file
          const subtitlePath = path.join(tempDir, subtitleFile);
          const content = fs.readFileSync(subtitlePath, 'utf-8');
          
          // Clean up the temp file
          fs.unlinkSync(subtitlePath);

          // Use our CaptionService to extract clean transcription
          const transcription = await this.captionService.extractTranscription(content, videoId);
          resolve(transcription);
        } catch (error) {
          reject(new Error(`Failed to process subtitles: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }
} 