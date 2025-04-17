export interface VideoInfo {
  title: string;
  author: {
    name: string;
  };
  videoId: string;
  videoUrl: string;
  thumbnailUrl: string;
  player_response?: {
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          languageCode: string;
          name?: {
            simpleText?: string;
          };
          baseUrl?: string;
        }>;
      };
    };
  };
}

export interface VideoFormat {
  quality: string;
  container: string;
  codecs?: string;
  bitrate?: number;
  url?: string;
  hasAudio: boolean;
  hasVideo: boolean;
} 