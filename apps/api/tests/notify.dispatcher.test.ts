import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { dispatchForToday } from "../src/notify/dispatcher.js";
import {
  __setSendForTests,
  __resetSendForTests,
} from "../src/notify/webPushClient.js";

function seed() {
  getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
  getDb()
    .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M','34X')")
    .run();
  getDb()
    .prepare(
      "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta','2026-06-08')",
    )
    .run();
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','30,7,1',1)",
    )
    .run();
  getDb()
    .prepare(
      "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P','A')",
    )
    .run();
}

describe("dispatchForToday", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    __setSendForTests(async () => ({ ok: true as const }));
  });
  afterEach(() => {
    __resetSendForTests();
  });

  it("sends to subscribers and records notification_sent", async () => {
    seed();
    const summary = await dispatchForToday("2026-06-01");
    expect(summary.total).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.recordedSent).toBe(1);
    const sent = getDb()
      .prepare("SELECT * FROM notification_sent WHERE sent_on = ?")
      .all("2026-06-01");
    expect(sent).toHaveLength(1);
  });

  it("does not double-record if the same lead/day is run twice", async () => {
    seed();
    await dispatchForToday("2026-06-01");
    const second = await dispatchForToday("2026-06-01");
    expect(second.total).toBe(0);
  });

  it("purges expired (404/410) endpoints and does not record", async () => {
    seed();
    __setSendForTests(async () => ({
      ok: false as const,
      gone: true,
      status: 410,
      message: "gone",
    }));
    const summary = await dispatchForToday("2026-06-01");
    expect(summary.expiredEndpoints).toBe(1);
    expect(summary.recordedSent).toBe(0);
    const remaining = getDb()
      .prepare("SELECT COUNT(*) AS c FROM push_subscription")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });
});
