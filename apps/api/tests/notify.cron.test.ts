import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { config } from "../src/config.js";
import { catchUpIfMissed } from "../src/notify/cron.js";
import { pruneEvents } from "../src/notify/retention.js";
import { __setSendForTests, __resetSendForTests } from "../src/notify/webPushClient.js";

const HOUR = config.CRON_HOUR;

/** Same clock the cron uses, so the fixtures line up with what it computes. */
function localToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: config.CRON_TIMEZONE });
}
function localHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.CRON_TIMEZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function setMarker(day: string): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('notify_last_dispatch_on', ?)")
    .run(day);
}
function marker(): string | undefined {
  return (
    getDb().prepare("SELECT value FROM app_meta WHERE key = 'notify_last_dispatch_on'").get() as
      | { value: string }
      | undefined
  )?.value;
}

/** One sigorta due in exactly 7 days, with a 7-day reminder and one endpoint. */
function seedDueToday() {
  const db = getDb();
  db.prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
  db.prepare("INSERT INTO bike (id, user_id, nickname) VALUES ('b1','u1','M')").run();
  db.prepare(
    "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta',?)",
  ).run(shiftDays(localToday(), 7));
  db.prepare(
    "INSERT INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7',1)",
  ).run();
  db.prepare(
    "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P','A')",
  ).run();
}

function sentCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM notification_sent").get() as { c: number }).c;
}

describe("cron catch-up", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    __setSendForTests(async () => ({ ok: true as const }));
    (config as { CRON_HOUR: number }).CRON_HOUR = HOUR;
  });
  afterEach(() => {
    __resetSendForTests();
    (config as { CRON_HOUR: number }).CRON_HOUR = HOUR;
  });

  it("arms itself instead of dispatching on a database that has never run", async () => {
    seedDueToday();
    (config as { CRON_HOUR: number }).CRON_HOUR = 0; // clock is past the hour
    expect(await catchUpIfMissed()).toBe("seeded");
    expect(sentCount()).toBe(0);
    expect(marker()).toBe(localToday());
  });

  it("dispatches when a previous day's run is the most recent one", async () => {
    seedDueToday();
    setMarker(shiftDays(localToday(), -1));
    (config as { CRON_HOUR: number }).CRON_HOUR = 0;
    expect(await catchUpIfMissed()).toBe("ran");
    expect(sentCount()).toBe(1);
    expect(marker()).toBe(localToday());
  });

  it("waits for CRON_HOUR before catching up", async () => {
    seedDueToday();
    setMarker(shiftDays(localToday(), -1));
    (config as { CRON_HOUR: number }).CRON_HOUR = localHour() + 1;
    expect(await catchUpIfMissed()).toBe("skipped-early");
    expect(sentCount()).toBe(0);
  });

  it("runs at most once a day, and never re-sends what was already sent", async () => {
    seedDueToday();
    setMarker(shiftDays(localToday(), -1));
    (config as { CRON_HOUR: number }).CRON_HOUR = 0;
    expect(await catchUpIfMissed()).toBe("ran");
    expect(await catchUpIfMissed()).toBe("already-ran");
    // Even with the marker forced back, notification_sent keeps it idempotent.
    setMarker(shiftDays(localToday(), -1));
    expect(await catchUpIfMissed()).toBe("ran");
    expect(sentCount()).toBe(1);
  });
});

describe("event retention", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
  });

  it("deletes rows older than the window and keeps the rest", () => {
    const db = getDb();
    db.prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
    const ins = db.prepare(
      "INSERT INTO event (id, user_id, name, created_at) VALUES (?, 'u1', 'scan_started', datetime('now', ?))",
    );
    ins.run("e_old", "-400 days");
    ins.run("e_edge", "-181 days");
    ins.run("e_recent", "-10 days");
    ins.run("e_now", "-0 days");

    expect(pruneEvents(180)).toBe(2);
    const left = (db.prepare("SELECT id FROM event ORDER BY id").all() as { id: string }[]).map(
      (r) => r.id,
    );
    expect(left).toEqual(["e_now", "e_recent"]);
    // Nothing left to do on a second pass.
    expect(pruneEvents(180)).toBe(0);
  });
});
