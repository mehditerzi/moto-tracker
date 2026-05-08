FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ sqlite
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mototracker/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./
COPY --from=build /repo/apps/api/src/db/migrations ./dist/db/migrations
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./node_modules
EXPOSE 8787
VOLUME ["/data"]
ENV DATABASE_PATH=/data/app.db
CMD ["node", "dist/index.js"]
