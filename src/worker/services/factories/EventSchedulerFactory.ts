import { EventScheduler } from '../interfaces/EventServices.js';
import { AwsEventScheduler } from '../implementations/AwsEventScheduler.js';
import { ConfigService } from '../ConfigService.js';

export class EventSchedulerFactory {
  static create(): EventScheduler {
    const configService = new ConfigService();
    return new AwsEventScheduler(configService);
  }
} 