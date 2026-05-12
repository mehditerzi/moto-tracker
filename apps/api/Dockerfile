# Debian slim — sharp ships reliable prebuilt binaries for linux/{amd64,arm64}
# (no source compile, no libvips-dev needed), and better-sqlite3 ships prebuilt
# napi binaries here too. Alpine + arm64 doesn't have prebuilt sharp.
FROM node:20-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# ---- build stage ----
FROM base AS build
# Tooling needed only if any prebuild is missing for this arch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mototracker/shared build
RUN pnpm --filter @mototracker/api build
# Build the React PWA so the API can serve it.
RUN pnpm --filter @mototracker/web build
# Bundle the api node_modules into /out for the runtime image.
RUN pnpm --filter @mototracker/api deploy --prod /out

# ---- runtime stage ----
FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-tur \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/api/src/db/migrations ./dist/db/migrations
# React build output served as static files at /app/public.
COPY --from=build /repo/apps/web/dist ./public
EXPOSE 8787
VOLUME ["/data"]
ENV DATABASE_PATH=/data/app.db
ENV UPLOADS_DIR=/data/uploads
ENV WEB_ROOT=/app/public
ENV TRUST_PROXY=true
CMD ["node", "dist/index.js"]
