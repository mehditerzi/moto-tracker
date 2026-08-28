import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { newId } from "../lib/ulid.js";
import {
  fleetCostQuerySchema,
  fleetInventoryQuerySchema,
  vehicleAssignmentCreateSchema,
  vehicleAssignmentEndSchema,
  type FleetCostBucket,
  type FleetCostResponse,
  type FleetCostVehicle,
  type FleetDueKind,
  type FleetHolder,
  type FleetInventoryResponse,
  type FleetInventoryRow,
  type FleetStatus,
  type FleetTriageResponse,
  type FleetTriageRow,
  type OrgMode,
} from "@mototracker/shared";
import { requireOrgRole } from "../lib/orgAccess.js";
import {
  daysUntil,
  fleetStatusFor,
  fleetToday,
  fold,
  foldedIncludes,
  maintenanceDueOn,
  maintenanceKmRemaining,
  normPlate,
} from "../lib/fleet.js";

/**
 * The three fleet-wide screens — triage, inventory, costs — plus the assignment
 * ledger that answers "who is driving this today" in fleet mode.
 *
 * ROLE BOUNDARY. Every route in this file is gated to owner / manager / staff by
 * `requireOrgRole`, never to `driver`. That is the security-critical line in
 * docs/fleet-design.md §2: a driver may see the vehicle in their hands through
 * the ordinary consumer endpoints (bikeScope grants it) and must not be able to
 * learn that the rest of the fleet exists. Because these endpoints answer
 * fleet-wide questions, there is no scoped version of them for a driver — the
 * answer is 403, not a filtered list.
 *
 * QUERY SHAPE. The board is the endpoint that sells the product, so it is a
 * fixed number of set-based queries — six for the whole triage board regardless
 * of fleet size — rather than a loop over vehicles. A 40-vehicle fleet doing
 * N+1 would be 200 statements per page load and would feel exactly like the
 * spreadsheet it is meant to replace.
 */
export const orgFleetRouter: Router = Router();
orgFleetRouter.use(requireUser);

/** Roles that see the whole fleet. Never includes `driver`. */
const FLEET_WIDE = ["owner", "manager", "staff"] as const;
/** Roles that may change who is holding a vehicle. §2: not staff. */
const FLEET_CONTROL = ["owner", "manager"] as const;

// ─── the fleet's vehicles, with whoever is holding them ───────────────────────

interface FleetBikeRow {
  id: string;
  plate: string | null;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: "motorcycle" | "car";
  current_km: number | null;
  archived: number;
  driver_id: string | null;
  driver_name: string | null;
  driver_email: string | null;
  assigned_at: string | null;
  contract_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  contract_started_at: string | null;
  contract_ends_at: string | null;
}

/**
 * Every vehicle of one organization with its CURRENT holder, in one statement.
 *
 * The two LEFT JOINs cannot fan out: `idx_assignment_open_bike` and
 * `idx_contract_open_bike` (021_organization.sql) each allow at most one open
 * row per vehicle. That guarantee is what lets the whole board be flat queries.
 */
function fleetBikes(orgId: string): FleetBikeRow[] {
  return getDb()
    .prepare(
      `SELECT b.id, b.plate, b.nickname, b.make, b.model, b.year, b.vehicle_type,
              b.current_km, b.archived,
              va.user_id AS driver_id, u.name AS driver_name, u.email AS driver_email,
              va.started_at AS assigned_at,
              rc.id AS contract_id, rc.customer_id, fc.name AS customer_name,
              rc.started_at AS contract_started_at, rc.ends_at AS contract_ends_at
         FROM bike b
         LEFT JOIN vehicle_assignment va ON va.bike_id = b.id AND va.ended_at IS NULL
         LEFT JOIN user u ON u.id = va.user_id
         LEFT JOIN rental_contract rc ON rc.bike_id = b.id AND rc.status = 'open'
         LEFT JOIN fleet_customer fc ON fc.id = rc.customer_id
        WHERE b.org_id = ?`,
    )
    .all(orgId) as FleetBikeRow[];
}

/**
 * One holder cell for both modes — the design doc is explicit that there is ONE
 * vehicle row, not two parallel UIs. The org's own mode is tried first so a
 * rental company that also assigns a van to staff still reads as "rented out"
 * when a contract is open.
 */
function holderOf(b: FleetBikeRow, mode: OrgMode): FleetHolder | null {
  const driver: FleetHolder | null = b.driver_id
    ? {
        type: "driver",
        id: b.driver_id,
        name: b.driver_name || b.driver_email || b.driver_id,
        since: b.assigned_at ?? "",
      }
    : null;
  const customer: FleetHolder | null = b.customer_id
    ? {
        type: "customer",
        id: b.customer_id,
        name: b.customer_name ?? b.customer_id,
        since: b.contract_started_at ?? "",
        dueBack: b.contract_ends_at,
        contractId: b.contract_id ?? undefined,
      }
    : null;
  return mode === "rental" ? (customer ?? driver) : (driver ?? customer);
}

// ─── deadlines, gathered once for the whole fleet ─────────────────────────────

interface Deadline {
  bikeId: string;
  kind: FleetDueKind;
  label: string | null;
  recordId: string | null;
  dueOn: string;
}

interface DatedRow {
  id: string;
  bike_id: string;
  type: "sigorta" | "kasko" | "muayene" | "mtv";
  expires_on: string;
}

interface MaintRow {
  id: string;
  bike_id: string;
  kind: string;
  custom_label: string | null;
  last_done_on: string | null;
  last_done_km: number | null;
  interval_months: number | null;
  interval_km: number | null;
}

/**
 * Every dated deadline in the fleet, as a flat list.
 *
 * `dated_item` keeps history — a vehicle has last year's policy and this year's
 * — so the deadline that matters is the LATEST expiry per (vehicle, type),
 * which is the same rule the consumer dashboard uses.
 *
 * Km-based maintenance intervals produce no dated deadline; they are surfaced on
 * the inventory row (`kmDue`, see `fleetKmDue` below) rather than on a board
 * sorted by date, because "due in 800 km" cannot be placed among "due in 12
 * days" honestly.
 */
function fleetDeadlines(orgId: string, bikeIds: string[], mode: OrgMode): Deadline[] {
  if (bikeIds.length === 0) return [];
  const db = getDb();
  const marks = bikeIds.map(() => "?").join(", ");
  const out: Deadline[] = [];

  const dated = db
    .prepare(
      `SELECT d.id, d.bike_id, d.type, d.expires_on
         FROM dated_item d
        WHERE d.bike_id IN (${marks})
          AND d.expires_on = (SELECT MAX(d2.expires_on) FROM dated_item d2
                               WHERE d2.bike_id = d.bike_id AND d2.type = d.type)`,
    )
    .all(...bikeIds) as DatedRow[];
  // Two rows can share the max date (a re-scan of the same policy); keep one.
  const seen = new Set<string>();
  for (const d of dated) {
    const key = `${d.bike_id}:${d.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bikeId: d.bike_id, kind: d.type, label: null, recordId: d.id, dueOn: d.expires_on });
  }

  const maint = db
    .prepare(
      `SELECT id, bike_id, kind, custom_label, last_done_on, last_done_km, interval_months, interval_km
         FROM maintenance_item
        WHERE bike_id IN (${marks}) AND interval_months IS NOT NULL AND last_done_on IS NOT NULL`,
    )
    .all(...bikeIds) as MaintRow[];
  for (const m of maint) {
    const dueOn = maintenanceDueOn(m);
    if (!dueOn) continue;
    out.push({
      bikeId: m.bike_id,
      kind: "maintenance",
      label: m.custom_label ?? m.kind,
      recordId: m.id,
      dueOn,
    });
  }

  // A rental due back is a deadline like any other: it is the thing a rental
  // company's morning actually revolves around.
  if (mode === "rental") {
    const contracts = db
      .prepare(
        `SELECT id, bike_id, ends_at FROM rental_contract
          WHERE bike_id IN (${marks}) AND status = 'open' AND ends_at IS NOT NULL`,
      )
      .all(...bikeIds) as { id: string; bike_id: string; ends_at: string }[];
    for (const c of contracts) {
      out.push({
        bikeId: c.bike_id,
        kind: "contract_due",
        label: null,
        recordId: c.id,
        // ends_at may carry a time; the board works in calendar days.
        dueOn: c.ends_at.slice(0, 10),
      });
    }
  }
  return out;
}

/**
 * The most urgent KM-based service interval per vehicle — the deadline that has
 * no date. One query for the whole fleet, joined to `bike.current_km` because
 * "how far is left" only means anything against the odometer we last saw.
 */
function fleetKmDue(bikeIds: string[]): Map<string, { label: string; kmRemaining: number }> {
  const out = new Map<string, { label: string; kmRemaining: number }>();
  if (bikeIds.length === 0) return out;
  const marks = bikeIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT m.bike_id, m.kind, m.custom_label, m.last_done_km, m.interval_km, b.current_km
         FROM maintenance_item m
         JOIN bike b ON b.id = m.bike_id
        WHERE m.bike_id IN (${marks}) AND m.interval_km IS NOT NULL AND m.last_done_km IS NOT NULL`,
    )
    .all(...bikeIds) as (MaintRow & { current_km: number | null })[];
  for (const m of rows) {
    const kmRemaining = maintenanceKmRemaining(m, m.current_km);
    if (kmRemaining === null) continue;
    const cur = out.get(m.bike_id);
    if (!cur || kmRemaining < cur.kmRemaining) {
      out.set(m.bike_id, { label: m.custom_label ?? m.kind, kmRemaining });
    }
  }
  return out;
}

/** Documents still waiting on OCR, per vehicle — the summary strip's last cell. */
function pendingOcrByBike(bikeIds: string[]): Map<string, number> {
  const map = new Map<string, number>();
  if (bikeIds.length === 0) return map;
  const marks = bikeIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT bike_id, COUNT(*) AS n FROM document
        WHERE bike_id IN (${marks}) AND ocr_status = 'pending' GROUP BY bike_id`,
    )
    .all(...bikeIds) as { bike_id: string; n: number }[];
  for (const r of rows) map.set(r.bike_id, r.n);
  return map;
}

// ─── triage board ─────────────────────────────────────────────────────────────

const triageQuery = z.object({
  horizonDays: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * `/fleet` — exception-first. A manager with 40 vehicles wants the 3 that need
 * action today, so the response leads with what is already overdue and follows
 * with the horizon, both sorted by urgency. The full inventory is a different
 * screen on purpose.
 *
 * An empty board is a SUCCESS state ("tüm araçlar güncel"), which is why the
 * summary strip is always populated even when both lists are empty — there has
 * to be something on the page saying the fleet is fine.
 */
orgFleetRouter.get(
  "/:orgId/triage",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const { horizonDays } = triageQuery.parse(req.query);
    const { orgId, mode } = req.orgMembership!;
    const today = fleetToday();

    const bikes = fleetBikes(orgId);
    const active = bikes.filter((b) => b.archived === 0);
    const activeIds = active.map((b) => b.id);
    const byId = new Map(active.map((b) => [b.id, b]));

    const deadlines = fleetDeadlines(orgId, activeIds, mode);
    const pending = pendingOcrByBike(activeIds);

    const rows: FleetTriageRow[] = [];
    for (const d of deadlines) {
      const b = byId.get(d.bikeId);
      if (!b) continue;
      const daysRemaining = daysUntil(d.dueOn, today);
      if (daysRemaining > horizonDays) continue;
      rows.push({
        bikeId: b.id,
        plate: b.plate,
        nickname: b.nickname,
        make: b.make,
        model: b.model,
        kind: d.kind,
        label: d.label,
        recordId: d.recordId,
        dueOn: d.dueOn,
        daysRemaining,
        status: fleetStatusFor(daysRemaining),
        holder: holderOf(b, mode),
      });
    }
    // Most overdue first, then soonest; plate as a stable tie-break so the board
    // does not reshuffle between two loads with identical data.
    rows.sort(
      (a, c) => a.daysRemaining - c.daysRemaining || (a.plate ?? "").localeCompare(c.plate ?? ""),
    );

    const overdue = rows.filter((r) => r.daysRemaining < 0);
    const upcoming = rows.filter((r) => r.daysRemaining >= 0);
    const inUse = active.filter((b) => holderOf(b, mode) !== null).length;

    const body: FleetTriageResponse = {
      orgId,
      mode,
      today,
      horizonDays,
      summary: {
        totalVehicles: active.length,
        inUse,
        idle: active.length - inUse,
        archived: bikes.length - active.length,
        documentsPendingOcr: [...pending.values()].reduce((a, b) => a + b, 0),
        overdueCount: overdue.length,
        dueSoonCount: upcoming.length,
      },
      overdue,
      upcoming,
    };
    res.json(body);
  }),
);

// ─── inventory ────────────────────────────────────────────────────────────────

/**
 * `/fleet/vehicles` — the full list, sortable and filterable.
 *
 * Filtering and sorting happen in JS over the org's own vehicles rather than in
 * SQL, deliberately: `status`, `nextDue` and `holder` are all DERIVED (a status
 * is a date minus today, a holder is one of two tables), so pushing them into
 * SQL would mean expressing the same rule twice and letting the two drift. The
 * set being sorted is bounded by `organization.max_vehicles`, which is a number
 * the customer pays for.
 *
 * Plate search folds spacing away in both directions — `34ABC123` finds
 * `34 ABC 123` and vice versa — because that is how people actually type a plate
 * they are reading off a windscreen.
 */
orgFleetRouter.get(
  "/:orgId/vehicles",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const q = fleetInventoryQuerySchema.parse(req.query);
    const { orgId, mode } = req.orgMembership!;
    const today = fleetToday();

    const all = fleetBikes(orgId);
    const bikes = q.includeArchived ? all : all.filter((b) => b.archived === 0);
    const ids = bikes.map((b) => b.id);
    const deadlines = fleetDeadlines(orgId, ids, mode);
    const kmDue = fleetKmDue(ids);
    const pending = pendingOcrByBike(ids);

    // Soonest deadline per vehicle.
    const next = new Map<string, Deadline>();
    for (const d of deadlines) {
      const cur = next.get(d.bikeId);
      if (!cur || d.dueOn < cur.dueOn) next.set(d.bikeId, d);
    }

    let items: FleetInventoryRow[] = bikes.map((b) => {
      const d = next.get(b.id);
      const daysRemaining = d ? daysUntil(d.dueOn, today) : null;
      return {
        bikeId: b.id,
        plate: b.plate,
        nickname: b.nickname,
        make: b.make,
        model: b.model,
        year: b.year,
        vehicleType: b.vehicle_type,
        currentKm: b.current_km,
        archived: b.archived === 1,
        nextDue: d
          ? { kind: d.kind, label: d.label, dueOn: d.dueOn, daysRemaining: daysRemaining! }
          : null,
        kmDue: kmDue.get(b.id) ?? null,
        status: fleetStatusFor(daysRemaining),
        holder: holderOf(b, mode),
        documentsPendingOcr: pending.get(b.id) ?? 0,
      };
    });

    if (q.q) {
      const needlePlate = normPlate(q.q);
      const needleText = fold(q.q.trim());
      items = items.filter(
        (r) =>
          (needlePlate.length > 0 && normPlate(r.plate).includes(needlePlate)) ||
          foldedIncludes(r.nickname, needleText) ||
          foldedIncludes(r.make, needleText) ||
          foldedIncludes(r.model, needleText),
      );
    }
    if (q.status) items = items.filter((r) => r.status === q.status);
    if (q.holder === "assigned") items = items.filter((r) => r.holder !== null);
    else if (q.holder === "idle") items = items.filter((r) => r.holder === null);
    else if (q.holder) items = items.filter((r) => r.holder?.id === q.holder);

    const STATUS_ORDER: Record<FleetStatus, number> = {
      expired: 0,
      danger: 1,
      soon: 2,
      ok: 3,
      unset: 4,
    };
    const dir = q.dir === "desc" ? -1 : 1;
    items.sort((a, b) => {
      let cmp = 0;
      switch (q.sort) {
        case "plate":
          cmp = normPlate(a.plate).localeCompare(normPlate(b.plate));
          break;
        case "nickname":
          cmp = fold(a.nickname).localeCompare(fold(b.nickname));
          break;
        case "km":
          cmp = (a.currentKm ?? -1) - (b.currentKm ?? -1);
          break;
        case "status":
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
        case "expiry":
          // A vehicle with no deadline sorts last however the column is pointed:
          // "nothing recorded" is not the same as "furthest away", and flipping
          // the arrow should not put unknowns at the top of an urgency list.
          if (!a.nextDue && !b.nextDue) cmp = 0;
          else if (!a.nextDue) return 1;
          else if (!b.nextDue) return -1;
          else cmp = a.nextDue.daysRemaining - b.nextDue.daysRemaining;
          break;
      }
      return (cmp || normPlate(a.plate).localeCompare(normPlate(b.plate))) * dir;
    });

    const body: FleetInventoryResponse = {
      orgId,
      mode,
      today,
      total: items.length,
      limit: q.limit,
      offset: q.offset,
      items: items.slice(q.offset, q.offset + q.limit),
    };
    res.json(body);
  }),
);

/**
 * One vehicle's fleet history — who has held it and under what contract.
 *
 * The rest of `/fleet/vehicles/:id` is the consumer dashboard's own endpoints
 * (`/api/bikes/:id`, its dated items, maintenance and documents), which already
 * authorise org vehicles through orgAccess. This adds only the part that has no
 * consumer equivalent.
 */
orgFleetRouter.get(
  "/:orgId/vehicles/:bikeId/history",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const { orgId } = req.orgMembership!;
    // Scoped by (id, org_id), not by id: a vehicle of another tenant must read
    // as non-existent even to an owner here.
    const bike = db
      .prepare("SELECT id FROM bike WHERE id = ? AND org_id = ?")
      .get(req.params.bikeId, orgId) as { id: string } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    const assignments = db
      .prepare(
        `SELECT va.id, va.user_id, va.started_at, va.ended_at, va.start_km, va.end_km,
                u.email, u.name
           FROM vehicle_assignment va
           LEFT JOIN user u ON u.id = va.user_id
          WHERE va.bike_id = ? AND va.org_id = ?
          ORDER BY va.started_at DESC`,
      )
      .all(req.params.bikeId, orgId) as {
      id: string;
      user_id: string;
      started_at: string;
      ended_at: string | null;
      start_km: number | null;
      end_km: number | null;
      email: string | null;
      name: string | null;
    }[];
    const contracts = db
      .prepare(
        `SELECT rc.id, rc.customer_id, rc.started_at, rc.ends_at, rc.returned_at,
                rc.handover_km, rc.return_km, rc.daily_rate, rc.currency, rc.status,
                fc.name AS customer_name
           FROM rental_contract rc
           LEFT JOIN fleet_customer fc ON fc.id = rc.customer_id
          WHERE rc.bike_id = ? AND rc.org_id = ?
          ORDER BY rc.started_at DESC`,
      )
      .all(req.params.bikeId, orgId) as Record<string, string | number | null>[];

    res.json({
      bikeId: req.params.bikeId,
      assignments: assignments.map((a) => ({
        id: a.id,
        userId: a.user_id,
        userName: a.name,
        userEmail: a.email,
        startedAt: a.started_at,
        endedAt: a.ended_at,
        startKm: a.start_km,
        endKm: a.end_km,
      })),
      contracts: contracts.map((c) => ({
        id: c.id,
        customerId: c.customer_id,
        customerName: c.customer_name,
        startedAt: c.started_at,
        endsAt: c.ends_at,
        returnedAt: c.returned_at,
        handoverKm: c.handover_km,
        returnKm: c.return_km,
        dailyRate: c.daily_rate,
        currency: c.currency,
        status: c.status,
      })),
    });
  }),
);

// ─── assignments (fleet mode) ─────────────────────────────────────────────────

interface AssignmentRow {
  id: string;
  org_id: string;
  bike_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  start_km: number | null;
  end_km: number | null;
  created_at: string;
  plate: string | null;
  nickname: string;
  email: string | null;
  name: string | null;
}

function rowToAssignment(r: AssignmentRow) {
  return {
    id: r.id,
    orgId: r.org_id,
    bikeId: r.bike_id,
    userId: r.user_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    startKm: r.start_km,
    endKm: r.end_km,
    createdAt: r.created_at,
    bike: { id: r.bike_id, plate: r.plate, nickname: r.nickname },
    user: { id: r.user_id, email: r.email, name: r.name },
  };
}

const ASSIGNMENT_SELECT = `SELECT va.*, b.plate, b.nickname, u.email, u.name
     FROM vehicle_assignment va
     JOIN bike b ON b.id = va.bike_id
     LEFT JOIN user u ON u.id = va.user_id`;

const assignmentQuery = z.object({
  bikeId: z.string().max(60).optional(),
  userId: z.string().max(60).optional(),
  open: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

orgFleetRouter.get(
  "/:orgId/assignments",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const q = assignmentQuery.parse(req.query);
    const where = ["va.org_id = ?"];
    const params: unknown[] = [req.orgMembership!.orgId];
    if (q.bikeId) {
      where.push("va.bike_id = ?");
      params.push(q.bikeId);
    }
    if (q.userId) {
      where.push("va.user_id = ?");
      params.push(q.userId);
    }
    if (q.open === true) where.push("va.ended_at IS NULL");
    if (q.open === false) where.push("va.ended_at IS NOT NULL");
    params.push(q.limit);
    const rows = getDb()
      .prepare(
        `${ASSIGNMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY va.started_at DESC LIMIT ?`,
      )
      .all(...params) as AssignmentRow[];
    res.json(rows.map(rowToAssignment));
  }),
);

orgFleetRouter.post(
  "/:orgId/assignments",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = vehicleAssignmentCreateSchema.parse(req.body);
    const db = getDb();
    const { orgId, mode } = req.orgMembership!;

    // Handing a vehicle to a driver is what `fleet` mode IS. Allowing it in a
    // rental org would create a holder the rental UI never renders, and the
    // partial unique index would then hold the vehicle out of the contract flow.
    if (mode !== "fleet") {
      res.status(409).json({ error: "mode_mismatch" });
      return;
    }
    const bike = db
      .prepare("SELECT id, archived, current_km FROM bike WHERE id = ? AND org_id = ?")
      .get(body.bikeId, orgId) as { id: string; archived: number; current_km: number | null } | undefined;
    if (!bike) {
      res.status(404).json({ error: "bike_not_found" });
      return;
    }
    if (bike.archived === 1) {
      res.status(409).json({ error: "bike_archived" });
      return;
    }
    // The driver must be an ACTIVE member: assigning to a removed member would
    // create an assignment that grants nothing and blocks the vehicle.
    const member = db
      .prepare("SELECT 1 FROM org_member WHERE org_id = ? AND user_id = ? AND status = 'active'")
      .get(orgId, body.userId);
    if (!member) {
      res.status(404).json({ error: "member_not_found" });
      return;
    }
    // The partial unique index would reject this anyway; checking first turns a
    // raw SQLITE_CONSTRAINT 500 into a code the client can act on.
    const open = db
      .prepare("SELECT id FROM vehicle_assignment WHERE bike_id = ? AND ended_at IS NULL")
      .get(body.bikeId);
    if (open) {
      res.status(409).json({ error: "vehicle_already_assigned" });
      return;
    }

    const id = newId();
    db.prepare(
      `INSERT INTO vehicle_assignment (id, org_id, bike_id, user_id, start_km)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, orgId, body.bikeId, body.userId, body.startKm ?? bike.current_km ?? null);
    const row = db.prepare(`${ASSIGNMENT_SELECT} WHERE va.id = ?`).get(id) as AssignmentRow;
    res.status(201).json(rowToAssignment(row));
  }),
);

orgFleetRouter.post(
  "/:orgId/assignments/:id/end",
  requireOrgRole(...FLEET_CONTROL),
  asyncHandler(async (req, res) => {
    const body = vehicleAssignmentEndSchema.parse(req.body ?? {});
    const db = getDb();
    const { orgId } = req.orgMembership!;
    const row = db
      .prepare("SELECT id, bike_id, ended_at, start_km FROM vehicle_assignment WHERE id = ? AND org_id = ?")
      .get(req.params.id, orgId) as
      | { id: string; bike_id: string; ended_at: string | null; start_km: number | null }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "assignment_not_found" });
      return;
    }
    if (row.ended_at !== null) {
      res.status(409).json({ error: "assignment_already_ended" });
      return;
    }
    if (body.endKm != null && row.start_km != null && body.endKm < row.start_km) {
      res.status(400).json({ error: "end_km_before_start_km" });
      return;
    }

    const close = db.transaction(() => {
      db.prepare(
        "UPDATE vehicle_assignment SET ended_at = datetime('now'), end_km = ? WHERE id = ?",
      ).run(body.endKm ?? null, row.id);
      // The odometer at handback is the freshest reading anyone has, and the
      // whole compliance/cost side reads `bike.current_km`. Only ever forward:
      // a typo that lowers the odometer must not corrupt the record.
      if (body.endKm != null) {
        db.prepare(
          "UPDATE bike SET current_km = ?, updated_at = datetime('now') WHERE id = ? AND (current_km IS NULL OR current_km < ?)",
        ).run(body.endKm, row.bike_id, body.endKm);
      }
    });
    close();

    const out = db.prepare(`${ASSIGNMENT_SELECT} WHERE va.id = ?`).get(row.id) as AssignmentRow;
    res.json(rowToAssignment(out));
  }),
);

// ─── costs ────────────────────────────────────────────────────────────────────

/** How far above the fleet median a vehicle's ₺/km has to be to be flagged. */
const OUTLIER_FACTOR = 1.5;

function emptyBucket(): FleetCostBucket {
  return {
    fuelCost: 0,
    fuelLiters: 0,
    maintenanceCost: 0,
    complianceCost: 0,
    totalCost: 0,
    distanceKm: 0,
    costPerKm: null,
  };
}

function seal(b: FleetCostBucket): FleetCostBucket {
  b.totalCost = round2(b.fuelCost + b.maintenanceCost + b.complianceCost);
  b.fuelCost = round2(b.fuelCost);
  b.fuelLiters = round2(b.fuelLiters);
  b.maintenanceCost = round2(b.maintenanceCost);
  b.complianceCost = round2(b.complianceCost);
  b.distanceKm = round2(b.distanceKm);
  b.costPerKm = b.distanceKm > 0 ? round2(b.totalCost / b.distanceKm) : null;
  return b;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function addMonthsToKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * `/fleet/costs` — fuel + service + compliance per vehicle and per month, with
 * ₺/km, and the outliers already identified.
 *
 * Distance is the hard part, because a fleet's odometer is only ever observed
 * when someone writes it down. Two sources, in order of trust:
 *
 *   1. ODOMETER DELTAS between consecutive fuel-ups. This is what a fleet
 *      actually has — refuelling is the one moment the km is recorded — and it
 *      counts every kilometre, including the ones nobody tracked as a trip. The
 *      deltas are computed over the vehicle's WHOLE history and then attributed
 *      to the month of the later fill, so the first month in the window is not
 *      silently short.
 *   2. GPS TRIPS, for a fleet that records journeys but not odometers.
 *
 * A vehicle with neither reports `costPerKm: null` rather than a made-up number.
 */
orgFleetRouter.get(
  "/:orgId/costs",
  requireOrgRole(...FLEET_WIDE),
  asyncHandler(async (req, res) => {
    const q = fleetCostQuerySchema.parse(req.query);
    const { orgId } = req.orgMembership!;
    const db = getDb();
    const today = fleetToday();
    const to = q.to ?? today.slice(0, 7);
    const from = q.from ?? addMonthsToKey(to, -11);
    const inWindow = (month: string) => month >= from && month <= to;

    const bikes = fleetBikes(orgId);
    const ids = bikes.map((b) => b.id);
    const marks = ids.map(() => "?").join(", ");

    const months: string[] = [];
    for (let k = from; k <= to; k = addMonthsToKey(k, 1)) {
      months.push(k);
      if (months.length > 120) break; // a decade is plenty; refuse to run away.
    }

    const perVehicle = new Map<string, Map<string, FleetCostBucket>>();
    const bucket = (bikeId: string, month: string): FleetCostBucket => {
      let byMonth = perVehicle.get(bikeId);
      if (!byMonth) {
        byMonth = new Map();
        perVehicle.set(bikeId, byMonth);
      }
      let b = byMonth.get(month);
      if (!b) {
        b = emptyBucket();
        byMonth.set(month, b);
      }
      return b;
    };

    if (ids.length > 0) {
      // Fuel: whole history, ordered by odometer, so the deltas are right at the
      // window edge. Cost and litres are only counted inside the window.
      const fuel = db
        .prepare(
          `SELECT bike_id, filled_on, liters, total_cost, odometer_km
             FROM fuel_log WHERE bike_id IN (${marks})
            ORDER BY bike_id, odometer_km ASC, filled_on ASC`,
        )
        .all(...ids) as {
        bike_id: string;
        filled_on: string;
        liters: number;
        total_cost: number | null;
        odometer_km: number | null;
      }[];

      let prevBike = "";
      let prevOdo: number | null = null;
      for (const f of fuel) {
        if (f.bike_id !== prevBike) {
          prevBike = f.bike_id;
          prevOdo = null;
        }
        const month = f.filled_on.slice(0, 7);
        if (inWindow(month)) {
          const b = bucket(f.bike_id, month);
          b.fuelCost += f.total_cost ?? 0;
          b.fuelLiters += f.liters ?? 0;
        }
        if (f.odometer_km != null) {
          if (prevOdo != null && f.odometer_km > prevOdo && inWindow(month)) {
            bucket(f.bike_id, month).distanceKm += f.odometer_km - prevOdo;
          }
          prevOdo = f.odometer_km;
        }
      }

      const maint = db
        .prepare(
          `SELECT bike_id, substr(last_done_on, 1, 7) AS month, SUM(COALESCE(cost, 0)) AS total
             FROM maintenance_item
            WHERE bike_id IN (${marks}) AND last_done_on IS NOT NULL
            GROUP BY bike_id, month`,
        )
        .all(...ids) as { bike_id: string; month: string; total: number }[];
      for (const m of maint) {
        if (inWindow(m.month)) bucket(m.bike_id, m.month).maintenanceCost += m.total;
      }

      // Compliance is bucketed by when the policy/tax was RECORDED, not when it
      // expires: an insurance premium is spent on the day it is bought, and
      // `dated_item` has no separate purchase date to do better with.
      const compliance = db
        .prepare(
          `SELECT bike_id, substr(created_at, 1, 7) AS month, SUM(COALESCE(cost, 0)) AS total
             FROM dated_item
            WHERE bike_id IN (${marks})
            GROUP BY bike_id, month`,
        )
        .all(...ids) as { bike_id: string; month: string; total: number }[];
      for (const c of compliance) {
        if (inWindow(c.month)) bucket(c.bike_id, c.month).complianceCost += c.total;
      }

      // Trip fallback, applied only where the odometer told us nothing.
      const trips = db
        .prepare(
          `SELECT bike_id, substr(started_at, 1, 7) AS month, SUM(distance_km) AS km
             FROM trip WHERE bike_id IN (${marks}) GROUP BY bike_id, month`,
        )
        .all(...ids) as { bike_id: string; month: string; km: number }[];
      for (const t of trips) {
        if (!inWindow(t.month)) continue;
        const b = bucket(t.bike_id, t.month);
        if (b.distanceKm === 0) b.distanceKm = t.km;
      }
    }

    const vehicles: FleetCostVehicle[] = bikes.map((b) => {
      const byMonth = perVehicle.get(b.id) ?? new Map<string, FleetCostBucket>();
      const total = emptyBucket();
      const monthRows = months.map((m) => {
        const src = byMonth.get(m) ?? emptyBucket();
        total.fuelCost += src.fuelCost;
        total.fuelLiters += src.fuelLiters;
        total.maintenanceCost += src.maintenanceCost;
        total.complianceCost += src.complianceCost;
        total.distanceKm += src.distanceKm;
        return { month: m, ...seal(src) };
      });
      return {
        bikeId: b.id,
        plate: b.plate,
        nickname: b.nickname,
        ...seal(total),
        ratioToMedian: null,
        outlier: false,
        months: monthRows,
      };
    });

    // The median is taken over vehicles that actually ran: a van parked all
    // quarter has no ₺/km, and letting it drag the median down would make every
    // working vehicle look like an outlier.
    const med = median(
      vehicles.filter((v) => v.costPerKm !== null && v.totalCost > 0).map((v) => v.costPerKm!),
    );
    for (const v of vehicles) {
      if (med !== null && med > 0 && v.costPerKm !== null) {
        v.ratioToMedian = round2(v.costPerKm / med);
        v.outlier = v.costPerKm > med * OUTLIER_FACTOR;
      }
    }
    vehicles.sort((a, b) => (b.costPerKm ?? -1) - (a.costPerKm ?? -1));

    const fleetMonths = months.map((m) => {
      const agg = emptyBucket();
      for (const v of vehicles) {
        const row = v.months.find((x) => x.month === m)!;
        agg.fuelCost += row.fuelCost;
        agg.fuelLiters += row.fuelLiters;
        agg.maintenanceCost += row.maintenanceCost;
        agg.complianceCost += row.complianceCost;
        agg.distanceKm += row.distanceKm;
      }
      return { month: m, ...seal(agg) };
    });
    const fleetTotal = emptyBucket();
    for (const m of fleetMonths) {
      fleetTotal.fuelCost += m.fuelCost;
      fleetTotal.fuelLiters += m.fuelLiters;
      fleetTotal.maintenanceCost += m.maintenanceCost;
      fleetTotal.complianceCost += m.complianceCost;
      fleetTotal.distanceKm += m.distanceKm;
    }

    const body: FleetCostResponse = {
      orgId,
      from,
      to,
      // One currency per org today; `fuel_log` and `dated_item` carry no code of
      // their own, and every fleet customer invoices in ₺.
      currency: "TRY",
      fleet: { ...seal(fleetTotal), medianCostPerKm: med, outlierThreshold: OUTLIER_FACTOR },
      months: fleetMonths,
      vehicles,
    };
    res.json(body);
  }),
);
