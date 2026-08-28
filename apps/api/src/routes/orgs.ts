import { Router } from "express";
import { requireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { getDb } from "../db/index.js";
import { orgSettingsUpdateSchema, type OrgDetail } from "@mototracker/shared";
import { requireOrgRole, userOrgs } from "../lib/orgAccess.js";

/**
 * The organization itself: what the caller belongs to, and its settings.
 *
 * Conspicuously absent: a create route. Organizations are provisioned by the
 * operator (scripts/fleet-admin.mjs) after a contract is signed and invoiced —
 * see docs/fleet-design.md §1. There is no fleet sign-up, and adding one here
 * would be the "call to action directing customers to a purchasing mechanism
 * other than IAP" that App Review Guideline 3.1.1 forbids. Deleting an org is
 * likewise an operator act; a customer who wants out is off-boarded by us.
 */
export const orgsRouter: Router = Router();
orgsRouter.use(requireUser);

/**
 * Every organization the caller belongs to.
 *
 * This is the request the web app makes on load to decide whether fleet UI
 * exists at all, so it is deliberately one indexed lookup and nothing else — no
 * counts, no vehicles, no joins beyond the org name. It runs for consumers too,
 * who are the overwhelming majority and get an empty array.
 *
 * Drivers ARE included, with `role: "driver"`. Their org membership is a fact
 * about them and hiding it would break the invite flow; the client gates fleet
 * chrome on `role !== "driver"` (docs/fleet-design.md §3), and every endpoint
 * below refuses them anyway.
 */
orgsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(userOrgs(req.user!.id));
  }),
);

interface OrgRow {
  id: string;
  name: string;
  mode: "rental" | "fleet";
  max_vehicles: number;
  created_at: string;
  updated_at: string;
}

function orgDetail(orgId: string, role: OrgDetail["role"]): OrgDetail {
  const db = getDb();
  const org = db.prepare("SELECT * FROM organization WHERE id = ?").get(orgId) as OrgRow;
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM bike WHERE org_id = ? AND archived = 0) AS vehicles,
              (SELECT COUNT(*) FROM org_member WHERE org_id = ? AND status = 'active') AS members`,
    )
    .get(orgId, orgId) as { vehicles: number; members: number };
  return {
    id: org.id,
    name: org.name,
    mode: org.mode,
    maxVehicles: org.max_vehicles,
    activeVehicles: counts.vehicles,
    memberCount: counts.members,
    role,
    createdAt: org.created_at,
    updatedAt: org.updated_at,
  };
}

// Owner/manager/staff run the fleet and may see its shape. A driver gets 403:
// the fleet's size is exactly the kind of thing they must not be able to read.
orgsRouter.get(
  "/:orgId",
  requireOrgRole("owner", "manager", "staff"),
  asyncHandler(async (req, res) => {
    const m = req.orgMembership!;
    res.json(orgDetail(m.orgId, m.role));
  }),
);

orgsRouter.patch(
  "/:orgId",
  requireOrgRole("owner", "manager"),
  asyncHandler(async (req, res) => {
    const body = orgSettingsUpdateSchema.parse(req.body);
    const db = getDb();
    const m = req.orgMembership!;

    // Switching mode changes which relationship a vehicle carries. Doing it
    // while vehicles are still out would leave live assignments/contracts in a
    // half of the product that no longer renders them — the row would exist, be
    // unreachable, and keep holding its vehicle through the partial unique
    // index. Refuse instead, and let the operator close them first.
    if (body.mode && body.mode !== m.mode) {
      const openRow = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM vehicle_assignment WHERE org_id = ? AND ended_at IS NULL) AS assignments,
                  (SELECT COUNT(*) FROM rental_contract  WHERE org_id = ? AND status = 'open')     AS contracts`,
        )
        .get(m.orgId, m.orgId) as { assignments: number; contracts: number };
      const blocking = m.mode === "fleet" ? openRow.assignments : openRow.contracts;
      if (blocking > 0) {
        res.status(409).json({ error: "mode_change_blocked" });
        return;
      }
    }

    const sets: string[] = [];
    const values: (string | number)[] = [];
    if (body.name !== undefined) {
      sets.push("name = ?");
      values.push(body.name);
    }
    if (body.mode !== undefined) {
      sets.push("mode = ?");
      values.push(body.mode);
    }
    sets.push("updated_at = datetime('now')");
    values.push(m.orgId);
    db.prepare(`UPDATE organization SET ${sets.join(", ")} WHERE id = ?`).run(...values);

    res.json(orgDetail(m.orgId, m.role));
  }),
);
