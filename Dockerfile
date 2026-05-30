FROM node:20-slim

WORKDIR /app

# Install curl for HTTP diagnostic utility and health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Ensure the data directory and uploads directory exist and have relaxed permissions
RUN mkdir -p /app/data /app/data/uploads && chmod -R 777 /app/data

EXPOSE 8080

ENV PORT=8080 \
    NODE_ENV=production

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD curl -fs http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
