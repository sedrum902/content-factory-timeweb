FROM node:20-slim

WORKDIR /app

# Install curl for HTTP diagnostic utility and health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Ensure the data directory and uploads directory exist and have relaxed permissions
RUN mkdir -p /app/data /app/data/uploads && chmod -R 777 /app/data

EXPOSE 3000

ENV PORT=3000 \
    NODE_ENV=production

CMD ["node", "server.js"]
