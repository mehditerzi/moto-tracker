# UX Round 2a (Tier 1 fixes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the Tier-1 audit findings — broken native confirms, missing pending/error states, an i18n bug, and camera safe-area — in the Garajım app.

**Architecture:** Add a promise-based `ConfirmSheet` (iOS-style action sheet) provider replacing `window.confirm` (which WKWebView suppresses); add `disabled`/pending guards and error toasts to mutation call sites; fix one hardcoded i18n suffix; add safe-area insets to the full-screen camera chrome.

**Tech Stack:** React 18 + TS + Tailwind + framer-motion + react-i18next + TanStack Query; vitest (node env). The app is a Capacitor iOS WebView (`capacitor://localhost`).

## Global Constraints

- Reuse existing Tailwind tokens only (`accent`, `surface`, `surface-elev`, `border`, `border-strong`, `muted`, `danger`, `bg`, `text` and their `-dark` variants). Palette lime `#E1FF4D` / dark `#0B0B0E`.
- Every user-visible string is a `t()` key present in BOTH `tr.json` and `en.json` (parity enforced by `src/locales/parity.test.ts`). TR primary.
- `window.confirm`/`window.alert` must NOT be used (suppressed in WKWebView).
- Safe areas via CSS env() insets (`pt-safe`/`pb-safe`/`pl-safe`/`pr-safe` utilities already exist in the project).
- Web tests: `pnpm --filter @mototracker/web test`. Typecheck: `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit`. Build: `pnpm --filter @mototracker/web build`.

---

### Task 1: `ConfirmSheet` provider + `useConfirm` hook

**Files:**
- Create: `apps/web/src/components/ConfirmSheet.tsx`
- Modify: `apps/web/src/routes.tsx` (wrap app with `ConfirmProvider`)
- Modify: `apps/web/src/locales/tr.json`, `apps/web/src/locales/en.json` (add `common.confirm`)
- Test: `apps/web/src/locales/parity.test.ts` (extend the onboarding-keys style block, or rely on existing parity `it`s — see step)

**Interfaces:**
- Produces: `ConfirmProvider` (wraps app) and `useConfirm(): (opts) => Promise<boolean>` where `opts = { title: string; message?: string; confirmLabel?: string; destructive?: boolean }`. Consumed by Task 2.

- [ ] **Step 1: Add i18n key** — add `"confirm"` to the existing `common` object in BOTH locales: tr `"confirm": "Onayla"`, en `"confirm": "Confirm"`. (`common.cancel` already exists.) Keep JSON valid.

- [ ] **Step 2: Create the component** — `apps/web/src/components/ConfirmSheet.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  // Close on Escape while open.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {createPortal(
        <AnimatePresence>
          {opts && (
            <motion.div
              className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 pb-safe pl-safe pr-safe"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => close(false)}
            >
              <motion.div
                role="alertdialog"
                aria-modal="true"
                aria-label={opts.title}
                className="mx-auto mb-2 w-full max-w-md overflow-hidden rounded-2xl"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="rounded-2xl bg-surface-elev p-4 text-center dark:bg-surface-elev-dark">
                  <p className="text-[15px] font-semibold">{opts.title}</p>
                  {opts.message && (
                    <p className="mt-1 text-[13px] text-muted dark:text-muted-dark">{opts.message}</p>
                  )}
                  <button
                    type="button"
                    autoFocus
                    onClick={() => close(true)}
                    className={`mt-4 min-h-[48px] w-full rounded-xl px-4 text-[15px] font-semibold transition ${
                      opts.destructive
                        ? "bg-danger/10 text-danger"
                        : "bg-accent text-black"
                    }`}
                  >
                    {opts.confirmLabel ?? t("common.confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="mt-2 min-h-[48px] w-full rounded-xl px-4 text-[15px] font-medium text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
                  >
                    {opts.cancelLabel ?? t("common.cancel")}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </ConfirmContext.Provider>
  );
}
```

- [ ] **Step 3: Wrap the app** — in `apps/web/src/routes.tsx`, import `ConfirmProvider` and wrap the existing tree inside `QueryClientProvider` (so `useConfirm` is available everywhere, including AppShell pages). In the `Routes()` function, change:

```tsx
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <InstallBanner />
    </QueryClientProvider>
```
to:
```tsx
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster />
      <InstallBanner />
    </QueryClientProvider>
```
Add the import: `import { ConfirmProvider } from "@/components/ConfirmSheet";`

- [ ] **Step 4: Verify** — `pnpm --filter @mototracker/web exec tsc -p tsconfig.json --noEmit` (exit 0); `pnpm --filter @mototracker/web test` (parity green with the new `common.confirm`); `pnpm --filter @mototracker/web build` (`✓ built`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ConfirmSheet.tsx apps/web/src/routes.tsx apps/web/src/locales/tr.json apps/web/src/locales/en.json
git commit -m "feat(web): iOS-style ConfirmSheet (replaces window.confirm)"
```

---

### Task 2: Replace `window.confirm` at the 4 destructive sites + disable their buttons while pending

**Files:**
- Modify: `apps/web/src/pages/BikeFormPage.tsx` (archive confirm; also `onArchive` error handling and Save/Archive disabled-while-pending)
- Modify: `apps/web/src/pages/DatedItemFormPage.tsx` (delete confirm)
- Modify: `apps/web/src/pages/MaintenanceFormPage.tsx` (delete confirm; Save + Delete disabled-while-pending)
- Modify: `apps/web/src/pages/SettingsPage.tsx` (sign-out confirm)

**Interfaces:**
- Consumes: `useConfirm` from `@/components/ConfirmSheet` (Task 1).

- [ ] **Step 1: BikeFormPage** — add `const confirm = useConfirm();`. Replace the archive handler's `if (!confirm(t("bike.archiveConfirm"))) return;` with:

```tsx
    const ok = await confirm({ title: t("bike.archiveConfirm"), confirmLabel: t("bike.archive"), destructive: true });
    if (!ok) return;
```
Wrap the archive mutation in `try/catch`, on error `pushToast({ variant: "danger", title: t("common.error"), description: (e as Error).message })`. Add `disabled={createMut.isPending || updateMut.isPending}` to the Save button and `disabled={archiveMut.isPending}` to the Archive control. (Rename the local `confirm` import carefully — the page's handler currently calls the global `confirm`; ensure all references now use the hook.)

- [ ] **Step 2: DatedItemFormPage** — add `const confirm = useConfirm();`. Replace `if (!confirm(...)) return;` in the delete handler with the awaited `confirm({ title: t("items.confirmDelete"), confirmLabel: t("items.delete"), destructive: true })` pattern. (Submit/delete already guard `isPending` per the audit — leave those.)

- [ ] **Step 3: MaintenanceFormPage** — add `const confirm = useConfirm();`. Replace the delete `if (!confirm(t("maintenance.deleteConfirm"))) return;` with the awaited pattern (`destructive: true`). Add `disabled={createMut.isPending || updateMut.isPending}` to Save and `disabled={deleteMut.isPending}` to Delete.

- [ ] **Step 4: SettingsPage** — add `const confirm = useConfirm();`. Replace `if (!confirm(t("settings.signOutConfirm"))) return;` with `if (!(await confirm({ title: t("settings.signOutConfirm"), confirmLabel: t("settings.signOut"), destructive: true }))) return;`.

- [ ] **Step 5: Verify** — typecheck (exit 0), `pnpm --filter @mototracker/web test`, build (`✓ built`). Grep to confirm no stray `confirm(` calling the global remains: `grep -rn "window.confirm\|[^.]confirm(" apps/web/src/pages` should show only `useConfirm()` calls and the awaited `confirm({...})` calls.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/BikeFormPage.tsx apps/web/src/pages/DatedItemFormPage.tsx apps/web/src/pages/MaintenanceFormPage.tsx apps/web/src/pages/SettingsPage.tsx
git commit -m "feat(web): use ConfirmSheet for destructive actions; guard pending buttons"
```

---

### Task 3: Remaining pending/disabled guards + error toasts

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx` (sign-out: pending + disable)
- Modify: `apps/web/src/pages/SettingsPage.tsx` (test-push disabled; pref-toggle error toasts)
- Modify: `apps/web/src/pages/DashboardPage.tsx` (km update: disable + suppress blur while pending)
- Modify: `apps/web/src/components/MaintenancePanel.tsx` (loading + error states)

**Interfaces:** none new.

- [ ] **Step 1: AppShell sign-out** — add `const [signingOut, setSigningOut] = useState(false);`. Make `onSignOut` set it true, `await signOut()` in try/finally, then navigate; add `disabled={signingOut}` to the sign-out `Button`. Import `useState` from react.

- [ ] **Step 2: SettingsPage** — add `disabled={test.isPending}` to the test-notification button. In `toggleLead` and `toggleEnabled`, change `void update.mutateAsync(...)` to `await`/`.catch()` that calls `pushToast({ variant: "danger", title: t("settings.testFailed") })` (reuse an existing danger key, or add `settings.updateFailed` to both locales if clearer — if you add a key, add it to tr+en).

- [ ] **Step 3: DashboardPage km update** — in `QuickKmUpdate`, do not fire the save on blur while `update.isPending`; add `disabled={update.isPending}` to the input and guard the blur handler with `if (update.isPending) return;`.

- [ ] **Step 4: MaintenancePanel** — replace `const items = q.data ?? []` usage so that `q.isLoading` shows a small loading line (e.g. `t("dashboard.loading")`) and `q.isError` shows an error line (`t("dashboard.loadFailed")`), and only the resolved-empty case shows the existing "no maintenance" text. Use the existing keys; do not invent UI copy beyond those keys.

- [ ] **Step 5: Verify** — typecheck, test, build all green. If any new i18n key was added, the parity test must still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AppShell.tsx apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/components/MaintenancePanel.tsx
git commit -m "fix(web): pending/disabled guards + error toasts on mutations"
```

---

### Task 4: i18n fix — lead-day chips show literal "-7g" in English

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx:~270`
- Modify: `apps/web/src/locales/tr.json`, `apps/web/src/locales/en.json`
- Test: `apps/web/src/locales/parity.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Add i18n key (failing test first)** — add to the parity test an `it` asserting `settings.daysBeforeShort` exists in both locales. Run it; expect FAIL.

- [ ] **Step 2: Add keys** — tr: `"daysBeforeShort": "-{{count}}g"`; en: `"daysBeforeShort": "-{{count}}d"` inside the `settings` object of each locale.

- [ ] **Step 3: Use it** — in SettingsPage replace the hardcoded `` `-${n}g` `` chip label with `t("settings.daysBeforeShort", { count: n })`, and add `aria-label={t("settings.daysBefore", { n })}` (the full key already exists) to each non-zero chip button.

- [ ] **Step 4: Verify** — typecheck, `pnpm --filter @mototracker/web test` (parity + new key), build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsPage.tsx apps/web/src/locales/tr.json apps/web/src/locales/en.json apps/web/src/locales/parity.test.ts
git commit -m "fix(web): localize lead-day chip suffix (-7g/-7d)"
```

---

### Task 5: Camera safe-area insets

**Files:**
- Modify: `apps/web/src/components/CameraCapture.tsx` (top bar ~line 247; shutter row ~line 286)

**Interfaces:** none new.

- [ ] **Step 1: Add insets** — on the full-screen camera top bar container, add top safe-area padding so the close button clears the notch/Dynamic Island (use the project's `pt-safe` utility alongside the existing padding). On the bottom shutter/gallery row, add `pb-safe` so controls clear the home indicator. Do not change the camera logic.

- [ ] **Step 2: Verify** — typecheck (exit 0), build (`✓ built`). (Visual correctness is verified on device in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CameraCapture.tsx
git commit -m "fix(ios): safe-area insets on full-screen camera chrome"
```

---

### Task 6: Verify

**Files:** none.

- [ ] **Step 1:** `pnpm --filter @mototracker/web test` → all green.
- [ ] **Step 2:** `pnpm --filter @mototracker/web build` → `✓ built`.
- [ ] **Step 3:** `pnpm --filter @mototracker/web cap:build` → web + `cap sync ios` succeed.
- [ ] **Step 4 (on device, manual):** delete/archive/sign-out now show the action sheet (no silent fire); Save/test-push/sign-out can't double-fire; a failed toggle shows a toast; lead-day chips read correctly in EN; camera close + shutter clear the notch/home indicator.

---

## Self-Review

**Coverage:** ConfirmSheet (Task 1) → window.confirm at 4 sites (Task 2); pending/disabled across Save/Archive/Delete/sign-out/test-push/km (Tasks 2-3); error toasts on archive + pref toggles + MaintenancePanel states (Tasks 2-3); i18n -7g fix (Task 4); camera safe-area (Task 5). All Tier-1 findings mapped.

**Placeholder scan:** ConfirmSheet has full code; wiring tasks reference exact files + the audit's line numbers and give the exact replacement patterns. No "TBD".

**Type consistency:** `useConfirm()` returns `(opts: ConfirmOptions) => Promise<boolean>`; all call sites `await confirm({ title, confirmLabel?, destructive? })`. `ConfirmProvider` wraps inside `QueryClientProvider` so the hook resolves in every page.
