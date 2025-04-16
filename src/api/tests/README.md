# API Tests

This directory contains tests for the API endpoints of the AI Knowledge Hub.

## Test Structure

- `jest.setup.ts` - Setup file for Jest with mocks for dependencies
- `jest.config.ts` - Jest configuration
- `run-tests.ts` - Script to run all API tests
- `*.test.ts` - Test files for each route category

## Running Tests

You can run the API tests using the following command:

```bash
npm run test:api
```

## Test Coverage

The tests cover all the API endpoints in the application:

### Upload Routes

- GET /api/upload/collections - Get user collections
- POST /api/upload/collections - Create a new collection
- POST /api/upload/youtube - Process YouTube sources
- POST /api/upload/websites - Process websites
- POST /api/upload/files - Process files

### YouTube Routes

- GET /api/youtube/audio/:videoId - Get video audio URL
- GET /api/youtube/metadata/:videoId - Get video metadata
- GET /api/youtube/transcript/:videoId - Get video transcript

## Writing New Tests

To write tests for new endpoints:

1. Create a new test file in this directory (or add to an existing one)
2. Import the necessary dependencies and route handler
3. Set up a test Express app
4. Write test cases for each endpoint, covering:
   - Success case
   - Error cases
   - Edge cases

## Mocks

The tests use mocks for external dependencies:

- Supabase client
- YouTube API utilities
- OpenAI utilities
- Express middleware
- File upload handling

You can find and modify these mocks in `jest.setup.ts`. 