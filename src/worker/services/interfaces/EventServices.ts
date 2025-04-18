export type SummaryType = 'short' | 'long';

export interface ProcessingOptions {
  generateShortForm?: boolean;
  generateLongForm?: boolean;
  generateAudio?: boolean;
}

export interface SummaryGenerationEvent {
  userId: string;
  videoId?: string;
  documentId?: string;
  transcriptText: string;
  summaryType: SummaryType;
  processingOptions?: ProcessingOptions;
}

export interface EventScheduler {
  scheduleSummaryGeneration(
    event: SummaryGenerationEvent,
    delayMinutes?: number
  ): Promise<void>;
} 