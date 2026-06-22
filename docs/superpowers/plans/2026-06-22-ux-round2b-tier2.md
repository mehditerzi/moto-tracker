# UX Round 2b (Tier 2 polish) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Polish the Garajım app per the Tier-2 audit findings: loading skeletons, a blank-form-load guard, TR date/unit formatting, 44pt tap targets, and capture/OCR robustness (cancel/abort, gallery size cap, pending escape).

**Architecture:** Add a `Skeleton` primitive and a `lib/format.ts` formatter (locale-aware via `Intl`); apply them; bump sub-44pt interactive elements; harden the document upload/review flow with an `AbortController`, a client-side size cap, and an escapable OCR-pending state.

**Tech Stack:** React 18 + TS + Tailwind + TanStack Query + react-i18next; vitest (node env). Capacitor iOS WebView.

## Global Constraints

- Existing Tailwind tokens only (`accent`, `surface`, `surface-elev`, `border`, `border-strong`, `muted`, `danger`, `bg`, `text`, `-dark` variants). Palette lime `#E1FF4D` / dark `#0B0B0E`.
- i18n parity: every user-visible string is a `t()` key in BOTH `tr.json` and `en.json` (`src/locales/parity.test.ts`). TR primary.
- Minimum interactive tap target: 44×44 CSS px (iOS HIG) — use `min-h-[44px]`/`min-w-[44px]` or padding; do not shrink visual density more than needed.
- No `window.confirm/alert`. Safe-area via existing `*-safe` utilities.
- Typecheck `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`; test `pnpm --filter @mototracker/web test`; build `pnpm --filter @mototracker/web build`.

---

### Task 1: `Skeleton` primitive + Dashboard loading state

**Files:** Create `apps/web/src/components/ui/skeleton.tsx`; Modify `apps/web/src/pages/DashboardPage.tsx` (loading branch).

**Interfaces:** Produces `Skeleton` (named export) — a pulsing placeholder box.

- [ ] **Step 1: Create the primitive** — `apps/web/src/components/ui/skeleton.tsx`:

```tsx
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-lg bg-border-strong/20 dark:bg-border/40",
        className,
      )}
    />
  );
}
```

- [ ] **Step 2: Use it in the dashboard loading branch** — in `DashboardPage.tsx`, replace the bare loading `<p>` (the `dash.isLoading` branch) with a skeleton roughly matching the loaded layout: a title bar, an "upcoming" card, an active-vehicle block, and a row of three status chips. Use `Skeleton` boxes (e.g. `<Skeleton className="h-6 w-40" />`, a `h-24` card, three `h-20` chips in a grid). Keep it inside the existing page container so there is no horizontal shift. Do not change the loaded layout.

- [ ] **Step 3: Verify** — typecheck (exit 0), `pnpm --filter @mototracker/web test`, build (`✓ built`).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): Skeleton primitive + dashboard loading skeleton"`

---

### Task 2: Guard the bike edit form from blank-then-reset

**Files:** Modify `apps/web/src/pages/BikeFormPage.tsx`.

- [ ] **Step 1:** In edit mode the form mounts with empty defaults and only resets after `useBike(id)` resolves, which can wipe early typing. Add an early loading guard: when editing (`id` present) and `bike.isLoading` (the query's loading flag), render a `Skeleton`-based form placeholder (a few `Skeleton` rows matching the field stack) instead of the live form, so the inputs only mount once data is present. New mode (no `id`) is unaffected. Import `Skeleton` from `@/components/ui/skeleton`.

- [ ] **Step 2: Verify** — typecheck, test, build all green.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "fix(web): skeleton-guard the bike edit form while loading"`

---

### Task 3: Locale-aware date + unit formatting

**Files:** Create `apps/web/src/lib/format.ts` (+ `apps/web/src/lib/format.test.ts`); Modify `apps/web/src/pages/DatedItemDetailPage.tsx`; Modify `apps/web/src/locales/tr.json`, `en.json`.

**Interfaces:** Produces `formatDate(iso: string, lang: string): string`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDate } from "./format";

describe("formatDate", () => {
  it("formats ISO as dd.MM.yyyy for Turkish", () => {
    expect(formatDate("2025-12-01", "tr")).toBe("01.12.2025");
  });
  it("formats for English without throwing", () => {
    expect(typeof formatDate("2025-12-01", "en")).toBe("string");
    expect(formatDate("2025-12-01", "en")).not.toBe("");
  });
  it("returns the raw input for an unparseable date", () => {
    expect(formatDate("not-a-date", "tr")).toBe("not-a-date");
  });
});
```

- [ ] **Step 2: Run it (fails — module missing).** `pnpm --filter @mototracker/web exec vitest run src/lib/format.test.ts`.

- [ ] **Step 3: Implement** — `apps/web/src/lib/format.ts`:

```ts
// Locale-aware date formatting. TR → dd.MM.yyyy; EN → en-GB style (dd/MM/yyyy).
// Falls back to the raw string if the input can't be parsed, so a bad value is
// never rendered as "Invalid Date".
export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = lang.toLowerCase().startsWith("tr") ? "tr-TR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}
```

- [ ] **Step 4: Run test (passes).**

- [ ] **Step 5: Apply in DatedItemDetailPage** — import `formatDate` and `useTranslation`; render the hero expiry date and each history date via `formatDate(item.data.expiresOn, i18n.language)` (get `i18n` from `useTranslation()`) instead of the raw ISO string. For the hardcoded `"TL"` currency suffix, add an i18n key `items.currency` (tr `"TL"`, en `"TL"` — Turkish Lira either way) and use `t("items.currency")`. Add the keys to both locales.

- [ ] **Step 6: Verify** — typecheck, `pnpm --filter @mototracker/web test` (format + parity green), build.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(web): locale-aware date formatting + currency key"`

---

### Task 4: 44pt tap targets

**Files:** Modify `apps/web/src/components/BikeSwitcher.tsx`, `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/pages/DocumentReviewPage.tsx`, `apps/web/src/pages/BikeFormPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`.

- [ ] **Step 1:** Bring these interactive elements to ≥44px (add `min-h-[44px]`, padding, or wrap icon-only taps in a ≥44px `button`), without changing their behavior or visual identity beyond the larger hit area:
  - `BikeSwitcher.tsx`: the vehicle pills (currently `py-2` ≈ 32px) → `min-h-[44px]`.
  - `SettingsPage.tsx`: the enabled/disabled toggle badge, the lead-day chips, and the language buttons.
  - `DocumentReviewPage.tsx`: the edit `Pencil` icon(s) in OCR diff rows (currently `h-3 w-3` with no padding) → wrap in a `min-h-[44px] min-w-[44px]` button.
  - `BikeFormPage.tsx`: the document-section edit/add icon buttons (`p-1.5`, ≈24px) → `min-h-[44px] min-w-[44px]`.
  - `DashboardPage.tsx`: the inline km-edit pencil affordance, if under 44px.
- Keep existing `aria-label`s; do not remove any.

- [ ] **Step 2: Verify** — typecheck, build (`✓ built`). (Visual sizing confirmed on device in Task 7.)

- [ ] **Step 3: Commit** — `git add -A && git commit -m "fix(web): enlarge tap targets to 44pt minimum"`

---

### Task 5: Document upload — cancel/abort + gallery size cap

**Files:** Modify `apps/web/src/hooks/useDocuments.ts`, `apps/web/src/pages/DocumentCapturePage.tsx`. (Reuse the downscale helper that `CameraCapture.tsx` already uses, if exported; otherwise cap by rejecting oversized files with a clear toast.)

- [ ] **Step 1: Thread an AbortSignal** — change `uploadDocument` to accept an optional `signal?: AbortSignal` in its input and pass it to `fetch({ ..., signal })`. Update `useUploadDocument` to create an `AbortController` per call (store it in a ref the page can access) — or expose an `abort()` from the hook. Keep the existing bearer-token header logic intact.

- [ ] **Step 2: Cancel UI** — in `DocumentCapturePage.tsx`, while an upload is in flight (`upload.isPending`/busy), show a **Cancel** button that calls the hook's abort; on abort, reset to the picker state without a danger toast (an aborted request is not an error — swallow `AbortError`).

- [ ] **Step 3: Gallery size cap** — gallery-picked files currently bypass the in-camera 2400px cap. Before calling the upload, if `file.size` exceeds a threshold (e.g. 8 MB) OR the image's longest edge is very large, downscale via a canvas to a max edge of 2400px (reuse the same approach as `CameraCapture`), or if downscaling isn't readily reusable, reject files over the threshold with `pushToast({ variant: "danger", title: t(...) })` using an existing capture error key. Prefer downscale; only reject if reuse is impractical. If you add any new i18n key, add it to both locales.

- [ ] **Step 4: Verify** — typecheck, test, build all green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(web): cancellable upload + gallery image size cap"`

---

### Task 6: OCR pending state — escape + slow-network message

**Files:** Modify `apps/web/src/pages/DocumentReviewPage.tsx`; possibly add i18n keys.

- [ ] **Step 1:** While `ocrStatus === "pending"`, the page is a dead end. Add: (a) a back/cancel affordance (a `Link` to `/dashboard` or a "back to capture" action) always visible during pending; (b) after a timeout (~20s of polling), show a "this is taking longer than usual" line with a retry-from-capture link. Track elapsed time with a `useEffect` timer/state. Use existing keys where possible; for the "taking longer" copy add `review.stillWorking` (tr + en) — add to both locales and keep parity.

- [ ] **Step 2: Verify** — typecheck, `pnpm --filter @mototracker/web test` (parity green), build.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(web): escapable OCR-pending state with slow-network hint"`

---

### Task 7: Verify

- [ ] **Step 1:** `pnpm --filter @mototracker/web test` → all green.
- [ ] **Step 2:** `pnpm --filter @mototracker/web build` → `✓ built`.
- [ ] **Step 3:** `pnpm --filter @mototracker/web cap:build` → succeeds.
- [ ] **Step 4 (on device):** dashboard shows a skeleton (no pop-in); editing a vehicle never flashes a blank form; expiry dates read `01.12.2025`; pills/chips/pencils are comfortably tappable; uploading shows a working Cancel; a huge gallery photo doesn't hang; OCR pending can be left and shows a slow-network hint.

---

## Self-Review

**Coverage:** skeletons (T1) + blank-form guard (T2); date/unit formatting (T3); tap targets (T4); upload cancel/abort + gallery cap (T5); OCR pending escape (T6) — all Tier-2 findings mapped.
**Placeholders:** new units (Skeleton, formatDate) have complete code + a TDD test for the formatter; application tasks give exact files + element targets.
**Type consistency:** `Skeleton({className})`, `formatDate(iso, lang): string` referenced identically across tasks.
