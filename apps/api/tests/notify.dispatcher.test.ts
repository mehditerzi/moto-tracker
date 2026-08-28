import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { dispatchForToday } from "../src/notify/dispatcher.js";
import {
  __setSendForTests,
  __resetSendForTests,
} from "../src/notify/webPushClient.js";
import { addMember, assignVehicle, createOrg } from "./helpers/org.js";

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

  it("multi-subscription: sends to all subs and counts each", async () => {
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
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7,1',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P1','A1')",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s2','u1','https://f/b','P2','A2')",
      )
      .run();

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.sent).toBe(2);
    expect(summary.recordedSent).toBe(1);
    const rows = getDb()
      .prepare("SELECT * FROM notification_sent WHERE sent_on = ?")
      .all("2026-06-01");
    expect(rows).toHaveLength(1);
  });

  it("mixed ok+gone: records notification_sent when at least one sub succeeds", async () => {
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
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7,1',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P1','A1')",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s2','u1','https://f/b','P2','A2')",
      )
      .run();

    let callCount = 0;
    __setSendForTests(async () => {
      callCount += 1;
      if (callCount === 1) return { ok: true as const };
      return { ok: false as const, gone: true, status: 410, message: "gone" };
    });

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.sent).toBe(1);
    expect(summary.expiredEndpoints).toBe(1);
    expect(summary.recordedSent).toBe(1);

    const remaining = getDb()
      .prepare("SELECT COUNT(*) AS c FROM push_subscription")
      .get() as { c: number };
    expect(remaining.c).toBe(1);
  });

  it("all-fail non-gone: does not record notification_sent", async () => {
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
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7,1',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P1','A1')",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s2','u1','https://f/b','P2','A2')",
      )
      .run();

    __setSendForTests(async () => ({
      ok: false as const,
      gone: false,
      status: 500,
      message: "error",
    }));

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.recordedSent).toBe(0);
    expect(summary.expiredEndpoints).toBe(0);

    const rows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM notification_sent")
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });

  it("no-subscriptions: skips user with no push subscriptions", async () => {
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
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7,1',1)",
      )
      .run();
    // no push_subscription row inserted

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.sent).toBe(0);
    expect(summary.recordedSent).toBe(0);
  });

  it("maintenance notification: dispatches for a due maintenance item", async () => {
    // engine_oil last done 3 months ago with interval_months=3 → due today
    const lastDoneOn = "2026-02-12"; // 3 months before 2026-05-12
    const today = "2026-05-12";

    getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M','34X')")
      .run();
    getDb()
      .prepare(
        `INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, interval_months)
         VALUES ('m1','b1','u1','engine_oil','${lastDoneOn}',3)`,
      )
      .run();
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','maintenance','0',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P','A')",
      )
      .run();

    const calls: Array<{ payload: unknown }> = [];
    __setSendForTests(async (input) => {
      calls.push({ payload: input.payload });
      return { ok: true as const };
    });

    const summary = await dispatchForToday(today);
    expect(summary.sent).toBe(1);
    expect(summary.recordedSent).toBe(1);

    expect(calls).toHaveLength(1);
    const payload = calls[0].payload as { title: string; url: string };
    // engine_oil maps to "Motor yağı" in the maintenance label table
    expect(payload.title.toLowerCase()).toMatch(/motor ya|bak[iı]m|engine_oil/i);
    expect(payload.url).toContain("m1");
  });

  it("empty DB: returns zero totals", async () => {
    const summary = await dispatchForToday("2026-06-01");
    expect(summary).toEqual({ total: 0, sent: 0, recordedSent: 0, expiredEndpoints: 0 });
  });

  it("writes the payload in the recipient's language", async () => {
    seed();
    getDb().prepare("INSERT INTO profile (user_id, language) VALUES ('u1','en')").run();
    const titles: string[] = [];
    __setSendForTests(async (input) => {
      titles.push((input.payload as { title: string }).title);
      return { ok: true as const };
    });
    await dispatchForToday("2026-06-01");
    expect(titles).toEqual(["Insurance expires in 7 days"]);
  });

  it("defaults to Turkish when the user has no profile row", async () => {
    seed();
    const titles: string[] = [];
    __setSendForTests(async (input) => {
      titles.push((input.payload as { title: string }).title);
      return { ok: true as const };
    });
    await dispatchForToday("2026-06-01");
    expect(titles).toEqual(["Sigorta 7 gün sonra bitiyor"]);
  });

  it("localizes maintenance items, keeping a custom label verbatim", async () => {
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
    getDb().prepare("INSERT INTO profile (user_id, language) VALUES ('u1','en')").run();
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M','34X')")
      .run();
    getDb()
      .prepare(
        `INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, interval_months)
         VALUES ('m1','b1','u1','engine_oil','2026-02-12',3)`,
      )
      .run();
    getDb()
      .prepare(
        `INSERT INTO maintenance_item (id, bike_id, user_id, kind, custom_label, last_done_on, interval_months)
         VALUES ('m2','b1','u1','custom','Zincir yağı','2026-02-12',3)`,
      )
      .run();
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','maintenance','0',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P','A')",
      )
      .run();

    const titles: string[] = [];
    __setSendForTests(async (input) => {
      titles.push((input.payload as { title: string }).title);
      return { ok: true as const };
    });
    await dispatchForToday("2026-05-12");
    expect(titles.sort()).toEqual(["Engine oil expires today", "Zincir yağı expires today"]);
  });

  it("sends in parallel but never exceeds the concurrency cap", async () => {
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
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7',1)",
      )
      .run();
    for (let i = 0; i < 30; i++) {
      getDb()
        .prepare(
          "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES (?,'u1',?,'P','A')",
        )
        .run(`s${i}`, `https://f/${i}`);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    __setSendForTests(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true as const };
    });

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.sent).toBe(30);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel
    expect(maxInFlight).toBeLessThanOrEqual(8); // …but bounded
  });

  it("purges every gone endpoint exactly once under concurrency", async () => {
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','x@y.io')").run();
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M','34X')")
      .run();
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta','2026-06-08')",
      )
      .run();
    // Two due items → two notifications for the same user, both running against
    // the same subscription list at the same time.
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d2','b1','u1','kasko','2026-06-08')",
      )
      .run();
    for (const type of ["sigorta", "kasko"]) {
      getDb()
        .prepare(
          "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1',?,'7',1)",
        )
        .run(type);
    }
    for (let i = 0; i < 10; i++) {
      getDb()
        .prepare(
          "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES (?,'u1',?,'P','A')",
        )
        .run(`s${i}`, `https://f/${i}`);
    }

    __setSendForTests(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return { ok: false as const, gone: true, status: 410, message: "gone" };
    });

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.expiredEndpoints).toBe(10);
    expect(summary.recordedSent).toBe(0);
    const remaining = getDb()
      .prepare("SELECT COUNT(*) AS c FROM push_subscription")
      .get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it("multi-user isolation: each user gets their own notification_sent row", async () => {
    // u1
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','u1@y.io')").run();
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b1','u1','M1','34X')")
      .run();
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta','2026-06-08')",
      )
      .run();
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u1','sigorta','7,1',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s1','u1','https://f/a','P1','A1')",
      )
      .run();

    // u2
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u2','u2@y.io')").run();
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES ('b2','u2','M2','35Y')")
      .run();
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d2','b2','u2','sigorta','2026-06-08')",
      )
      .run();
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES ('u2','sigorta','7,1',1)",
      )
      .run();
    getDb()
      .prepare(
        "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES ('s2','u2','https://f/b','P2','A2')",
      )
      .run();

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.total).toBe(2);
    expect(summary.recordedSent).toBe(2);

    const u1Rows = getDb()
      .prepare("SELECT * FROM notification_sent WHERE user_id = 'u1'")
      .all();
    expect(u1Rows).toHaveLength(1);

    const u2Rows = getDb()
      .prepare("SELECT * FROM notification_sent WHERE user_id = 'u2'")
      .all();
    expect(u2Rows).toHaveLength(1);
  });

  /**
   * The fan-out end to end. This is where the old dedupe key
   * (item_kind, item_id, lead_days, sent_on) actually bites: it identifies the
   * ITEM, so the first recipient recorded would suppress every other recipient
   * of the same expiry — for the rest of the day and for good. 022 adds
   * `user_id` to the key.
   */
  it("org fan-out: every recipient of one expiry is delivered and recorded", async () => {
    for (const [id, email] of [
      ["owner", "owner@f.io"],
      ["staff", "staff@f.io"],
      ["driver", "driver@f.io"],
    ]) {
      getDb().prepare("INSERT INTO user (id, email) VALUES (?, ?)").run(id, email);
      getDb()
        .prepare(
          "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES (?, 'sigorta', '7', 1)",
        )
        .run(id);
      getDb()
        .prepare(
          "INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, 'P', 'A')",
        )
        .run(`s-${id}`, id, `https://f/${id}`);
    }

    const orgId = createOrg("Kervan Filo", "fleet");
    addMember(orgId, "owner", "owner");
    addMember(orgId, "staff", "staff");
    addMember(orgId, "driver", "driver");
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate, org_id) VALUES (?,?,?,?,?)")
      .run("van", "owner", "Van", "34 VAN 01", orgId);
    assignVehicle(orgId, "van", "driver");
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','van','staff','sigorta','2026-06-08')",
      )
      .run();

    const delivered: string[] = [];
    __setSendForTests(async (sub) => {
      delivered.push(sub.endpoint);
      return { ok: true as const };
    });

    const summary = await dispatchForToday("2026-06-01");
    expect(summary.total).toBe(3);
    expect(summary.sent).toBe(3);
    expect(summary.recordedSent).toBe(3);
    expect(delivered.sort()).toEqual(["https://f/driver", "https://f/owner", "https://f/staff"]);

    const rows = getDb()
      .prepare("SELECT user_id FROM notification_sent WHERE item_id = 'd1' ORDER BY user_id")
      .all() as { user_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual(["driver", "owner", "staff"]);

    // …and the whole fan-out is still idempotent on a re-run.
    const second = await dispatchForToday("2026-06-01");
    expect(second.total).toBe(0);
    const after = getDb()
      .prepare("SELECT COUNT(*) AS c FROM notification_sent WHERE item_id = 'd1'")
      .get() as { c: number };
    expect(after.c).toBe(3);
  });
});
