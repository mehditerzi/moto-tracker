import { useEffect } from "react";

/**
 * Keeps the screen on while a ride is active.
 *
 * Uses the W3C Screen Wake Lock API, which WKWebView has supported since iOS
 * 16.4 — no plugin, no new dependency, and it degrades to a no-op everywhere it
 * is missing. (`@capacitor-community/keep-awake` would be the belt-and-braces
 * native route, but it is not installed and adding a dependency for this is not
 * worth it while the web API covers the supported iOS range.)
 *
 * iOS releases the lock whenever the page is hidden — a notification, the app
 * going to the background — and never re-takes it on its own, so the lock is
 * re-acquired on every `visibilitychange`. Without that, the screen stays on
 * for the first five minutes of a ride and then quietly stops.
 */

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}
interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

function wakeLock(): WakeLockLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const lock = wakeLock();
    if (!lock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      lock
        .request("screen")
        .then((s) => {
          if (cancelled) void s.release().catch(() => {});
          else sentinel = s;
        })
        // Denied (low power mode, unsupported) — the ride carries on regardless.
        .catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
