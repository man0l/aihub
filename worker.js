/**
 * YouTube Video Processing Worker (ES Module Entry Point)
 * 
 * This file serves as the main entry point for running the TypeScript worker.
 * It simply imports and runs the compiled TypeScript implementation.
 */

import { Application } from './dist/worker/worker/index.js';

// Create and start the application
console.log('Starting YouTube Video Processing Worker (TypeScript implementation)');
const app = new Application();
app.start().catch(console.error); 