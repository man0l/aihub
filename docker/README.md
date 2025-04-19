# Worker Docker Image

This directory contains files related to Docker containerization of the worker component.

## Docker Image

The worker Docker image is designed to run the worker process that handles background tasks like processing YouTube videos, websites, and other content.

### Building Locally

To build the Docker image locally:

```bash
docker build -t ai-knowledge-hub-worker .
```

To run the Docker image locally:

```bash
docker run -p 8080:8080 --env-file .env ai-knowledge-hub-worker
```

## GitHub Actions Workflow

The project includes a GitHub Actions workflow that automatically builds and pushes the Docker image to GitHub Container Registry (ghcr.io) whenever changes are made to the worker code.

### Workflow Triggers

The workflow is triggered by:
- Pushes to the main/master branch that modify worker-related files
- Manual trigger via GitHub Actions interface

### Image Tags

The Docker image is tagged with:
- `latest` for the default branch
- A long SHA format for each build, matching the Git commit SHA

### Using the Published Image

To pull and use the published image:

```bash
docker pull ghcr.io/[username]/ai-knowledge-hub-worker:latest
docker run -p 8080:8080 --env-file .env ghcr.io/[username]/ai-knowledge-hub-worker:latest
```

Replace `[username]` with your GitHub username or organization name.

## Environment Variables

The Docker image requires the following environment variables to be set:

- Database connection details (via Supabase URL and key)
- OpenAI API key
- AWS credentials (if using S3)
- Other service-specific credentials

You can provide these using an `.env` file when running locally or through GitHub repository secrets for deployment environments.

## Continuous Deployment

After the image is pushed to GitHub Container Registry, you can set up additional workflows to deploy it to your hosting environment (AWS, GCP, Azure, etc.). 