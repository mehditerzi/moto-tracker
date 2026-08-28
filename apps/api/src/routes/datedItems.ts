import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { datedItemCreateSchema, datedItemUpdateSchema } from "@mototracker/shared";
import { authorizeRecord, canAccessBike, canAccessRecord } from "../lib/orgAccess.js";

interface DatedItemRow {
  id: string;
  bike_id: string;
  user_id: string;
  type: "sigorta" | "kasko" | "muayene";
  expires_on: string;
  provider: string | null;
  policy_no: string | null;
  cost: number | null;
  notes: string | null;
  source_document_id: string | null;
  ocr_confidence: number | null;
  needs_review: number;
  created_at: string;
  updated_at: string;
}

export function rowToDatedItem(r: DatedItemRow) {
  return {
    id: r.id,
    bikeId: r.bike_id,
    userId: r.user_id,
    type: r.type,
    expiresOn: r.expires_on,
    provider: r.provider,
    policyNo: r.policy_no,
    cost: r.cost,
    notes: r.notes,
    sourceDocumentId: r.source_document_id,
    ocrConfidence: r.ocr_confidence,
    needsReview: r.needs_review === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * These records ARE facts about the vehicle — a renewal deadline, a service
 * interval — not facts about the person who typed them. That distinction is the
 * whole sharing model: it is what a personal-group GUEST (a mechanic, an
 * inspection agency) is allowed to see and edit, whereas trips, fuel spending
 * and scanned documents stay with their author. The flag defaults to false in
 * `lib/orgAccess.ts`, so a record type is private until a route says otherwise.
 */
const VEHICLE_FACT = { vehicleFact: true } as const;

export const bikesNestedDatedRouter: Router = Router({ mergeParams: true });
bikesNestedDatedRouter.use(requireUser);

// Records are scoped by their VEHICLE, not by who typed them: on an org vehicle
// the insurance a driver scanned has to be visible to the manager who pays for
// it. For a personal vehicle the two are the same person, so nothing changes.
bikesNestedDatedRouter.get(
  "/:id/dated-items",
  asyncHandler(async (req, res) => {
    const db = getDb();
    if (!canAccessBike(req.user!.id, req.params.id!, "read", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = db
      .prepare("SELECT * FROM dated_item WHERE bike_id = ? ORDER BY type ASC, expires_on DESC")
      .all(req.params.id) as DatedItemRow[];
    res.json(rows.map(rowToDatedItem));
  }),
);

bikesNestedDatedRouter.post(
  "/:id/dated-items",
  asyncHandler(async (req, res) => {
    const body = datedItemCreateSchema.parse(req.body);
    const db = getDb();
    if (!canAccessBike(req.user!.id, req.params.id!, "write", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Only honour sourceDocumentId if the caller may actually read that document
    // — otherwise it would be a way to probe for other people's document ids.
    let sourceDocumentId: string | null = null;
    if (body.sourceDocumentId) {
      const doc = db
        .prepare("SELECT bike_id, user_id FROM document WHERE id = ?")
        .get(body.sourceDocumentId) as { bike_id: string | null; user_id: string } | undefined;
      if (doc && canAccessRecord(req.user!.id, { bikeId: doc.bike_id, userId: doc.user_id }, "read", db)) {
        sourceDocumentId = body.sourceDocumentId;
      }
    }
    const id = newId();
    db.prepare(
      `INSERT INTO dated_item (id, bike_id, user_id, type, expires_on, provider, policy_no, cost, notes, source_document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      req.user!.id,
      body.type,
      body.expiresOn,
      body.provider ?? null,
      body.policyNo ?? null,
      body.cost ?? null,
      body.notes ?? null,
      sourceDocumentId,
    );
    const row = db.prepare("SELECT * FROM dated_item WHERE id = ?").get(id) as DatedItemRow;
    res.status(201).json(rowToDatedItem(row));
  }),
);

export const datedItemsRouter: Router = Router();
datedItemsRouter.use(requireUser);

/** Fetch a dated item by id, unfiltered — the caller is authorised separately. */
function findItem(id: string): DatedItemRow | undefined {
  return getDb().prepare("SELECT * FROM dated_item WHERE id = ?").get(id) as
    | DatedItemRow
    | undefined;
}

/** The shape `authorizeRecord` needs: which vehicle, and who recorded it. */
function recordOf(row: DatedItemRow) {
  return { bikeId: row.bike_id, userId: row.user_id };
}

datedItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = findItem(req.params.id!);
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(row), "read", VEHICLE_FACT)) return;
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = datedItemUpdateSchema.parse(req.body);
    const db = getDb();
    const existing = findItem(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRecord(req, res, recordOf(existing), "write", { db, ...VEHICLE_FACT })) return;
    const fieldMap: Record<string, string> = {
      type: "type",
      expiresOn: "expires_on",
      provider: "provider",
      policyNo: "policy_no",
      cost: "cost",
      notes: "notes",
    };
    const sets: string[] = [];
    const values: (string | number | null | undefined)[] = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body) {
        sets.push(`${col} = ?`);
        values.push((body as Record<string, unknown>)[key] as string | number | null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id);
      db.prepare(`UPDATE dated_item SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = db.prepare("SELECT * FROM dated_item WHERE id = ?").get(req.params.id) as DatedItemRow;
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const existing = findItem(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Deleting a RECORD is a day-to-day act ("write"), unlike deleting the
    // vehicle it belongs to.
    if (!authorizeRecord(req, res, recordOf(existing), "write", { db, ...VEHICLE_FACT })) return;
    db.prepare("DELETE FROM dated_item WHERE id = ?").run(req.params.id);
    res.status(204).end();
  }),
);
