import { getDb } from "../db/index.js";
import { config } from "../config.js";

/**
 * Telemetry retention. `event` is append-only and written on every client
 * interaction (routes/events.ts), so without a prune it grows for the life of
 * the deployment — on a single self-hosted SQLite file that eventually costs
 * both disk and write throughput.
 *
 * The default window is 180 days: long enough to compare a release against the
 * same funnel two quarters back (and to cover a full seasonal riding cycle),
 * short enough that the table stays small. Nothing in the product reads events
 * older than that — they exist for product analytics, not as user data.
 */
export function pruneEvents(days = config.EVENT_RETENTION_DAYS): number {
  const res = getDb()
    .prepare("DELETE FROM event WHERE created_at < datetime('now', ?)")
    .run(`-${days} days`);
  return res.changes;
}

/**
 * How long a send record is kept. It only has to outlive the thing it dedupes:
 * a claim expires after CLAIM_RESPONSE_DAYS (21) and an invitation after 14, so
 * 90 days is generous by a factor of four and there is no window in which a
 * pruned row could let a live event be delivered twice.
 */
const NOTIFICATION_EVENT_RETENTION_DAYS = 90;

/**
 * Prune the event-notification log.
 *
 * Unlike `event`, this is not only about disk. A row on the email path holds
 * the ADDRESS OF SOMEBODY WHO MAY NOT BE A USER — an invitee who never
 * accepted, or a mistyped address belonging to a stranger with no relationship
 * to this service at all. Account deletion cannot reach those rows (there is no
 * account to cascade from), so age is the only thing that can, and keeping them
 * indefinitely would mean the one lasting trace of a wrong-address invitation
 * is a permanent record of the wrong address.
 */
export function pruneNotificationEvents(days = NOTIFICATION_EVENT_RETENTION_DAYS): number {
  const res = getDb()
    .prepare("DELETE FROM notification_event WHERE sent_at < datetime('now', ?)")
    .run(`-${days} days`);
  return res.changes;
}
