import ytdl from '@distube/ytdl-core';
import { VideoDownloaderInterface } from './VideoDownloaderInterface.js';
import { VideoFormat, VideoInfo } from '../interfaces/VideoServices.js';

export class YtdlAdapter implements VideoDownloaderInterface {
  async getInfo(videoUrl: string): Promise<VideoInfo> {
    const info = await ytdl.getInfo(videoUrl);
    
    return {
      id: info.videoDetails.videoId,
      title: info.videoDetails.title,
      formats: info.formats.map(format => ({
        formatId: format.itag.toString(),
        container: format.container || 'unknown',
        quality: format.quality || 'unknown',
        audioOnly: format.hasAudio && !format.hasVideo,
        videoOnly: format.hasVideo && !format.hasAudio,
        acodec: format.audioCodec,
        vcodec: format.videoCodec,
        abr: format.audioBitrate,
        vbr: format.bitrate
      }))
    };
  }

  async getFormats(videoUrl: string): Promise<VideoFormat[]> {
    const info = await ytdl.getInfo(videoUrl);
    return info.formats.map(format => ({
      formatId: format.itag.toString(),
      container: format.container || 'unknown',
      quality: format.quality || 'unknown',
      audioOnly: format.hasAudio && !format.hasVideo,
      videoOnly: format.hasVideo && !format.hasAudio,
      acodec: format.audioCodec,
      vcodec: format.videoCodec,
      abr: format.audioBitrate,
      vbr: format.bitrate
    }));
  }

  getBestAudioFormat(formats: VideoFormat[]): VideoFormat | null {
    const audioFormats = formats.filter(f => f.audioOnly);
    if (audioFormats.length === 0) return null;

    // Sort by bitrate (highest first) if available
    return audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
  }

  async downloadAudio(url: string, format: VideoFormat): Promise<NodeJS.ReadableStream> {
    if (!format.formatId) throw new Error('Format ID is missing');
    const stream = ytdl(url, {
      quality: format.formatId,
      filter: 'audioonly'
    });
    return stream;
  }
} 