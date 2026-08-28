import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { computeDueNotifications } from "./computeDueNotifications.js";
import { maintenanceLabel, notificationTitle, typeLabel } from "./messages.js";
import {
  mapPool,
  pushToUser,
  Semaphore,
  NOTIFICATION_CONCURRENCY,
  PUSH_CONCURRENCY,
  type PushPayload,
} from "./send.js";
import type { DueNotification } from "./types.js";

export interface DispatchSummary {
  total: number;
  sent: number;
  recordedSent: number;
  expiredEndpoints: number;
}

/**
 * The DAILY path: expiry reminders, computed from the state of the database by
 * a cron job. Event-driven sends (a claim, an invitation) live in `events.ts`;
 * both go out through the shared sender in `send.ts`, so there is one
 * implementation of the endpoint fan-out and the `gone`-purge.
 */

function buildPayload(n: DueNotification): PushPayload {
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
  const outcomes = await mapPool(due, NOTIFICATION_CONCURRENCY, (n) =>
    pushToUser(n.userId, buildPayload(n), sem),
  );

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
