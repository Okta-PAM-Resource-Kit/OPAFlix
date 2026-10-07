# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Development stage
FROM node:24-alpine AS development

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm ci

# Create cache directory
RUN mkdir -p /tmp/opaflix-cache

# Expose port
EXPOSE 3000

# Start in development mode
CMD ["npm", "run", "dev"]

# Production stage
FROM node:24-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S opaflix && \
    adduser -u 1001 -S opaflix -G opaflix

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

# Create cache directory with correct permissions
RUN mkdir -p /tmp/opaflix-cache && chown opaflix:opaflix /tmp/opaflix-cache

# Switch to non-root user
USER opaflix

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

# Start application
CMD ["node", "src/index.js"]
