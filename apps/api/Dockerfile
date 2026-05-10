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
RUN pnpm --filter @mototracker/shared build
RUN pnpm --filter @mototracker/api build
RUN pnpm --filter @mototracker/api deploy --prod /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
EXPOSE 8787
VOLUME ["/data"]
ENV DATABASE_PATH=/data/app.db
CMD ["node", "dist/index.js"]
