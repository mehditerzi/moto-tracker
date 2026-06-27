import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import { datedItemCreateSchema, datedItemUpdateSchema } from "@mototracker/shared";

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

export const bikesNestedDatedRouter: Router = Router({ mergeParams: true });
bikesNestedDatedRouter.use(requireUser);

bikesNestedDatedRouter.get(
  "/:id/dated-items",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rows = db
      .prepare(
        "SELECT * FROM dated_item WHERE bike_id = ? AND user_id = ? ORDER BY type ASC, expires_on DESC",
      )
      .all(req.params.id, req.user!.id) as DatedItemRow[];
    res.json(rows.map(rowToDatedItem));
  }),
);

bikesNestedDatedRouter.post(
  "/:id/dated-items",
  asyncHandler(async (req, res) => {
    const body = datedItemCreateSchema.parse(req.body);
    const db = getDb();
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!bike) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Only honour sourceDocumentId if the document belongs to this user.
    let sourceDocumentId: string | null = null;
    if (body.sourceDocumentId) {
      const owns = db
        .prepare("SELECT id FROM document WHERE id = ? AND user_id = ?")
        .get(body.sourceDocumentId, req.user!.id);
      if (owns) sourceDocumentId = body.sourceDocumentId;
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

datedItemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM dated_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id) as DatedItemRow | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = datedItemUpdateSchema.parse(req.body);
    const db = getDb();
    const existing = db
      .prepare("SELECT id FROM dated_item WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
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
      values.push(req.params.id, req.user!.id);
      db.prepare(`UPDATE dated_item SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
        ...values,
      );
    }
    const row = db.prepare("SELECT * FROM dated_item WHERE id = ?").get(req.params.id) as DatedItemRow;
    res.json(rowToDatedItem(row));
  }),
);

datedItemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const result = db
      .prepare("DELETE FROM dated_item WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.status(204).end();
  }),
);
