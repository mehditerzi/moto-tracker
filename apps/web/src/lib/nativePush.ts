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
 */
export async function registerNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return;

    await PushNotifications.addListener("registration", (token) => {
      void api("/api/push/device-token", {
        method: "POST",
        json: { platform: "ios", token: token.value },
      }).catch(() => {
        /* best-effort — retried on next app start */
      });
    });
    await PushNotifications.addListener("registrationError", () => {
      /* swallow — nothing the user can act on */
    });

    await PushNotifications.register();
  } catch {
    /* plugin unavailable / not on device — ignore */
  }
}
