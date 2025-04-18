import { CaptionParserFactory } from './interfaces/CaptionServices.js';

export class CaptionService {
  constructor(
    private readonly parserFactory: CaptionParserFactory
  ) {}

  /**
   * Extracts clean transcription text from caption content
   * @param content Raw caption content (VTT, SRT, etc.)
   * @returns Clean transcription text without timestamps and formatting
   */
  extractTranscription(content: string): string {
    try {
      const parser = this.parserFactory.getParser(content);
      return parser.parse(content);
    } catch (error) {
      console.error('Failed to parse captions:', error);
      return '';
    }
  }
} 