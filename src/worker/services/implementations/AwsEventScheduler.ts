import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventScheduler, SummaryGenerationEvent, ProcessingOptions } from '../interfaces/EventServices.js';
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
    const { userId, videoId, documentId, transcriptText, summaryType, processingOptions } = event;
    
    // Check if this summary type should be generated based on processing options
    if (processingOptions) {
      if (summaryType === 'short' && processingOptions.generateShortForm !== true) {
        console.log('Skipping short form summary generation as it is not explicitly enabled');
        return;
      }
      if (summaryType === 'long' && processingOptions.generateLongForm !== true) {
        console.log('Skipping long form summary generation as it is not explicitly enabled');
        return;
      }
    }
    
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
      summary_type: summaryType,
      processing_options: {
        generateAudio: processingOptions?.generateAudio ?? true, // Default to true if not specified
        ...processingOptions
      }
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