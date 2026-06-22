# Garajım — Session Handoff / Working Context

_Last updated: 2026-06-22. This is a working-context dump so a fresh session (esp. on the server) can continue without re-deriving everything. No secrets here — only var **names** and public identifiers._

## What the app is

**Garajım** (renamed from "MotoTracker"; user-facing name = "Garajım" = "my garage") — a self-hosted PWA, wrapped as a **native iOS app via Capacitor 8**, for tracking **all vehicles'** Sigorta / Kasko / Muayene / Bakım expiry dates + maintenance. Users photograph documents; a local **Ollama** vision model extracts dates; reminders fire before expiry. Turkish-market (TR default via i18n fallback; device language honored).

- Monorepo (pnpm): `apps/api` (Node/Express/SQLite/better-auth), `apps/web` (React+TS+Vite+Tailwind), `packages/shared`.
- iOS wrapper: `apps/web/ios` (SwiftPM, no CocoaPods). appId `com.mehditerzi.mototracker`, appName "Garajım".
- Build the iOS bundle: `pnpm --filter @mototracker/web cap:build` (bakes `VITE_API_URL=https://mototracker.mehditerzi.com`); open Xcode: `pnpm --filter @mototracker/web exec cap open ios`.

## Deployment

- **Docker Compose + Cloudflare Tunnel** serving `https://mototracker.mehditerzi.com`. The **api container serves BOTH the web (WEB_ROOT) and the API**, bound to `127.0.0.1:8787`.
- `docker compose up -d` starts **only `api`** by default; `ngrok` and `cloudflared` are opt-in profiles (`--profile ngrok` / `--profile cloudflare`). ngrok is legacy/dead — Cloudflare only.
- Server repo lives at `~/moto-tracker` (user `ostamai`). Deploy = `git pull && docker compose up -d --build api`.
- `bootstrap.sh` auto-detects `CLOUDFLARED_TOKEN` in `.env` → Cloudflare mode (skips ngrok).

### 🔴 CURRENT BLOCKER (2026-06-22): HTTP 530 on everything
After a deploy, the whole origin returns Cloudflare **530** (fonts, favicon, `/api/me`, sign-in). 530 = tunnel can't reach origin. Likely causes:
- **A:** duplicate/orphaned `mototracker-api` container (fixed `container_name`) or port-8787 conflict → new container didn't start. Fix: `docker compose down --remove-orphans && docker compose up -d --build api`.
- **B (most common):** `cloudflared` runs as its own container but isn't on the api's Docker network, so ingress `http://api:8787` is unreachable. Fix: run cloudflared via this compose (`docker compose --profile cloudflare up -d cloudflared`, ingress `http://api:8787`), or if it's a host systemd process use `http://localhost:8787` and restart it.
- Diagnose: `docker ps -a`, `docker compose ps`, `curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/health` (200 = app fine → it's the tunnel), `docker compose logs --tail=60 api`.

## Auth — IMPORTANT architecture

- **Web** uses the better-auth httpOnly **cookie** (same-origin).
- **Native iOS uses a BEARER TOKEN, not the cookie** — WKWebView drops the cross-site cookie. Flow: better-auth `bearer()` plugin server-side; CORS `exposedHeaders:["set-auth-token"]`; client stores `set-auth-token` in localStorage on native (`Capacitor.isNativePlatform()`) and sends `Authorization: Bearer …`. See `apps/web/src/lib/{nativeAuth,authClient,api}.ts`.
- **Gotcha already fixed:** the document upload uses a raw `fetch` (FormData) and now attaches the bearer token itself (`apps/api`→ no; it's `apps/web/src/hooks/useDocuments.ts`). Any NEW raw fetch to `/api/*` must attach the native bearer token too, or it 401s on iOS.
- `.env` has `WEB_ORIGIN=capacitor://localhost` + `CROSS_SITE_COOKIES=true` (harmless, not the active mechanism anymore).

## Push notifications (APNs) — IN v1

- Capability wired: `apps/web/ios/App/Garajım.entitlements` (`aps-environment`), AppDelegate registration handlers, `@capacitor/push-notifications` plugin. Client `registerNativePush()` requests permission on sign-in and POSTs the token to `/api/push/device-token`.
- **.p8 APNs key:** Key ID `BT78GDURP8`, Team ID `289RQZ99Z9`, bundle `com.mehditerzi.mototracker`. The key file is `~/Downloads/AuthKey_BT78GDURP8.p8` on the user's Mac (NOT committed — user decided to keep it in server `.env` instead). `APNS_*` env passed through `docker-compose.yml`.
- **Server `.env` must have** `APNS_KEY` (base64 of the .p8), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` (user said these are now added on the server).
- **`APNS_PRODUCTION` MUST match the build:** `false` for Xcode "Run"/debug (sandbox tokens), `true` for TestFlight/App Store (production tokens). Mismatch → Apple rejects the token.
- **Test flow:** `/api/push/test` now sends APNs (not just Web Push); SettingsPage shows a native "Send test" button on iOS. On device: sign in → Allow notifications → Settings → Send test. "0 sent" usually = no device_token (permission not granted) or APNS_PRODUCTION mismatch.
- `apns.ts` transport (HTTP/2 + ES256 JWT) was untested against live APNs as of this writing — verify the first real send.

## Env vars (server `.env`, gitignored — values NOT here)

`APP_BASE_URL=https://mototracker.mehditerzi.com`, `SESSION_SECRET` (≥16 chars; keep stable or users get logged out), `WEB_ORIGIN=capacitor://localhost`, `CROSS_SITE_COOKIES=true`, `CLOUDFLARED_TOKEN` (⚠️ was exposed once in chat — should be rotated), `OLLAMA_URL`/`OLLAMA_VISION_MODEL=gemma4`, `VAPID_*`, `EMAIL_FROM`, `APNS_*`, `CRON_*`.

## What shipped recently (all on `main`)

- **Entry flow:** `/welcome` onboarding carousel (3 slides), slimmed viewport-locked auth screen. Logged-out users always see onboarding (no once-flag).
- **Brand:** garage logo + icons/splash regenerated (lime `#E1FF4D` / dark `#0B0B0E`); favicon/public icons are hand-authored SVG → rasterized via sharp; native via `capacitor-assets generate --ios`.
- **iOS fix:** `contentInset: "never"` in `capacitor.config.ts` (was doubling the safe-area inset → big header gap).
- **UX Tier 1:** `ConfirmSheet` (iOS action sheet) replacing WKWebView-broken `window.confirm` at delete/archive/sign-out; pending/disabled guards; error toasts; camera safe-area; lead-day i18n.
- **UX Tier 2:** `Skeleton` + dashboard/bike-edit loading; `lib/format.ts` TR date `dd.MM.yyyy`; 44pt tap targets; cancellable upload (AbortController) + gallery image size cap (`downscaleImageFile` in `lib/camera.ts`); escapable OCR-pending state.
- **Critical fix:** document upload now attaches the native bearer token (scanning was 401 on iOS).
- **Push:** `/api/push/test` sends APNs; native Settings test button.

## What's next

1. **Resolve the 530** (tunnel/container — see blocker above).
2. **On-device verify:** login persists (bearer), **document scan works** (the 401 fix), onboarding, action-sheet confirms, dates `01.12.2025`, **push test** lands.
3. **App Store submit (push in v1):** confirm Push capability in Xcode (entitlement exists), set `APNS_PRODUCTION=true` before archiving, App Store Connect (name Garajım, privacy URL `https://mototracker.mehditerzi.com/privacy`, screenshots, demo account in review notes), archive → upload → submit. (Offered to draft listing copy + review notes — not yet written.)
4. **UX Tier 3 — DEFERRED until AFTER App Store publish** (user decision): a11y `role="switch"`/`aria-checked`, dashboard "+N more" overflow, read-only vehicle detail page, install-banner share-icon/dismiss consistency, upload-failure retry affordance.

## Process notes

- Work happens directly on `main` (the deploy branch); server `git pull`s it. Plans/specs under `docs/superpowers/{specs,plans}/`. UX rounds were run via the superpowers subagent-driven flow (implementer → review per task → final whole-branch review).
- Commits co-authored: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Privacy policy served login-free at `/privacy` (`apps/api/src/routes/privacy.ts`), contact `mehditerzi32@hotmail.com`.
- The live web is the api-served build — to see changes you must `git pull && docker compose up -d --build api` on the server AND `cap:build` + Xcode rebuild for iOS.
