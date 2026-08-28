import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { computeDueNotifications } from "../src/notify/computeDueNotifications.js";
import { addMember, assignVehicle, createOrg, endAssignment, removeMember } from "./helpers/org.js";

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
    // The kind travels untranslated (the dispatcher renders it per language);
    // only a 'custom' item carries a label, which is the user's own text.
    expect(out[0]!.maintenanceKind).toBe("engine_oil");
    expect(out[0]!.maintenanceLabel).toBeNull();
  });

  it("carries the recipient's language, defaulting to tr without a profile", () => {
    seedUser("u1");
    seedBike("b1", "u1");
    getDb()
      .prepare(
        "INSERT INTO dated_item (id, bike_id, user_id, type, expires_on) VALUES ('d1','b1','u1','sigorta','2026-06-08')",
      )
      .run();
    seedPref("u1", "sigorta");
    expect(computeDueNotifications(getDb(), "2026-06-01")[0]!.language).toBe("tr");

    getDb().prepare("INSERT INTO profile (user_id, language) VALUES ('u1','en')").run();
    expect(computeDueNotifications(getDb(), "2026-06-01")[0]!.language).toBe("en");
  });
});

/**
 * A fleet's whole promise is "nobody misses an expiry". Addressing the reminder
 * to `dated_item.user_id` — whoever typed it in — kept that promise for exactly
 * one employee, possibly a driver, and never for the manager accountable for
 * the vehicle. These tests pin the recipient set instead.
 */
describe("computeDueNotifications — organization vehicles", () => {
  let orgId: string;

  function recipients(today = "2026-06-01"): string[] {
    return computeDueNotifications(getDb(), today)
      .map((n) => n.userId)
      .sort();
  }

  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    for (const u of ["owner", "manager", "staff", "driver", "other", "outsider"]) {
      seedUser(u);
      seedPref(u, "sigorta");
      seedPref(u, "maintenance");
    }
    orgId = createOrg("Kervan Filo", "fleet");
    addMember(orgId, "owner", "owner");
    addMember(orgId, "manager", "manager");
    addMember(orgId, "staff", "staff");
    addMember(orgId, "driver", "driver");
    addMember(orgId, "other", "driver");

    // The van, registered by the owner, currently driven by `driver`.
    getDb()
      .prepare("INSERT INTO bike (id, user_id, nickname, plate, org_id) VALUES (?,?,?,?,?)")
      .run("van", "owner", "Van", "34 VAN 01", orgId);
    assignVehicle(orgId, "van", "driver");
  });

  it("a personal vehicle still notifies exactly its owner", () => {
    seedBike("mine", "outsider");
    seedDated("dp", "mine", "outsider", "sigorta", "2026-06-08");
    expect(recipients()).toEqual(["outsider"]);
  });

  it("an org vehicle notifies the whole management set plus the assigned driver", () => {
    // Typed in by a member of staff — under the old rule only they heard about it.
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    expect(recipients()).toEqual(["driver", "manager", "owner", "staff"]);
  });

  it("does not notify a driver about a vehicle they are not holding", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    // `other` is a driver in the same org but holds nothing.
    expect(recipients()).not.toContain("other");
  });

  it("stops notifying a driver the moment the vehicle is handed back", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    const a = getDb()
      .prepare("SELECT id FROM vehicle_assignment WHERE bike_id = 'van' AND ended_at IS NULL")
      .get() as { id: string };
    endAssignment(a.id);
    expect(recipients()).toEqual(["manager", "owner", "staff"]);
  });

  it("a removed member hears nothing, even about a vehicle they registered", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    removeMember(orgId, "staff");
    expect(recipients()).toEqual(["driver", "manager", "owner"]);
  });

  it("each recipient's own preference decides — an opt-out stays opted out", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    seedPref("manager", "sigorta", "30,7,1", 0);
    expect(recipients()).toEqual(["driver", "owner", "staff"]);
  });

  it("each recipient's own lead days apply", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    seedPref("owner", "sigorta", "7");
    seedPref("manager", "sigorta", "30");
    seedPref("staff", "sigorta", "1");
    seedPref("driver", "sigorta", "1");
    expect(recipients("2026-06-01")).toEqual(["owner"]); // 7 days out
    expect(recipients("2026-06-07")).toEqual(["driver", "staff"]); // 1 day out
    expect(recipients("2026-05-09")).toEqual(["manager"]); // 30 days out
  });

  it("dedupes a recipient who is both management and the assigned driver", () => {
    // A working owner who drives one of the vans themselves.
    getDb()
      .prepare("UPDATE vehicle_assignment SET ended_at = datetime('now') WHERE bike_id = 'van'")
      .run();
    assignVehicle(orgId, "van", "owner");
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    const out = computeDueNotifications(getDb(), "2026-06-01").filter((n) => n.userId === "owner");
    expect(out).toHaveLength(1);
  });

  it("suppresses only the recipient already notified today, not the rest", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    getDb()
      .prepare(
        "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES ('n1','owner','dated','d1',7,'2026-06-01')",
      )
      .run();
    expect(recipients()).toEqual(["driver", "manager", "staff"]);
  });

  it("fans a maintenance item out the same way", () => {
    getDb()
      .prepare(
        "INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, interval_months) VALUES ('m1','van','driver','engine_oil','2026-01-01',6)",
      )
      .run();
    expect(recipients("2026-06-24")).toEqual(["driver", "manager", "owner", "staff"]);
  });

  it("carries the vehicle's org and each recipient's own language", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    getDb().prepare("INSERT INTO profile (user_id, language) VALUES ('manager','en')").run();
    const out = computeDueNotifications(getDb(), "2026-06-01");
    expect(new Set(out.map((n) => n.orgId))).toEqual(new Set([orgId]));
    expect(out.find((n) => n.userId === "manager")!.language).toBe("en");
    expect(out.find((n) => n.userId === "owner")!.language).toBe("tr");
  });

  it("ignores an archived org vehicle", () => {
    seedDated("d1", "van", "staff", "sigorta", "2026-06-08");
    getDb().prepare("UPDATE bike SET archived = 1 WHERE id = 'van'").run();
    expect(recipients()).toEqual([]);
  });
});
