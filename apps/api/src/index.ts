import { buildApp } from "./server.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { seedCatalog } from "./db/seedCatalog.js";
import { startCron } from "./notify/cron.js";
import { attachRideWs } from "./lib/rideHub.js";

// Apply any pending DB migrations before serving traffic. Idempotent: already-
// applied migrations are skipped via the _migrations table.
const m = runMigrations();
if (m.applied.length > 0) {
  console.log(`[migrate] applied ${m.applied.length} migration(s): ${m.applied.join(", ")}`);
} else {
  console.log(`[migrate] up-to-date (${m.skipped.length} already applied)`);
}

// Load the bundled motorcycle catalog into the DB (idempotent; only rebuilds
// when the bundled data changes).
const cat = seedCatalog();
if (cat.seeded) {
  console.log(`[catalog] seeded ${cat.makes} makes, ${cat.models} models`);
} else {
  console.log("[catalog] up-to-date");
}

const app = buildApp();
const server = app.listen(config.PORT, () => {
  console.log(`[api] listening on http://localhost:${config.PORT}`);
  startCron();
});
// Live group-ride positions (WebSocket upgrade on /api/ride-ws).
attachRideWs(server);
