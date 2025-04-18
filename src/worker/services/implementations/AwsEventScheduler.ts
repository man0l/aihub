import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventScheduler, SummaryGenerationEvent } from '../interfaces/EventServices.js';
import { ConfigService } from '../ConfigService.js';

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

    const detailType = `summary.generation.${summaryType}`;
    const eventTime = new Date();

    if (delayMinutes > 0) {
      eventTime.setMinutes(eventTime.getMinutes() + delayMinutes);
    }

    console.log(`Scheduling ${summaryType} summary generation for ${sourceType} ${sourceId} at ${eventTime.toISOString()}`);

    const putCommand = new PutEventsCommand({
      Entries: [
        {
          EventBusName: this.eventBusName,
          Source: 'ai-knowledge-hub',
          DetailType: detailType,
          Time: eventTime,
          Detail: JSON.stringify({
            userId,
            sourceType,
            sourceId,
            transcriptText,
            summaryType,
          }),
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