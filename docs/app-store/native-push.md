# Native push (APNs) — setup

The web app uses **Web Push (VAPID)**, which does **not** fire inside the iOS
Capacitor WebView. For reminders to push on the iOS app you must use **APNs**.
This repo ships the plumbing; the steps below activate it. It stays **off until
the four `APNS_*` env vars are set** — until then nothing changes.

## What's already wired

- **Client** (`apps/web/src/lib/nativePush.ts`): on the native iOS app, after
  sign-in, requests notification permission, registers with APNs, and POSTs the
  device token to `POST /api/push/device-token`. No-op on web.
- **API**: `device_token` table (migration `006`), the `device-token`
  endpoints, and an APNs sender (`apps/api/src/notify/apns.ts`) that the daily
  dispatcher calls alongside Web Push — gated behind config.

## 1. Apple side (one-time)

1. **Apple Developer → Certificates, Identifiers & Profiles → Keys → +**:
   create a key with **Apple Push Notifications service (APNs)** enabled.
   Download the **`.p8`** file (you can only download it once). Note the
   **Key ID** and your **Team ID**.
2. Ensure the App ID `com.mehditerzi.garajim` has the **Push Notifications**
   capability enabled.

## 2. Xcode (one-time, on the Mac)

Open `apps/web/ios/App` in Xcode → target **App → Signing & Capabilities → + Capability**:
- add **Push Notifications**,
- add **Background Modes** → check **Remote notifications**.

(These write the `aps-environment` entitlement; they can't be set reliably from
the CLI, so they're done here.)

## 3. API env (production)

Set on the API (e.g. in `.env` / compose `environment:`):

```
APNS_KEY=<base64 of the .p8 file contents>     # base64 -i AuthKey_XXXX.p8
APNS_KEY_ID=<10-char Key ID>
APNS_TEAM_ID=<10-char Team ID>
APNS_BUNDLE_ID=com.mehditerzi.garajim
APNS_PRODUCTION=true                            # false while testing on a dev build
```

`APNS_KEY` accepts the raw PEM or a base64 of it. Redeploy the API after setting.

## 4. Verify (on a real device — not the simulator)

1. Build & run the app on a physical iPhone (`pnpm --filter @mototracker/web cap:build` → Xcode → Run).
2. Sign in → accept the notification prompt.
3. Confirm a `device_token` row was created for your user.
4. Trigger the daily dispatch (or wait for the cron) with a due reminder and
   confirm the push arrives.

> **Caveat:** the APNs transport in `apns.ts` (HTTP/2 + ES256 provider-token
> JWT, Node built-ins) has not been exercised against live APNs in this repo.
> Verify the first send end-to-end; if Apple rejects the token, check
> `APNS_PRODUCTION` (sandbox vs production must match the build type) and the
> `apns-topic` / Team/Key IDs.
