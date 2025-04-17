import fs, { WriteStream } from 'fs';
import { FileManager } from '../interfaces/VideoServices.js';

export class FileManagerImpl implements FileManager {
  ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory at ${dir}`);
    }
  }

  createWriteStream(path: string): WriteStream {
    return fs.createWriteStream(path);
  }

  cleanup(path: string): void {
    try {
      if (this.exists(path)) {
        fs.unlinkSync(path);
        console.log(`Deleted file: ${path}`);
      }
    } catch (error) {
      console.error(`Error cleaning up file ${path}:`, error);
    }
  }

  exists(path: string): boolean {
    return fs.existsSync(path);
  }
} 