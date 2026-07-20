# Garajım docs

## Operations & setup
- [Release notes — June 2026](./RELEASE-NOTES-2026-06.md) — latest round of work
- [Apple Sign-In setup](./apple-signin.md) — Apple Developer config + env
- [iOS widget](./ios-widget.md) — "next deadline" widget (App Group + Xcode)
- [iOS in-app purchases](./ios-iap.md) — extra-vehicle subscriptions (StoreKit 2 + JWS verify)
- [Fuel tracking & receipt OCR](./fuel-ocr.md) — economy math + glm-ocr/qwen pipeline
- [Trip route maps](./trip-maps.md) — polyline capture + MapKit JS setup
- [Native push (APNs)](./app-store/native-push.md)
- [Session handoff](./SESSION-HANDOFF.md)

## App Store
- [Review notes](./app-store/review-notes.md)
- [Listing copy](./app-store/listing-copy.md)
- [App privacy](./app-store/app-privacy.md) · [Privacy policy](./app-store/privacy-policy.md)

## Design & plans
- [Design spec](./superpowers/specs/2026-05-08-mototracker-design.md)
- Phase plans & UX rounds: see [`superpowers/plans/`](./superpowers/plans/)

## Quick reference
- **Env**: see `.env.example` (Resend/SMTP email, APNs push, Google/Apple OAuth,
  OCR/Ollama, VAPID).
- **Run/deploy**: `docker compose --profile mail up -d --build api` (serves the
  web build + applies migrations on boot).
- **iOS**: `pnpm --filter @mototracker/web cap:build` → Xcode archive. The app
  loads the live web via `server.url`, so most changes need no resubmission.
