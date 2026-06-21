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
