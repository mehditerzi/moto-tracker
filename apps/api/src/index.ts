import { buildApp } from "./server.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { seedCatalog } from "./db/seedCatalog.js";
import { startCron } from "./notify/cron.js";
import { attachRideWs } from "./lib/rideHub.js";
import { closeDb } from "./db/index.js";

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
const rideWs = attachRideWs(server);

/**
 * Graceful shutdown. `docker stop` sends SIGTERM and waits 10s, so we have a
 * budget: stop accepting connections, let in-flight requests finish, kick the
 * ride sockets, then close SQLite so the WAL is checkpointed instead of left
 * for the next boot to recover.
 */
const SHUTDOWN_TIMEOUT_MS = 8000;
let shuttingDown = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${reason} — shutting down`);

  // Hard deadline: never let a stuck socket outlive the container's grace period.
  const guard = setTimeout(() => {
    console.error("[api] shutdown timed out — forcing exit");
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS);
  guard.unref();

  try {
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    // Idle keep-alive sockets would otherwise hold server.close() open until
    // their timeout, even though they have no request in flight.
    server.closeIdleConnections();
    await rideWs.close();
    await drained;
    closeDb();
    console.log("[api] shutdown complete");
  } catch (err) {
    console.error("[api] error during shutdown:", err);
    exitCode = exitCode || 1;
  }
  clearTimeout(guard);
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Node 20 kills the process on an unhandled rejection by default. A rejected
// promise in one request is not a reason to drop everyone else's, so log it
// loudly and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled promise rejection:", reason);
});

// An uncaught exception leaves the process in an unknown state — drain what we
// can, then exit non-zero so the restart policy takes over.
process.on("uncaughtException", (err) => {
  console.error("[api] uncaught exception:", err);
  void shutdown("uncaught exception", 1);
});
