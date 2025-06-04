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
    
    // Consolidated proxy and initialization logging
    if (this.proxyConfig.enabled) {
      console.log(`[YtDlpAdapter] Initialized with proxy: ${this.proxyConfig.host}:${this.proxyConfig.port}, userId: ${this.userId}, preferred language: ${this.preferredSubtitleLanguage}`);
    } else {
      console.log(`[YtDlpAdapter] Initialized with direct connection, userId: ${this.userId}, preferred language: ${this.preferredSubtitleLanguage}`);
    }
  }

  private getYtDlpArgs(baseArgs: string[], options: { includeFormatting?: boolean } = {}): string[] {
    // Common arguments that should always be included
    const args = [
      '--no-check-certificates',
      '--geo-bypass',
      '--no-playlist',
      '--ignore-errors',
      '--no-warnings',
      '--cookies', 
      'cookies.txt'
    ];

    // Add proxy if configured - do this early to help with rate limiting
    if (this.proxyUrl) {
      args.push('--proxy', this.proxyUrl);
    }

    // Add format-related arguments only when explicitly requested
    if (options.includeFormatting === true) {
      args.push(
        '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',  // Prefer m4a, then webm, then best audio
        '--extract-audio',
        '--audio-format', 'm4a',  // Convert to m4a
        '--audio-quality', '0',   // Best quality
      );
    }

    // Add base arguments
    args.push(...baseArgs);

    // Only log command type without detailed args to reduce log volume
    const commandType = baseArgs.includes('--write-sub') ? 'caption' : 
                       (baseArgs.includes('--dump-json') ? 'info' : 'download');
    const videoId = baseArgs[0].includes('=') ? baseArgs[0].split('=').pop() : 'unknown';
    console.log(`[YtDlpAdapter] Executing ${commandType} command for ${videoId}`);

    return args;
  }

  async getVideoInfo(videoId: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--dump-json',
        '--quiet',  // Suppress progress output
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
        // Only log actual errors, not warnings
        if (msg.includes('ERROR') || msg.includes('failed')) {
          console.error(`[YtDlpAdapter] stderr: ${msg.trim()}`);
        }
      });

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          console.error('[YtDlpAdapter] Failed to get video info:', stderr);
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Log raw output for debugging if it doesn't look like JSON
          if (!stdout.trim().startsWith('{')) {
            console.error('[YtDlpAdapter] Unexpected output format. Raw stdout:', stdout);
            reject(new Error('yt-dlp output is not in JSON format'));
            return;
          }

          const info = JSON.parse(stdout);
          
          // Validate required fields
          if (!info.id || !info.title) {
            console.error('[YtDlpAdapter] Missing required fields in video info');
            reject(new Error('Missing required fields in video info'));
            return;
          }

          // Handle case where we get a single format instead of an array
          const formats = Array.isArray(info.formats) ? info.formats : [info];

          // Use a shorter title version in logs
          const title = info.title.length > 40 ? info.title.substring(0, 40) + '...' : info.title;
          console.log(`[YtDlpAdapter] Retrieved info for: "${title}" (${formats.length} formats)`);
          
          resolve({
            id: info.id,
            title: info.title,
            formats: formats.map((f: any) => ({
              formatId: f.format_id,
              filesize: f.filesize || f.filesize_approx, // Add fallback to filesize_approx
              container: f.ext,
              quality: f.quality || f.format_note || 'unknown',
              audioOnly: !f.width && !f.height,
              videoOnly: !f.acodec || f.acodec === 'none',
              resolution: f.width && f.height ? `${f.width}x${f.height}` : undefined,
              fps: f.fps,
              vcodec: f.vcodec,
              acodec: f.acodec,
              abr: f.abr,
              vbr: f.vbr || f.tbr // Add fallback to tbr for video bitrate
            }))
          });
        } catch (error: unknown) {
          console.error('[YtDlpAdapter] Failed to parse video info:', error);
          reject(new Error(`Failed to parse yt-dlp output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  selectBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    // Only log a count of formats, not their details
    console.log(`[YtDlpAdapter] Selecting best audio format from ${formats.length} available formats`);

    // First try to find audio-only formats
    let audioFormats = formats.filter(f => f.audioOnly && f.acodec && f.acodec !== 'none');

    // If no audio-only formats, try formats that at least have audio
    if (audioFormats.length === 0) {
      audioFormats = formats.filter(f => !f.videoOnly && f.acodec && f.acodec !== 'none');
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

    // Log only the most important details of the selected format
    console.log(`[YtDlpAdapter] Selected format: ${selected.formatId}, ${selected.container}, bitrate: ${selected.abr || 'unknown'}`);

    return selected;
  }

  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use the provided output path directly
      console.log(`[YtDlpAdapter] Starting download for video ${videoId}`);
      const baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '-o', outputPath,
        '--newline',  // Ensure progress output is line-buffered
      ];

      const ytDlp = spawn('yt-dlp', this.getYtDlpArgs(baseArgs, { includeFormatting: format.audioOnly }));

      let stderr = '';
      let downloadCompleted = false;
      let finalOutputPath = outputPath; // Track the final output path which might change
      let lastProgressLog = 0; // Track when we last logged progress

      ytDlp.stderr.on('data', (data) => {
        const msg = data.toString();
        stderr += msg;
        // Only log serious errors, not warnings
        if (msg.includes('ERROR:') || msg.includes('Fatal error')) {
          console.error(`[YtDlpAdapter] stderr: ${msg.trim()}`);
        }
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
              size: parseFloat(size),
              sizeUnit,
              speed: parseFloat(speed),
              speedUnit
            });
          }
        }

        // Check for download completion message
        if (output.includes('[download] 100%') || output.includes('[ExtractAudio] Destination:')) {
          downloadCompleted = true;
        }
        
        // Check if yt-dlp is changing the output file destination
        const destinationMatch = output.match(/\[ExtractAudio\] Destination: (.+)/);
        if (destinationMatch) {
          finalOutputPath = destinationMatch[1].trim();
          console.log(`[YtDlpAdapter] Output path changed to: ${path.basename(finalOutputPath)}`);
        }

        // Only log non-progress output that's relevant for debugging
        if (!output.includes('%')) {
          // Filter out informational messages to reduce noise
          const isImportant = 
            output.includes('ERROR:') || 
            output.includes('Destination:') || 
            output.includes('Merging') ||
            output.includes('Deleting') ||
            output.includes('Post-process') ||
            output.includes('has already been downloaded');
            
          if (isImportant) {
            console.log(`[YtDlpAdapter] ${output.trim()}`);
          }
        }
      });

      ytDlp.on('close', async (code) => {
        if (code !== 0) {
          console.error('[YtDlpAdapter] Download failed:', stderr);
          reject(new Error(`yt-dlp failed with code ${code}: ${stderr}`));
          return;
        }

        // Add a small delay to ensure file system has finished writing
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try possible file paths in order
        const possiblePaths = [
          finalOutputPath, // First try the detected final path
          outputPath,      // Then the original output path
          `${outputPath}.m4a`, // Then with m4a extension
          `${outputPath}.mp3`  // Then with mp3 extension
        ];
        
        // Find the first file that exists
        let foundPath = null;
        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            foundPath = filePath;
            if (filePath !== outputPath && filePath !== finalOutputPath) {
              console.log(`[YtDlpAdapter] Found output at alternate path: ${path.basename(filePath)}`);
            }
            break;
          }
        }

        // Verify the file exists and has content
        try {
          if (!foundPath) {
            console.error(`[YtDlpAdapter] Output file not found. Checked paths:`, possiblePaths.map(p => path.basename(p)));
            reject(new Error(`Output file not found after checking multiple potential paths`));
            return;
          }

          const stats = fs.statSync(foundPath);
          if (stats.size === 0) {
            console.error(`[YtDlpAdapter] Output file is empty: ${path.basename(foundPath)}`);
            reject(new Error(`Output file is empty: ${foundPath}`));
            return;
          }

          if (!downloadCompleted) {
            console.error(`[YtDlpAdapter] Download did not complete successfully for ${path.basename(foundPath)}`);
            reject(new Error(`Download did not complete successfully for ${foundPath}`));
            return;
          }

          // If the foundPath is different from the expected outputPath, rename it
          if (foundPath !== outputPath) {
            try {
              console.log(`[YtDlpAdapter] Renaming ${path.basename(foundPath)} to ${path.basename(outputPath)}`);
              fs.renameSync(foundPath, outputPath);
            } catch (renameError) {
              console.error(`[YtDlpAdapter] Error renaming file:`, renameError);
              // Instead of failing, copy the file content
              try {
                console.log(`[YtDlpAdapter] Copying content to expected path`);
                fs.copyFileSync(foundPath, outputPath);
                fs.unlinkSync(foundPath); // Delete the original
              } catch (copyError) {
                console.error(`[YtDlpAdapter] Error copying file:`, copyError);
                reject(new Error(`Error ensuring file at correct path: ${copyError instanceof Error ? copyError.message : String(copyError)}`));
                return;
              }
            }
          }

          const fileSizeMB = Math.round(stats.size / 1024 / 1024 * 100) / 100;
          console.log(`[YtDlpAdapter] Download successful: ${fileSizeMB} MB`);
          resolve();
        } catch (error) {
          console.error(`[YtDlpAdapter] Error verifying output file:`, error);
          reject(new Error(`Error verifying output file: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  async downloadCaptions(videoId: string, language?: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Handle special language option for 'default' which gets video's primary language
      // Otherwise use provided language or fall back to preferred language
      const useDefault = language === 'default';
      const targetLanguage = useDefault ? '' : (language || this.preferredSubtitleLanguage);
      
      // Build yt-dlp command
      let baseArgs = [
        `https://www.youtube.com/watch?v=${videoId}`,
        '--write-sub',
        '--write-auto-sub',
        '--skip-download',
        '--sub-format', 'vtt',
        '--no-check-certificates',
        '--geo-bypass',
        '--ignore-errors',
        '--no-warnings',
        '-o', path.join(tempDir, '%(id)s.%(ext)s')
      ];

      // Add language parameter if needed
      if (!useDefault && targetLanguage) {
        console.log(`[YtDlpAdapter] Requesting captions for ${videoId} in language "${targetLanguage}"`);
        baseArgs.push('--sub-lang', targetLanguage);
      } else {
        console.log(`[YtDlpAdapter] Requesting default language captions for ${videoId}`);
      }

      // Execute yt-dlp command
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
          const files = fs.readdirSync(tempDir).filter(f => f.startsWith(videoId) && 
                                                           (f.endsWith('.vtt') || f.endsWith('.srt')));
          
          // Find appropriate subtitle file
          let subtitleFile = null;
          
          // For specific language, try to find that language first
          if (targetLanguage) {
            subtitleFile = files.find(f => 
              f.includes(`.${targetLanguage}.`) || f.includes(`.${targetLanguage}-auto.`)
            );
          }
          
          // If no specific match, use any available subtitle file
          if (!subtitleFile && files.length > 0) {
            subtitleFile = files[0];
          }
          
          if (!subtitleFile) {
            console.log(`[YtDlpAdapter] No captions found for ${videoId}`);
            resolve(null);
            return;
          }
          
          // Extract language from filename for logging
          const langMatch = subtitleFile.match(/\.([a-z]{2}(-[A-Z]{2})?)\./) || 
                            subtitleFile.match(/\.([a-z]{2}(-[A-Z]{2})?)-auto\./);
          const detectedLang = langMatch ? langMatch[1] : 'unknown';
          
          // Log success with detected language
          if (targetLanguage) {
            if (detectedLang === targetLanguage) {
              console.log(`[YtDlpAdapter] Found requested ${targetLanguage} captions for ${videoId}`);
            } else {
              console.log(`[YtDlpAdapter] Requested ${targetLanguage} not found, using ${detectedLang} captions instead for ${videoId}`);
            }
          } else {
            console.log(`[YtDlpAdapter] Using ${detectedLang} captions for ${videoId}`);
          }

          // Read and process subtitle file
          const subtitlePath = path.join(tempDir, subtitleFile);
          const content = fs.readFileSync(subtitlePath, 'utf-8');
          fs.unlinkSync(subtitlePath); // Clean up

          // Extract transcription
          const transcription = await this.captionService.extractTranscription(content, videoId);
          resolve(transcription);
        } catch (error) {
          console.error('[YtDlpAdapter] Failed to process subtitles:', error);
          reject(new Error(`Failed to process subtitles: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });
  }

  // Implement VideoDownloader interface methods
  async getInfo(videoUrl: string): Promise<VideoInfo> {
    const videoId = this.extractVideoId(videoUrl);
    return this.getVideoInfo(videoId);
  }

  async getFormats(videoUrl: string): Promise<VideoFormat[]> {
    const videoId = this.extractVideoId(videoUrl);
    const info = await this.getVideoInfo(videoId);
    return info.formats;
  }

  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    return this.selectBestAudioFormat(formats);
  }

  private extractVideoId(url: string): string {
    const match = url.match(/[?&]v=([^&]+)/);
    if (!match) throw new Error('Invalid YouTube URL');
    return match[1];
  }
} 