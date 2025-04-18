import { CaptionParserFactory } from './interfaces/CaptionServices.js';
import { EventSchedulerFactory } from './factories/EventSchedulerFactory.js';
import { SummaryType } from './interfaces/EventServices.js';

export class CaptionService {
  constructor(
    private readonly parserFactory: CaptionParserFactory,
    private readonly userId?: string
  ) {
    console.log(`CaptionService initialized with userId: ${userId}`);
  }

  /**
   * Extracts clean transcription text from caption content and schedules summary generation
   * @param content Raw caption content (VTT, SRT, etc.)
   * @param videoId Optional video ID for scheduling summary generation
   * @returns Clean transcription text without timestamps and formatting
   */
  async extractTranscription(content: string, videoId?: string): Promise<string> {
    try {
      const parser = this.parserFactory.getParser(content);
      const transcription = parser.parse(content);

      // Debug log to check userId value
      console.log('CaptionService.extractTranscription - Current userId:', this.userId);

      // If we have both userId and videoId, schedule summary generation
      if (this.userId && videoId && transcription) {
        console.log(`Attempting to schedule summary generation for video ${videoId} with userId ${this.userId}`);
        await this.scheduleSummaryGeneration(videoId, transcription);
      } else {
        console.log(`Skipping summary scheduling - missing requirements:`, {
          hasUserId: !!this.userId,
          userId: this.userId, // Add actual userId for debugging
          hasVideoId: !!videoId,
          hasTranscription: !!transcription,
          transcriptionLength: transcription?.length || 0
        });
      }

      return transcription;
    } catch (error) {
      console.error('Failed to parse captions:', error);
      return '';
    }
  }

  /**
   * Schedules both short and long summary generation events
   */
  private async scheduleSummaryGeneration(videoId: string, transcriptText: string): Promise<void> {
    try {
      console.log(`Creating event scheduler for video ${videoId} with userId ${this.userId}`);
      const eventScheduler = EventSchedulerFactory.create();

      // Schedule short summary immediately
      console.log(`Scheduling short summary for video ${videoId}`);
      await eventScheduler.scheduleSummaryGeneration({
        userId: this.userId!,
        videoId,
        transcriptText,
        summaryType: 'short'
      });

      // Schedule long summary with a delay
      console.log(`Scheduling long summary for video ${videoId}`);
      await eventScheduler.scheduleSummaryGeneration({
        userId: this.userId!,
        videoId,
        transcriptText,
        summaryType: 'long'
      }, 1); // 1 minute delay for long summary

      console.log(`Successfully scheduled both summary generation events for video ${videoId}`);
    } catch (error) {
      console.error('Failed to schedule summary generation:', error);
      // Don't throw the error as this is a non-critical operation
    }
  }
} 