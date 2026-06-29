import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { eventBatchSchema } from "@mototracker/shared";

/**
 * Self-hosted product telemetry sink. The web/native client batches events and
 * POSTs them here; we store one row each. Best-effort by design — a malformed
 * batch is rejected (400) but never blocks the user's real work, and we cap the
 * batch size in the schema so a buggy client can't flood a single request.
 */
export const eventsRouter: Router = Router();
eventsRouter.use(requireUser);

eventsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { events } = eventBatchSchema.parse(req.body);
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO event (id, user_id, name, props, session_id, client_ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const writeAll = db.transaction((rows: typeof events) => {
      for (const e of rows) {
        insert.run(
          newId(),
          req.user!.id,
          e.name,
          e.props ? JSON.stringify(e.props) : null,
          e.sessionId ?? null,
          e.ts ?? null,
        );
      }
    });
    writeAll(events);
    res.status(202).json({ accepted: events.length });
  }),
);
