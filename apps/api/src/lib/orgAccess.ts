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
 * The model, in three paragraphs:
 *
 *   A vehicle is either PERSONAL (`bike.org_id IS NULL`) or ORGANIZATIONAL.
 *   A personal vehicle belongs to `bike.user_id` and to nobody else — exactly
 *   today's behaviour, which is why existing single-user accounts see no change.
 *   An org vehicle is governed by `org_member`, and for it `bike.user_id` means
 *   custodian ("who registered it"), NOT "who may see it" — never use it as an
 *   access check on an org row.
 *
 *   A BUSINESS org (`mode` 'fleet' or 'rental') is an employer's fleet. Owners
 *   and managers can do everything, staff can do everything day-to-day except
 *   delete a vehicle, and a DRIVER can only see and act on the vehicles
 *   CURRENTLY assigned to them. That driver boundary is the security-critical
 *   one: their access comes from an OPEN `vehicle_assignment` row and disappears
 *   the moment it is closed.
 *
 *   A PERSONAL org (`mode: 'personal'`) is a garage GROUP: a household, a couple,
 *   a rider and their mechanic. Same tables, same roles column, same function
 *   below — but a different permission row, because a family garage is not an
 *   employer and must not behave like one. See `permits`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TWO LAYERS, which is the idea most of this file exists to protect.
 *
 *   VEHICLE FACTS are about the car: its identity, its renewal deadlines
 *   (muayene/sigorta/kasko/MTV), its service history, its odometer. They are
 *   what "sharing a vehicle" means, and they are what survives a change of
 *   owner.
 *
 *   THE PERSONAL LAYER is about the person: the trips they drove, what they
 *   spent on fuel, and the documents they scanned. A Turkish ruhsat carries its
 *   holder's TC kimlik number, name and home address; a trip log is everywhere
 *   they went. None of that is a fact about the car, and none of it may leak to
 *   somebody who merely has access to the car.
 *
 * The layers are enforced in exactly two places, both here:
 *   - `bikeScope` is the PERSONAL-LAYER scope. Trips, fuel logs and documents
 *     list through it, so a vehicle that is absent from it is a vehicle whose
 *     personal layer the caller simply cannot enumerate.
 *   - `canAccessRecord` / `authorizeRecord` gate individual records, and default
 *     to the personal layer. A caller of a facts-shaped record (a dated item, a
 *     maintenance item) opts in with `vehicleFact: true`.
 * `readableBikeScope` is the facts-layer scope, used by the garage list and the
 * dashboard.
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
 * read   — see the vehicle and the facts recorded against it.
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
  is_personal: number;
  name: string;
}

/**
 * The composed mode.
 *
 * `organization.mode` is stored with `CHECK (mode IN ('rental','fleet'))` and
 * SQLite cannot alter a CHECK constraint without a table rebuild that would
 * cascade-delete every fleet customer's data (the reasoning is written out in
 * 027_vehicle_identity_share.sql). So personal groups carry an additive
 * `is_personal` flag and the third mode is composed HERE, in the one function
 * every reader goes through. Nothing outside this module reads the raw column.
 */
function composeMode(mode: OrgMode, isPersonal: number | boolean): OrgMode {
  return isPersonal ? "personal" : mode;
}

/** SQL fragment yielding the composed mode; used wherever a row carries it. */
const MODE_SQL = "CASE WHEN o.is_personal = 1 THEN 'personal' ELSE o.mode END";

/**
 * Every organization the user is an ACTIVE member of. A 'removed' membership is
 * kept for history but grants nothing, so it never appears here.
 */
export function userOrgs(userId: string, db: DB = getDb()): UserOrg[] {
  const rows = db
    .prepare(
      `SELECT m.org_id, m.role, o.mode, o.is_personal, o.name
         FROM org_member m
         JOIN organization o ON o.id = m.org_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY o.name ASC`,
    )
    .all(userId) as MemberRow[];
  return rows.map((r) => ({
    orgId: r.org_id,
    role: r.role,
    mode: composeMode(r.mode, r.is_personal),
    name: r.name,
  }));
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
  const row = db
    .prepare(`SELECT ${MODE_SQL} AS mode FROM organization o WHERE o.id = ?`)
    .get(orgId) as { mode: OrgMode } | undefined;
  return row?.mode ?? null;
}

/** True for a personal garage group — never the operator-provisioned fleet product. */
export function isPersonalGroup(orgId: string, db: DB = getDb()): boolean {
  return orgMode(orgId, db) === "personal";
}

// ─── scopes ───────────────────────────────────────────────────────────────────

interface ScopeParts {
  clauses: string[];
  params: unknown[];
}

/**
 * The clauses common to both scopes: your own garage, the business fleets you
 * help run, and the business vehicle currently in your hands.
 */
function baseScopeParts(userId: string, orgs: UserOrg[]): ScopeParts {
  const clauses = ["(b.org_id IS NULL AND b.user_id = ?)"];
  const params: unknown[] = [userId];

  // Personal vehicles stay personal even for org members: belonging to an org
  // never exposes your own garage to it.
  const fleetWide = orgs
    .filter((o) => o.mode !== "personal" && FLEET_WIDE_ROLES.includes(o.role))
    .map((o) => o.orgId);
  if (fleetWide.length > 0) {
    clauses.push(`b.org_id IN (${fleetWide.map(() => "?").join(", ")})`);
    params.push(...fleetWide);
  }

  // Drivers (and anyone else) additionally reach the business vehicles they are
  // currently holding. The join to org_member is not redundant: closing a
  // membership must revoke access even if a stale assignment row was left open.
  // The `va.org_id = b.org_id` correlation makes a mismatched assignment row
  // unable to reach across tenants (the schema also forbids writing one).
  clauses.push(
    `b.id IN (SELECT va.bike_id
                FROM vehicle_assignment va
                JOIN org_member m
                  ON m.org_id = va.org_id AND m.user_id = va.user_id AND m.status = 'active'
               WHERE va.user_id = ? AND va.ended_at IS NULL AND va.org_id = b.org_id)`,
  );
  params.push(userId);

  return { clauses, params };
}

/**
 * The PERSONAL-LAYER scope: `SELECT id FROM bike …` yielding every vehicle whose
 * trips, fuel logs and documents this user may enumerate. Embed as a subquery:
 *
 *   const scope = bikeScope(userId);
 *   db.prepare(`SELECT * FROM fuel_log WHERE bike_id IN (${scope.sql})`).all(...scope.params);
 *
 * It is a subquery rather than a bare predicate so callers cannot get the column
 * aliasing wrong, and so the driver rule (which needs a join) travels with it.
 *
 * WHAT IS DELIBERATELY MISSING: vehicles a personal-group GUEST can see. A guest
 * is a mechanic or a friend — they may read the car's facts, and this scope is
 * how "and nothing else" is enforced without every list route having to
 * remember. Use `readableBikeScope` for facts-shaped lists (the garage, the
 * dashboard).
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

  const { clauses, params } = baseScopeParts(userId, orgs);

  // Personal groups: owner and member (stored 'owner'/'manager'/'staff') share
  // the whole garage, trips and documents included — that is what inviting your
  // partner into your garage means, and the invite screen says so. A GUEST
  // (stored 'driver') contributes nothing here, which is the entire mechanism
  // that keeps a mechanic out of your journey log.
  const personalFull = orgs
    .filter((o) => o.mode === "personal" && FLEET_WIDE_ROLES.includes(o.role))
    .map((o) => o.orgId);
  if (personalFull.length > 0) {
    clauses.push(`b.org_id IN (${personalFull.map(() => "?").join(", ")})`);
    params.push(...personalFull);
  }

  return { sql: `SELECT b.id FROM bike b WHERE ${clauses.join(" OR ")}`, params };
}

/**
 * The FACTS-LAYER scope: every vehicle the caller may see at all, guest-visible
 * group vehicles included. Used by the garage list and the dashboard, which are
 * about vehicles and their deadlines rather than about anybody's movements.
 *
 * Kept as a separate function rather than a flag on `bikeScope` so that the
 * unsafe direction requires an explicit call: a new list route that reaches for
 * `bikeScope` gets the private answer by default, and only a route that has
 * thought about it asks for the wider one.
 */
export function readableBikeScope(
  userId: string,
  db: DB = getDb(),
): { sql: string; params: unknown[] } {
  const orgs = userOrgs(userId, db);
  if (orgs.length === 0) {
    return { sql: "SELECT b.id FROM bike b WHERE b.org_id IS NULL AND b.user_id = ?", params: [userId] };
  }

  const { clauses, params } = baseScopeParts(userId, orgs);

  // Every personal group, whatever the role: owners, members and guests all see
  // the group's vehicles. They differ in what hangs off them, not in which cars
  // are on the list.
  const personal = orgs.filter((o) => o.mode === "personal").map((o) => o.orgId);
  if (personal.length > 0) {
    clauses.push(`b.org_id IN (${personal.map(() => "?").join(", ")})`);
    params.push(...personal);
  }

  return { sql: `SELECT b.id FROM bike b WHERE ${clauses.join(" OR ")}`, params };
}

// ─── one vehicle ──────────────────────────────────────────────────────────────

/** Everything needed to decide any action on one vehicle, in a single query. */
export interface BikeAccessFacts {
  bikeId: string;
  /** null for a personal vehicle. */
  orgId: string | null;
  /** The composed mode of the vehicle's org; null for a personal vehicle. */
  mode: OrgMode | null;
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
              (SELECT ${MODE_SQL} FROM organization o WHERE o.id = b.org_id) AS mode,
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
        mode: OrgMode | null;
        role: OrgRole | null;
        assigned: number;
      }
    | undefined;
  if (!row) return null;
  return {
    bikeId: row.id,
    orgId: row.org_id,
    mode: row.mode,
    custodianId: row.user_id,
    archived: row.archived === 1,
    role: row.role,
    assigned: row.assigned === 1,
  };
}

/**
 * True when the caller reaches this vehicle only as a personal-group GUEST — the
 * mechanic tier. The one predicate that separates the two layers, so it is
 * written once and consulted from `canAccessRecord` and `canAttachRecord`.
 */
export function isGuestOnly(facts: BikeAccessFacts): boolean {
  return facts.mode === "personal" && facts.role === "driver";
}

/** The permission table itself, applied to already-resolved facts. */
export function permits(facts: BikeAccessFacts, userId: string, action: BikeAction): boolean {
  // Personal vehicle: unchanged from the pre-organization app.
  if (facts.orgId === null) return facts.custodianId === userId;

  // Org vehicle: membership is mandatory. Note what is deliberately absent —
  // being `bike.user_id` grants nothing once a vehicle belongs to an org, so a
  // member who leaves loses the vehicles they registered.
  if (facts.role === null) return false;

  // ── personal garage group ────────────────────────────────────────────────
  //
  // A household is not an employer, so the fleet row would be wrong twice over:
  // a family member is not "staff" who must not delete anything, and a guest is
  // not a "driver" whose access hangs off a dispatch record that a personal
  // group has none of.
  if (facts.mode === "personal") {
    switch (facts.role) {
      case "owner":
        // The person who made the group. Everything.
        return true;
      case "manager":
        // Not offered by any invite route; treated as owner if hand-created.
        return true;
      case "staff":
        // MEMBER — a partner, a parent, an adult child. Everything about the
        // group's vehicles except removing one: deleting a car out of a shared
        // garage takes its whole history with it, and that stays with whoever
        // built the group. (The custodian can always pull their own vehicle back
        // out of the group — see routes/vehicleShares.ts — so nobody is trapped.)
        return action !== "delete";
      case "driver":
        // GUEST — a mechanic, an inspection agency, a friend borrowing the bike.
        // Read and write the CAR'S FACTS: renewal dates, service records, the
        // odometer. Never `manage` (they may not rename or re-plate somebody
        // else's vehicle) and never `delete`. What keeps them out of the trips,
        // the fuel spending and the scanned documents is not this line — those
        // are the personal layer, gated by `bikeScope` and `canAccessRecord`.
        return action === "read" || action === "write";
    }
  }

  // ── business fleet: unchanged ────────────────────────────────────────────
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
 * May this user attach a record OF THEIR OWN — a trip, a fuel log — to this
 * vehicle?
 *
 * Separate from `canAccessBike("write")` because of one case: a personal-group
 * GUEST has write on the vehicle's facts but no personal layer at all, so a trip
 * they recorded here would be invisible to them the moment it was saved (it is
 * not in their `bikeScope`). Refusing up front is the honest answer; silently
 * writing something the author can never list is not.
 */
export function canAttachRecord(userId: string, bikeId: string, db: DB = getDb()): boolean {
  const facts = bikeFacts(userId, bikeId, db);
  if (!facts || !permits(facts, userId, "write")) return false;
  return !isGuestOnly(facts);
}

/**
 * Authorisation for a record that hangs off a vehicle (dated item, maintenance
 * item, fuel log, trip, document). Pass the row the route already fetched.
 *
 * `bikeId` may be null only for a document that was uploaded without a vehicle;
 * such a row is purely personal and belongs to its uploader. Everything else
 * inherits its vehicle's permissions — which is what makes a fleet's service
 * history visible to the manager even though a driver typed it in.
 *
 * `vehicleFact` is the layer opt-in, and it defaults to FALSE on purpose. A
 * record is assumed to be about the PERSON who wrote it until a caller states
 * otherwise, so a new record type added next year is private by default and a
 * personal-group guest reaches only what they wrote themselves. The two callers
 * that pass `true` — dated items and maintenance items — are recording facts
 * about the car, which is exactly what a share is for.
 */
export function canAccessRecord(
  userId: string,
  record: { bikeId: string | null; userId: string },
  action: BikeAction,
  db: DB = getDb(),
  opts: { vehicleFact?: boolean } = {},
): boolean {
  if (record.bikeId === null) return record.userId === userId;
  const facts = bikeFacts(userId, record.bikeId, db);
  if (!facts || !permits(facts, userId, action)) return false;
  // A personal-group GUEST sees the car, not the people. Trips, fuel logs and
  // documents on a vehicle that was merely shared with them are out of reach
  // whoever wrote them — one rule, no exceptions to remember, and the same
  // sentence the privacy policy has to make true.
  if (!opts.vehicleFact && isGuestOnly(facts)) return false;
  return true;
}

/**
 * May the caller enumerate this vehicle's PERSONAL LAYER — its trips, its fuel
 * logs, its documents?
 *
 * The list routes need this as a separate question because they filter by
 * `bike_id` directly once a `bikeId` is supplied, bypassing `bikeScope`
 * entirely. Without it, "GET /api/trips?bikeId=<the car my mechanic can see>"
 * would hand a guest the owner's whole journey log while every other path
 * correctly refused.
 */
export function canReadPersonalLayer(userId: string, bikeId: string, db: DB = getDb()): boolean {
  const facts = bikeFacts(userId, bikeId, db);
  if (!facts || !permits(facts, userId, "read")) return false;
  return !isGuestOnly(facts);
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
  /**
   * True when the record IS a fact about the vehicle (a renewal deadline, a
   * service record) rather than a fact about the person who wrote it (a trip, a
   * fuel log, a scanned document). Only vehicle facts travel through a share to
   * a personal-group guest. Defaults to false — see `canAccessRecord`.
   */
  vehicleFact?: boolean;
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
  // A personal-group GUEST reaches the vehicle's FACTS and nothing else, so a
  // route that has not declared itself a facts route is invisible to them —
  // which is exactly how the document wallet stays shut without documents.ts
  // needing to know that sharing exists. 404, not 403: they are not being
  // refused a resource, this resource is not part of what they were shown.
  if (isGuestOnly(facts) && !opts.vehicleFact) {
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
 * does not exist). Used by the entitlement split, which must charge a business
 * org's vehicle against `organization.max_vehicles` rather than a member's plan.
 */
export function orgOfBike(bikeId: string, db: DB = getDb()): string | null | undefined {
  const row = db.prepare("SELECT org_id FROM bike WHERE id = ?").get(bikeId) as
    | { org_id: string | null }
    | undefined;
  return row === undefined ? undefined : row.org_id;
}

/**
 * Who may DECIDE an ownership claim on this vehicle.
 *
 * Sharing makes this question real: if a car sits in a group with three members,
 * who gets to say "yes, the buyer may have it"? The answer is the people who
 * could destroy the record anyway — anyone with `delete` on it — plus its
 * custodian, who is the person that actually put it there and, for a group
 * vehicle, may be a member rather than the group's owner.
 *
 * Deliberately NOT "everybody who can see it": a guest mechanic must not be able
 * to hand somebody's car to a stranger, and a fleet driver must not be able to
 * hand away the company van.
 */
export function approversOfBike(bikeId: string, db: DB = getDb()): string[] {
  const bike = db.prepare("SELECT user_id, org_id FROM bike WHERE id = ?").get(bikeId) as
    | { user_id: string; org_id: string | null }
    | undefined;
  if (!bike) return [];
  const ids = new Set<string>([bike.user_id]);
  if (bike.org_id) {
    const rows = db
      .prepare(
        `SELECT m.user_id, m.role FROM org_member m
          WHERE m.org_id = ? AND m.status = 'active' AND m.role IN ('owner','manager')`,
      )
      .all(bike.org_id) as { user_id: string; role: OrgRole }[];
    for (const r of rows) ids.add(r.user_id);
    // The custodian of an org vehicle only counts if they are still a member:
    // an ex-employee must not keep a veto over the company's van.
    const stillMember = db
      .prepare(
        "SELECT 1 AS ok FROM org_member WHERE org_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(bike.org_id, bike.user_id) as { ok: number } | undefined;
    if (!stillMember) ids.delete(bike.user_id);
  }
  return [...ids];
}

/** May this user decide claims on this vehicle? */
export function canDecideClaims(userId: string, bikeId: string, db: DB = getDb()): boolean {
  return approversOfBike(bikeId, db).includes(userId);
}

// ─── route guards ─────────────────────────────────────────────────────────────

type ModeFilter = "business" | "personal";

function orgRoleGuard(modeFilter: ModeFilter, roles: OrgRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const raw =
      (req.params as Record<string, string | undefined>).orgId ??
      (req.params as Record<string, string | undefined>).groupId ??
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
        `SELECT m.role, ${MODE_SQL} AS mode, o.name
           FROM org_member m
           JOIN organization o ON o.id = m.org_id
          WHERE m.org_id = ? AND m.user_id = ? AND m.status = 'active'`,
      )
      .get(orgId, req.user.id) as { role: OrgRole; mode: OrgMode; name: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // THE WALL BETWEEN THE TWO PRODUCTS.
    //
    // Every fleet route in the app is guarded by `requireOrgRole`, so refusing a
    // personal group HERE closes all of them at once: the triage board, the cost
    // rollups, the CSV importer, the member management screens, the contracts —
    // and, most importantly, `PATCH /api/orgs/:orgId`, which is the one route
    // that writes `mode` and would otherwise let a garage group promote itself
    // into the fleet product. docs/fleet-design.md §1 makes that an App Review
    // 3.1.1 problem, not merely a bug, so it gets a structural answer rather
    // than a check in each handler.
    //
    // The refusal is 404, not 403: a personal group is simply not an object the
    // fleet API has.
    const wanted: ModeFilter = row.mode === "personal" ? "personal" : "business";
    if (wanted !== modeFilter) {
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

/**
 * Express guard for BUSINESS org routes: `requireOrgRole("owner", "manager")`.
 *
 * The org id is taken from `:orgId` in the path, or from `orgId` in the body or
 * query for routes that are not nested. A non-member gets 404, not 403 — the
 * existence of an organization is itself information a stranger should not get.
 * Insufficient role gets 403, because at that point the caller already knows the
 * org exists. A PERSONAL group gets 404 too: see the note above.
 *
 * On success `req.orgMembership` carries the resolved org for the handler, so it
 * never has to re-query.
 */
export function requireOrgRole(...roles: OrgRole[]): RequestHandler {
  return orgRoleGuard("business", roles);
}

/**
 * The mirror image, for the consumer sharing routes: personal groups only, and
 * a business fleet is invisible to them. Roles are given in their STORED form
 * ('owner' / 'staff' / 'driver'); `shareRoleForOrgRole` in the shared package
 * maps them to the owner/member/guest vocabulary the user sees.
 */
export function requirePersonalGroupRole(...roles: OrgRole[]): RequestHandler {
  return orgRoleGuard("personal", roles);
}
