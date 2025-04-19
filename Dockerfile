FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY src/worker/ ./src/worker/

# Build the worker
RUN npm run build:worker

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built files from builder stage
COPY --from=builder /app/dist/worker/ ./dist/worker/
COPY worker.js ./

# Set environment variables
ENV NODE_ENV=production

# Command to run the worker
CMD ["node", "worker.js"] 