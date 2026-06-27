import { buildApp } from "../../src/server.js";
import { resetDbForTests } from "../../src/db/index.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedCatalog } from "../../src/db/seedCatalog.js";

export function buildTestApp() {
  resetDbForTests(":memory:");
  runMigrations();
  seedCatalog();
  return buildApp({ silent: true });
}
