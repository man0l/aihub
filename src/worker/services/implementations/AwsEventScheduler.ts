import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventScheduler, SummaryGenerationEvent } from '../interfaces/EventServices.js';
import { ConfigService } from '../ConfigService.js';
import { formatISO } from 'date-fns';

export class AwsEventScheduler implements EventScheduler {
  private client: EventBridgeClient;
  private eventBusName: string;

  constructor(private configService: ConfigService) {
    // Get AWS configuration from the storage config
    const storageConfig = this.configService.getStorageConfig();
    const region = storageConfig.region;

    this.client = new EventBridgeClient({
      region,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    });

    // Use a default event bus name or get it from environment
    this.eventBusName = process.env.AWS_EVENT_BUS_NAME || 'default';
    console.log(`Using event bus: ${this.eventBusName}`);
  }

  async scheduleSummaryGeneration(
    event: SummaryGenerationEvent,
    delayMinutes = 0
  ): Promise<void> {
    const { userId, videoId, documentId, transcriptText, summaryType } = event;
    
    const sourceType = videoId ? 'video' : 'document';
    const sourceId = videoId || documentId;
    
    if (!sourceId) {
      throw new Error('Either videoId or documentId must be provided');
    }

    // Use "SummaryGenerationRequest" as the detail type to match existing rule
    const detailType = "SummaryGenerationRequest";
    const eventTime = new Date(Date.now() + delayMinutes * 60000);

    console.log(`Scheduling ${summaryType} summary generation for ${sourceType} ${sourceId} at ${formatISO(eventTime)}`);

    // Create the event detail
    const eventDetail = {
      user_id: userId,
      video_id: sourceId,
      transcript_text: transcriptText,
      summary_type: summaryType
    };

    const putCommand = new PutEventsCommand({
      Entries: [
        {
          EventBusName: this.eventBusName,
          Source: "custom.transcription",
          DetailType: detailType,
          Time: eventTime,
          Detail: JSON.stringify(eventDetail),
        },
      ],
    });

    try {
      const response = await this.client.send(putCommand);
      console.log(`Event scheduled successfully: ${JSON.stringify(response)}`);
    } catch (error) {
      console.error(`Failed to schedule event: ${error}`);
      throw error;
    }
  }
} 