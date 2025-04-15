# YouTube Video Processing Worker

This directory contains the TypeScript implementation of the YouTube Video Processing Worker, which is responsible for:

1. Fetching YouTube video transcriptions
2. Downloading videos and extracting audio when necessary
3. Storing files in S3
4. Managing processing status in the database

## Implementation Details

The worker is implemented in TypeScript with ES Modules:

- **TypeScript Implementation**: The implementation is written in TypeScript and compiled to JavaScript ES Modules
- **ES Modules**: The codebase uses ES Modules for better compatibility with modern JavaScript ecosystems
- **Type Safety**: Full TypeScript implementation provides compile-time type checking

## How to Run the Worker

```bash
# Dev mode (rebuilds and runs the worker)
npm run dev:worker

# Production mode (builds and runs the worker)
npm run worker

# Run tests
npm test
```

## Module System

This project uses ES Modules:

- The main package.json has `"type": "module"`, which means .js files are treated as ES Modules by default
- Our TypeScript code is compiled to ES Modules by default, with explicit `.js` extensions in imports
- Jest tests are configured to run with the experimental VM modules flag for ES Modules support

## Services

The worker uses the following services:

- **ConfigService**: Manages environment variables and configuration
- **ClientFactory**: Creates clients for external services (Supabase, S3)
- **StorageService**: Handles S3 file operations
- **YouTubeService**: Interacts with YouTube APIs
- **DatabaseService**: Manages database operations via Supabase
- **VideoProcessor**: Orchestrates the video processing workflow
- **Worker**: Manages the worker lifecycle and queue processing
- **Application**: Bootstraps the application

## Testing

The worker includes comprehensive tests:

```bash
# Run tests
npm test
```

Tests are written in TypeScript using Jest with ES Modules support. The test suite covers all major components and services, ensuring the worker functions correctly under various scenarios. 