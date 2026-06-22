import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "./api";

/**
 * Register the device for native APNs push (Capacitor iOS only) and send the
 * resulting device token to the API. No-op on the web — browsers use Web Push
 * (VAPID) via the service worker instead. Safe to call on every app start;
 * the backend upserts by token.
 *
 * Requires the Push Notifications capability + Background Modes (remote
 * notifications) enabled in Xcode — see docs/app-store/native-push.md.
 *
 * Every step records a {@link PushDiag} so on-device registration failures are
 * visible in Settings instead of silently swallowed (APNs registration can
 * fail even with permission granted — e.g. a provisioning profile without
 * Push — and there is otherwise no signal).
 */

export type PushDiagState =
  | "idle"
  | "permission-denied"
  | "registering"
  | "registered"
  | "register-error"
  | "register-timeout"
  | "post-error";

/** How long to wait for APNs before declaring the registration hung. */
const REGISTER_TIMEOUT_MS = 30_000;

export interface PushDiag {
  state: PushDiagState;
  message?: string;
  at: number;
}

const DIAG_KEY = "moto.pushDiag";
export const PUSH_DIAG_EVENT = "moto:push-diag";

function setDiag(state: PushDiagState, message?: string): void {
  const diag: PushDiag = { state, message, at: Date.now() };
  try {
    localStorage.setItem(DIAG_KEY, JSON.stringify(diag));
    window.dispatchEvent(new CustomEvent<PushDiag>(PUSH_DIAG_EVENT, { detail: diag }));
  } catch {
    /* noop */
  }
}

export function getPushDiag(): PushDiag {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    if (raw) return JSON.parse(raw) as PushDiag;
  } catch {
    /* noop */
  }
  return { state: "idle", at: 0 };
}

let listenersBound = false;

export async function registerNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      setDiag("permission-denied");
      return;
    }

    // Bind the result listeners once; re-calling register() reuses them.
    if (!listenersBound) {
      listenersBound = true;
      await PushNotifications.addListener("registration", (token) => {
        void api("/api/push/device-token", {
          method: "POST",
          json: { platform: "ios", token: token.value },
        })
          .then(() => setDiag("registered"))
          .catch((e) => setDiag("post-error", (e as Error).message ?? String(e)));
      });
      await PushNotifications.addListener("registrationError", (err) => {
        setDiag("register-error", (err as { error?: string }).error ?? "unknown");
      });
    }

    setDiag("registering");
    await PushNotifications.register();
    // register() resolving does NOT mean a token arrived — the APNs callback is
    // async. On a Simulator that can't issue tokens (Intel Mac without T2, or
    // iOS < 16) neither callback ever fires, so the state would hang on
    // "registering" forever. Time out and say so honestly.
    window.setTimeout(() => {
      if (getPushDiag().state === "registering") setDiag("register-timeout");
    }, REGISTER_TIMEOUT_MS);
  } catch (e) {
    setDiag("register-error", (e as Error).message ?? String(e));
  }
}
