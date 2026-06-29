# Release notes — June 2026

A large round of fixes, a UX overhaul, and several new features. Everything below
is **live on web** and reaches the iOS app automatically via `server.url` (the
native-only items in "Finish on your Mac" need one App Store build).

## Fixes
- **Push notifications**: were failing with a bare `403`. Root cause — device
  tokens are production (TestFlight/App Store) but `APNS_PRODUCTION` was `false`,
  so sends hit the sandbox. Set to `true`; the sender now surfaces Apple's
  `reason` on any failure. (`5610d87`)
- **Password-reset / magic-link email**: silently no-op'd without Resend. Added a
  local SMTP fallback (Mailpit) — `RESEND_API_KEY` → SMTP → console. (`5ddb64d`)
- **Clean-checkout build**: `cap:build` now builds `@mototracker/shared` first,
  fixing "MIN_TRIP_KM is not exported" on a fresh machine. (`895d104`)

## OCR & vehicle UX
- Human-centred pass: friendly localized API errors, vehicle-type **car/bike
  icons**, persisted active vehicle, OCR results in **ruhsat field order**,
  clearer capture/apply states, self-hosted telemetry. (`91a73df`)
- OCR is now the **entry point for adding a vehicle** (scan a ruhsat → create);
  removed from edit flows + the dashboard camera button. (`18ea8a5`)
- OCR now also reads **colour (R)**, **fuel type (P.3)**, and **first
  registration date (B)**. (`7f23d79`, `0abea69`)

## New features
- **Official-service deep links** — TÜVTÜRK randevu, e-Devlet muayene/sigorta/
  ceza — on the dashboard. (`0f35526`)
- **Vehicle photos** + a **document wallet** (scanned-doc gallery for police
  checks). (`3acc84d`)
- **MTV** (vehicle tax) as a 4th tracked, reminded deadline. (`a83a5b5`)
- **Fuel log** with **L/100km**, **₺/km**, and spend; plus a **premium cost**
  field and a **combined cost rollup**. (`03e423e`, `128701c`)
- **Trip insights** (this-month / total km) and **haptics**. (`8c91230`)
- **Sign in with Apple** — backend wired, button gated on config. (`0421057`)
- **iOS "next deadline" widget** — web bridge live, native scaffold. (`89546f8`)

## New config / schema
- Env: `SMTP_*`, `APPLE_CLIENT_ID/SECRET`; set `APNS_PRODUCTION=true`.
- Migrations: `010_event` (telemetry), `011_trip`, `012_bike_fuel_registration`,
  `013_dated_item_mtv` (CHECK rebuild), `014_fuel_log`.

## Finish on your Mac (one App Store build)
1. `cap sync` adds the **background-geolocation** + **haptics** pods.
2. Location permission + background mode already in `Info.plist` — add an App
   Review note about background location.
3. **Apple Sign-In** → [`apple-signin.md`](./apple-signin.md).
4. **Widget** → [`ios-widget.md`](./ios-widget.md).
5. Bump the build number; this build also locks in `server.url` auto-update.
