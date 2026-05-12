# MotoTracker

A self-hosted PWA that tracks your motorcycle's **Sigorta / Kasko / Muayene / Bakım** dates so you never miss a renewal again.

- 📸 **Photo OCR** — snap your sigorta poliçesi or muayene belgesi; a local Ollama vision model extracts the dates and auto-fills them
- 🔔 **Web Push reminders** — daily cron sends notifications at lead times you choose (default 30 / 7 / 1 days)
- 🔧 **Maintenance tracking** — engine oil, chain, brakes, tires, etc., by months and/or km
- 🇹🇷 🇬🇧 **Bilingual** UI (Turkish default, English toggle)
- 🏠 **Runs entirely on one machine** — no Vercel, no cloud DB, no third-party AI; just Docker + ngrok

The frontend is tunneled to your phone via **ngrok**. Everything else — API, SQLite, Ollama, cron — stays local.

```text
┌──── your phone ──┐         ┌──── your machine (docker) ──────────────┐
│  PWA (Safari /   │  HTTPS  │  ngrok  ─────┬── api  (Express)         │
│  Chrome install) │ ───────▶│              │   ↓ same origin          │
│                  │         │              └── React PWA (static)     │
└──────────────────┘         │                                         │
                             │  ollama   (vision model, default gemma4:e4b) │
                             │  sqlite   (./data/app.db)               │
                             └─────────────────────────────────────────┘
```

---

## Quickstart

Prerequisites: **Docker** (compose v2) and **git**. That's it.

### First time on a new device

```bash
git clone <this repo> mototracker
cd mototracker
./scripts/bootstrap.sh
```

The bootstrap script will:

1. generate a 64-char `SESSION_SECRET` and a VAPID keypair
2. ask for your **ngrok authtoken** (one-time, from <https://dashboard.ngrok.com/get-started/your-authtoken>)
3. optionally ask for a **reserved ngrok domain** (free, one per account at <https://dashboard.ngrok.com/domains>) — without one, ngrok hands out a random URL each restart
4. write `.env`, run `docker compose up -d`
5. pull the configured Ollama vision model (`gemma4:e4b` by default)
6. print your public URL

When it finishes you'll see:

```text
✓ MotoTracker is up.
   Public URL:      https://honest-tarpon-44.ngrok-free.app
   ngrok inspector: http://localhost:4040
   API (local):     http://localhost:8787
   Ollama (local):  http://localhost:11434
```

Open the public URL on your phone, create an account, and **add to home screen** (iOS requires this for push). You're done.

### Every update afterwards

```bash
git pull
docker compose up -d --build
```

Migrations auto-run at container start. `.env`, your SQLite DB, uploaded photos, and the Ollama model all persist across upgrades.

### Stop / start / wipe

```bash
docker compose stop          # pause (keeps data)
docker compose up -d         # resume
docker compose down          # remove containers (keeps volumes)
docker compose down -v       # ☢️  also delete ./data and ./ollama
```

---

## Features

| Area | What's there |
|---|---|
| Auth | Email + password, magic link (via Resend or console log), Google OAuth — all powered by BetterAuth |
| Bikes | Multiple bikes per user, archive, plate auto-uppercased, optional make/model/year/km/color |
| Dated items | Sigorta, Kasko, Muayene — full history per (bike, type), latest one surfaced on dashboard |
| Status chips | Color-coded by days remaining (green > 30, amber ≤ 30, red ≤ 7 / expired with pulse) |
| Maintenance | Engine oil, chain, brakes, tires, coolant, custom — months and km intervals; due-soon highlighted on dashboard |
| OCR | Single-flight queue, Ollama vision model, JSON parser tolerant of prose / code fences, Turkish date normalization, auto-apply when confidence ≥ 0.7 and bike matches by plate |
| Notifications | Web Push (VAPID), per-user per-item-type lead-day preferences, daily `node-cron` dispatcher, de-dupe via `notification_sent`, expired-endpoint pruning |
| PWA | `vite-plugin-pwa` with custom `sw.ts`, install on iOS / Android, scan-line capture animation, prefers-reduced-motion respected |
| i18n | Turkish default with English toggle; `html lang` synced so CSS uppercase rules behave correctly |
| Hosting | Single-origin: API serves the built React PWA; ngrok tunnel exposes one HTTPS URL |

---

## Local development (without Docker)

For UI iteration the Vite dev server is much faster than a Docker rebuild.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter @mototracker/api migrate
pnpm dev:api       # http://localhost:8787  (API only)
pnpm dev:web       # http://localhost:5173  (Vite, proxies /api to :8787)
```

In dev the React app fetches `/api/*` through Vite's proxy, so it behaves same-origin without Docker. Open <http://localhost:5173>.

### Tests

```bash
pnpm --filter @mototracker/api test
```

48 vitest + supertest tests covering auth, bikes, dated items, dashboard, maintenance, push subs, prefs, document upload, OCR parser, and notification dispatcher (Ollama and `web-push` are stubbed via test seams).

---

## Configuration

All config is environment variables. The bootstrap script generates/prompts for everything required. See `.env.example` for the full list — the important ones:

| Variable | Required | Notes |
|---|---|---|
| `NGROK_AUTHTOKEN` | yes | from ngrok dashboard |
| `NGROK_DOMAIN` | recommended | reserved free subdomain; without it, URL changes on every restart |
| `APP_BASE_URL` | yes | `https://<NGROK_DOMAIN>` — set by bootstrap |
| `SESSION_SECRET` | yes | 64 hex chars — generated by bootstrap |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | yes | generated by bootstrap |
| `OLLAMA_VISION_MODEL` | no | default `gemma4:e4b` (best speed/quality balance); `gemma4:26b` for max quality, `gemma4:e2b` for fastest |
| `OCR_AUTO_APPLY_THRESHOLD` | no | default `0.7` — minimum confidence for auto-applying a dated_item |
| `CRON_TIMEZONE` / `CRON_HOUR` | no | default `Europe/Istanbul` / `9` |
| `RESEND_API_KEY` / `EMAIL_FROM` | no | for magic-link email; without it, links print to API logs |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | enables Google sign-in |

---

## Architecture notes

**Single-origin.** The Docker image bakes the React build into `/app/public`; Express serves it (`WEB_ROOT=/app/public`) with SPA fallback (everything that isn't `/api/*` → `index.html`). All client requests are relative (`fetch("/api/...")`), so the browser sees one origin. No CORS, no third-party cookies, no Vercel deploy step.

**ngrok.** The `ngrok` container talks to `api:8787` over the Docker network. The API binds only to `127.0.0.1:8787` on the host — there's no public path that bypasses ngrok. `TRUST_PROXY=true` makes Express read `X-Forwarded-Proto` so BetterAuth issues `Secure` cookies behind the tunnel.

**OCR pipeline.** `POST /api/documents` (multipart) → `sharp` re-encodes the image (max 2000 px, q=85 JPEG, EXIF rotation respected) → row inserted with `ocr_status='pending'` → single-flight queue picks it up → calls `POST {OLLAMA_URL}/api/generate` with the image base64 and a strict Turkish prompt → parses the response against a Zod schema that tolerates code fences, leading/trailing prose, and `dd.mm.yyyy` Turkish date formats → if `doc_type ∈ {sigorta,kasko,muayene}` and confidence ≥ threshold and the bike matches by plate (or single-bike user), inserts a `dated_item` automatically with `source_document_id` set. Otherwise leaves the document parsed for the user to confirm.

**Push & cron.** VAPID keys live in `.env`. Daily `node-cron` (default 09:00 `Europe/Istanbul`) computes `expires_on - today` for every active dated_item and maintenance item, matches against per-user `notification_preference.lead_days`, and calls `web-push` for each subscription. Already-sent `(item_kind, item_id, lead_days, sent_on)` tuples are de-duped via `notification_sent`. Endpoints that return 404/410 are pruned.

**iOS push.** Web Push on iOS requires iOS 16.4+ and the PWA to be **installed to the home screen**. The Settings page surfaces this hint when it detects iOS Safari without standalone display mode.

---

## Repo layout

```text
apps/
  api/                       # Express + SQLite + BetterAuth + node-cron + web-push + multer/sharp
    src/
      auth/                  # BetterAuth + magic-link email
      db/migrations/         # 001..004 — run automatically on startup
      ocr/                   # Ollama client, prompt, parser, worker, auto-apply
      notify/                # computeDueNotifications, dispatcher, cron
      routes/                # bikes, dated-items, maintenance, dashboard, documents, push, ...
    tests/                   # vitest + supertest
    Dockerfile               # multi-stage: builds web + api, copies dist/ to /app/public
  web/                       # React PWA — built at image time, served by api
    src/
      components/            # AppShell, BrandMark, StatusChip, BikeSwitcher, MaintenancePanel, ui/*
      pages/                 # SignIn, SignUp, Dashboard, Bike/Form, DatedItem/Form/Detail, Maintenance, Capture/Review, Settings, ...
      hooks/                 # useMe, useBikes, useDashboard, useDatedItems, useMaintenance, useNotifPrefs, usePush, useDocuments
      lib/                   # api client, authClient, push, i18n, datedItems helpers
      locales/               # tr.json, en.json
      sw.ts                  # custom service worker (push + notificationclick)
packages/
  shared/                    # zod schemas shared between api and web
scripts/
  bootstrap.sh               # one-shot setup
docker-compose.yml           # api + ollama + ngrok
docs/superpowers/
  specs/                     # design doc
  plans/                     # phase implementation plans
```

---

## Troubleshooting

**`docker compose up` fails with `APP_BASE_URL` / `SESSION_SECRET` missing**
You haven't run `./scripts/bootstrap.sh` yet, or your `.env` was deleted. Run the bootstrap script — it's idempotent.

**Ngrok URL changed after restart**
Either reserve a free domain at <https://dashboard.ngrok.com/domains> and set `NGROK_DOMAIN` in `.env`, or re-run `./scripts/bootstrap.sh` which auto-detects the new URL and rewrites `APP_BASE_URL`.

**Ollama: host vs bundled**
The bootstrap script auto-detects whether you already have Ollama running on the host. If yes, the api container talks to it via `host.docker.internal:11434` and no bundled Ollama is started. If not, it starts a bundled `ollama` container (via `--profile bundled-ollama`) and pulls the model into it. To force the bundled mode, set `OLLAMA_URL=http://ollama:11434` in `.env` and run `docker compose --profile bundled-ollama up -d`.

**OCR returns `model 'X' not found`**
- Bundled mode: `docker exec mototracker-ollama ollama pull <name>`
- Host mode: `ollama pull <name>` (on the host)
- Or change `OLLAMA_VISION_MODEL` in `.env` to a tag you already have.

**OCR returns `OCR response did not contain a JSON object`**
The vision model isn't producing usable output. Likely it's not multimodal or doesn't follow instructions well. Try a stronger vision model (e.g. a `:12b` or `:27b` variant of Gemma) or a different family. Increase `OCR_AUTO_APPLY_THRESHOLD` if you'd rather always confirm manually.

**iOS doesn't show the "enable notifications" button**
You need to install the PWA to your home screen first (Share → Add to Home Screen on iOS 16.4+), then open it from the icon. Push only works in the installed standalone window on iOS.

**Magic-link email never arrives**
Without `RESEND_API_KEY`, magic links print to the API logs: `docker compose logs -f api | grep email:dev`. Copy the URL from there. For real email, sign up at <https://resend.com> and set `RESEND_API_KEY` and `EMAIL_FROM`.

**View logs**

```bash
docker compose logs -f                    # everything
docker compose logs -f api                # just the api
docker compose logs -f ollama             # vision model
docker compose logs -f ngrok              # tunnel
```

---

## License

Personal project — no license declared. Use at your own risk.
