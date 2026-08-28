import { getDb } from "../../src/db/index.js";
import { newId } from "../../src/lib/ulid.js";
import type { OrgMode, OrgRole } from "@mototracker/shared";

/**
 * Test helpers for the organization layer. Orgs, members and assignments are
 * created straight in the database: the routes that manage them are a later
 * agent's work, and the access-control tests must not wait for them.
 */

export function createOrg(
  name: string,
  mode: OrgMode = "fleet",
  maxVehicles = 10,
): string {
  const id = newId();
  getDb()
    .prepare("INSERT INTO organization (id, name, mode, max_vehicles) VALUES (?, ?, ?, ?)")
    .run(id, name, mode, maxVehicles);
  return id;
}

export function addMember(
  orgId: string,
  userId: string,
  role: OrgRole,
  status: "active" | "removed" = "active",
): void {
  getDb()
    .prepare(
      `INSERT INTO org_member (org_id, user_id, role, status) VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role, status = excluded.status`,
    )
    .run(orgId, userId, role, status);
}

export function removeMember(orgId: string, userId: string): void {
  getDb()
    .prepare("UPDATE org_member SET status = 'removed' WHERE org_id = ? AND user_id = ?")
    .run(orgId, userId);
}

/** Hand a vehicle to a driver. Returns the assignment id so it can be closed. */
export function assignVehicle(orgId: string, bikeId: string, userId: string): string {
  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO vehicle_assignment (id, org_id, bike_id, user_id, start_km) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, orgId, bikeId, userId, 1000);
  return id;
}

/** Take the vehicle back — the moment a driver's access must disappear. */
export function endAssignment(assignmentId: string): void {
  getDb()
    .prepare("UPDATE vehicle_assignment SET ended_at = datetime('now'), end_km = 1200 WHERE id = ?")
    .run(assignmentId);
}
