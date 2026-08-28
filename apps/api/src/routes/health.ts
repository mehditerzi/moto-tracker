import { Router } from "express";
import { getDb } from "../db/index.js";

/**
 * Readiness (`/api/health`) and liveness (`/api/health/live`).
 *
 * Readiness touches SQLite, because "the process is up" says nothing useful
 * here: a corrupt file, a lost volume mount or a stuck WAL lock all leave the
 * HTTP layer answering happily while every real request 500s. The container
 * HEALTHCHECK and the tunnel's depends_on both key off this.
 */
export const healthRouter: Router = Router();

const SERVICE = "mototracker-api";

healthRouter.get("/", (_req, res) => {
  try {
    // Cheap and index-free — proves the handle is open and the DB is readable.
    getDb().prepare("SELECT 1 AS ok").get();
    res.json({ ok: true, service: SERVICE, db: "up", time: new Date().toISOString() });
  } catch (err) {
    console.error("[health] database check failed:", err);
    res.status(503).json({ ok: false, service: SERVICE, db: "down", time: new Date().toISOString() });
  }
});

// Liveness: no dependencies, never fails while the event loop turns. Kept
// separate so an orchestrator restarting on liveness doesn't restart-loop the
// container over a DB problem a restart can't fix.
healthRouter.get("/live", (_req, res) => {
  res.json({ ok: true, service: SERVICE, time: new Date().toISOString() });
});
