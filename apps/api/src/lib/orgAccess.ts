import type { Request, RequestHandler, Response } from "express";
import type { Database as DB } from "better-sqlite3";
import { getDb } from "../db/index.js";
import type { OrgMode, OrgRole } from "@mototracker/shared";

/**
 * The single place that answers "may this user touch this vehicle?".
 *
 * Every route funnels through here — no route writes ownership SQL of its own.
 * That is the whole point: an access rule that lives in one module can be
 * audited and tested; the same rule copy-pasted into eight routes cannot.
 *
 * The model, in one paragraph:
 *
 *   A vehicle is either PERSONAL (`bike.org_id IS NULL`) or ORGANIZATIONAL.
 *   A personal vehicle belongs to `bike.user_id` and to nobody else — exactly
 *   today's behaviour, which is why existing single-user accounts see no change.
 *   An org vehicle is governed by `org_member`: owners and managers can do
 *   everything, staff can do everything day-to-day except delete a vehicle, and
 *   a DRIVER can only see and act on the vehicles CURRENTLY assigned to them.
 *   For an org vehicle `bike.user_id` means custodian ("who registered it"), NOT
 *   "who may see it" — never use it as an access check on an org row.
 *
 * The driver boundary is the one that matters most: a driver must never be able
 * to enumerate the rest of the fleet, so their access comes from an OPEN
 * `vehicle_assignment` row and disappears the moment it is closed.
 */

export type { OrgRole, OrgMode };

/** A user's membership in one organization, as the caller experiences it. */
export interface UserOrg {
  orgId: string;
  role: OrgRole;
  mode: OrgMode;
  name: string;
}

/**
 * What a caller may do with a vehicle.
 *
 * read   — see the vehicle and everything hanging off it.
 * write  — day-to-day records: dated items, maintenance, fuel, trips, documents.
 *          A driver has this on the vehicle they are holding — logging a fill-up
 *          is the entire point of handing them a vehicle.
 * manage — the vehicle record itself: attributes and photo. Drivers must not
 *          rename or re-plate a company vehicle, so this is where they stop.
 * delete — archive/remove the vehicle. Owners and managers only; a member of
 *          staff can lose a receipt, not the van.
 */
export type BikeAction = "read" | "write" | "manage" | "delete";

/** Roles with blanket access to every vehicle in their org (i.e. not `driver`). */
const FLEET_WIDE_ROLES: readonly OrgRole[] = ["owner", "manager", "staff"] as const;

interface MemberRow {
  org_id: string;
  role: OrgRole;
  mode: OrgMode;
  name: string;
}

/**
 * Every organization the user is an ACTIVE member of. A 'removed' membership is
 * kept for history but grants nothing, so it never appears here.
 */
export function userOrgs(userId: string, db: DB = getDb()): UserOrg[] {
  const rows = db
    .prepare(
      `SELECT m.org_id, m.role, o.mode, o.name
         FROM org_member m
         JOIN organization o ON o.id = m.org_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY o.name ASC`,
    )
    .all(userId) as MemberRow[];
  return rows.map((r) => ({ orgId: r.org_id, role: r.role, mode: r.mode, name: r.name }));
}

/** The user's active role in one org, or null when they are not a member. */
export function roleInOrg(userId: string, orgId: string, db: DB = getDb()): OrgRole | null {
  const row = db
    .prepare("SELECT role FROM org_member WHERE org_id = ? AND user_id = ? AND status = 'active'")
    .get(orgId, userId) as { role: OrgRole } | undefined;
  return row?.role ?? null;
}

/** The org's mode, or null if it does not exist. */
export function orgMode(orgId: string, db: DB = getDb()): OrgMode | null {
  const row = db.prepare("SELECT mode FROM organization WHERE id = ?").get(orgId) as
    | { mode: OrgMode }
    | undefined;
  return row?.mode ?? null;
}

/**
 * A self-contained `SELECT id FROM bike …` yielding every vehicle this user may
 * READ, to be embedded as a subquery:
 *
 *   const scope = bikeScope(userId);
 *   db.prepare(`SELECT * FROM fuel_log WHERE bike_id IN (${scope.sql})`).all(...scope.params);
 *
 * It is a subquery rather than a bare predicate so callers cannot get the column
 * aliasing wrong, and so the driver rule (which needs a join) travels with it.
 *
 * WRITES must not use this — use `canAccessBike`, which distinguishes read from
 * write from delete.
 */
export function bikeScope(userId: string, db: DB = getDb()): { sql: string; params: unknown[] } {
  const orgs = userOrgs(userId, db);

  // The overwhelmingly common case: a consumer account with no org membership.
  // Emit precisely the query the app used before organizations existed, so the
  // single-user path pays nothing for a feature it does not use.
  if (orgs.length === 0) {
    return { sql: "SELECT b.id FROM bike b WHERE b.org_id IS NULL AND b.user_id = ?", params: [userId] };
  }

  const fleetWide = orgs.filter((o) => FLEET_WIDE_ROLES.includes(o.role)).map((o) => o.orgId);

  // Personal vehicles stay personal even for org members: belonging to an org
  // never exposes your own garage to it.
  const clauses = ["(b.org_id IS NULL AND b.user_id = ?)"];
  const params: unknown[] = [userId];

  if (fleetWide.length > 0) {
    clauses.push(`b.org_id IN (${fleetWide.map(() => "?").join(", ")})`);
    params.push(...fleetWide);
  }

  // Drivers (and anyone else) additionally reach the vehicles they are currently
  // holding. The join to org_member is not redundant: closing a membership must
  // revoke access even if a stale assignment row was left open. The
  // `va.org_id = b.org_id` correlation makes a mismatched assignment row
  // unable to reach across tenants (the schema also forbids writing one).
  clauses.push(
    `b.id IN (SELECT va.bike_id
                FROM vehicle_assignment va
                JOIN org_member m
                  ON m.org_id = va.org_id AND m.user_id = va.user_id AND m.status = 'active'
               WHERE va.user_id = ? AND va.ended_at IS NULL AND va.org_id = b.org_id)`,
  );
  params.push(userId);

  return { sql: `SELECT b.id FROM bike b WHERE ${clauses.join(" OR ")}`, params };
}

/** Everything needed to decide any action on one vehicle, in a single query. */
export interface BikeAccessFacts {
  bikeId: string;
  /** null for a personal vehicle. */
  orgId: string | null;
  /** `bike.user_id`: the owner for a personal vehicle, the custodian for an org one. */
  custodianId: string;
  archived: boolean;
  /** The caller's ACTIVE role in the vehicle's org; null when personal or not a member. */
  role: OrgRole | null;
  /** The caller currently holds this vehicle (open `vehicle_assignment`). */
  assigned: boolean;
}

/**
 * Resolve the facts for one vehicle, or null when it does not exist. Routes that
 * need the org id (to check a fleet ceiling, say) can use this; for a plain
 * yes/no, use `canAccessBike`.
 */
export function bikeFacts(userId: string, bikeId: string, db: DB = getDb()): BikeAccessFacts | null {
  const row = db
    .prepare(
      `SELECT b.id,
              b.user_id,
              b.org_id,
              b.archived,
              (SELECT m.role FROM org_member m
                WHERE m.org_id = b.org_id AND m.user_id = ? AND m.status = 'active') AS role,
              EXISTS (SELECT 1 FROM vehicle_assignment va
                       JOIN org_member m2
                         ON m2.org_id = va.org_id AND m2.user_id = va.user_id AND m2.status = 'active'
                      WHERE va.bike_id = b.id AND va.user_id = ? AND va.ended_at IS NULL
                        AND va.org_id = b.org_id) AS assigned
         FROM bike b
        WHERE b.id = ?`,
    )
    .get(userId, userId, bikeId) as
    | {
        id: string;
        user_id: string;
        org_id: string | null;
        archived: number;
        role: OrgRole | null;
        assigned: number;
      }
    | undefined;
  if (!row) return null;
  return {
    bikeId: row.id,
    orgId: row.org_id,
    custodianId: row.user_id,
    archived: row.archived === 1,
    role: row.role,
    assigned: row.assigned === 1,
  };
}

/** The permission table itself, applied to already-resolved facts. */
export function permits(facts: BikeAccessFacts, userId: string, action: BikeAction): boolean {
  // Personal vehicle: unchanged from the pre-organization app.
  if (facts.orgId === null) return facts.custodianId === userId;

  // Org vehicle: membership is mandatory. Note what is deliberately absent —
  // being `bike.user_id` grants nothing once a vehicle belongs to an org, so a
  // member who leaves loses the vehicles they registered.
  if (facts.role === null) return false;

  switch (facts.role) {
    case "owner":
    case "manager":
      return true;
    case "staff":
      // Everything day-to-day, but the fleet's size is a billing decision.
      return action !== "delete";
    case "driver":
      // Only the vehicle in their hands, and only its records — never the
      // vehicle record itself, never its removal.
      return facts.assigned && (action === "read" || action === "write");
  }
}

/** May this user perform `action` on this vehicle? False for unknown ids. */
export function canAccessBike(
  userId: string,
  bikeId: string,
  action: BikeAction,
  db: DB = getDb(),
): boolean {
  const facts = bikeFacts(userId, bikeId, db);
  return facts !== null && permits(facts, userId, action);
}

/**
 * Authorisation for a record that hangs off a vehicle (dated item, maintenance
 * item, fuel log, trip, document). Pass the row the route already fetched.
 *
 * `bikeId` may be null only for a document that was uploaded without a vehicle;
 * such a row is purely personal and belongs to its uploader. Everything else
 * inherits its vehicle's permissions — which is what makes a fleet's service
 * history visible to the manager even though a driver typed it in.
 */
export function canAccessRecord(
  userId: string,
  record: { bikeId: string | null; userId: string },
  action: BikeAction,
  db: DB = getDb(),
): boolean {
  if (record.bikeId === null) return record.userId === userId;
  return canAccessBike(userId, record.bikeId, action, db);
}

/**
 * Authorise a vehicle inside a route handler, answering with the codes the rest
 * of the API already uses.
 *
 * Returns the facts on success. On refusal it has ALREADY sent the response and
 * returns null, so handlers read `if (!authorizeBike(...)) return;`.
 *
 * The 404-vs-403 split is a security decision, made here once: a vehicle the
 * caller may not even READ is reported as non-existent, because "403" would
 * confirm that a given id is a real vehicle in some fleet. Only once they can
 * see it does a refusal become an honest 403.
 */
export interface AuthorizeOptions {
  db?: DB;
  /**
   * Machine code for the 404 body. Routes that already answered `bike_not_found`
   * before organizations existed keep saying that — the client translates these
   * codes, so they are part of the contract.
   */
  notFoundCode?: string;
}

export function authorizeBike(
  req: Request,
  res: Response,
  bikeId: string,
  action: BikeAction,
  opts: AuthorizeOptions = {},
): BikeAccessFacts | null {
  const db = opts.db ?? getDb();
  const userId = req.user!.id;
  const facts = bikeFacts(userId, bikeId, db);
  if (!facts || !permits(facts, userId, "read")) {
    res.status(404).json({ error: opts.notFoundCode ?? "not_found" });
    return null;
  }
  if (!permits(facts, userId, action)) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return facts;
}

/**
 * The same contract for a record hanging off a vehicle (or a vehicle-less
 * personal document). True when the caller may proceed; on false the response
 * has already been sent.
 */
export function authorizeRecord(
  req: Request,
  res: Response,
  record: { bikeId: string | null; userId: string },
  action: BikeAction,
  opts: AuthorizeOptions = {},
): boolean {
  if (record.bikeId === null) {
    // A document with no vehicle is purely personal: its uploader, or nobody.
    if (record.userId !== req.user!.id) {
      res.status(404).json({ error: opts.notFoundCode ?? "not_found" });
      return false;
    }
    return true;
  }
  return authorizeBike(req, res, record.bikeId, action, opts) !== null;
}

/**
 * The org a vehicle belongs to (null for personal, undefined when the vehicle
 * does not exist). Used by the entitlement split, which must charge an org
 * vehicle against `organization.max_vehicles` rather than a member's own plan.
 */
export function orgOfBike(bikeId: string, db: DB = getDb()): string | null | undefined {
  const row = db.prepare("SELECT org_id FROM bike WHERE id = ?").get(bikeId) as
    | { org_id: string | null }
    | undefined;
  return row === undefined ? undefined : row.org_id;
}

/**
 * Express guard for org-scoped routes: `requireOrgRole("owner", "manager")`.
 *
 * The org id is taken from `:orgId` in the path, or from `orgId` in the body or
 * query for routes that are not nested. A non-member gets 404, not 403 — the
 * existence of an organization is itself information a stranger should not get.
 * Insufficient role gets 403, because at that point the caller already knows the
 * org exists.
 *
 * On success `req.orgMembership` carries the resolved org for the handler, so it
 * never has to re-query.
 */
export function requireOrgRole(...roles: OrgRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const raw =
      (req.params as Record<string, string | undefined>).orgId ??
      (typeof req.body === "object" && req.body !== null
        ? (req.body as Record<string, unknown>).orgId
        : undefined) ??
      req.query.orgId;
    const orgId = typeof raw === "string" && raw.length > 0 ? raw : null;
    if (!orgId) {
      res.status(400).json({ error: "org_id_required" });
      return;
    }
    const db = getDb();
    const row = db
      .prepare(
        `SELECT m.role, o.mode, o.name
           FROM org_member m
           JOIN organization o ON o.id = m.org_id
          WHERE m.org_id = ? AND m.user_id = ? AND m.status = 'active'`,
      )
      .get(orgId, req.user.id) as { role: OrgRole; mode: OrgMode; name: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (roles.length > 0 && !roles.includes(row.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.orgMembership = { orgId, role: row.role, mode: row.mode, name: row.name };
    next();
  };
}
