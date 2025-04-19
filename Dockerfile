FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Create necessary directories
RUN mkdir -p /app/test/data \
    && mkdir -p /app/temp

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files including shared interfaces
COPY tsconfig*.json ./
COPY src/worker/ ./src/worker/
COPY src/shared/ ./src/shared/
COPY test/ ./test/

# Build the worker
RUN npm run build:worker

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies and yt-dlp
RUN apk add --no-cache \
    python3 \
    py3-pip \
    cairo \
    jpeg \
    pango \
    giflib \
    pixman \
    && python3 -m venv /venv \
    && source /venv/bin/activate \
    && pip3 install --no-cache-dir yt-dlp \
    && deactivate

# Add virtual environment to PATH
ENV PATH="/venv/bin:$PATH"

# Create necessary directories
RUN mkdir -p /app/test/data \
    && mkdir -p /app/temp \
    && chmod 777 /app/temp

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    && npm ci --production \
    && apk del \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Copy built files from builder stage
COPY --from=builder /app/dist/worker/ ./dist/worker/
COPY --from=builder /app/test/ ./test/
COPY worker.js ./

# Set environment variables
ENV NODE_ENV=production

# Command to run the worker
CMD ["node", "worker.js"] 