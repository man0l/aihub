export type VideoSource = {
  url: string;
  type: 'video' | 'playlist' | 'channel';
};

export type DocumentType = 'brief' | 'sop' | 'wiki';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'error';

export interface ProcessingResult {
  id: string;
  title: string;
  status: ProcessingStatus;
  error?: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  category: string;
}

export interface ProcessingOptions {
  generateShortForm?: boolean;
  generateLongForm?: boolean;
  generateAudio?: boolean;
  collectionId?: string;
  category?: string;
}

export interface Summary {
  text: string;
  audioUrl?: string;
}

export interface DocumentSummaries {
  shortForm?: Summary;
  longForm?: Summary;
}