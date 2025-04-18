import { CaptionParserFactory } from './interfaces/CaptionServices.js';
import { EventSchedulerFactory } from './factories/EventSchedulerFactory.js';
import { SummaryType } from './interfaces/EventServices.js';

export class CaptionService {
  constructor(
    private readonly parserFactory: CaptionParserFactory,
    private readonly userId?: string
  ) {}

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

      // If we have both userId and videoId, schedule summary generation
      if (this.userId && videoId && transcription) {
        await this.scheduleSummaryGeneration(videoId, transcription);
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
      const eventScheduler = EventSchedulerFactory.create();

      // Schedule short summary immediately
      await eventScheduler.scheduleSummaryGeneration({
        userId: this.userId!,
        videoId,
        transcriptText,
        summaryType: 'short'
      });

      // Schedule long summary with a delay
      await eventScheduler.scheduleSummaryGeneration({
        userId: this.userId!,
        videoId,
        transcriptText,
        summaryType: 'long'
      }, 1); // 1 minute delay for long summary

      console.log(`Scheduled summary generation events for video ${videoId}`);
    } catch (error) {
      console.error('Failed to schedule summary generation:', error);
      // Don't throw the error as this is a non-critical operation
    }
  }
} 