# App Review notes (App Store Connect → App Review Information)

Paste the relevant parts into the **App Review Information → Notes** field, and
fill the **Sign-In required** demo account fields.

## Demo account

> Provide a real, working account on the production API. Create it ahead of
> review and confirm it can sign in.

- **Email:** `review@mototracker.app` _(create this; don't use a personal account)_
- **Password:** `__set_a_password__`

## What the app does

Garajım helps a vehicle owner track the expiry dates of their Turkish
vehicle documents — **sigorta** (insurance), **kasko**, and **muayene**
(periodic inspection) — and reminds them before each expires. The user
photographs a document; the app reads the dates and vehicle details
automatically (OCR) and the user confirms them.

## How to exercise it during review

1. Sign in with the demo account above.
2. **Camera / OCR (core native feature):** tap **Take photo** → grant camera
   permission → frame a document in the guide rectangle → capture. The app
   crops, checks readability, uploads, and extracts the dates/fields, then
   shows a review screen to confirm. (A sample ruhsat image is attached to this
   submission for convenience.)
3. The confirmed dates appear on the dashboard with a countdown; reminders are
   scheduled before expiry.

## Notes for the reviewer

- **Camera permission** is required for the document-scanning feature; the
  purpose string is in `Info.plist` (`NSCameraUsageDescription`).
- The backend is **self-hosted**; it is reachable at
  `https://mototracker.mehditerzi.com` for the duration of review.
- No third-party advertising or tracking SDKs are included.

## Pre-submission checklist (engineering)

- [ ] Production API is up at `https://mototracker.mehditerzi.com`.
- [ ] API env: `CROSS_SITE_COOKIES=true` and `WEB_ORIGIN=capacitor://localhost`
      are set **and the API redeployed** — otherwise sign-in does not persist in
      the WebView and review will fail.
- [ ] Demo account created and verified to sign in.
- [ ] App icon + launch screen present (generated via `@capacitor/assets`).
- [ ] Camera tested on a real device (not just simulator — the simulator has no
      camera).
- [ ] Privacy policy URL is live (see `privacy-policy.md`) and entered in the
      App Information page.
