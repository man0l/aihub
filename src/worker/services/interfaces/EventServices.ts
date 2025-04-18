export type SummaryType = 'short' | 'long';

export interface SummaryGenerationEvent {
  userId: string;
  videoId: string;
  transcriptText: string;
  summaryType: SummaryType;
}

export interface EventScheduler {
  scheduleSummaryGeneration(
    event: SummaryGenerationEvent,
    delayMinutes?: number
  ): Promise<void>;
} 