import { getDb } from "../db/index.js";
import { sendPush } from "./webPushClient.js";
import { sendApns, apnsConfigured } from "./apns.js";

/**
 * The one place a push actually leaves this process.
 *
 * Extracted from `dispatcher.ts` when event-driven sends arrived. There are now
 * two callers with completely different schedules — the 9am reminder batch and
 * a claim filed at 03:12 — and exactly one of them may own the rules for
 * "deliver to every endpoint this user has, in parallel but bounded, and delete
 * the ones the push service says are dead". A second copy of the `gone`-purge
 * logic is how a dead endpoint ends up purged on one path and retried forever
 * on the other.
 */

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Collapse key — a second notification with the same tag replaces the first. */
  tag: string;
}

export interface SendOutcome {
  sent: number;
  expired: number;
  anyOk: boolean;
}

/**
 * How many push requests are in flight at once across the whole run. The 9am
 * batch is entirely network-bound, so serializing it made the run scale with
 * the user count; an unbounded Promise.all would instead hand FCM/APNs a
 * thundering herd and earn us a 429. Same shape as the OCR worker's semaphore.
 */
export const PUSH_CONCURRENCY = 8;

/**
 * How many notifications are being prepared at once. Bounds memory too: the
 * due list can be large, and each in-flight notification holds its recipient's
 * endpoint rows.
 */
export const NOTIFICATION_CONCURRENCY = 8;

/** Run `fn` over `items` with a fixed pool of workers, preserving order. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.queue.shift()?.();
    };
  }
}

/**
 * Deliver one payload to every endpoint a user has, in parallel up to the
 * semaphore's limit. Counters are folded in by the caller once all the sends
 * have settled, and every DB write happens back on this (single) thread after
 * the awaits — better-sqlite3 is synchronous, so there is no interleaving
 * inside a statement, and each row we delete is keyed by its own id.
 */
export async function pushToUser(
  userId: string,
  payload: PushPayload,
  sem: Semaphore,
): Promise<SendOutcome> {
  const db = getDb();

  const subs = db
    .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
    .all(userId) as SubRow[];
  const tokens = apnsConfigured()
    ? (db
        .prepare("SELECT id, token FROM device_token WHERE user_id = ? AND platform = 'ios'")
        .all(userId) as { id: string; token: string }[])
    : [];

  type Result = {
    ok: boolean;
    gone: boolean;
    table: "push_subscription" | "device_token";
    id: string;
  };

  const jobs: Array<Promise<Result>> = [
    ...subs.map(async (s): Promise<Result> => {
      const release = await sem.acquire();
      try {
        const res = await sendPush({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
          payload,
        });
        return {
          ok: res.ok,
          gone: !res.ok && res.gone === true,
          table: "push_subscription",
          id: s.id,
        };
      } finally {
        release();
      }
    }),
    // Native push (APNs) to the user's iOS devices — no-op unless configured.
    ...tokens.map(async (d): Promise<Result> => {
      const release = await sem.acquire();
      try {
        const res = await sendApns(d.token, {
          title: payload.title,
          body: payload.body,
          url: payload.url,
        });
        return { ok: res.ok, gone: !res.ok && res.gone === true, table: "device_token", id: d.id };
      } finally {
        release();
      }
    }),
  ];

  const results = await Promise.all(jobs);

  const out: SendOutcome = { sent: 0, expired: 0, anyOk: false };
  for (const r of results) {
    if (r.ok) {
      out.anyOk = true;
      out.sent += 1;
    } else if (r.gone) {
      // Two notifications for the same user run against the same endpoint
      // list, so both can come back 410 for it. Count the row only when this
      // DELETE is the one that actually removed it.
      const del = db.prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(r.id);
      if (del.changes > 0) out.expired += 1;
    }
  }
  return out;
}
