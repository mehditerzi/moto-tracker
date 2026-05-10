# MotoTracker — Design Spec

**Date:** 2026-05-08
**Status:** Approved by user (sections 1–3); sections 4–5 included in this doc for completeness.

## 1. Purpose

A multi-user, self-hosted PWA that tracks each motorcycle's **Muayene**, **Sigorta**, and **Kasko** expiry dates and (optionally) maintenance items. Users photograph official documents (ruhsat, sigorta poliçesi, etc.); a local Ollama vision model extracts the relevant dates; the system fires Web Push notifications a configurable number of days before each expiry.

**Primary jobs-to-be-done (in priority order):**

1. Never miss a Muayene / Sigorta / Kasko renewal.
2. Capture a renewal as fast as possible (one photo, no typing if OCR succeeds).
3. (Secondary) Track maintenance by km + time intervals.

## 2. Architecture

```
┌──────────────────────────┐
│ React PWA  (Vercel)      │   <-- public origin: app.<domain>
│  vite-plugin-pwa         │
│  service worker (push)   │
└────────────┬─────────────┘
             │ HTTPS
             ▼
┌──────────────────────────┐
│ Cloudflare Tunnel        │   <-- mototracker.<yourdomain>
│  (cloudflared container) │
└────────────┬─────────────┘
             │
┌────────────┴─────────────────────────────────────────────┐
│ Self-hosted host (always-on machine, Docker compose)     │
│                                                          │
│  ┌─────────────────────┐   ┌────────────────────────┐    │
│  │ api (Node/Express)  │──▶│ ollama  (gemma3 vision)│    │
│  │  better-sqlite3     │   │  http://ollama:11434   │    │
│  │  betterauth         │   └────────────────────────┘    │
│  │  node-cron          │                                 │
│  │  web-push           │   ┌────────────────────────┐    │
│  │  multer             │──▶│ /data (SQLite + uploads│    │
│  └─────────────────────┘   │   bind-mounted volume) │    │
│                            └────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| PWA | `vite-plugin-pwa` (Workbox); custom `sw.ts` for push handler |
| UI primitives | shadcn/ui (Radix under the hood) |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Icons | Lucide + a few custom motorcycle SVGs |
| Forms | react-hook-form + zod |
| Routing | react-router v6 |
| Data fetching | TanStack Query + persisted cache (IndexedDB) for offline reads |
| i18n | react-i18next (TR default, EN toggle) |
| Date utils | date-fns + date-fns-tz (`Europe/Istanbul`) |
| Backend | Node 20 + Express + TypeScript |
| DB | SQLite (`better-sqlite3`, WAL mode), single file at `/data/app.db` |
| Auth | BetterAuth (email/password + magic link + Google OAuth) |
| Email | Resend (or any SMTP) — magic links only |
| OCR | Ollama HTTP API; vision model name is env-configurable, default `gemma4` |
| Cron | node-cron, daily at 09:00 `Europe/Istanbul` |
| Push | `web-push` (VAPID) |
| File uploads | multer → disk; max 10 MB; converted/compressed via sharp before storage |
| Edge / TLS | Cloudflare Tunnel (`cloudflared`) |
| Frontend hosting | Vercel (static build of `apps/web`) |

### Repo layout (single repo, pnpm workspaces)

```
mototracker/
  apps/
    web/                  # React PWA  → Vercel
      src/
      vite.config.ts
      vercel.json         # SPA rewrite + headers
    api/                  # Express + SQLite + Ollama → self-host
      src/
        server.ts
        routes/
        db/
          migrations/
          schema.sql
        ocr/              # Ollama client + prompt + zod parsers
        cron/             # daily-notify job
        push/             # web-push helpers
        auth/             # BetterAuth config
      package.json
      Dockerfile
  packages/
    shared/               # zod schemas, types shared web<->api
  docker-compose.yml      # api + ollama + cloudflared
  .env.example
  README.md
```

## 3. Data Model (SQLite)

BetterAuth manages `user`, `session`, `account`, `verification` (its standard schema).

App tables:

```sql
-- per-user app preferences
CREATE TABLE profile (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'tr' CHECK (language IN ('tr','en')),
  timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bike (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  plate TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  current_km INTEGER,
  color TEXT,
  photo_url TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bike_user ON bike(user_id, archived);

CREATE TABLE dated_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sigorta','kasko','muayene')),
  expires_on TEXT NOT NULL,                 -- ISO date
  provider TEXT,
  policy_no TEXT,
  cost REAL,
  notes TEXT,
  source_document_id TEXT REFERENCES document(id) ON DELETE SET NULL,
  ocr_confidence REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dated_user_type_exp ON dated_item(user_id, type, expires_on);
CREATE INDEX idx_dated_bike_type ON dated_item(bike_id, type, expires_on DESC);

CREATE TABLE maintenance_item (
  id TEXT PRIMARY KEY,
  bike_id TEXT NOT NULL REFERENCES bike(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('engine_oil','chain','brakes','tires','coolant','custom')),
  custom_label TEXT,
  last_done_on TEXT,
  last_done_km INTEGER,
  interval_months INTEGER,
  interval_km INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_maint_bike ON maintenance_item(bike_id, kind);

CREATE TABLE document (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bike_id TEXT REFERENCES bike(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  doc_type TEXT CHECK (doc_type IN ('ruhsat','sigorta','kasko','muayene','unknown')),
  ocr_raw_json TEXT,
  ocr_extracted_json TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  ocr_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_doc_user ON document(user_id, ocr_status);

CREATE TABLE notification_preference (
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('sigorta','kasko','muayene','maintenance')),
  lead_days_csv TEXT NOT NULL DEFAULT '30,7,1',
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item_type)
);

CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_push_user ON push_subscription(user_id);

CREATE TABLE notification_sent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('dated','maintenance')),
  item_id TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  sent_on TEXT NOT NULL,
  UNIQUE (item_kind, item_id, lead_days, sent_on)
);
```

**Conventions / decisions**
- Every app row carries `user_id`. All queries route through middleware that injects `req.user.id` and rejects mismatches; SQLite has no RLS.
- "Current" Sigorta/Kasko/Muayene per bike = row with the greatest `expires_on` for that `(bike_id, type)`. Renewals are inserts, never updates — the history is preserved.
- Maintenance is a single row per `(bike, kind)`; completing a service updates `last_done_on` / `last_done_km`. (A `maintenance_log` audit table is intentionally deferred.)
- IDs are ULIDs (string sortable by creation time).

## 4. OCR Pipeline

### Capture flow

1. PWA collects an image (camera or file). On client: optional resize to max 2000 px long-edge and JPEG quality 85 to keep upload small.
2. `POST /api/documents` (multipart) → server stores file on disk, inserts `document(ocr_status='pending')`, returns `{ documentId }`.
3. Server kicks an in-process worker (a simple async queue with concurrency 1; Ollama isn't designed for parallel calls on a single GPU/CPU).
4. Worker calls Ollama:
   - Endpoint: `POST {OLLAMA_URL}/api/generate`
   - Model: `OLLAMA_VISION_MODEL` (default `gemma4`)
   - Prompt asks for strict JSON: `{ doc_type, plate, dates: { sigorta_expires_on?, kasko_expires_on?, muayene_expires_on?, ruhsat_*? }, confidence }` — dates as ISO `YYYY-MM-DD`.
   - Image passed via `images: [<base64>]`.
   - `format: "json"` enabled so Ollama returns parsed JSON.
5. Server validates the response with a zod schema. Records:
   - `ocr_raw_json` (the full text)
   - `ocr_extracted_json` (the validated, normalized object)
   - `doc_type`, `ocr_status='done'`, `ocr_model`.
6. **Auto-apply** rules:
   - If `doc_type ∈ {sigorta, kasko, muayene}` AND a matching expiry date is present AND `confidence ≥ 0.7` AND the bike can be matched (by plate, or single-bike user, or explicit bike association): create the corresponding `dated_item` with `source_document_id` set.
   - Else: leave the document parsed but unattached, with `needs_review` semantics surfaced in the UI.
7. Frontend polls `GET /documents/:id` every 1.5 s (TanStack Query) until `ocr_status !== 'pending'`, then renders the confirmation sheet.

### Failure handling

- Ollama unreachable → `ocr_status='failed'`; user can retry from the document detail screen.
- JSON parse / schema fail → `ocr_status='failed'`, raw response stored for debugging.
- Image too large / wrong mime → 4xx at upload time, no document row created.

## 5. Notification System

### Subscription flow (per device)

1. Service worker registered at `/sw.js` via vite-plugin-pwa.
2. App triggers an in-page banner ("Bildirimleri açmak ister misin?") after the first dated_item exists; or via Settings.
3. User accepts → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC })`.
4. POST `/api/push/subscribe` with `{ endpoint, keys: { p256dh, auth }, userAgent }` → upsert by `endpoint`.

### Daily cron

- Schedule: `0 9 * * *` in `Europe/Istanbul` (`node-cron`, with `timezone` option).
- For each `(user, item_type)` notification preference (enabled=1):
  - For each `lead` in `lead_days_csv`:
    - Query items expiring exactly `lead` days from today **and not present** in `notification_sent` for `(item_kind, item_id, lead, today)`.
    - For each match: send Web Push to all `push_subscription` rows of that user. Payload:
      ```json
      { "title": "Sigorta 7 gün sonra bitiyor",
        "body": "Ducati Monster · 34 ABC 123",
        "url": "/bikes/<bike_id>/items/<item_id>",
        "tag": "<item_kind>:<item_id>:<lead>" }
      ```
    - Insert `notification_sent` row.
- After send, on `web-push` errors:
  - 404/410 → delete the subscription row (gone forever).
  - 5xx → leave; next day's run retries.

### Service worker push handler (custom code in PWA)

- `push` event → parse JSON → `self.registration.showNotification(title, { body, tag, data: { url }, icon, badge })`.
- `notificationclick` → focus existing client at `data.url` or open a new one.

### VAPID keys

- Generated once via `npx web-push generate-vapid-keys`.
- Public key → frontend env (`VITE_VAPID_PUBLIC_KEY`).
- Private key → API env (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT="mailto:..."`).

## 6. UX (Detail)

### Information hierarchy

1. The three dated chips (Muayene · Sigorta · Kasko) are visually dominant on the dashboard. The "days remaining" number is oversized; the chip pulses subtly when ≤7 days.
2. Maintenance is collapsed into a secondary "Bakımı izle" panel, expandable.
3. Camera capture is the primary action — a floating action button.

### Key screens

- **Sign-in** — minimal, brand mark + 3 buttons (Google, magic link, email/password). Background is a slow animated gradient.
- **Empty state** — illustrated motorbike silhouette, single CTA: "Bir motosiklet ekle".
- **Dashboard** — bike pill carousel up top, hero status card with three chips, maintenance accordion, FAB (camera).
- **Capture / OCR review** — full-screen sheet, photo preview with a horizontal "scanline" animation while processing, then animated reveal of extracted fields. Low-confidence fields get an amber outline and a "Düzenle" affordance.
- **Item detail** — current state, history list (renewals), source document image, "Yenile" + "Manuel düzenle".
- **Settings** — language, per-item notification lead-days as toggleable pill chips (60 / 30 / 14 / 7 / 3 / 1), "Bu cihazda bildirim al" toggle, account, sign out.

### Localization

- Default `tr-TR`. Toggle in Settings. All copy keyed via `i18next`. Date formatting honors locale.
- Domain terms preserved in Turkish (Sigorta, Kasko, Muayene, Bakım, Ruhsat).

### Offline

- Reads served from TanStack Query persisted cache (IndexedDB).
- Writes (especially document uploads) queued in a simple outbox; replayed on reconnect.

## 7. Visual Direction

The brief: **distinctive, impressive, animated — not generic "AI app" look.**

### Mood

Modern garage / motorsport instrument cluster. Dark by default, with a single high-energy accent. Restrained motion that earns its presence — never decorative-only.

### Color

| Token | Light | Dark (default) |
|---|---|---|
| `bg` | `#F7F7F5` | `#0B0B0E` |
| `surface` | `#FFFFFF` | `#15151A` |
| `surface-elev` | `#FFFFFF` | `#1D1D24` |
| `border` | `#E6E6E2` | `#2A2A33` |
| `text` | `#0B0B0E` | `#F4F4F2` |
| `muted` | `#6B6B72` | `#9A9AA3` |
| `accent` | `#E1FF4D` (signal lime) | `#E1FF4D` |
| `success` | `#37D67A` | `#37D67A` |
| `warning` | `#F2A93B` | `#F2A93B` |
| `danger` | `#FF4757` | `#FF4757` |

Accent is used sparingly — primary CTAs, the "current" chip glow, focused states. Status colors drive the chips (success / warning / danger).

### Typography

- **UI**: Geist Sans, fallback `Inter`, weights 400/500/600.
- **Numerals (days remaining, km counters)**: Geist Mono, tabular-nums, weight 600. The hero "days remaining" is `clamp(64px, 10vw, 112px)` with -2% letter spacing.

### Layout

- 8-pt grid, max-width 480 px on mobile dashboard, full-bleed cards above 768 px.
- Cards: `border-radius: 20px`, `1px` inner border, faint inset highlight on top.
- Soft conic-gradient "garage floor" background, very low opacity, scrolls slower than content (subtle parallax).

### Motion (Framer Motion)

- **Bike switcher**: shared layout transitions on the active pill (`layoutId`).
- **Chip status**: spring on mount; danger chips have a 1.6s pulsing glow loop.
- **Camera FAB**: scales 1.0 → 1.04 on hover, taps with a 6 px press-down spring; on capture, expands into the capture sheet via a layout animation.
- **OCR scanline**: a horizontal gradient line sweeps top-to-bottom over the photo while `ocr_status='pending'`; when status flips to `done`, fields appear sequentially with a 60 ms stagger.
- **Page transitions**: slide+fade, 220 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Respect `prefers-reduced-motion` — disable scanline + pulses, keep instantaneous transitions.

### Icons / illustration

- Lucide for utility icons.
- 2–3 custom motorcycle silhouette illustrations (sport, naked, scooter) for empty states and bike type indicator.

### Distinctive touches

- The Sigorta/Kasko/Muayene chips render like instrument-cluster gauges: large numeric, small label, color ring. Inspired by motorcycle dashboards.
- Subtle "ignition" cue on app open: status chips animate in sequentially over ~400 ms.
- OCR review uses the source photo as an immersive backdrop with a gradient mask, foregrounding extracted fields. Feels like the system is reading the document with you.

## 8. API Surface (REST, JSON)

All routes prefixed `/api`. All require auth except auth endpoints.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/*` | BetterAuth-managed (signup, signin, callback, magic-link, etc.) |
| `GET` | `/me` | Current user + profile |
| `PATCH` | `/me` | Update language / timezone |
| `GET` | `/bikes` | List user's bikes |
| `POST` | `/bikes` | Create bike (seeds 3 empty dated placeholders) |
| `PATCH` | `/bikes/:id` | Update bike |
| `DELETE` | `/bikes/:id` | Archive bike |
| `GET` | `/bikes/:id/items` | Dated + maintenance items for bike |
| `POST` | `/bikes/:id/dated-items` | Manual create renewal |
| `PATCH` | `/dated-items/:id` | Edit / confirm OCR-suggested fields |
| `POST` | `/bikes/:id/maintenance-items` | Add maintenance item |
| `PATCH` | `/maintenance-items/:id` | Update / mark done |
| `POST` | `/documents` | Multipart upload, returns `{ documentId }` |
| `GET` | `/documents/:id` | OCR status + extracted fields |
| `GET` | `/documents/:id/file` | Stream file (auth-checked) |
| `GET` | `/notification-preferences` | Get prefs |
| `PUT` | `/notification-preferences/:itemType` | Update lead days |
| `POST` | `/push/subscribe` | Save Web Push subscription |
| `POST` | `/push/unsubscribe` | Remove subscription |
| `POST` | `/push/test` | Send a test notification (dev/debug) |

## 9. Out of Scope / YAGNI

- Email reminders (push only).
- Receipt / cost tracking dashboards.
- Multi-tenant admin panel.
- Real-time sync across devices (eventual via polling/refetch is fine).
- A native mobile app.
- A `maintenance_log` audit table — single-row per kind for now.
- Sharing a bike between users.

## 10. Risks / Open Questions

- **OCR accuracy on Turkish documents** with Gemma 3 vision — needs measurement on real ruhsat/poliçe samples; we'll need a calibration pass and may need a stronger vision model later.
- **iOS Web Push** requires "install to home screen". UI must guide iPhone users through it.
- **Single-host availability** — if the home server is offline at 09:00, that day's run is missed. The cron should also catch up on missed days at startup.
- **Cloudflare Tunnel** rate / connection limits — fine for personal/family scale.

## 11. Acceptance Criteria

- A user can sign in with each of: email/password, magic link, Google.
- A user can add a bike, take a photo of a sigorta poliçesi, and within ~30 seconds see the expiry chip filled in correctly.
- The dashboard's three chips reflect current state with color thresholds (>30d green, ≤30d amber, ≤7d red, expired red+pulse).
- With at least one Web Push subscription, a notification is delivered on the configured lead days (verifiable via `POST /push/test` and via simulating system clock for the cron).
- The PWA is installable on iOS and Android; on iOS, a notification arrives after install + permission grant.
- All copy is Turkish by default; switching to English in Settings updates the entire UI.
- `prefers-reduced-motion` disables scanline / pulses.
