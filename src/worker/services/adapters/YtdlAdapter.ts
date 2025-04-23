import ytdl from '@distube/ytdl-core';
import { VideoDownloader } from '../interfaces/VideoServices.js';
import { VideoFormat, VideoInfo, DownloadProgress } from '../interfaces/VideoServices.js';
import fs from 'fs';
import { pipeline } from 'stream/promises';

export class YtdlAdapter implements VideoDownloader {
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

  async downloadVideo(
    videoId: string,
    format: VideoFormat,
    outputPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    if (!format.formatId) throw new Error('Format ID is missing');

    const stream = ytdl(url, {
      quality: format.formatId,
      filter: format.audioOnly ? 'audioonly' : undefined
    });

    // Create write stream
    const writer = fs.createWriteStream(outputPath);

    // Track download progress
    let totalBytes = 0;
    let downloadedBytes = 0;

    stream.once('response', (res) => {
      totalBytes = parseInt(res.headers['content-length'] || '0', 10);
    });

    stream.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      if (onProgress && totalBytes > 0) {
        const percent = (downloadedBytes / totalBytes) * 100;
        const size = totalBytes / (1024 * 1024); // Convert to MB
        onProgress({
          percent,
          size,
          sizeUnit: 'MB',
          speed: 0, // ytdl doesn't provide speed info
          speedUnit: 'MB/s'
        });
      }
    });

    // Use pipeline to properly handle the stream
    await pipeline(stream, writer);
  }

  async downloadCaptions(videoId: string): Promise<string | null> {
    // Basic implementation that returns no captions
    return null;
  }
} 