# MotoTracker

Self-hosted PWA that tracks motorcycle Sigorta / Kasko / Muayene expiry dates with photo-based OCR (local Ollama vision model) and Web Push reminders.

- **Frontend** (`apps/web`): React + Vite + Tailwind, deployed to Vercel.
- **Backend** (`apps/api`): Node + Express + better-sqlite3 + BetterAuth, self-hosted via Docker.
- **OCR**: Ollama vision model (e.g. `gemma3:4b`) running on the same host as the API.
- **Edge**: Cloudflare Tunnel exposes the API at `api.<your-domain>` over HTTPS.

See `docs/superpowers/specs/2026-05-08-mototracker-design.md` for the full design.

## Phase status

- [x] Phase 1 — Foundation + Auth (this branch)
- [ ] Phase 2 — Dashboard + Dated Items
- [ ] Phase 3 — OCR Pipeline
- [ ] Phase 4 — Notifications + Maintenance + Polish

## Local development

Prereqs: Node 20, pnpm 9, Docker Desktop (optional for Ollama).

~~~bash
pnpm install
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env (SESSION_SECRET at minimum)
pnpm --filter @mototracker/api migrate
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:5173
~~~

Vite proxies `/api` → `http://localhost:8787` so cookies work cross-origin in dev.

### Tests

~~~bash
pnpm --filter @mototracker/api test
~~~

## Self-host (production)

1. Provision a Cloudflare Tunnel: `cloudflared tunnel login`, then `cloudflared tunnel create mototracker`. Note the token.
2. Point `api.<your-domain>` at the tunnel in the Cloudflare dashboard.
3. Copy `.env.example` to `.env` at the repo root and fill in: `WEB_ORIGIN`, `APP_BASE_URL`, `SESSION_SECRET`, `CLOUDFLARED_TOKEN`, plus optional `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`.
4. `docker compose up -d`
5. Pull the Ollama vision model (Phase 3): `docker exec mototracker-ollama ollama pull gemma3:4b`

## Frontend deploy (Vercel)

1. New Vercel project pointing at this repo, root directory `apps/web`.
2. Build command: `pnpm --filter @mototracker/web build`. Output: `apps/web/dist`.
3. Env vars on Vercel:
   - `VITE_API_URL=https://api.<your-domain>`
4. Vercel will use `apps/web/vercel.json` for the SPA rewrite + service-worker headers.

## Repo layout

~~~
apps/
  api/        # Express + SQLite + BetterAuth
  web/        # React PWA → Vercel
packages/
  shared/     # zod schemas
docker-compose.yml
docs/superpowers/
  specs/      # design docs
  plans/      # implementation plans
~~~
