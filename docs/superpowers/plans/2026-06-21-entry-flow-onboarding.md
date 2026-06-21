# Entry-Flow Onboarding + Clean Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-launch onboarding carousel and slim the logged-out `LandingPage` into a clean, non-scrolling auth screen.

**Architecture:** Three new/changed front-end units — `lib/onboarding.ts` (a localStorage-backed "seen" flag, plain functions, no React state), `pages/OnboardingPage.tsx` (a 3-slide CSS scroll-snap carousel), and a slimmed `pages/LandingPage.tsx` (auth only, viewport-locked). The router gains a `/welcome` route and an onboarding-aware logged-out redirect. No backend changes.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + react-router-dom + react-i18next + framer-motion + lucide-react; vitest (node env) for tests.

## Global Constraints

- Palette: lime accent `#E1FF4D` / dark `#0B0B0E`; reuse existing tokens (`accent`, `accent-dim`, `surface`, `border`, `border-strong`, `muted`) — do not introduce new colors.
- App is fully i18n'd (TR primary, EN parallel). Every user-visible string is a `t()` key in **both** `tr.json` and `en.json`; `src/locales/parity.test.ts` enforces key parity.
- Onboarding state is client-only, per-device, in `localStorage` under key `garajim_onboarded` (value `"1"`). Storage access must never throw (mirror `src/lib/nativeAuth.ts`).
- Web tests run under vitest **node** environment (no DOM, no `@testing-library`). Component screens are verified via `tsc` + build + on-device, not render tests.
- Web typecheck: `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`. Web tests: `pnpm --filter @mototracker/web test`.

---

### Task 1: i18n — onboarding copy (TR + EN)

**Files:**
- Modify: `apps/web/src/locales/tr.json`
- Modify: `apps/web/src/locales/en.json`
- Test: `apps/web/src/locales/parity.test.ts` (add one `it` block)

**Interfaces:**
- Produces: i18n keys `onboarding.skip`, `onboarding.next`, `onboarding.getStarted`, and `onboarding.slides.{scan,remind,garage}.{title,body}` in both locales. Consumed by Task 3 (OnboardingPage).

- [ ] **Step 1: Write the failing test** — append this `it` block inside the existing `describe("locale key parity", …)` in `apps/web/src/locales/parity.test.ts` (after the last `it`, before the closing `});`):

```ts
  it("includes the onboarding keys in both locales", () => {
    for (const key of [
      "onboarding.skip",
      "onboarding.next",
      "onboarding.getStarted",
      "onboarding.slides.scan.title",
      "onboarding.slides.scan.body",
      "onboarding.slides.remind.title",
      "onboarding.slides.remind.body",
      "onboarding.slides.garage.title",
      "onboarding.slides.garage.body",
    ]) {
      expect(trKeys.has(key)).toBe(true);
      expect(enKeys.has(key)).toBe(true);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mototracker/web exec vitest run src/locales/parity.test.ts`
Expected: FAIL — `expected false to be true` on the onboarding keys.

- [ ] **Step 3: Add the keys** — in `apps/web/src/locales/tr.json`, add a top-level `"onboarding"` object (e.g. right after the `"install"` block, keeping valid JSON commas):

```json
  "onboarding": {
    "skip": "Geç",
    "next": "İleri",
    "getStarted": "Başla",
    "slides": {
      "scan": {
        "title": "Belgeni çek",
        "body": "Sigorta, kasko ve muayene belgelerini çek — tarihler otomatik okunur."
      },
      "remind": {
        "title": "Vadeyi kaçırma",
        "body": "Sigorta, kasko, muayene ve bakım dolmadan önce seni uyarırız."
      },
      "garage": {
        "title": "Tüm araçların tek garajda",
        "body": "Araçlarını ekle; bakım ve kilometre takibini tek yerden yap."
      }
    }
  }
```

In `apps/web/src/locales/en.json`, add the parallel block:

```json
  "onboarding": {
    "skip": "Skip",
    "next": "Next",
    "getStarted": "Get Started",
    "slides": {
      "scan": {
        "title": "Scan your documents",
        "body": "Photograph your insurance, kasko and inspection papers — dates are read automatically."
      },
      "remind": {
        "title": "Never miss a deadline",
        "body": "We warn you before insurance, kasko, inspection and maintenance fall due."
      },
      "garage": {
        "title": "All your vehicles, one garage",
        "body": "Add your vehicles and track maintenance and mileage in one place."
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mototracker/web test`
Expected: PASS — parity suite green (no tr/en mismatch, onboarding keys present).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/locales/tr.json apps/web/src/locales/en.json apps/web/src/locales/parity.test.ts
git commit -m "feat(web): onboarding i18n copy (tr+en)"
```

---

### Task 2: Onboarding flag — `lib/onboarding.ts`

**Files:**
- Create: `apps/web/src/lib/onboarding.ts`
- Test: `apps/web/src/lib/onboarding.test.ts`

**Interfaces:**
- Produces: `isOnboarded(): boolean`, `markOnboarded(): void`, `clearOnboarded(): void`. Consumed by Task 3 (OnboardingPage calls `markOnboarded`) and Task 5 (router calls `isOnboarded`).

- [ ] **Step 1: Write the failing test** — create `apps/web/src/lib/onboarding.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOnboarded, markOnboarded, clearOnboarded } from "./onboarding";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

describe("onboarding flag", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("defaults to not onboarded", () => {
    expect(isOnboarded()).toBe(false);
  });

  it("markOnboarded persists the flag", () => {
    markOnboarded();
    expect(isOnboarded()).toBe(true);
  });

  it("clearOnboarded resets the flag", () => {
    markOnboarded();
    clearOnboarded();
    expect(isOnboarded()).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => markOnboarded()).not.toThrow();
    expect(isOnboarded()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mototracker/web exec vitest run src/lib/onboarding.test.ts`
Expected: FAIL — cannot resolve `./onboarding` (module does not exist).

- [ ] **Step 3: Write minimal implementation** — create `apps/web/src/lib/onboarding.ts`:

```ts
// First-launch onboarding flag. Per-device, client-only, in localStorage.
// Storage access is guarded so it never throws (private mode / disabled), the
// same defensive pattern as nativeAuth.ts.

const KEY = "garajim_onboarded";

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isOnboarded(): boolean {
  try {
    return store()?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboarded(): void {
  try {
    store()?.setItem(KEY, "1");
  } catch {
    /* storage unavailable — ignore */
  }
}

export function clearOnboarded(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mototracker/web exec vitest run src/lib/onboarding.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/onboarding.ts apps/web/src/lib/onboarding.test.ts
git commit -m "feat(web): onboarding localStorage flag"
```

---

### Task 3: `OnboardingPage` carousel

**Files:**
- Create: `apps/web/src/pages/OnboardingPage.tsx`

**Interfaces:**
- Consumes: `markOnboarded` from `@/lib/onboarding` (Task 2); `onboarding.*` i18n keys (Task 1); `Button` from `@/components/ui/button`; `BrandMark` from `@/components/BrandMark`.
- Produces: `OnboardingPage` (named export) — consumed by Task 5 (router).

- [ ] **Step 1: Create the component** — create `apps/web/src/pages/OnboardingPage.tsx`:

```tsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, Bell, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { markOnboarded } from "@/lib/onboarding";

// `Icon: null` → render the garage BrandMark instead of a lucide glyph.
const SLIDES: { key: string; Icon: LucideIcon | null }[] = [
  { key: "scan", Icon: ScanLine },
  { key: "remind", Icon: Bell },
  { key: "garage", Icon: null },
];

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = index >= SLIDES.length - 1;

  function finish() {
    markOnboarded();
    navigate("/sign-in", { replace: true });
  }

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  }

  function next() {
    if (last) {
      finish();
      return;
    }
    const el = trackRef.current;
    if (el) el.scrollTo({ left: (index + 1) * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-bg pl-safe pr-safe pt-safe pb-safe dark:bg-bg-dark">
      {/* ignition glow — same accent backdrop as the auth screen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55dvh] [mask-image:radial-gradient(75%_60%_at_50%_0%,#000,transparent)]"
      >
        <div className="absolute left-1/2 top-[-20%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px] dark:bg-accent/20" />
      </div>

      {/* Skip */}
      <div className="relative flex justify-end px-5 pt-3">
        <button
          type="button"
          onClick={finish}
          className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
        >
          {t("onboarding.skip")}
        </button>
      </div>

      {/* Slide track (native CSS scroll-snap — smooth in WKWebView) */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="relative flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map(({ key, Icon }) => (
          <section
            key={key}
            className="flex h-full w-full shrink-0 snap-center flex-col items-center justify-center gap-6 px-8 text-center"
          >
            <div className="relative">
              <div aria-hidden className="absolute inset-0 -z-10 rounded-[1.6rem] bg-accent/30 blur-2xl" />
              <div className="grid h-[84px] w-[84px] place-items-center rounded-[1.6rem] border border-border bg-surface text-text shadow-card dark:border-border-dark dark:bg-surface-dark dark:text-text-dark">
                {Icon ? (
                  <Icon className="h-9 w-9 text-accent-dim" />
                ) : (
                  <BrandMark showWordmark={false} className="[&>svg]:h-10 [&>svg]:w-auto" />
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <h2 className="text-balance text-[26px] font-semibold leading-tight tracking-tight">
                {t(`onboarding.slides.${key}.title`)}
              </h2>
              <p className="max-w-[32ch] text-[15px] leading-relaxed text-muted dark:text-muted-dark">
                {t(`onboarding.slides.${key}.body`)}
              </p>
            </div>
          </section>
        ))}
      </div>

      {/* Dots + primary action */}
      <div className="relative flex flex-col items-center gap-5 px-8 pb-6 pt-2">
        <div className="flex items-center gap-1.5">
          {SLIDES.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-accent" : "w-1.5 bg-border-strong dark:bg-border"
              }`}
            />
          ))}
        </div>
        <Button type="button" variant="accent" size="lg" onClick={next} className="w-full shadow-ignite">
          {t(last ? "onboarding.getStarted" : "onboarding.next")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS (exit 0, no output). The component is wired into the router in Task 5; an unused-export warning is not produced by `tsc`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/OnboardingPage.tsx
git commit -m "feat(web): onboarding carousel page"
```

---

### Task 4: Slim `LandingPage` to a viewport-locked auth screen

**Files:**
- Modify: `apps/web/src/pages/LandingPage.tsx:1-129` (imports + the `LandingPage` function; the form components and shared primitives below stay unchanged)

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged `LandingPage` export (still `{ mode: "signin" | "signup" }`).

- [ ] **Step 1: Replace the imports** — change the top icon import (line 7) to drop the now-unused marketing icons (keep only `Eye`, `EyeOff`):

Replace:
```tsx
import { Eye, EyeOff, ScanLine, Bell, Wrench, Gauge } from "lucide-react";
```
with:
```tsx
import { Eye, EyeOff } from "lucide-react";
```

- [ ] **Step 2: Delete the `FEATURES` constant** — remove lines 21-26:

```tsx
const FEATURES = [
  { Icon: ScanLine, key: "scan" },
  { Icon: Bell,     key: "remind" },
  { Icon: Wrench,   key: "maintain" },
  { Icon: Gauge,    key: "km" },
] as const;
```

- [ ] **Step 3: Replace the `LandingPage` function body** — replace the entire `export function LandingPage({ mode }: Props) { … }` (lines 28-129) with this slimmed, viewport-locked version (the `TabBtn`, `SignInForm`, `SignUpForm`, `Field`, `PasswordInput` definitions further down the file are unchanged):

```tsx
export function LandingPage({ mode }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-bg dark:bg-bg-dark">
      {/* Ignition glow — the one splash of colour, like an LED behind the cluster */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55dvh] [mask-image:radial-gradient(75%_60%_at_50%_0%,#000,transparent)]"
      >
        <div className="absolute left-1/2 top-[-20%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px] dark:bg-accent/20" />
      </div>
      {/* Hairline grid for instrument-cluster depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-border-strong opacity-[0.06] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:38px_38px] [mask-image:radial-gradient(80%_50%_at_50%_0%,#000,transparent)] dark:text-border"
      />

      <main className="relative mx-auto flex h-[100dvh] max-w-md flex-col justify-center gap-8 px-6 pb-10 pl-safe pr-safe pt-safe">
        {/* ── compact brand header ── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex flex-col items-center gap-3 text-center"
        >
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 rounded-[1.4rem] bg-accent/30 blur-2xl" />
            <div className="grid h-[68px] w-[68px] place-items-center rounded-[1.4rem] border border-border bg-surface text-text shadow-card dark:border-border-dark dark:bg-surface-dark dark:text-text-dark">
              <BrandMark showWordmark={false} className="[&>svg]:h-9 [&>svg]:w-auto" />
            </div>
          </div>
          <span className="text-[13px] font-semibold uppercase tracking-micro text-muted dark:text-muted-dark">
            Garajım
          </span>
        </motion.div>

        {/* ── auth ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-1 bg-surface-elev p-1 dark:bg-surface-elev-dark">
              <TabBtn label={t("auth.signIn")} active={mode === "signin"} onClick={() => navigate("/sign-in")} />
              <TabBtn label={t("auth.signUp")} active={mode === "signup"} onClick={() => navigate("/sign-up")} />
            </div>
            <CardContent className="p-6">
              {mode === "signin" ? <SignInForm /> : <SignUpForm />}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck (catches any leftover unused import)**

Run: `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS (exit 0). If it reports an unused `ScanLine`/`Bell`/`Wrench`/`Gauge`, a deletion in Step 1/2 was missed — fix and re-run.

- [ ] **Step 5: Build to confirm the bundle compiles**

Run: `pnpm --filter @mototracker/web build`
Expected: `✓ built` with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/LandingPage.tsx
git commit -m "feat(web): slim landing into a viewport-locked auth screen"
```

---

### Task 5: Router — `/welcome` route + onboarding-aware redirect

**Files:**
- Modify: `apps/web/src/routes.tsx:1-24` (imports), `:43-45` (RequireAuth redirect), `:49-55` (route table)

**Interfaces:**
- Consumes: `OnboardingPage` (Task 3); `isOnboarded` from `@/lib/onboarding` (Task 2).
- Produces: route `/welcome`; logged-out users with no onboarding flag are sent to `/welcome`.

- [ ] **Step 1: Add imports** — after the existing `LandingPage` import (line 7), add:

```tsx
import { OnboardingPage } from "@/pages/OnboardingPage";
import { isOnboarded } from "@/lib/onboarding";
```

- [ ] **Step 2: Make the logged-out redirect onboarding-aware** — in `RequireAuth`, replace:

```tsx
  if (me.isError || !me.data) {
    return <Navigate to="/sign-in" replace />;
  }
```
with:
```tsx
  if (me.isError || !me.data) {
    return <Navigate to={isOnboarded() ? "/sign-in" : "/welcome"} replace />;
  }
```

- [ ] **Step 3: Add a guarded `/welcome` route** — add this small component just above `const router = createBrowserRouter([` (line 49):

```tsx
// Show onboarding only until it's been seen; afterwards skip straight to auth.
function WelcomeRoute() {
  if (isOnboarded()) return <Navigate to="/sign-in" replace />;
  return <OnboardingPage />;
}
```

Then add the route as the first entry in the `createBrowserRouter([…])` array (before the `/sign-in` entry on line 50):

```tsx
  { path: "/welcome", element: <WelcomeRoute /> },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`
Expected: PASS (exit 0).

- [ ] **Step 5: Full web test + build**

Run: `pnpm --filter @mototracker/web test && pnpm --filter @mototracker/web build`
Expected: all vitest suites PASS; `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes.tsx
git commit -m "feat(web): /welcome onboarding route + onboarding-aware redirect"
```

---

### Task 6: Verify on web + device

**Files:** none (verification only).

- [ ] **Step 1: Run the full web suite once more**

Run: `pnpm --filter @mototracker/web test`
Expected: all PASS (parity incl. onboarding keys, onboarding flag, camera, StatusChip).

- [ ] **Step 2: Local web smoke (dev server)**

Run: `pnpm --filter @mototracker/web dev`, open the app in a fresh private window (no `garajim_onboarded` key).
Expected: hitting a protected route while logged out lands on `/welcome`; swiping/scrolling moves through the 3 slides with the dots tracking; **Skip** and **Get Started** both go to `/sign-in`; reloading no longer shows onboarding (flag set); the sign-in screen does not scroll.

- [ ] **Step 3: Build the iOS bundle**

Run: `pnpm --filter @mototracker/web cap:build`
Expected: web build + `cap sync ios` succeed.

- [ ] **Step 4: On-device check (Xcode → run on iPhone)**

Expected on a fresh install: onboarding shows once, Skip/Get Started reach sign-in and it never reappears on relaunch; the auth screen does not scroll; sign-in still works (bearer-token auth from the prior change).

- [ ] **Step 5: (No commit — verification only.)** If `cap:build` changed files under `apps/web/ios/App/App/public`, commit them:

```bash
git add apps/web/ios
git commit -m "chore(ios): sync onboarding build into the iOS bundle"
```

---

## Self-Review

**Spec coverage:**
- Onboarding carousel (3 slides, dots, Skip, Next/Get Started, scroll-snap) → Task 3. ✓
- Shown once via `localStorage` flag → Task 2 + Task 5 (`WelcomeRoute`, redirect). ✓
- Clean, viewport-locked auth screen (hero + feature strip removed) → Task 4. ✓
- Onboarding-aware logged-out redirect → Task 5 Step 2. ✓
- `/welcome` redirects to `/sign-in` when already onboarded → Task 5 Step 3 (`WelcomeRoute`). ✓
- i18n `onboarding.*` (TR+EN) → Task 1. ✓
- localStorage-unavailable safety → Task 2 (guarded) + its test. ✓
- Testing (i18n parity, manual on-device) → Tasks 1, 6. ✓
- Spec said a `useOnboarded` hook; plan uses `lib/onboarding.ts` plain functions (no React state needed) — intentional YAGNI simplification, same module responsibility.

**Placeholder scan:** none — every code/JSON block is complete.

**Type consistency:** `isOnboarded`/`markOnboarded`/`clearOnboarded` defined in Task 2 are used with identical names in Tasks 3 and 5. `OnboardingPage` named export (Task 3) imported the same way in Task 5. Slide keys `scan`/`remind`/`garage` match between Task 1 (i18n) and Task 3 (`SLIDES`).
