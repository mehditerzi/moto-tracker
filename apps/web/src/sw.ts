/// <reference lib="webworker" />
/// <reference types="vite/client" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

/**
 * Delete precaches from previous builds BEFORE registering this one.
 *
 * Without this they accumulate, and the failure mode is a blank white screen:
 * the old worker keeps serving its cached index.html, which references asset
 * hashes that no longer exist on the server (Vite empties dist each build). If
 * the browser has evicted part of that old precache — iOS/WKWebView is
 * aggressive about this — those chunks miss the cache, 404 on the network, and
 * the entry module graph fails to load. That happens outside React, so the
 * ErrorBoundary never runs and the user gets an empty page with no way back.
 */
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Garajım", body: event.data?.text() ?? "" };
  }
  const title = payload.title ?? "Garajım";
  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    icon: "/icons/icon-192.svg",
    badge: "/icons/badge-72.png",
    data: { url: payload.url ?? "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          (c as WindowClient).navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
