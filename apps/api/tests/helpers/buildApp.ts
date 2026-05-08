import { buildApp } from "../../src/server.js";
import { resetDbForTests } from "../../src/db/index.js";
import { runMigrations } from "../../src/db/migrate.js";

export function buildTestApp() {
  resetDbForTests(":memory:");
  runMigrations();
  return buildApp({ silent: true });
}
