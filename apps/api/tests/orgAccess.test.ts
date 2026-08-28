import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { addMember, assignVehicle, createOrg, endAssignment, removeMember } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";
import { newId } from "../src/lib/ulid.js";
import {
  bikeScope,
  canAccessBike,
  canAccessRecord,
  orgOfBike,
  requireOrgRole,
  roleInOrg,
  userOrgs,
  type BikeAction,
} from "../src/lib/orgAccess.js";

/**
 * Unit tests for the access-control model itself. The route-level consequences
 * are in orgScoping.test.ts; here we pin the rules directly, because every route
 * in the app inherits whatever this module decides.
 */

/**
 * These tests exercise the library, not the HTTP surface, so users are inserted
 * directly — a real sign-up per user would add nothing but a scrypt hash.
 */
function makeUser(email: string): string {
  const id = newId();
  getDb().prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(id, email, email);
  return id;
}

function makeBike(userId: string, orgId: string | null, nickname = "V"): string {
  const id = newId();
  getDb()
    .prepare("INSERT INTO bike (id, user_id, org_id, nickname) VALUES (?, ?, ?, ?)")
    .run(id, userId, orgId, nickname);
  return id;
}

/** Every vehicle id the user may read, via the scope subquery routes embed. */
function scopedBikeIds(userId: string): string[] {
  const scope = bikeScope(userId, getDb());
  const rows = getDb()
    .prepare(`SELECT id FROM bike WHERE id IN (${scope.sql}) ORDER BY nickname`)
    .all(...scope.params) as { id: string }[];
  return rows.map((r) => r.id);
}

const ALL_ACTIONS: BikeAction[] = ["read", "write", "manage", "delete"];

function allowedActions(userId: string, bikeId: string): BikeAction[] {
  return ALL_ACTIONS.filter((a) => canAccessBike(userId, bikeId, a, getDb()));
}

describe("orgAccess", () => {
  let owner: string, manager: string, staff: string, driver: string, outsider: string;
  let orgId: string, otherOrgId: string;
  let assignedBike: string, unassignedBike: string, personalBike: string, otherOrgBike: string;
  let assignmentId: string;

  beforeEach(() => {
    buildTestApp(); // resets the database and runs the migrations
    owner = makeUser("owner@org.test");
    manager = makeUser("manager@org.test");
    staff = makeUser("staff@org.test");
    driver = makeUser("driver@org.test");
    outsider = makeUser("outsider@org.test");

    orgId = createOrg("Kervan Filo", "fleet");
    addMember(orgId, owner, "owner");
    addMember(orgId, manager, "manager");
    addMember(orgId, staff, "staff");
    addMember(orgId, driver, "driver");

    otherOrgId = createOrg("Rakip Kiralama", "rental");
    addMember(otherOrgId, outsider, "owner");

    assignedBike = makeBike(owner, orgId, "A-assigned");
    unassignedBike = makeBike(owner, orgId, "B-unassigned");
    personalBike = makeBike(owner, null, "C-personal");
    otherOrgBike = makeBike(outsider, otherOrgId, "D-other-org");
    assignmentId = assignVehicle(orgId, assignedBike, driver);
  });

  describe("userOrgs / roleInOrg", () => {
    it("lists only active memberships, with the org's mode and name", () => {
      expect(userOrgs(owner)).toEqual([
        { orgId, role: "owner", mode: "fleet", name: "Kervan Filo" },
      ]);
      expect(userOrgs(outsider)).toEqual([
        { orgId: otherOrgId, role: "owner", mode: "rental", name: "Rakip Kiralama" },
      ]);
      expect(userOrgs(driver)[0]!.role).toBe("driver");
    });

    it("a removed member is not a member: no orgs, no role", () => {
      removeMember(orgId, staff);
      expect(userOrgs(staff)).toEqual([]);
      expect(roleInOrg(staff, orgId)).toBeNull();
    });

    it("reports no role for an org the user was never in", () => {
      expect(roleInOrg(owner, otherOrgId)).toBeNull();
    });
  });

  describe("bikeScope", () => {
    it("gives a user with no membership exactly their own vehicles", () => {
      const solo = makeBike(outsider, null, "E-solo-personal");
      // The outsider owns an org too — their personal garage stays separate.
      expect(scopedBikeIds(outsider).sort()).toEqual([otherOrgBike, solo].sort());
    });

    it("gives owner/manager/staff the whole fleet but nobody else's personal vehicle", () => {
      for (const u of [manager, staff]) {
        expect(scopedBikeIds(u).sort()).toEqual([assignedBike, unassignedBike].sort());
      }
      // The owner also sees their own personal vehicle — because it is theirs,
      // not because they run the org.
      expect(scopedBikeIds(owner).sort()).toEqual(
        [assignedBike, unassignedBike, personalBike].sort(),
      );
    });

    it("gives a driver ONLY the vehicle currently assigned to them", () => {
      expect(scopedBikeIds(driver)).toEqual([assignedBike]);
    });

    it("takes the vehicle back the moment the assignment ends", () => {
      endAssignment(assignmentId);
      expect(scopedBikeIds(driver)).toEqual([]);
    });

    it("revokes a driver removed from the org even if the assignment is left open", () => {
      removeMember(orgId, driver);
      expect(scopedBikeIds(driver)).toEqual([]);
    });

    it("never crosses organizations", () => {
      expect(scopedBikeIds(owner)).not.toContain(otherOrgBike);
      expect(scopedBikeIds(outsider)).not.toContain(assignedBike);
      expect(scopedBikeIds(outsider)).not.toContain(unassignedBike);
    });
  });

  describe("canAccessBike", () => {
    it("owner and manager may do everything on every org vehicle", () => {
      for (const u of [owner, manager]) {
        for (const b of [assignedBike, unassignedBike]) {
          expect(allowedActions(u, b)).toEqual(["read", "write", "manage", "delete"]);
        }
      }
    });

    it("staff may run the fleet but not shrink it", () => {
      expect(allowedActions(staff, unassignedBike)).toEqual(["read", "write", "manage"]);
      expect(canAccessBike(staff, unassignedBike, "delete")).toBe(false);
    });

    it("a driver may only log against the vehicle in their hands", () => {
      expect(allowedActions(driver, assignedBike)).toEqual(["read", "write"]);
      // Not even readable: a driver must not be able to enumerate the fleet.
      expect(allowedActions(driver, unassignedBike)).toEqual([]);
    });

    it("a driver loses every action when the assignment closes", () => {
      endAssignment(assignmentId);
      expect(allowedActions(driver, assignedBike)).toEqual([]);
    });

    it("keeps personal vehicles personal, including from the user's own org", () => {
      expect(allowedActions(owner, personalBike)).toEqual(["read", "write", "manage", "delete"]);
      for (const u of [manager, staff, driver, outsider]) {
        expect(allowedActions(u, personalBike)).toEqual([]);
      }
    });

    it("grants nothing across organizations", () => {
      for (const u of [owner, manager, staff, driver]) {
        expect(allowedActions(u, otherOrgBike)).toEqual([]);
      }
      expect(allowedActions(outsider, unassignedBike)).toEqual([]);
    });

    it("grants nothing on an unknown vehicle id", () => {
      expect(allowedActions(owner, "no-such-bike")).toEqual([]);
    });

    it("custody of an org vehicle grants nothing on its own", () => {
      // `owner` registered every org vehicle, so bike.user_id points at them.
      // Strip the membership and the custody must be worth nothing.
      removeMember(orgId, owner);
      expect(allowedActions(owner, unassignedBike)).toEqual([]);
      // …while the personal vehicle they own is untouched.
      expect(canAccessBike(owner, personalBike, "delete")).toBe(true);
    });

    it("an assignment on another org's vehicle cannot be forged into access", () => {
      // The schema refuses the row outright (composite FK bike(id, org_id)),
      // which is the guarantee the read path relies on.
      expect(() => assignVehicle(orgId, otherOrgBike, driver)).toThrow(/FOREIGN KEY/);
    });
  });

  describe("canAccessRecord", () => {
    it("inherits the vehicle's permissions", () => {
      const record = { bikeId: assignedBike, userId: driver };
      expect(canAccessRecord(manager, record, "read")).toBe(true);
      expect(canAccessRecord(driver, record, "write")).toBe(true);
      expect(canAccessRecord(outsider, record, "read")).toBe(false);
    });

    it("treats a vehicle-less record as strictly personal to its author", () => {
      const record = { bikeId: null, userId: staff };
      expect(canAccessRecord(staff, record, "read")).toBe(true);
      // Not even the owner of the org the author belongs to.
      expect(canAccessRecord(owner, record, "read")).toBe(false);
    });
  });

  it("orgOfBike distinguishes personal, organizational and unknown", () => {
    expect(orgOfBike(unassignedBike)).toBe(orgId);
    expect(orgOfBike(personalBike)).toBeNull();
    expect(orgOfBike("nope")).toBeUndefined();
  });

  describe("requireOrgRole", () => {
    /** A bare app so the guard can be exercised without the auth round-trip. */
    function guardedApp(userId: string, ...roles: Parameters<typeof requireOrgRole>) {
      const a = express();
      a.use(express.json());
      a.use((req, _res, next) => {
        req.user = { id: userId, email: "x@test.com", name: null };
        next();
      });
      a.get("/orgs/:orgId/thing", requireOrgRole(...roles), (req, res) => {
        res.json(req.orgMembership);
      });
      a.post("/thing", requireOrgRole(...roles), (req, res) => {
        res.json(req.orgMembership);
      });
      return a;
    }

    it("passes an allowed role through and hands the handler the membership", async () => {
      const res = await request(guardedApp(manager, "owner", "manager")).get(
        `/orgs/${orgId}/thing`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ orgId, role: "manager", mode: "fleet", name: "Kervan Filo" });
    });

    it("refuses staff and drivers where owner/manager is required", async () => {
      for (const u of [staff, driver]) {
        const res = await request(guardedApp(u, "owner", "manager")).get(`/orgs/${orgId}/thing`);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("forbidden");
      }
    });

    it("hides the org from a non-member and from a removed member (404, not 403)", async () => {
      const stranger = await request(guardedApp(outsider, "owner")).get(`/orgs/${orgId}/thing`);
      expect(stranger.status).toBe(404);

      removeMember(orgId, manager);
      const removed = await request(guardedApp(manager, "manager")).get(`/orgs/${orgId}/thing`);
      expect(removed.status).toBe(404);
    });

    it("accepts orgId from the body for non-nested routes, and asks for it when absent", async () => {
      const ok = await request(guardedApp(owner, "owner")).post("/thing").send({ orgId });
      expect(ok.status).toBe(200);

      const missing = await request(guardedApp(owner, "owner")).post("/thing").send({});
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe("org_id_required");
    });

    it("with no roles listed, any active member passes", async () => {
      const res = await request(guardedApp(driver)).get(`/orgs/${orgId}/thing`);
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("driver");
    });
  });
});
