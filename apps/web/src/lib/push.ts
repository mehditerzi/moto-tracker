import { api } from "./api";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface PushPublicKeyResponse {
  publicKey: string | null;
}

export async function getPushPublicKey(): Promise<string | null> {
  const r = await api<PushPublicKeyResponse>("/api/push/public-key");
  return r.publicKey;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.ready;
  return reg;
}

export async function subscribePushOnDevice(publicKey: string): Promise<{ id: string }> {
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") throw new Error("Bildirim izni reddedildi");
  }
  const reg = await ensureServiceWorker();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as ArrayBuffer,
  });
  const json = sub.toJSON();
  return await api<{ id: string }>("/api/push/subscribe", {
    method: "POST",
    json: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      userAgent: navigator.userAgent,
    },
  });
}

export async function unsubscribePushOnDevice(): Promise<void> {
  const reg = await ensureServiceWorker();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api<void>("/api/push/unsubscribe", {
    method: "POST",
    json: { endpoint: sub.endpoint },
  });
  await sub.unsubscribe();
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await ensureServiceWorker();
  return reg.pushManager.getSubscription();
}
