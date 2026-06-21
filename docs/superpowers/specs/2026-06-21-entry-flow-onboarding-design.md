# Entry-Flow Redesign — Onboarding + Clean Auth (Round 1)

_Date: 2026-06-21 · Status: approved design_

## Context

Garajım's logged-out entry is a single `LandingPage` that stacks a marketing hero
(icon, headline, paragraph), a 4-card feature strip, **and** the sign-in/sign-up
form on one screen. On smaller phones this overflows the viewport and scrolls —
undesirable for an auth screen — and there is no dedicated "intro" moment.

This is **Round 1** of a broader UX audit. Scope here is the entry flow only.
Dashboard / capture / settings audits are later rounds.

## Goals

1. A dedicated **onboarding carousel** (3 slides) shown on first launch, like a
   typical app, that introduces what Garajım does.
2. A **clean, viewport-locked auth screen** (no scroll) for sign-in / sign-up.
3. Onboarding is shown **once** and remembered.

Non-goals: backend changes, new auth methods, illustrations/artwork beyond the
existing icon + instrument-cluster aesthetic, changes to any post-login screen.

## Design

### Onboarding carousel — `OnboardingPage` (route `/welcome`)

- 3 swipeable slides (horizontal scroll-snap + drag), each composed of:
  large icon tile (lime glow, reusing the existing app-icon-tile treatment) →
  headline → one-line subtext.
  - Slide 1 — **Scan**: `ScanLine` icon. "Photograph your documents, dates are
    read automatically."
  - Slide 2 — **Remind**: `Bell` icon. "Never miss Sigorta / Kasko / Muayene /
    Bakım."
  - Slide 3 — **Garage**: the garage `BrandMark`. "All your vehicles in one
    garage — maintenance and km tracked."
- Page-dot indicator reflecting the active slide.
- **Skip** affordance (top-right) and one primary button that reads **Next**
  while advancing and **Get Started** on the last slide.
- Skip or Get Started → set the onboarded flag → navigate to `/sign-in`.
- Backdrop: same ignition-glow + hairline grid as today, for visual continuity.

### Clean auth screen — slimmed `LandingPage`

- Remove the hero paragraph and the 4-card feature strip (that content now lives
  in onboarding).
- Keep: compact brand header (app-icon tile + "Garajım" wordmark) + the
  sign-in/sign-up tab `Card` + form (forms themselves unchanged).
- **Viewport-locked, no scroll:** root uses `h-[100dvh]` + `overflow-hidden`
  with `pt-safe/pb-safe/pl-safe/pr-safe`; the card is vertically centered and
  fits without scrolling. Keep the ignition-glow backdrop.
- iOS keyboard: rely on native focus scroll for the focused input; the screen
  stays a single non-scrolling viewport (no extra scroll container introduced).

### Routing / gate

- A small `useOnboarded` hook owns the `localStorage` flag
  (`garajim_onboarded`), with `isOnboarded()` and `markOnboarded()`.
- New route `/welcome` → `OnboardingPage`. If already onboarded, `/welcome`
  redirects to `/sign-in`.
- Logged-out entry: when not onboarded, redirect to `/welcome`; otherwise the
  existing `/sign-in`. (Today `RequireAuth` redirects logged-out users to
  `/sign-in`; that redirect becomes onboarding-aware.)

### i18n

Add an `onboarding` namespace to `tr.json` + `en.json`:
`slides[].title`, `slides[].body` for the 3 slides, plus `skip`, `next`,
`getStarted`. Wording matches the approved copy (TR primary, EN parallel).

### Components (small + isolated)

- `apps/web/src/pages/OnboardingPage.tsx` — the carousel screen.
- `apps/web/src/hooks/useOnboarded.ts` — the localStorage flag.
- `apps/web/src/pages/LandingPage.tsx` — slimmed to auth-only (hero + feature
  strip removed). Shared form primitives unchanged.
- Wiring in the router (`App` routes + the logged-out redirect).

No backend, no DB, no API. Purely client-side; the flag is per-device
(localStorage persists in WKWebView on iOS).

## Data flow

`localStorage["garajim_onboarded"]` is the only persisted state. Read on entry
to decide welcome-vs-auth; written on Skip / Get Started. No network involved.

## Error / edge handling

- localStorage unavailable (private mode / disabled) → treat as "not onboarded"
  and never throw (the hook swallows storage errors, mirroring `nativeAuth.ts`).
- Direct navigation to `/welcome` when already onboarded → redirect to
  `/sign-in`. Direct navigation to `/sign-in` always works.
- Logged-in users never see `/welcome` (the existing auth redirect sends them to
  the dashboard before the onboarding gate applies).

## Testing

- i18n: assert the new `onboarding.*` keys exist in both `tr.json` and `en.json`
  (parallel structure), consistent with existing locale coverage.
- Manual / on-device after `cap:build`: onboarding shows once on a fresh install,
  Skip and Get Started both reach `/sign-in` and don't reappear on next launch;
  the auth screen does not scroll on a small device.

## Out of scope (later rounds)

Dashboard, capture/scan, and settings UX polish — to be audited and prioritized
after this round ships.
