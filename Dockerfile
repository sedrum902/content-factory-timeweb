FROM node:20-slim

RUN corepack enable

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pm2

RUN groupadd --gid 2000 app \
  && useradd --uid 2000 --gid 2000 -m -s /bin/bash app

WORKDIR /app

COPY package.json package-lock.json* pnpm-lock.yaml* pnpm-workspace.yaml* ./

RUN if [ -f pnpm-lock.yaml ]; then \
      corepack prepare pnpm --activate && pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

COPY --chown=app:app . .

RUN mkdir -p /app/data/uploads \
  && chown -R app:app /app/data \
  && chmod -R 775 /app/data

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

EXPOSE 8080

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
