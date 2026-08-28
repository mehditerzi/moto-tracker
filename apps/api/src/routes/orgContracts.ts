import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  fleetCustomerCreateSchema,
  fleetCustomerUpdateSchema,
  rentalContractCreateSchema,
  rentalContractReturnSchema,
} from "@mototracker/shared";
import { requireOrgRole } from "../lib/orgAccess.js";
import { fold, foldedIncludes } from "../lib/fleet.js";

/**
 * Rental mode: the renters, and the contracts that put a vehicle in their hands.
 *
 * PRIVACY IS THE REASON DELETE EXISTS HERE. `fleet_customer` holds the personal
 * data of people who are NOT app users — a renter's name, phone and email —
 * collected by the organization. `DELETE /api/me` cannot reach it (there is no
 * user row to cascade from), so without the delete route below the only erasure
 * path for a renter would be deleting the entire organization. The privacy
 * policy in routes/privacy.ts promises better than that, so the route is
 * unconditional: it works whatever the org's mode, and it works while a contract
 * is still open. Contracts cascade with the customer (021_organization.sql).
 *
 * Reads and erasure are mode-agnostic on purpose; only CREATING a customer or
 * opening a contract requires `rental` mode, so that switching an org's mode
 * never hides data it has already collected.
 */
export const orgContractsRouter: Router = Router();
orgContractsRouter.use(requireUser);

const FLEET_WIDE = ["owner", "manager", "staff"] as const;
const FLEET_CONTROL = ["owner", "manager"] as const;

// ─── customers ────────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string;
  org_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  open_contracts?: number;
  total_contracts?: number;
}

function rowToCustomer(r: CustomerRow) {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openContracts: r.open_contracts ?? 0,
    totalContracts: r.total_contracts ?? 0,
  };
}

const customerQuery = z.object({ q: z.string().max(120).optional() });

orgContractsRouter.get(
  "/:orgId/customers",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const { q } = customerQuery.parse(req.query);
    const rows = getDb()
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM rental_contract rc WHERE rc.customer_id = c.id AND rc.status = 'open') AS open_contracts,
                (SELECT COUNT(*) FROM rental_contract rc WHERE rc.customer_id = c.id) AS total_contracts
           FROM fleet_customer c
          WHERE c.org_id = ?
          ORDER BY c.name ASC`,
      )
      .all(req.orgMembership!.orgId) as CustomerRow[];
    // Matching in JS so `Öz` finds `öz`: SQLite's UPPER/LIKE are ASCII-only and
    // a customer list is one org's worth of rows.
    const needle = q ? fold(q.trim()) : "";
    const filtered = needle
      ? rows.filter(
          (r) =>
            foldedIncludes(r.name, needle) ||
            foldedIncludes(r.phone, needle) ||
            foldedIncludes(r.email, needle),
        )
      : rows;
    res.json(filtered.map(rowToCustomer));
  }),
);

orgContractsRouter.post(
  "/:orgId/customers",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = fleetCustomerCreateSchema.parse(req.body);
    const { orgId, mode } = req.orgMembership!;
    if (mode !== "rental") {
      res.status(409).json({ error: "mode_mismatch" });
      return;
    }
    const db = getDb();
    const id = newId();
    db.prepare(
      "INSERT INTO fleet_customer (id, org_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, orgId, body.name, body.phone ?? null, body.email ?? null, body.notes ?? null);
    const row = db.prepare("SELECT * FROM fleet_customer WHERE id = ?").get(id) as CustomerRow;
    res.status(201).json(rowToCustomer(row));
  }),
);

/** Load a customer, scoped by (id, org_id) so another tenant's id is a 404. */
function customerOf(orgId: string, id: string): CustomerRow | undefined {
  return getDb()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM rental_contract rc WHERE rc.customer_id = c.id AND rc.status = 'open') AS open_contracts,
              (SELECT COUNT(*) FROM rental_contract rc WHERE rc.customer_id = c.id) AS total_contracts
         FROM fleet_customer c WHERE c.id = ? AND c.org_id = ?`,
    )
    .get(id, orgId) as CustomerRow | undefined;
}

orgContractsRouter.get(
  "/:orgId/customers/:id",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const row = customerOf(req.orgMembership!.orgId, req.params.id!);
    if (!row) {
      res.status(404).json({ error: "customer_not_found" });
      return;
    }
    res.json(rowToCustomer(row));
  }),
);

orgContractsRouter.patch(
  "/:orgId/customers/:id",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = fleetCustomerUpdateSchema.parse(req.body);
    const orgId = req.orgMembership!.orgId;
    if (!customerOf(orgId, req.params.id!)) {
      res.status(404).json({ error: "customer_not_found" });
      return;
    }
    const fields: Record<string, string> = {
      name: "name",
      phone: "phone",
      email: "email",
      notes: "notes",
    };
    const sets: string[] = [];
    const values: (string | null)[] = [];
    for (const [key, col] of Object.entries(fields)) {
      if (key in body) {
        sets.push(`${col} = ?`);
        values.push(((body as Record<string, unknown>)[key] as string | null) ?? null);
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      values.push(req.params.id!, orgId);
      getDb()
        .prepare(`UPDATE fleet_customer SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`)
        .run(...values);
    }
    res.json(rowToCustomer(customerOf(orgId, req.params.id!)!));
  }),
);

orgContractsRouter.delete(
  "/:orgId/customers/:id",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const orgId = req.orgMembership!.orgId;
    if (!customerOf(orgId, req.params.id!)) {
      res.status(404).json({ error: "customer_not_found" });
      return;
    }
    // Unconditional, including while a contract is open. This is an ERASURE
    // route for third-party personal data, and a right to erasure that can be
    // blocked by the controller's own open paperwork is not one. The contracts
    // cascade; the vehicle is released because the open contract goes with them.
    getDb().prepare("DELETE FROM fleet_customer WHERE id = ? AND org_id = ?").run(req.params.id, orgId);
    res.status(204).end();
  }),
);

// ─── contracts ────────────────────────────────────────────────────────────────

interface ContractRow {
  id: string;
  org_id: string;
  bike_id: string;
  customer_id: string;
  started_at: string;
  ends_at: string | null;
  returned_at: string | null;
  handover_km: number | null;
  return_km: number | null;
  daily_rate: number | null;
  currency: string;
  status: "open" | "returned" | "cancelled";
  notes: string | null;
  created_at: string;
  updated_at: string;
  plate: string | null;
  nickname: string;
  customer_name: string | null;
}

function rowToContract(r: ContractRow) {
  return {
    id: r.id,
    orgId: r.org_id,
    bikeId: r.bike_id,
    customerId: r.customer_id,
    startedAt: r.started_at,
    endsAt: r.ends_at,
    returnedAt: r.returned_at,
    handoverKm: r.handover_km,
    returnKm: r.return_km,
    dailyRate: r.daily_rate,
    currency: r.currency,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bike: { id: r.bike_id, plate: r.plate, nickname: r.nickname },
    customer: { id: r.customer_id, name: r.customer_name },
    // The distance this rental actually covered, once both odometers are known.
    distanceKm: r.return_km != null && r.handover_km != null ? r.return_km - r.handover_km : null,
  };
}

const CONTRACT_SELECT = `SELECT rc.*, b.plate, b.nickname, fc.name AS customer_name
     FROM rental_contract rc
     JOIN bike b ON b.id = rc.bike_id
     LEFT JOIN fleet_customer fc ON fc.id = rc.customer_id`;

const contractQuery = z.object({
  status: z.enum(["open", "returned", "cancelled", "all"]).default("open"),
  bikeId: z.string().max(60).optional(),
  customerId: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

orgContractsRouter.get(
  "/:orgId/contracts",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const q = contractQuery.parse(req.query);
    const where = ["rc.org_id = ?"];
    const params: unknown[] = [req.orgMembership!.orgId];
    if (q.status !== "all") {
      where.push("rc.status = ?");
      params.push(q.status);
    }
    if (q.bikeId) {
      where.push("rc.bike_id = ?");
      params.push(q.bikeId);
    }
    if (q.customerId) {
      where.push("rc.customer_id = ?");
      params.push(q.customerId);
    }
    params.push(q.limit);
    const rows = getDb()
      .prepare(`${CONTRACT_SELECT} WHERE ${where.join(" AND ")} ORDER BY rc.started_at DESC LIMIT ?`)
      .all(...params) as ContractRow[];
    res.json(rows.map(rowToContract));
  }),
);

orgContractsRouter.post(
  "/:orgId/contracts",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = rentalContractCreateSchema.parse(req.body);
    const db = getDb();
    const { orgId, mode } = req.orgMembership!;
    if (mode !== "rental") {
      res.status(409).json({ error: "mode_mismatch" });
      return;
    }
    // Both lookups are scoped by org_id. The composite foreign keys in
    // 021_organization.sql would also refuse a cross-tenant pairing, but a
    // constraint failure is a 500 to the client; this is a 404 with a code.
    const bike = db
      .prepare("SELECT id, archived, current_km FROM bike WHERE id = ? AND org_id = ?")
      .get(body.bikeId, orgId) as
      | { id: string; archived: number; current_km: number | null }
      | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    if (bike.archived === 1) {
      res.status(409).json({ error: "bike_archived" });
      return;
    }
    if (!db.prepare("SELECT 1 FROM fleet_customer WHERE id = ? AND org_id = ?").get(body.customerId, orgId)) {
      res.status(404).json({ error: "customer_not_found" });
      return;
    }
    // Double-booking is the failure mode that costs a rental company a customer.
    // The partial unique index makes it impossible; this makes it legible.
    if (db.prepare("SELECT 1 FROM rental_contract WHERE bike_id = ? AND status = 'open'").get(body.bikeId)) {
      res.status(409).json({ error: "vehicle_already_rented" });
      return;
    }
    if (body.endsAt && body.startedAt && body.endsAt < body.startedAt) {
      res.status(400).json({ error: "ends_before_start" });
      return;
    }

    const id = newId();
    db.prepare(
      `INSERT INTO rental_contract
         (id, org_id, bike_id, customer_id, started_at, ends_at, handover_km, daily_rate, currency, notes)
       VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)`,
    ).run(
      id,
      orgId,
      body.bikeId,
      body.customerId,
      body.startedAt ?? null,
      body.endsAt ?? null,
      body.handoverKm ?? bike.current_km ?? null,
      body.dailyRate ?? null,
      body.currency,
      body.notes ?? null,
    );
    const row = db.prepare(`${CONTRACT_SELECT} WHERE rc.id = ?`).get(id) as ContractRow;
    res.status(201).json(rowToContract(row));
  }),
);

/** An open contract of this org, or null after answering with the right code. */
function openContract(
  orgId: string,
  id: string,
  res: import("express").Response,
): ContractRow | null {
  const row = getDb().prepare(`${CONTRACT_SELECT} WHERE rc.id = ? AND rc.org_id = ?`).get(id, orgId) as
    | ContractRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: "contract_not_found" });
    return null;
  }
  if (row.status !== "open") {
    res.status(409).json({ error: "contract_not_open" });
    return null;
  }
  return row;
}

orgContractsRouter.post(
  "/:orgId/contracts/:id/close",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = rentalContractReturnSchema.parse(req.body ?? {});
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const row = openContract(orgId, req.params.id!, res);
    if (!row) return;
    if (body.returnKm != null && row.handover_km != null && body.returnKm < row.handover_km) {
      res.status(400).json({ error: "return_km_before_handover" });
      return;
    }

    const close = db.transaction(() => {
      db.prepare(
        `UPDATE rental_contract
            SET status = 'returned', returned_at = datetime('now'), return_km = ?,
                notes = COALESCE(?, notes), updated_at = datetime('now')
          WHERE id = ? AND org_id = ? AND status = 'open'`,
      ).run(body.returnKm ?? null, body.notes ?? null, row.id, orgId);
      // Same reasoning as ending an assignment: the return odometer is the best
      // reading anyone has, and it only ever moves forward.
      if (body.returnKm != null) {
        db.prepare(
          "UPDATE bike SET current_km = ?, updated_at = datetime('now') WHERE id = ? AND (current_km IS NULL OR current_km < ?)",
        ).run(body.returnKm, row.bike_id, body.returnKm);
      }
    });
    close();

    const out = db.prepare(`${CONTRACT_SELECT} WHERE rc.id = ?`).get(row.id) as ContractRow;
    res.json(rowToContract(out));
  }),
);

/**
 * Cancelling is not the same as closing: the vehicle never went out. It releases
 * the open slot (the partial unique index keys on status = 'open') without
 * claiming a return that did not happen, and `returned_at` stays NULL — which
 * the table's own CHECK depends on.
 */
orgContractsRouter.post(
  "/:orgId/contracts/:id/cancel",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const orgId = req.orgMembership!.orgId;
    const row = openContract(orgId, req.params.id!, res);
    if (!row) return;
    db.prepare(
      "UPDATE rental_contract SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND org_id = ? AND status = 'open'",
    ).run(row.id, orgId);
    const out = db.prepare(`${CONTRACT_SELECT} WHERE rc.id = ?`).get(row.id) as ContractRow;
    res.json(rowToContract(out));
  }),
);
