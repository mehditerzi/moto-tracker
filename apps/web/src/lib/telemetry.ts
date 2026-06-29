import { env } from "@/env";
import { isNative, getBearerToken } from "./nativeAuth";

/**
 * Tiny, best-effort product telemetry. `track()` queues an event; the queue is
 * flushed in batches (every few seconds, and immediately when the tab is hidden)
 * to our own `/api/events` sink. It must never throw or block the UI — every
 * failure path is swallowed. No third party is involved.
 */

interface QueuedEvent {
  name: string;
  props?: Record<string, unknown>;
  ts: string;
}

const FLUSH_DELAY_MS = 4000;
const MAX_BATCH = 50;

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// One id per app session, so events can be grouped into a journey server-side.
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function track(name: string, props?: Record<string, unknown>): void {
  queue.push({ name, props, ts: new Date().toISOString() });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush(keepalive = false): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    // Same auth model as lib/api.ts: web sends the httpOnly cookie; native sends
    // the bearer token (the cross-site cookie is dropped by WKWebView).
    const bearer = isNative() ? getBearerToken() : null;
    await fetch(`${env.VITE_API_URL}/api/events`, {
      method: "POST",
      credentials: "include",
      // keepalive lets the request outlive a page being hidden/unloaded.
      keepalive,
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({
        events: batch.map((e) => ({ name: e.name, props: e.props, sessionId, ts: e.ts })),
      }),
    });
  } catch {
    // Telemetry is best-effort — never surface or retry-storm. Dropped on failure.
  }
}

// Flush when the user backgrounds the app (the reliable "leaving" signal on
// mobile — `beforeunload` is unreliable there). Guarded for non-browser envs.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}
