export interface CaptionFormat {
  kind: string;
  language: string;
  content: string;
}

export interface CaptionParser {
  canParse(content: string): boolean;
  parse(content: string): string;
}

export interface CaptionParserFactory {
  getParser(content: string): CaptionParser;
} 