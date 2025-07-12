# AI Knowledge Hub

A full-stack application for processing, analyzing, and organizing content from various sources including YouTube videos, websites, and files.

## Project Overview

The AI Knowledge Hub consists of three main components:

1. **Frontend**: React-based web application for user interaction
2. **Backend API**: Express.js API with serverless deployment option
3. **Worker**: Background processing service for handling resource-intensive tasks

## Architecture

The project is designed following SOLID principles with a clean architecture approach:

- **Single Responsibility**: Each component has a well-defined purpose
- **Open/Closed**: Modules are extensible without modification
- **Liskov Substitution**: Implementations can be swapped without affecting clients
- **Interface Segregation**: Clients only depend on interfaces they need
- **Dependency Inversion**: High-level modules don't depend on low-level implementation details

## Technology Stack

- **Frontend**: React, TypeScript, Vite
- **Backend API**: Express.js (Dev), Vercel Serverless Functions (Prod)
- **Worker**: TypeScript with ES Modules
- **Database**: PostgreSQL via Supabase
- **Storage**: AWS S3, Supabase Storage
- **AI Services**: OpenAI API

## Deployment Strategy

The application uses a dual deployment strategy:

- **Development**: Express.js server with direct API access
- **Production**: Vercel serverless functions for API endpoints

## Backend API

The API provides endpoints for:

- **Authentication**: User management via Supabase Auth
- **YouTube Processing**: Extract metadata and transcripts from videos
- **Website Processing**: Extract and process content from web pages
- **File Processing**: Process uploaded files (PDF, DOCX, etc.)
- **Content Management**: Organize and query processed content

## Worker Service

The worker service processes:

- **YouTube Videos**: Fetches transcriptions and media
- **Files**: Processes uploaded documents
- **Content Analysis**: Performs AI analysis on processed content

## Environment Variables

The application requires the following environment variables:

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
PROJECT_PREFIX=your_project_prefix
RAW_MEDIA_BUCKET=${PROJECT_PREFIX}-raw-media-input
PROCESSED_TRANSCRIPTS_BUCKET=${PROJECT_PREFIX}-processed-transcripts-output

# YouTube Configuration
VITE_YOUTUBE_API_KEY=your_youtube_api_key

# Apify Configuration
APIFY_API_TOKEN=your_apify_api_token

# OpenAI Configuration
VITE_OPENAI_API_KEY=your_openai_api_key
```

## Running the Project

### Development Mode

```bash
# Install dependencies
npm install

# Start the backend server
npm run dev:backend

# Start the worker
npm run dev:worker

# Start the frontend
npm run dev:frontend

# Run everything
npm run dev
```

### Production Mode

```bash
# Build and start the server
npm run server

# Build and start the worker
npm run worker

# Deploy to Vercel (automatic with git push)
```

## Project Structure

```
/api/               - Vercel serverless functions
/src/               - Source code
  /api/             - Express API implementation
  /components/      - React components
  /lib/             - Shared libraries
  /worker/          - Background worker service
/public/            - Static assets
```

## Testing

```bash
# Run tests
npm test
```

## Make sure you have installed yt-dlp:

```
pip install yt-dlp
```