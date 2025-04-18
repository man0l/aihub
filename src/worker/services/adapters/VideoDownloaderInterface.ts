import { VideoFormat, VideoInfo } from '../interfaces/VideoServices.js';

export interface VideoDownloaderInterface {
  getInfo(videoUrl: string): Promise<VideoInfo>;
  getFormats(videoUrl: string): Promise<VideoFormat[]>;
  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null;
  downloadAudio(url: string, format: VideoFormat): Promise<NodeJS.ReadableStream>;
  downloadCaptions(videoId: string): Promise<string | null>;
} 