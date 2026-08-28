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
