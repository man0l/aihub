import { CaptionParser } from '../interfaces/CaptionServices.js';

export class VttCaptionParser implements CaptionParser {
  canParse(content: string): boolean {
    // Check if content starts with WEBVTT or contains typical VTT timestamp format
    // Also check for Kind: captions format
    return content.trim().startsWith('WEBVTT') || 
           content.includes('-->') ||
           content.toLowerCase().includes('kind: captions');
  }

  parse(content: string): string {
    return content
      .split('\n')
      .map(line => {
        // Remove all timestamp tags like <00:00:00.320>
        line = line.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '');
        // Remove <c> tags
        line = line.replace(/<\/?c>/g, '');
        // Remove align and position metadata
        line = line.replace(/align:.*position:.*%/g, '');
        return line;
      })
      .filter(line => {
        // Remove WebVTT header and metadata
        if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) return false;
        // Remove timestamp lines (00:00:00.000 --> 00:00:00.000)
        if (line.match(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/)) return false;
        // Remove empty lines
        if (line.trim().length === 0) return false;
        // Remove lines that are just numbers (counter)
        if (line.trim().match(/^\d+$/)) return false;
        return true;
      })
      .map(line => line.trim())
      // Remove duplicate consecutive lines (often happens with VTT captions)
      .filter((line, index, array) => line !== array[index - 1])
      .join(' ')
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }
} 