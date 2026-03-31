# Build stage — full image has python3/make/g++ for native addons (better-sqlite3)
FROM node:22 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Runtime stage — slim Debian, no build tools needed
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

ENV NODE_ENV=production

# Run as non-root so files created in bind-mounted volumes are owned by the
# host user rather than root.  The node:22-slim base image ships a "node" user
# (UID 1000) that is used as the default; docker-compose can override the
# numeric UID/GID at runtime via PUID/PGID env vars and `user:`.
USER node

EXPOSE 8765

# Graceful shutdown: handle both SIGINT and SIGTERM (Docker sends SIGTERM)
STOPSIGNAL SIGTERM

CMD ["node", "src/server.js"]
