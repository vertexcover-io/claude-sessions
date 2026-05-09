FROM oven/bun:1.2.19 AS builder
WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.base.json biome.json ./
COPY packages/core/package.json packages/core/
COPY packages/adapter-claude/package.json packages/adapter-claude/
COPY packages/cli/package.json packages/cli/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/test-config/package.json packages/test-config/

RUN bun install --frozen-lockfile

COPY packages/core packages/core
COPY packages/adapter-claude packages/adapter-claude
COPY packages/server packages/server
COPY packages/web packages/web
COPY packages/test-config packages/test-config

RUN bun run --filter @claude-sessions/core build
RUN bun run --filter @claude-sessions/adapter-claude build
RUN bun run --filter @claude-sessions/web build
RUN bun run --filter @claude-sessions/server build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST=/app/packages/web/dist

COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json packages/core/package.json
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/adapter-claude/package.json packages/adapter-claude/package.json
COPY --from=builder /app/packages/adapter-claude/dist packages/adapter-claude/dist
COPY --from=builder /app/packages/server/package.json packages/server/package.json
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/server/src/db/migrations packages/server/dist/src/db/migrations
COPY --from=builder /app/packages/web/dist packages/web/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/src/main.js"]
