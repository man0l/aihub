import { EventScheduler } from '../interfaces/EventServices.js';
import { AwsEventScheduler } from '../implementations/AwsEventScheduler.js';

export class EventSchedulerFactory {
  static create(region: string = 'eu-central-1'): EventScheduler {
    return new AwsEventScheduler(region);
  }
} 