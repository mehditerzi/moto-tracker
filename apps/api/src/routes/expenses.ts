import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  expenseCreateSchema,
  expenseUpdateSchema,
  type CostMonth,
  type CostSummary,
  type Expense,
} from "@mototracker/shared";
import { canAccessRecord, canAttachRecord, canReadPersonalLayer } from "../lib/orgAccess.js";
import { isPro, proLimits } from "../lib/entitlement.js";

/**
 * Expenses that are not fuel — and the cost report that adds everything up.
 *
 * Authorisation mirrors fuel_log exactly (see routes/fuelLogs.ts): what was
 * SPENT on a vehicle is the personal layer, so a guest the car was shared with
 * cannot read it, and only someone who may attach records may write one.
 */
export const expensesRouter: Router = Router();
expensesRouter.use(requireUser);

interface ExpenseRow {
  id: string;
  user_id: string;
  bike_id: string;
  category: Expense["category"];
  amount: number;
  spent_on: string;
  odometer_km: number | null;
  vendor: string | null;
  notes: string | null;
  created_at: string;
}

function rowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    userId: r.user_id,
    bikeId: r.bike_id,
    category: r.category,
    amount: r.amount,
    spentOn: r.spent_on,
    odometerKm: r.odometer_km,
    vendor: r.vendor,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

const listQuery = z.object({ bikeId: z.string().min(1) });

expensesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { bikeId } = listQuery.parse(req.query);
    const db = getDb();
    if (!canReadPersonalLayer(req.user!.id, bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const rows = db
      .prepare(
        "SELECT * FROM expense WHERE bike_id = ? ORDER BY spent_on DESC, created_at DESC LIMIT 500",
      )
      .all(bikeId) as ExpenseRow[];
    res.json(rows.map(rowToExpense));
  }),
);

// ─── the cost report ──────────────────────────────────────────────────────────

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const summaryQuery = z.object({
  bikeId: z.string().min(1),
  from: z.string().regex(isoDate).optional(),
  to: z.string().regex(isoDate).optional(),
});

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * "Today" as a Turkish user means it. Turkey has been fixed at UTC+3 since
 * 2016, so shifting the instant is exact; using the UTC date instead would end
 * the report at yesterday for the first three hours of every day — and drop
 * anything entered after midnight from "this month" on the 1st.
 */
function istanbulNow(): Date {
  return new Date(Date.now() + 3 * 3600 * 1000);
}

/** Default window: the last twelve whole months plus this one. */
function defaultRange(): { from: string; to: string } {
  const now = istanbulNow();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  return { from: ymd(from), to: ymd(now) };
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 120) break; // ten years is a report, more is a typo
  }
  return out;
}

interface CostLine {
  source: "fuel" | "maintenance" | "document" | "expense";
  on: string;
  amount: number;
  category: string;
  label: string;
}

/**
 * Every priced event on the vehicle inside [from, to]. Four tables, one shape.
 *
 * A dated item (policy, inspection, MTV) has no "paid on" date, so it is placed
 * where the record was created — the moment the user told us they paid. A
 * maintenance item only remembers its LAST service, so only that one is
 * counted; that is the honest reading of what the table holds.
 */
function costLines(bikeId: string, from: string, to: string, db = getDb()): CostLine[] {
  const fuel = db
    .prepare(
      `SELECT filled_on AS on_, total_cost AS amount FROM fuel_log
        WHERE bike_id = ? AND total_cost IS NOT NULL AND filled_on BETWEEN ? AND ?`,
    )
    .all(bikeId, from, to) as { on_: string; amount: number }[];
  const maint = db
    .prepare(
      `SELECT last_done_on AS on_, cost AS amount, kind, custom_label FROM maintenance_item
        WHERE bike_id = ? AND cost IS NOT NULL AND cost > 0 AND last_done_on BETWEEN ? AND ?`,
    )
    .all(bikeId, from, to) as { on_: string; amount: number; kind: string; custom_label: string | null }[];
  const dated = db
    .prepare(
      `SELECT date(created_at, '+3 hours') AS on_, cost AS amount, type FROM dated_item
        WHERE bike_id = ? AND cost IS NOT NULL AND cost > 0 AND date(created_at, '+3 hours') BETWEEN ? AND ?`,
    )
    .all(bikeId, from, to) as { on_: string; amount: number; type: string }[];
  const expenses = db
    .prepare(
      `SELECT spent_on AS on_, amount, category, vendor FROM expense
        WHERE bike_id = ? AND spent_on BETWEEN ? AND ?`,
    )
    .all(bikeId, from, to) as { on_: string; amount: number; category: string; vendor: string | null }[];

  return [
    ...fuel.map((r) => ({ source: "fuel" as const, on: r.on_, amount: r.amount, category: "fuel", label: "" })),
    ...maint.map((r) => ({
      source: "maintenance" as const,
      on: r.on_,
      amount: r.amount,
      category: r.kind,
      label: r.custom_label ?? "",
    })),
    ...dated.map((r) => ({ source: "document" as const, on: r.on_, amount: r.amount, category: r.type, label: "" })),
    ...expenses.map((r) => ({
      source: "expense" as const,
      on: r.on_,
      amount: r.amount,
      category: r.category,
      label: r.vendor ?? "",
    })),
  ].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/** km covered inside the window, from every odometer reading we have. */
function distanceIn(bikeId: string, from: string, to: string, db = getDb()): number | null {
  const row = db
    .prepare(
      `SELECT MIN(km) AS lo, MAX(km) AS hi, COUNT(*) AS n FROM (
         SELECT odometer_km AS km FROM fuel_log WHERE bike_id = ? AND odometer_km IS NOT NULL AND filled_on BETWEEN ? AND ?
         UNION ALL
         SELECT odometer_km FROM expense WHERE bike_id = ? AND odometer_km IS NOT NULL AND spent_on BETWEEN ? AND ?
         UNION ALL
         SELECT last_done_km FROM maintenance_item WHERE bike_id = ? AND last_done_km IS NOT NULL AND last_done_on BETWEEN ? AND ?
       )`,
    )
    .get(bikeId, from, to, bikeId, from, to, bikeId, from, to) as { lo: number | null; hi: number | null; n: number };
  if (row.n < 2 || row.lo === null || row.hi === null || row.hi <= row.lo) return null;
  return row.hi - row.lo;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

expensesRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const q = summaryQuery.parse(req.query);
    const db = getDb();
    if (!canReadPersonalLayer(req.user!.id, q.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const range = defaultRange();
    const from = q.from ?? range.from;
    const to = q.to ?? range.to;
    if (from > to) {
      res.status(400).json({ error: "invalid_range" });
      return;
    }
    const lines = costLines(q.bikeId, from, to, db);

    const bySource = { fuel: 0, maintenance: 0, document: 0, expense: 0 };
    const byCategory: Record<string, number> = {};
    const months = new Map<string, CostMonth>(
      monthsBetween(from, to).map((m) => [m, { month: m, fuel: 0, maintenance: 0, document: 0, expense: 0, total: 0 }]),
    );
    for (const l of lines) {
      bySource[l.source] += l.amount;
      if (l.source === "expense") byCategory[l.category] = (byCategory[l.category] ?? 0) + l.amount;
      const m = months.get(l.on.slice(0, 7));
      if (m) {
        m[l.source] += l.amount;
        m.total += l.amount;
      }
    }
    const total = bySource.fuel + bySource.maintenance + bySource.document + bySource.expense;
    const distanceKm = distanceIn(q.bikeId, from, to, db);

    const summary: CostSummary = {
      bikeId: q.bikeId,
      from,
      to,
      total: round2(total),
      bySource: {
        fuel: round2(bySource.fuel),
        maintenance: round2(bySource.maintenance),
        document: round2(bySource.document),
        expense: round2(bySource.expense),
      },
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round2(v)])),
      months: [...months.values()].map((m) => ({
        ...m,
        fuel: round2(m.fuel),
        maintenance: round2(m.maintenance),
        document: round2(m.document),
        expense: round2(m.expense),
        total: round2(m.total),
      })),
      distanceKm,
      costPerKm: distanceKm && total > 0 ? round2(total / distanceKm) : null,
    };
    res.json(summary);
  }),
);

/** RFC 4180 field: quote when needed, double inner quotes. */
function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/expenses/export.csv?bikeId=… — every cost line, for a spreadsheet
 * or an accountant. A Pro feature (when the free allowances are enforced).
 * UTF-8 with a BOM so Excel opens Turkish characters correctly.
 */
expensesRouter.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const q = summaryQuery.parse(req.query);
    const db = getDb();
    if (!canReadPersonalLayer(req.user!.id, q.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    if (proLimits.enforced && !isPro(req.user!.id, db)) {
      res.status(402).json({ error: "pro_required" });
      return;
    }
    const from = q.from ?? "1970-01-01";
    const to = q.to ?? ymd(istanbulNow());
    const bike = db.prepare("SELECT nickname, plate FROM bike WHERE id = ?").get(q.bikeId) as
      | { nickname: string; plate: string | null }
      | undefined;
    const lines = costLines(q.bikeId, from, to, db);
    const header = ["date", "source", "category", "detail", "amount_try"];
    const body = lines.map((l) =>
      [l.on, l.source, l.category, l.label, l.amount.toFixed(2)].map(csvField).join(","),
    );
    const name = (bike?.plate || bike?.nickname || "arac").replace(/[^\p{L}\p{N}]+/gu, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="garajim-masraflar-${encodeURIComponent(name)}.csv"`,
    );
    res.send("﻿" + [header.join(","), ...body].join("\r\n") + "\r\n");
  }),
);

expensesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = expenseCreateSchema.parse(req.body);
    const db = getDb();
    if (!canAttachRecord(req.user!.id, body.bikeId, db)) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const bike = db.prepare("SELECT id FROM bike WHERE id = ? AND archived = 0").get(body.bikeId);
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const id = newId();
    db.prepare(
      `INSERT INTO expense (id, user_id, bike_id, category, amount, spent_on, odometer_km, vendor, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.user!.id,
      body.bikeId,
      body.category,
      body.amount,
      body.spentOn,
      body.odometerKm ?? null,
      body.vendor || null,
      body.notes || null,
    );
    // A newer odometer reading moves the vehicle forward, never back — same
    // courtesy the fuel form does on the client, done once here for both.
    if (body.odometerKm != null) {
      db.prepare(
        "UPDATE bike SET current_km = ?, updated_at = datetime('now') WHERE id = ? AND (current_km IS NULL OR current_km < ?)",
      ).run(body.odometerKm, body.bikeId, body.odometerKm);
    }
    const row = db.prepare("SELECT * FROM expense WHERE id = ?").get(id) as ExpenseRow;
    res.status(201).json(rowToExpense(row));
  }),
);

expensesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = expenseUpdateSchema.parse(req.body);
    const db = getDb();
    const row = db.prepare("SELECT * FROM expense WHERE id = ?").get(req.params.id) as ExpenseRow | undefined;
    if (!row || !canAccessRecord(req.user!.id, { bikeId: row.bike_id, userId: row.user_id }, "write", db)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const next = { ...rowToExpense(row), ...body };
    db.prepare(
      `UPDATE expense SET category = ?, amount = ?, spent_on = ?, odometer_km = ?, vendor = ?, notes = ?,
              updated_at = datetime('now') WHERE id = ?`,
    ).run(
      next.category,
      next.amount,
      next.spentOn,
      next.odometerKm ?? null,
      next.vendor || null,
      next.notes || null,
      row.id,
    );
    res.json(rowToExpense(db.prepare("SELECT * FROM expense WHERE id = ?").get(row.id) as ExpenseRow));
  }),
);

expensesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare("SELECT id, bike_id, user_id FROM expense WHERE id = ?").get(req.params.id) as
      | { id: string; bike_id: string; user_id: string }
      | undefined;
    if (row && canAccessRecord(req.user!.id, { bikeId: row.bike_id, userId: row.user_id }, "write", db)) {
      db.prepare("DELETE FROM expense WHERE id = ?").run(row.id);
    }
    res.status(204).end();
  }),
);
