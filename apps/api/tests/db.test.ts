import { describe, it, expect, beforeEach } from "vitest";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

describe("migrations", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("creates user, bike, and profile tables", () => {
    const result = runMigrations();
    expect(result.applied).toContain("001_init.sql");

    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["user", "bike", "profile", "session", "account"]));
  });

  it("is idempotent", () => {
    runMigrations();
    const second = runMigrations();
    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("001_init.sql");
  });
});
