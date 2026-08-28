import cron from "node-cron";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { dispatchForToday } from "./dispatcher.js";
import { pruneEvents } from "./retention.js";

/** app_meta key holding the last calendar day we dispatched for (yyyy-MM-dd). */
const LAST_RUN_KEY = "notify_last_dispatch_on";

/** Today in the cron timezone — en-CA gives yyyy-MM-dd. */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.CRON_TIMEZONE });
}

/** Hour-of-day (0–23) in the cron timezone. */
function localHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.CRON_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
}

function lastRunOn(): string | null {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = ?").get(LAST_RUN_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function markRun(day: string): void {
  getDb()
    .prepare(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(LAST_RUN_KEY, day);
}

async function runDispatch(day: string, reason: string): Promise<void> {
  try {
    const s = await dispatchForToday(day);
    markRun(day);
    console.log(`[cron] ${reason}: dispatched ${s.sent}/${s.total}, expired ${s.expiredEndpoints}`);
  } catch (e) {
    // Leave the marker alone so the next hourly check retries today.
    console.error(`[cron] ${reason} failure`, e);
  }
}

/**
 * Fire today's dispatch if the scheduled tick was missed (process down or
 * restarting at CRON_HOUR, machine asleep, container redeployed). Safe to call
 * as often as we like:
 *   - it only runs once the local clock has passed CRON_HOUR;
 *   - it runs at most once per calendar day, tracked in app_meta;
 *   - and even if both guards were wrong, dispatchForToday is idempotent —
 *     computeDueNotifications skips anything already in notification_sent for
 *     today, and the insert is INSERT OR IGNORE against a UNIQUE
 *     (item_kind, item_id, lead_days, sent_on).
 *
 * The one case we deliberately skip is a database that has never dispatched
 * (no marker at all): a fresh dev DB — or the first boot after this code ships
 * — would otherwise blast out a real batch the moment someone starts the
 * server in the afternoon. We just record the day and let the normal schedule
 * take over tomorrow.
 */
export async function catchUpIfMissed(): Promise<"ran" | "skipped-early" | "already-ran" | "seeded"> {
  const today = localToday();
  const last = lastRunOn();
  if (last === today) return "already-ran";
  if (last === null) {
    markRun(today);
    console.log(`[cron] first run on this database — catch-up armed from ${today}`);
    return "seeded";
  }
  if (localHour() < config.CRON_HOUR) return "skipped-early";
  await runDispatch(today, `catch-up (last dispatch ${last})`);
  return "ran";
}

export function startCron(): void {
  if (!config.CRON_ENABLED) {
    console.log("[cron] disabled");
    return;
  }
  const expr = `0 ${config.CRON_HOUR} * * *`;
  cron.schedule(
    expr,
    () => {
      void runDispatch(localToday(), "daily");
    },
    { timezone: config.CRON_TIMEZONE },
  );

  // Hourly safety net for the daily tick above, plus the boot check. node-cron
  // has no concept of a missed fire, so without this a restart across 09:00
  // loses that day's reminders permanently.
  cron.schedule("17 * * * *", () => void catchUpIfMissed(), { timezone: config.CRON_TIMEZONE });
  void catchUpIfMissed();

  // Telemetry retention runs on the same daily rhythm (plus once at boot, so a
  // deployment that is only ever restarted still gets pruned).
  cron.schedule(
    "40 3 * * *",
    () => {
      const removed = pruneEvents();
      if (removed > 0) console.log(`[cron] pruned ${removed} event row(s)`);
    },
    { timezone: config.CRON_TIMEZONE },
  );
  try {
    const removed = pruneEvents();
    if (removed > 0) console.log(`[cron] pruned ${removed} event row(s) at boot`);
  } catch (e) {
    console.error("[cron] event prune failed", e);
  }

  console.log(`[cron] scheduled '${expr}' in ${config.CRON_TIMEZONE}`);
}
