/**
 * AI Knowledge Hub API Server
 * 
 * This is the main entry point for the Express server that handles API requests
 * during development. In production, Vercel serverless functions are used instead.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';

// Initialize environment variables first
dotenv.config();

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const port = process.env.PORT || 3001;

// Set NODE_ENV if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
console.log(`Server running in ${process.env.NODE_ENV} mode`);

// Middleware
app.use(cors());
app.use(express.json());

// For debugging
console.log('Supabase URL:', process.env.VITE_SUPABASE_URL ? 'Set' : 'Not set');
console.log('Supabase Key:', process.env.VITE_SUPABASE_ANON_KEY ? 'Set' : 'Not set');
console.log('YouTube API Key:', process.env.VITE_YOUTUBE_API_KEY ? 'Set' : 'Not set');
console.log('OpenAI API Key:', process.env.VITE_OPENAI_API_KEY ? 'Set' : 'Not set');

// Setup routes asynchronously
async function setupRoutes() {
  try {
    console.log('Setting up routes...');
    
    // Import route handlers
    const uploadRoutesModule = await import('./src/api/routes/upload.js');
    const youtubeRoutesModule = await import('./src/api/routes/youtube.js');
    const errorHandlerModule = await import('./src/api/middleware/errorHandler.js');
    
    const uploadRoutes = uploadRoutesModule.default;
    const youtubeRoutes = youtubeRoutesModule.default;
    const { errorHandler } = errorHandlerModule;
    
    // Register routes
    app.use('/api/upload', uploadRoutes);
    app.use('/api/youtube', youtubeRoutes);
    
    // Error handling middleware
    app.use(errorHandler);
    
    console.log('Routes set up successfully');
    return true;
  } catch (error) {
    console.error('Error setting up routes:', error);
    return false;
  }
}

// Start the server
async function startServer() {
  try {
    const routesSetup = await setupRoutes();
    
    if (!routesSetup) {
      throw new Error('Failed to set up routes');
    }
    
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
      console.log(`API base URL: http://localhost:${port}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize the server
startServer().catch(error => {
  console.error('Unhandled error during server startup:', error);
  process.exit(1);
}); 