import { buildApp } from "./server.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { startCron } from "./notify/cron.js";

// Apply any pending DB migrations before serving traffic. Idempotent: already-
// applied migrations are skipped via the _migrations table.
const m = runMigrations();
if (m.applied.length > 0) {
  console.log(`[migrate] applied ${m.applied.length} migration(s): ${m.applied.join(", ")}`);
} else {
  console.log(`[migrate] up-to-date (${m.skipped.length} already applied)`);
}

const app = buildApp();
app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}`);
  startCron();
});
