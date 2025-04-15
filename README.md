# YouTube Video Processing Worker

This worker service processes YouTube videos by fetching transcriptions and media, then storing them in AWS S3.

## Architecture

The worker is designed following SOLID principles:

- **Single Responsibility**: Each class has a single responsibility
- **Open/Closed**: Classes are extensible without modification
- **Liskov Substitution**: Subclasses can be used in place of their parent classes
- **Interface Segregation**: Clients depend only on the interfaces they use
- **Dependency Inversion**: High-level modules don't depend on low-level modules

## Implementation Details

The worker is implemented in TypeScript with ES Modules:

- **TypeScript**: Full type safety with TypeScript
- **ES Modules**: Modern JavaScript module system
- **Jest Tests**: Comprehensive test suite for all components

## Class Structure

- `ConfigService`: Manages configuration and environment variables
- `ClientFactory`: Creates external service clients (Supabase, S3, HTTP)
- `YouTubeService`: Interacts with YouTube APIs to fetch video data
- `StorageService`: Manages file operations and S3 uploads
- `DatabaseService`: Handles database interactions via Supabase
- `VideoProcessor`: Orchestrates the video processing workflow
- `Worker`: Manages the worker lifecycle and queue processing
- `Application`: Bootstraps the application

## Environment Variables

The worker requires the following environment variables:

```
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=eu-central-1

# S3 Configuration
PROJECT_PREFIX=transcribe-manol-eu1-20240222
RAW_MEDIA_BUCKET=${PROJECT_PREFIX}-raw-media-input
PROCESSED_TRANSCRIPTS_BUCKET=${PROJECT_PREFIX}-processed-transcripts-output

# YouTube Configuration
VITE_YOUTUBE_API_KEY=your_youtube_api_key
```

## Running the Worker

```bash
# Install dependencies
npm install

# Build and start the worker
npm run worker

# Start in development mode (watches for changes)
npm run dev:worker
```

## S3 Storage Structure

Files are stored in S3 with the following path structure:

- Videos: `users/{userId}/videos/{videoId}.mp4`
- Audio: `users/{userId}/audio/{videoId}.mp3`
- Transcripts: `users/{userId}/transcripts/{videoId}.txt`

## Testing

The worker includes Jest tests:

```bash
# Run tests
npm test
```

## Graceful Shutdown

The worker handles graceful shutdown on SIGTERM and SIGINT signals, ensuring all resources are properly released. 