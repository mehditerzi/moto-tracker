# Rewriting Garajım as a native Swift app

A scoping document, written 2026-09-05, for replacing the Capacitor wrapper
with a native SwiftUI client. It states what the rewrite actually costs, what
it does not touch, the one thing it takes away that nothing gives back, and a
phase order that keeps a shippable app at every step.

---

## What is actually being rewritten

Measured, not estimated:

| Layer | Size | Fate under a rewrite |
|---|---|---|
| `apps/api` — 25 route modules | **7,800 lines** | **Untouched.** A Swift client speaks the same HTTP API. |
| `packages/shared` | shared types/constants | Untouched (or mirrored as Swift types) |
| `apps/web/src` — 22 pages, 162 files | **25,900 lines** | **All of it.** This is the rewrite. |
| `apps/web/ios/App` native Swift | 647 lines | Kept in spirit: `StoreKitPlugin` (383 lines) and the widget (93) already exist and mostly survive |

So the rewrite is one layer, not the system. The server, the database, the OCR
pipeline, entitlements, sharing rules and fleet logic all stay exactly where
they are. That is the good news, and it is what makes this tractable at all.

The bad news is that 25,900 lines of UI is not a weekend. It is 22 screens,
several of which (document capture + OCR review, the trip map, group riding,
sharing and handover) are the hard kind.

---

## The one thing you give up

**Web deploys stop reaching users.**

Today `capacitor.config.ts` sets `server.url` to the live site, so a change to
`apps/web` is in front of every installed app on next launch — no build, no
review, no waiting. That property is why a bug found on a Friday is fixed on a
Friday.

A native app cannot do that. Every UI change becomes: build → Xcode Cloud →
App Store review → release. **The incident that prompted this rewrite is a
release-pipeline failure** — version 1.3 sat unsubmitted for six days while
users ran a July binary — and a native rewrite makes that class of failure
strictly more expensive, because after it there is no way to route around
review at all.

That is not an argument against rewriting. It is an argument for fixing the
release pipeline *first* (done: `scripts/asc-submit-version.mjs`) and going in
with open eyes.

Also lost: the web app itself and any Android future. Today they are the same
codebase. After this they are two.

## What you get

Real answers, not marketing:

- **Camera and OCR capture** — `AVFoundation` + `VisionKit`'s document scanner
  gives edge detection, auto-capture and perspective correction for free. This
  is the single biggest UX win; the web capture flow cannot approach it.
- **Maps** — native `MapKit` instead of the JS SDK plus a token endpoint.
  Smoother, cheaper, works offline, no `mapkit.ts` token dance.
- **Trip tracking** — native `CoreLocation` significant-change and background
  modes are far more reliable than `@capacitor-community/background-geolocation`,
  which is the most fragile dependency in the project.
- **StoreKit 2** — already written (`StoreKitPlugin.swift`), drops the bridge.
- **Widgets, Live Activities, Siri/Shortcuts** — a live "trip in progress"
  Activity is genuinely nice and is not reachable from a web view.
- **Feel** — real gestures, real navigation transitions, no WKWebView scroll
  quirks, no safe-area CSS workarounds, instant cold start with no network.

---

## Scope inventory

The 22 screens, grouped by how hard they are to port.

**Straightforward (forms and lists) — the bulk of the screens**
`SignIn`, `SignUp`, `ForgotPassword`, `ResetPassword`, `MagicLinkSent`,
`Onboarding`, `Landing`, `NotFound`, `Bikes`, `BikeForm`, `DatedItemDetail`,
`DatedItemForm`, `MaintenanceForm`, `Fuel`, `Groups`, `Settings`, `Dashboard`

**Hard — allow real time for these**
- `DocumentCapture` + `DocumentReview` + `capture/` (batch ruhsat capture, grouped OCR review)
- `Map` (full-screen routes, multi-stop, live group riding)
- `Trips` (background GPS, battery behaviour)
- Sharing + ownership handover (`components/share`) — the permission model is subtle
- IAP paywall + entitlement ceilings

**Recommend NOT porting: `fleet/`**
The org/fleet surface is ~2,500 API lines (`orgFleet`, `orgMembers`,
`orgContracts`, `orgImport`) and is explicitly *invisible to consumers*
(commit `8727cb0`). It is a business tool used on bigger screens. Porting it to
SwiftUI is a large fraction of the total work for a small fraction of the
users.

**Keep it in a `WKWebView` inside the native app.** This is not a compromise —
it is the right architecture. Consumer surface native, back-office surface web.

---

## Phase order

Each phase ends with something shippable. No phase requires the next one to
exist.

**Phase 0 — the auth story: DONE, and it is not a blocker**

Verified against production on 2026-09-05, so nobody has to re-derive it.

`better-auth` is configured with the `bearer()` plugin
(`apps/api/src/auth/index.ts`), and `requireUser` resolves the session by
handing the whole request header set to `getSession()` — it never reads the
cookie directly. So bearer support is uniform across all **70** `requireUser`
call sites for free, and the **34** `requireOrgRole` guards chain off
`req.user` rather than resolving a session of their own, so they inherit it too.

Measured, signing in as the review demo account and sending **only**
`Authorization: Bearer …` with no cookie whatsoever:

```
/api/me  /api/bikes  /api/dashboard  /api/trips  /api/fuel-logs
/api/documents  /api/entitlement  /api/orgs  /api/catalog/makes
/api/notification-preferences  /api/mapkit-token  /api/ride-groups/active
                                                          → all 200
```

Only three routers skip `requireUser` — `health`, `publicConfig` and `privacy`
(a static policy page) — and all three are public by design.

**A native client needs no API changes to authenticate.** That is the single
biggest de-risking fact in this document: the rewrite is a pure UI project.

Two notes for whoever builds it. Live group riding authenticates over
WebSocket with a one-time ticket from `GET /api/ride-groups/ws-ticket`, not
with the bearer token — that pattern ports to native unchanged. And Sign in
with Apple should move to `ASAuthorizationAppleIDProvider`, which retires the
Safari cookie-jar bug class permanently rather than configuring around it.

**Phase 1 — skeleton + auth + vehicle list**
Tab bar, networking layer, generated models, sign-in, vehicle list and detail.
Ship to TestFlight. Proves the API contract end to end.

**Phase 2 — the data-entry core**
Dated items, maintenance, fuel, groups, dashboard. After this the app is
genuinely usable for the core promise (track renewal dates).

**Phase 3 — capture and OCR**
`VisionKit` scanner into the existing `/api/documents` pipeline. Highest
user-visible payoff.

**Phase 4 — trips and maps**
`CoreLocation` + `MapKit`, then group riding.

**Phase 5 — commerce and platform**
StoreKit 2 (port the plugin), push, widgets, Live Activities.

**Phase 6 — fleet via embedded web view, then cut over**
Ship, watch crash-free rate, retire the Capacitor build.

---

## Honest estimate

For one experienced iOS engineer, full parity minus fleet: **3–5 months**.
Phases 1–2 (a genuinely useful app) land much sooner — think weeks, not months.
Working with me on it compresses the mechanical parts (models, networking,
forms) considerably; it does not compress the hard parts, which are design
decisions and device testing.

The realistic risk is not the code. It is that the Capacitor app keeps working
the whole time and the rewrite stalls at 80% — which is the normal fate of
rewrites that run beside a working system. The phase order above is chosen so
that stalling at any boundary still leaves something worth shipping.

---

## Decisions needed before Phase 1

1. **Minimum iOS version.** 17+ unlocks the good SwiftUI APIs and Live
   Activities. Current deployment target is 15.0.
2. ~~Bearer tokens or cookies~~ — **settled.** Bearer, verified end to end
   against production; no API work required. See Phase 0.
3. **Does the web app stay?** If yes it needs its own maintenance budget; if no,
   the fleet web view has to be reworked or fleet becomes native after all.
4. **Fleet in a web view** — confirm that is acceptable.

---

## Related

- `docs/ios-release.md` — the release pipeline and its three failure modes
- `docs/ios-iap.md` — StoreKit products and verification
- `docs/ocr.md`, `docs/trip-maps.md` — the pipelines a native client would call
