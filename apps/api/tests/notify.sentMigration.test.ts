import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/db/migrations/022_notification_sent_per_recipient.sql",
);

/**
 * 022 rebuilds `notification_sent` to widen its idempotency key with `user_id`.
 * The table carries real production history, and a rebuild that loses rows would
 * re-send every reminder that had already gone out today — so the upgrade is
 * exercised against the OLD table, with data in it, rather than assumed.
 */
describe("022_notification_sent_per_recipient", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
    // Put the table back the way a pre-022 database has it, with history.
    getDb().exec(`
      DROP TABLE notification_sent;
      CREATE TABLE notification_sent (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        item_kind TEXT NOT NULL CHECK (item_kind IN ('dated','maintenance')),
        item_id TEXT NOT NULL,
        lead_days INTEGER NOT NULL,
        sent_on TEXT NOT NULL,
        UNIQUE (item_kind, item_id, lead_days, sent_on)
      );
      CREATE INDEX IF NOT EXISTS idx_sent_user ON notification_sent(user_id, sent_on);
    `);
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u1','u1@t.io')").run();
    getDb().prepare("INSERT INTO user (id, email) VALUES ('u2','u2@t.io')").run();
    for (const [id, user, item, lead, day] of [
      ["n1", "u1", "d1", 30, "2026-05-09"],
      ["n2", "u1", "d1", 7, "2026-06-01"],
      ["n3", "u2", "m1", 1, "2026-06-01"],
    ] as const) {
      getDb()
        .prepare(
          "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES (?,?,?,?,?,?)",
        )
        .run(id, user, item === "m1" ? "maintenance" : "dated", item, lead, day);
    }
  });

  function upgrade(): void {
    getDb().exec(fs.readFileSync(MIGRATION, "utf8"));
  }

  it("carries every existing row across the rebuild", () => {
    upgrade();
    const rows = getDb()
      .prepare("SELECT id, user_id, item_id, lead_days, sent_on FROM notification_sent ORDER BY id")
      .all();
    expect(rows).toEqual([
      { id: "n1", user_id: "u1", item_id: "d1", lead_days: 30, sent_on: "2026-05-09" },
      { id: "n2", user_id: "u1", item_id: "d1", lead_days: 7, sent_on: "2026-06-01" },
      { id: "n3", user_id: "u2", item_id: "m1", lead_days: 1, sent_on: "2026-06-01" },
    ]);
  });

  it("lets a second recipient of the same item be recorded — the point of the change", () => {
    // The old key rejected exactly this, which is how everyone after the first
    // recipient was silently dropped.
    const insertSecond = () =>
      getDb()
        .prepare(
          "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES ('n4','u2','dated','d1',7,'2026-06-01')",
        )
        .run();
    expect(insertSecond).toThrow(/UNIQUE/);
    upgrade();
    expect(insertSecond).not.toThrow();
  });

  it("still refuses a duplicate for the SAME recipient", () => {
    upgrade();
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO notification_sent (id, user_id, item_kind, item_id, lead_days, sent_on) VALUES ('n5','u1','dated','d1',7,'2026-06-01')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("keeps the cascade from user, so account deletion still erases the history", () => {
    upgrade();
    getDb().prepare("DELETE FROM user WHERE id = 'u1'").run();
    const left = getDb().prepare("SELECT COUNT(*) AS c FROM notification_sent").get() as {
      c: number;
    };
    expect(left.c).toBe(1);
  });
});
