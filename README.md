# MotoTracker

Self-hosted PWA that tracks motorcycle Sigorta / Kasko / Muayene / Bakım expiry dates with photo-based OCR (local Ollama vision model) and Web Push reminders.

- **Frontend** (`apps/web`): React + Vite + Tailwind + vite-plugin-pwa, deployed to Vercel.
- **Backend** (`apps/api`): Node + Express + better-sqlite3 + BetterAuth + node-cron + web-push, self-hosted via Docker.
- **OCR**: Ollama vision model (e.g. `gemma4`) running on the same host as the API.
- **Edge**: Cloudflare Tunnel exposes the API at `api.<your-domain>` over HTTPS.

See `docs/superpowers/specs/2026-05-08-mototracker-design.md` for the full design.

## Phase status

- [x] Phase 1 — Foundation + Auth
- [x] Phase 2 — Dashboard + Dated Items
- [x] Phase 3 — OCR Pipeline
- [x] Phase 4 — Notifications + Maintenance + PWA + i18n + Polish

## Local development

Prereqs: Node 20, pnpm 9, Docker Desktop (optional for Ollama).

~~~bash
pnpm install
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env: SESSION_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
npx web-push generate-vapid-keys      # paste output into apps/api/.env
pnpm --filter @mototracker/api migrate
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:5173
~~~

The web env needs `VITE_API_URL=http://localhost:8787` and `VITE_VAPID_PUBLIC_KEY=<public key>`.

### Tests

~~~bash
pnpm --filter @mototracker/api test
~~~

## Self-host (production)

1. **Cloudflare Tunnel.** `cloudflared tunnel login`, then `cloudflared tunnel create mototracker`. Note the token. In the Cloudflare dashboard, point `api.<your-domain>` at the tunnel's HTTP service `http://api:8787`.
2. **VAPID keys.** Run `npx web-push generate-vapid-keys` once. Save both keys.
3. **Env.** Copy `.env.example` to `.env` at the repo root and fill in:
   - `WEB_ORIGIN` (your Vercel URL)
   - `APP_BASE_URL` (your tunnel URL)
   - `SESSION_SECRET` (32+ random chars)
   - `CLOUDFLARED_TOKEN`
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - optional: `RESEND_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`
4. **Compose up.** `docker compose up -d`
5. **Pull the OCR model.** `docker exec mototracker-ollama ollama pull gemma4`
6. **Run migrations.** First boot auto-runs them via the entrypoint; on later upgrades: `docker exec mototracker-api node dist/db/migrate.js`.

## Frontend deploy (Vercel)

1. New Vercel project pointing at this repo, root directory `apps/web`.
2. Build command: `pnpm --filter @mototracker/web build`. Output: `apps/web/dist`.
3. Env vars on Vercel:
   - `VITE_API_URL=https://api.<your-domain>`
   - `VITE_VAPID_PUBLIC_KEY=<public-key>`
4. Vercel uses `apps/web/vercel.json` for the SPA rewrite + service-worker headers.

## Push on iOS

iOS Web Push requires the user to **install the PWA to home screen** (iOS 16.4+). The Settings page hints at this when the device is iOS without an active subscription.

## Daily reminders

Reminders fire daily at `CRON_HOUR` in `CRON_TIMEZONE` (default 09:00 Europe/Istanbul). The cron picks items whose `expires_on - today` matches one of the user's lead-day preferences (default 30/7/1) and calls Web Push for each subscribed device. Already-sent (item, lead, day) tuples are de-duped via `notification_sent`.

## Repo layout

~~~
apps/
  api/        # Express + SQLite + BetterAuth + cron + web-push
  web/        # React PWA → Vercel
packages/
  shared/     # zod schemas
docker-compose.yml
docs/superpowers/
  specs/      # design docs
  plans/      # implementation plans
~~~
