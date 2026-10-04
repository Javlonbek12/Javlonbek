# Production image: one image runs the web app, the scheduler worker and the watchdog
# (different commands in docker-compose.prod.yml).

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Placeholder so `prisma generate` and `next build` work without a database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && rm -rf .next/cache

# ---- run ----
FROM node:22-bookworm-slim AS run
WORKDIR /app
# Fonts for PNG pictures of planograms: the DejaVu files bundled in assets/fonts.
ENV FONTCONFIG_FILE=/app/deploy/fonts.conf \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads
# Dev dependencies stay: the worker and the watchdog run TypeScript through tsx,
# and migrations use the prisma CLI.
COPY --from=build /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data /app/.next
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
