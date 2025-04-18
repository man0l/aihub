import { CaptionParser, CaptionParserFactory } from '../interfaces/CaptionServices.js';
import { VttCaptionParser } from '../implementations/VttCaptionParser.js';

export class DefaultCaptionParserFactory implements CaptionParserFactory {
  private readonly parsers: CaptionParser[];

  constructor() {
    this.parsers = [
      new VttCaptionParser(),
      // Add more parsers here as needed (SRT, SSA, etc.)
    ];
  }

  getParser(content: string): CaptionParser {
    const parser = this.parsers.find(p => p.canParse(content));
    if (!parser) {
      throw new Error('No suitable parser found for the caption content');
    }
    return parser;
  }
} 