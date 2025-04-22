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

export interface YtDlpOptions extends DownloaderOptions {
  preferredSubtitleLanguage?: string;  // e.g., 'en', 'bg', etc.
}

export class YtDlpAdapter implements VideoInfoProvider, VideoFormatSelector, VideoDownloader {
  private readonly userId?: string;
  private readonly proxyUrl?: string;
  private readonly proxyConfig: ReturnType<typeof getProxyConfig>;
  private readonly preferredSubtitleLanguage: string;

  constructor(
    private readonly options: YtDlpOptions = {},
    private readonly captionService: CaptionService
  ) {
    this.userId = options.userId;
    this.proxyConfig = getProxyConfig();
    this.proxyUrl = getProxyUrl();
    this.preferredSubtitleLanguage = options.preferredSubtitleLanguage || 'en';
    
    // Enhanced proxy logging
    if (this.proxyConfig.enabled) {
      console.log(`[YtDlpAdapter] Proxy enabled - Using ${this.proxyConfig.host}:${this.proxyConfig.port}`);
      console.log(`[YtDlpAdapter] Using rotating proxy with username: ${this.proxyConfig.username}`);
    } else {
      console.log('[YtDlpAdapter] Proxy disabled - Using direct connection');
    }
    console.log(`[YtDlpAdapter] Initialized with userId: ${this.userId}`);
    console.log(`[YtDlpAdapter] Preferred subtitle language: ${this.preferredSubtitleLanguage}`);
  }

  private getYtDlpArgs(baseArgs: string[], options: { includeFormatting?: boolean } = {}): string[] {
    // Common arguments that should always be included
    const args = [
      '--no-check-certificates',
      '--geo-bypass',
      '--no-playlist',
      '--ignore-errors',
      '--no-warnings',
    ];

    // Add proxy if configured - do this early to help with rate limiting
    if (this.proxyUrl) {
      console.log(`[YtDlpAdapter] Adding proxy arguments to yt-dlp command`);
      args.push('--proxy', this.proxyUrl);
    }

    // Add format-related arguments only when explicitly requested
    if (options.includeFormatting === true) {
      args.push(
        '--format', 'bestaudio[ext=m4a]/bestaudio/best',  // Prefer m4a audio, fallback to best audio, then any format
        '--extract-audio',  // Extract audio from video
        '--audio-format', 'mp3',  // Convert to mp3
        '--audio-quality', '0',  // Best quality
      );
    }

    // Add base arguments
    args.push(...baseArgs);

    // Log the final command for debugging
    const cmdString = ['yt-dlp', ...args].join(' ');
    console.log(`[YtDlpAdapter] Executing command: ${cmdString}`);

    return args;
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--dump-json',
        '--no-quiet',  // We want to see any errors
      ];

      console.log(`[YtDlpAdapter] Getting video info for ${videoId}`);
      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs, { includeFormatting: false }));

      let stdout = '';
      let stderr = '';

      ytDlp.stdout.on('data', (data) => {
        stdout += data;
      });

      ytDlp.stderr.on('data', (data) => {
        const msg = data.toString();
        stderr += msg;
        // Log stderr in real-time for better debugging
        console.error(`[YtDlpAdapter] stderr: ${msg.trim()}`);
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          console.error('[YtDlpAdapter] Failed to get video info:', stderr);
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          const info = JSON.parse(stdout);
          console.log(`[YtDlpAdapter] Successfully retrieved info for video: ${info.title}`);
          console.log(`[YtDlpAdapter] Available formats: ${info.formats?.length || 0}`);
          
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
          console.error('[YtDlpAdapter] Failed to parse video info:', error);
          console.error('[YtDlpAdapter] Raw stdout:', stdout);
          reject(new Error(`Failed to parse yt-dlp output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  selectBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    // Log all available formats
    console.log('[YtDlpAdapter] Available formats:', formats.map(f => ({
      formatId: f.formatId,
      container: f.container,
      quality: f.quality,
      audioOnly: f.audioOnly,
      videoOnly: f.videoOnly,
      acodec: f.acodec,
      abr: f.abr
    })));

    // First try to find audio-only formats
    let audioFormats = formats.filter(f => f.audioOnly && f.acodec && f.acodec !== 'none');
    console.log(`[YtDlpAdapter] Found ${audioFormats.length} audio-only formats`);

    // If no audio-only formats, try formats that at least have audio
    if (audioFormats.length === 0) {
      audioFormats = formats.filter(f => !f.videoOnly && f.acodec && f.acodec !== 'none');
      console.log(`[YtDlpAdapter] Found ${audioFormats.length} formats with audio (including combined formats)`);
    }

    if (audioFormats.length === 0) {
      console.log('[YtDlpAdapter] No suitable audio formats found');
      return null;
    }

    // Sort by quality and bitrate
    const selected = audioFormats.sort((a, b) => {
      // Prefer higher bitrate
      if (a.abr && b.abr) {
        return b.abr - a.abr;
      }
      // If bitrates are not available, use quality
      if (a.quality === b.quality) {
        return (a.filesize || Infinity) - (b.filesize || Infinity);
      }
      return a.quality === 'tiny' ? -1 : 1;
    })[0];

    console.log('[YtDlpAdapter] Selected audio format:', {
      formatId: selected.formatId,
      container: selected.container,
      quality: selected.quality,
      audioOnly: selected.audioOnly,
      acodec: selected.acodec,
      abr: selected.abr
    });

    return selected;
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
        '-o', outputPath,
        '--newline',  // Ensure progress output is line-buffered
      ];

      console.log(`[YtDlpAdapter] Starting download for video ${videoId} to ${outputPath}`);
      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs, { includeFormatting: true }));

      let stderr = '';

      ytDlp.stderr.on('data', (data) => {
        const msg = data.toString();
        stderr += msg;
        console.error(`[YtDlpAdapter] stderr: ${msg.trim()}`);
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
        // Log any non-progress output
        if (!output.includes('%')) {
          console.log(`[YtDlpAdapter] stdout: ${output.trim()}`);
        }
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          const error = new Error(`yt-dlp failed with code ${code}: ${stderr}`);
          console.error('[YtDlpAdapter] Download failed:', error);
          reject(error);
          return;
        }
        console.log(`[YtDlpAdapter] Successfully downloaded video ${videoId}`);
        resolve();
      });
    });
  }

  async downloadCaptions(videoId: string, language?: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Use provided language or fall back to preferred language
      const targetLanguage = language || this.preferredSubtitleLanguage;
      console.log(`[YtDlpAdapter] Attempting to download captions in ${targetLanguage}`);

      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang', targetLanguage,
        '--skip-download',
        '--sub-format', 'vtt',
        '--no-check-certificates',
        '--geo-bypass',
        '--ignore-errors',
        '--no-warnings',
        '-o', path.join(tempDir, '%(id)s.%(ext)s')
      ];

      // If target language isn't English, also try English as fallback
      if (targetLanguage !== 'en') {
        baseArgs.push('--sub-lang-fallback', 'en');
      }

      console.log('[YtDlpAdapter] Attempting to download captions with args:', baseArgs);
      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs));

      let stderr = '';

      ytDlp.stderr.on('data', (data) => {
        const msg = data.toString();
        stderr += msg;
        if (msg.includes('Sign in to confirm')) {
          console.log('[YtDlpAdapter] Detected bot check during caption download');
        }
      });

      ytDlp.on('close', async (code) => {
        if (code !== 0) {
          console.error('[YtDlpAdapter] Caption download failed:', stderr);
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Look for the subtitle file
          const files = fs.readdirSync(tempDir);
          
          // First try to find subtitles in target language
          let subtitleFile = files.find(f => 
            f.startsWith(videoId) && 
            (f.includes(`.${targetLanguage}.`) || f.includes(`.${targetLanguage}-auto.`)) && 
            (f.endsWith('.vtt') || f.endsWith('.srt'))
          );

          // If not found and target language isn't English, try English
          if (!subtitleFile && targetLanguage !== 'en') {
            subtitleFile = files.find(f => 
              f.startsWith(videoId) && 
              (f.includes('.en.') || f.includes('.en-auto.')) && 
              (f.endsWith('.vtt') || f.endsWith('.srt'))
            );
          }
          
          if (!subtitleFile) {
            console.log(`[YtDlpAdapter] No subtitle file found for languages: ${targetLanguage}${targetLanguage !== 'en' ? ', en' : ''}`);
            resolve(null);
            return;
          }

          console.log('[YtDlpAdapter] Found subtitle file:', subtitleFile);

          // Read and parse the subtitle file
          const subtitlePath = path.join(tempDir, subtitleFile);
          const content = fs.readFileSync(subtitlePath, 'utf-8');
          
          // Clean up the temp file
          fs.unlinkSync(subtitlePath);

          // Use our CaptionService to extract clean transcription
          const transcription = await this.captionService.extractTranscription(content, videoId);
          resolve(transcription);
        } catch (error) {
          console.error('[YtDlpAdapter] Failed to process subtitles:', error);
          reject(new Error(`Failed to process subtitles: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }
} 