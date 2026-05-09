import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { computeDueNotifications } from "../src/notify/computeDueNotifications.js";

function seedUser(userId: string, email = `${userId}@t.io`) {
  getDb()
    .prepare("INSERT INTO user (id, email) VALUES (?, ?)")
    .run(userId, email);
}

function seedBike(id: string, userId: string, plate?: string | null) {
  getDb()
    .prepare("INSERT INTO bike (id, user_id, nickname, plate) VALUES (?, ?, ?, ?)")
    .run(id, userId, "B", plate ?? null);
}

function seedDated(id: string, bikeId: string, userId: string, type: string, expires: string) {
  getDb()
    .prepare(
      "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, bikeId, userId, type, expires);
}

function seedPref(userId: string, itemType: string, csv = "30,7,1", enabled = 1) {
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO notification_preference (user_id, item_type, lead_days_csv, enabled) VALUES (?, ?, ?, ?)",
    )
    .run(userId, itemType, csv, enabled);
}

describe("computeDueNotifications", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
  });

  it("emits one notification when a sigorta is exactly 7 days out and pref includes 7", () => {
    seedUser("u1");
    seedBike("b1", "u1", "34X");
    seedDated("d1", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    const out = computeDueNotifications(getDb(), "2026-06-01");
    expect(out).toHaveLength(1);
    expect(out[0]!.leadDays).toBe(7);
    expect(out[0]!.itemKind).toBe("dated");
  });

  it("emits 30 + 7 + 1 across distinct days", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "muayene", "2026-07-01");
    seedPref("u1", "muayene");

    const dayMinus30 = computeDueNotifications(getDb(), "2026-06-01");
    const dayMinus7 = computeDueNotifications(getDb(), "2026-06-24");
    const dayMinus1 = computeDueNotifications(getDb(), "2026-06-30");
    const random = computeDueNotifications(getDb(), "2026-06-15");

    expect(dayMinus30.map((d) => d.leadDays)).toEqual([30]);
    expect(dayMinus7.map((d) => d.leadDays)).toEqual([7]);
    expect(dayMinus1.map((d) => d.leadDays)).toEqual([1]);
    expect(random).toEqual([]);
  });

  it("respects enabled=false", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "kasko", "2026-06-08");
    seedPref("u1", "kasko", "30,7,1", 0);
    expect(computeDueNotifications(getDb(), "2026-06-01")).toEqual([]);
  });

  it("dedupes via notification_sent on the same day", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    getDb()
      .prepare(
        "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES ('n1','u1','dated','d1',7,'2026-06-01')",
      )
      .run();
    expect(computeDueNotifications(getDb(), "2026-06-01")).toEqual([]);
  });

  it("uses the latest dated_item per (bike,type) when there are multiple", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    seedDated("d1", "b1", "u1", "sigorta", "2025-06-08");
    seedDated("d2", "b1", "u1", "sigorta", "2026-06-08");
    seedPref("u1", "sigorta");
    const out = computeDueNotifications(getDb(), "2026-06-01");
    expect(out).toHaveLength(1);
    expect(out[0]!.itemId).toBe("d2");
  });

  it("emits a maintenance notification based on last_done + interval_months", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    getDb()
      .prepare(
        "INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, interval_months) VALUES ('m1','b1','u1','engine_oil','2026-01-01',6)",
      )
      .run();
    seedPref("u1", "maintenance");
    const out = computeDueNotifications(getDb(), "2026-06-24");
    expect(out).toHaveLength(1);
    expect(out[0]!.itemKind).toBe("maintenance");
    expect(out[0]!.maintenanceLabel).toBe("Motor yağı");
  });
});
