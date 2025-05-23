import { WriteStream } from 'fs';

export interface VideoFormat {
  formatId: string;
  filesize?: number;
  container: string;
  quality: string;
  audioOnly: boolean;
  videoOnly: boolean;
  resolution?: string;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  abr?: number;
  vbr?: number;
  url?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
}

export interface VideoInfo {
  id: string;
  title: string;
  formats: VideoFormat[];
  author?: {
    name: string;
  };
  videoId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface DownloadProgress {
  percent: number;
  size: number;
  sizeUnit: string;
  speed: number;
  speedUnit: string;
}

export interface VideoInfoProvider {
  getVideoInfo(videoId: string): Promise<VideoInfo>;
}

export interface VideoFormatSelector {
  selectBestAudioFormat(formats: VideoFormat[]): VideoFormat | null;
}

export interface VideoDownloader {
  getInfo(videoUrl: string): Promise<VideoInfo>;
  getFormats(videoUrl: string): Promise<VideoFormat[]>;
  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null;
  downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void>;
  downloadCaptions(videoId: string, language?: string): Promise<string | null>;
}

export interface FileManager {
  ensureDirectory(dir: string): void;
  createWriteStream(path: string): WriteStream;
  cleanup(path: string): void;
  exists(path: string): boolean;
}

export interface ProgressTracker {
  onProgress(bytesDownloaded: number, totalBytes?: number): void;
  onComplete(totalBytes: number): void;
  onError(error: Error): void;
}

export interface DownloaderOptions {
  timeout?: number;
  maxRetries?: number;
  preferredFormat?: string;
  userId?: string;
}

export interface TranscriptionProvider {
  fetchTranscription(videoId: string): Promise<string | null>;
  parseTranscriptionData(data: string): string;
} 