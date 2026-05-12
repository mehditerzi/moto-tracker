# MotoTracker

Self-hosted PWA that tracks your motorcycle's **Sigorta / Kasko / Muayene / Bakım** expiry dates. Snap a photo of the document — a local Ollama vision model reads the dates and auto-fills them. Daily Web Push reminders at lead times you choose. Bilingual (TR/EN).

The entire stack runs in Docker on a single machine. The frontend is tunneled to your phone via **ngrok**; everything else (API, SQLite, Ollama, cron) stays local.

~~~
┌──── your phone ──┐         ┌──── your machine ───────────────────────┐
│  PWA (Safari /   │  HTTPS  │  ngrok ── docker ──┬── api  (Express)   │
│  Chrome install) │ ───────▶│  tunnel            │   ↓ same origin    │
│                  │         │                    └── React PWA static │
└──────────────────┘         │  ollama (gemma4 vision)                 │
                             │  sqlite (./data/app.db)                 │
                             └─────────────────────────────────────────┘
~~~

## Quickstart on a fresh device

Requires Docker (compose v2) and git.

~~~bash
git clone <this repo> mototracker && cd mototracker
./scripts/bootstrap.sh
~~~

The script will:

1. generate `SESSION_SECRET` and a VAPID keypair
2. prompt for your ngrok authtoken (and optionally a reserved free domain)
3. write `.env` and `docker compose up -d` everything
4. pull the Ollama vision model

When it finishes you'll see something like:

~~~
✓ MotoTracker is up.
   Public URL:      https://honest-tarpon-44.ngrok-free.app
   ngrok inspector: http://localhost:4040
   API (local):     http://localhost:8787
   Ollama (local):  http://localhost:11434
~~~

Open the public URL on your phone, sign up, and (on iOS) **add to home screen** so push notifications can reach you.

To stop:

~~~bash
docker compose down
~~~

## Phase status

- [x] Phase 1 — Foundation + Auth
- [x] Phase 2 — Dashboard + Dated Items
- [x] Phase 3 — OCR Pipeline
- [x] Phase 4 — Notifications + Maintenance + PWA + i18n + Polish
- [x] Phase 5 — Single-origin (no Vercel) + ngrok + bootstrap script

## Local development (without Docker)

For UI iteration the Vite dev server is much faster than a Docker rebuild.

~~~bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter @mototracker/api migrate
pnpm dev:api       # http://localhost:8787 (API only)
pnpm dev:web       # http://localhost:5173 (Vite, proxies /api to :8787)
~~~

In dev the React app fetches `/api/*` from `:5173` via Vite's proxy — same-origin behaviour without needing Docker.

### Tests

~~~bash
pnpm --filter @mototracker/api test
~~~

## Architecture notes

**Single-origin.** The production Docker image bakes the React build into `/app/public` and the Express server serves it (`WEB_ROOT=/app/public`). All client requests are relative (`fetch("/api/...")`) so the browser sees one origin. No CORS, no third-party cookies, no Vercel.

**ngrok.** The `ngrok` container connects to `api:8787` over the docker network and exposes one public HTTPS URL. The API binds only to `127.0.0.1:8787` on the host. With `TRUST_PROXY=true` Express reads `X-Forwarded-Proto` so BetterAuth issues `Secure` cookies behind the tunnel.

**Reserved ngrok domain (recommended).** The free ngrok tier gives you one static subdomain per account at <https://dashboard.ngrok.com/domains>. Without it, every restart hands out a new random URL and the bootstrap rewrites `APP_BASE_URL` accordingly.

**Push.** VAPID keys live in `.env`. The daily cron (`node-cron`, default 09:00 `Europe/Istanbul`) calls `web-push` for each subscription whose lead-day matches today. Already-sent (item, lead, day) tuples are de-duped in `notification_sent`.

**OCR.** Documents are uploaded as `multipart/form-data` to `/api/documents`, re-encoded with `sharp` (max 2000 px, q=85 JPEG), then queued for the Ollama vision model. The result is parsed against a strict Zod schema and, if confidence ≥ 0.7 and the bike matches, automatically inserted as a `dated_item`. Otherwise the user confirms manually.

## Push on iOS

iOS Web Push requires the user to **install the PWA to the home screen** (iOS 16.4+). The Settings page surfaces this hint when it detects iOS Safari without a standalone display mode.

## Repo layout

~~~
apps/
  api/        # Express + SQLite + BetterAuth + node-cron + web-push + multer/sharp
  web/        # React PWA — built at image time, served by api
packages/
  shared/     # zod schemas shared between api and web
scripts/
  bootstrap.sh
docker-compose.yml
docs/superpowers/
  specs/      # design doc
  plans/      # phase implementation plans
~~~
