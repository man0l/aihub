import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventScheduler, SummaryGenerationEvent } from '../interfaces/EventServices.js';

export class AwsEventScheduler implements EventScheduler {
  private readonly eventBridge: EventBridgeClient;

  constructor(region: string = 'eu-central-1') {
    this.eventBridge = new EventBridgeClient({ region });
  }

  async scheduleSummaryGeneration(
    event: SummaryGenerationEvent,
    delayMinutes: number = 0
  ): Promise<void> {
    try {
      // Calculate event time
      const eventTime = new Date();
      eventTime.setMinutes(eventTime.getMinutes() + delayMinutes);

      // Convert event to snake_case format
      const snakeCaseEvent = {
        user_id: event.userId,
        video_id: event.videoId,
        transcript_text: event.transcriptText,
        summary_type: event.summaryType
      };

      const command = new PutEventsCommand({
        Entries: [
          {
            Time: eventTime,
            Source: 'custom.transcription',
            DetailType: 'SummaryGenerationRequest',
            Detail: JSON.stringify(snakeCaseEvent),
            EventBusName: 'default'
          }
        ]
      });

      const response = await this.eventBridge.send(command);
      
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        throw new Error(`Failed to schedule event: ${JSON.stringify(response.Entries)}`);
      }

      console.log(`Scheduled ${event.summaryType} summary generation event for video ${event.videoId}`);
    } catch (error) {
      console.error('Error scheduling summary generation:', error);
      throw new Error(`Failed to schedule summary generation: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 