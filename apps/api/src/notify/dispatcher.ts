import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { sendPush } from "./webPushClient.js";
import { sendApns, apnsConfigured } from "./apns.js";
import { computeDueNotifications } from "./computeDueNotifications.js";
import { maintenanceLabel, notificationTitle, typeLabel } from "./messages.js";
import type { DueNotification } from "./types.js";

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DispatchSummary {
  total: number;
  sent: number;
  recordedSent: number;
  expiredEndpoints: number;
}

/**
 * How many push requests are in flight at once across the whole run. The 9am
 * batch is entirely network-bound, so serializing it made the run scale with
 * the user count; an unbounded Promise.all would instead hand FCM/APNs a
 * thundering herd and earn us a 429. Same shape as the OCR worker's semaphore.
 */
const PUSH_CONCURRENCY = 8;

/**
 * How many notifications are being prepared at once. Bounds memory too: the
 * due list can be large, and each in-flight notification holds its recipient's
 * endpoint rows.
 */
const NOTIFICATION_CONCURRENCY = 8;

/** Run `fn` over `items` with a fixed pool of workers, preserving order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

class Semaphore {
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

function buildPayload(n: DueNotification) {
  const label =
    n.itemKind === "maintenance"
      ? maintenanceLabel(n.language, n.maintenanceKind, n.maintenanceLabel)
      : typeLabel(n.language, n.itemType);
  const url =
    n.itemKind === "dated"
      ? `/dated-items/${n.itemId}`
      : `/bikes/${n.bikeId}/maintenance/${n.itemId}`;
  return {
    title: notificationTitle(n.language, label, n.leadDays),
    body: `${n.bikeNickname}${n.bikePlate ? ` · ${n.bikePlate}` : ""}`,
    url,
    tag: `${n.itemKind}:${n.itemId}:${n.leadDays}`,
  };
}

interface SendOutcome {
  sent: number;
  expired: number;
  anyOk: boolean;
}

/**
 * Deliver one notification to every endpoint the user has, in parallel up to
 * the semaphore's limit. Counters are folded in by the caller once all the
 * sends for this notification have settled, and every DB write happens back on
 * this (single) thread after the awaits — better-sqlite3 is synchronous, so
 * there is no interleaving inside a statement, and each row we delete is keyed
 * by its own id.
 */
async function deliver(n: DueNotification, sem: Semaphore): Promise<SendOutcome> {
  const db = getDb();
  const payload = buildPayload(n);

  const subs = db
    .prepare("SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?")
    .all(n.userId) as SubRow[];
  const tokens = apnsConfigured()
    ? (db
        .prepare("SELECT id, token FROM device_token WHERE user_id = ? AND platform = 'ios'")
        .all(n.userId) as { id: string; token: string }[])
    : [];

  type Result = { ok: boolean; gone: boolean; table: "push_subscription" | "device_token"; id: string };

  const jobs: Array<Promise<Result>> = [
    ...subs.map(async (s): Promise<Result> => {
      const release = await sem.acquire();
      try {
        const res = await sendPush({
          endpoint: s.endpoint,
          keys: { p256dh: s.p256dh, auth: s.auth },
          payload,
        });
        return { ok: res.ok, gone: !res.ok && res.gone === true, table: "push_subscription", id: s.id };
      } finally {
        release();
      }
    }),
    // Native push (APNs) to the user's iOS devices — no-op unless configured.
    ...tokens.map(async (d): Promise<Result> => {
      const release = await sem.acquire();
      try {
        const res = await sendApns(d.token, { title: payload.title, body: payload.body, url: payload.url });
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

export async function dispatchForToday(todayIso: string): Promise<DispatchSummary> {
  const db = getDb();
  const due = computeDueNotifications(db, todayIso);
  const sem = new Semaphore(PUSH_CONCURRENCY);

  let sent = 0;
  let recordedSent = 0;
  let expiredEndpoints = 0;

  // Notifications run concurrently too, but the semaphore is what actually
  // caps the number of open push requests — so a user with many devices can't
  // monopolize the run, and the push services never see more than
  // PUSH_CONCURRENCY requests from us at a time.
  const outcomes = await mapPool(due, NOTIFICATION_CONCURRENCY, (n) => deliver(n, sem));

  for (const [i, n] of due.entries()) {
    const outcome = outcomes[i]!;
    sent += outcome.sent;
    expiredEndpoints += outcome.expired;
    if (!outcome.anyOk) continue;
    // Idempotent per (user_id, item_kind, item_id, lead_days, sent_on) — that
    // tuple is UNIQUE (022_notification_sent_per_recipient.sql), so a re-run
    // (or the boot catch-up) can never double-record, and
    // computeDueNotifications skips anything already in notification_sent for
    // the day. `user_id` is part of the key because one org item fans out to
    // several recipients: without it the first delivery would suppress
    // everybody else's.
    db.prepare(
      `INSERT OR IGNORE INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), n.userId, n.itemKind, n.itemId, n.leadDays, todayIso);
    recordedSent += 1;
  }

  return { total: due.length, sent, recordedSent, expiredEndpoints };
}
