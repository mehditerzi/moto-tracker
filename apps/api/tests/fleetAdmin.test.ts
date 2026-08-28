import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDbForTests, getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";
import { newId } from "../src/lib/ulid.js";
import { setOrgMaxVehicles, countActiveOrgBikes, getOrgMaxVehicles } from "../src/lib/entitlement.js";
import { roleInOrg, canAccessBike, userOrgs } from "../src/lib/orgAccess.js";

/**
 * The provisioning CLI is the ONLY way a fleet organization comes into being
 * (docs/fleet-design.md §1), so it gets the same scrutiny as a route. These
 * tests import its operations directly and check them against the app's own
 * access-control and entitlement modules — the point being that the CLI must
 * not be able to create a state the API disagrees with.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin: any = await import("../../../scripts/fleet-admin.mjs");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "garajim-fleet-admin-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function makeUser(email: string, name = email): string {
  const id = newId();
  getDb().prepare("INSERT INTO user (id, email, name) VALUES (?, ?, ?)").run(id, email, name);
  return id;
}

describe("fleet-admin CLI", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
    runMigrations();
  });

  describe("org:create / org:ceiling", () => {
    it("creates an organization the app's own modules can read", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, {
        name: "Akdeniz Filo Kiralama",
        mode: "rental",
        maxVehicles: 25,
      });
      expect(getOrgMaxVehicles(orgId, db)).toBe(25);
      expect(countActiveOrgBikes(orgId, db)).toBe(0);
      expect(admin.findOrg(db, "Akdeniz Filo Kiralama").id).toBe(orgId);
      expect(admin.findOrg(db, orgId).mode).toBe("rental");
    });

    it("refuses a mode outside the schema's CHECK rather than letting SQLite do it", () => {
      const db = getDb();
      expect(() => admin.createOrganization(db, { name: "X", mode: "leasing" })).toThrow(
        /--mode must be one of/,
      );
    });

    /**
     * The ceiling is what an operator raises when an invoice is paid, and the
     * app's single write seam for it is `setOrgMaxVehicles`. The CLI cannot
     * import that TypeScript module at runtime, so it carries a copy — and this
     * test is what stops the copy drifting.
     */
    it("writes the ceiling identically to lib/entitlement.setOrgMaxVehicles", () => {
      const db = getDb();
      const viaCli = admin.createOrganization(db, { name: "A", mode: "fleet", maxVehicles: 1 });
      const viaApp = admin.createOrganization(db, { name: "B", mode: "fleet", maxVehicles: 1 });

      admin.setOrgCeiling(db, viaCli, 40);
      setOrgMaxVehicles(viaApp, 40, db);

      const a = db.prepare("SELECT max_vehicles, updated_at FROM organization WHERE id = ?").get(viaCli) as {
        max_vehicles: number;
        updated_at: string;
      };
      const b = db.prepare("SELECT max_vehicles, updated_at FROM organization WHERE id = ?").get(viaApp) as {
        max_vehicles: number;
        updated_at: string;
      };
      expect(a.max_vehicles).toBe(b.max_vehicles);
      expect(a.max_vehicles).toBe(40);
      // Both must stamp updated_at; a silent ceiling change is unauditable.
      expect(a.updated_at).toBe(b.updated_at);
      expect(getOrgMaxVehicles(viaCli, db)).toBe(getOrgMaxVehicles(viaApp, db));
    });

    it("exits with an operator error for an unknown org rather than silently doing nothing", () => {
      expect(() => admin.setOrgCeiling(getDb(), "no-such-org", 5)).toThrow(/No organization/);
    });
  });

  describe("member:add", () => {
    it("adds an existing account and then promotes it to owner with the same command", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "fleet", maxVehicles: 5 });
      const userId = makeUser("patron@example.com");

      const first = admin.upsertMember(db, orgId, userId, "manager");
      expect(first.previous).toBeNull();
      expect(roleInOrg(userId, orgId, db)).toBe("manager");

      const second = admin.upsertMember(db, orgId, userId, "owner");
      expect(second.previous).toEqual({ role: "manager", status: "active" });
      expect(roleInOrg(userId, orgId, db)).toBe("owner");
      expect(userOrgs(userId, db)).toEqual([
        { orgId, role: "owner", mode: "fleet", name: "Filo" },
      ]);
    });

    it("issues a single-use invite when the email has no account, instead of inventing a password", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "fleet" });
      expect(admin.findUserByEmail(db, "yeni@example.com")).toBeNull();

      const invite = admin.createInvite(db, { orgId, email: "yeni@example.com", role: "staff" });
      expect(invite.token).toMatch(/^[\w-]{40,}$/);
      const row = db.prepare("SELECT * FROM org_invite WHERE id = ?").get(invite.id) as {
        email: string;
        role: string;
        accepted_at: string | null;
      };
      expect(row.email).toBe("yeni@example.com");
      expect(row.role).toBe("staff");
      expect(row.accepted_at).toBeNull();
      // No account was created as a side effect — the operator never holds a
      // credential belonging to the customer.
      expect(admin.findUserByEmail(db, "yeni@example.com")).toBeNull();
    });

    it("re-inviting replaces the old capability instead of leaving two live links", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "fleet" });
      const a = admin.createInvite(db, { orgId, email: "yeni@example.com", role: "staff" });
      const b = admin.createInvite(db, { orgId, email: "YENI@example.com", role: "manager" });
      const live = admin.listInvites(db, orgId).filter((i: { accepted_at: null }) => !i.accepted_at);
      expect(live).toHaveLength(1);
      expect(db.prepare("SELECT 1 FROM org_invite WHERE id = ?").get(a.id)).toBeUndefined();
      expect(db.prepare("SELECT role FROM org_invite WHERE id = ?").get(b.id)).toEqual({ role: "manager" });
    });
  });

  describe("member:remove", () => {
    it("revokes access immediately, keeps history, and hands back an open assignment", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "fleet", maxVehicles: 5 });
      const managerId = makeUser("m@example.com");
      const driverId = makeUser("d@example.com");
      admin.upsertMember(db, orgId, managerId, "manager");
      admin.upsertMember(db, orgId, driverId, "driver");

      const bikeId = newId();
      db.prepare("INSERT INTO bike (id, user_id, org_id, nickname) VALUES (?, ?, ?, 'Van')").run(
        bikeId,
        managerId,
        orgId,
      );
      db.prepare(
        "INSERT INTO vehicle_assignment (id, org_id, bike_id, user_id) VALUES (?, ?, ?, ?)",
      ).run(newId(), orgId, bikeId, driverId);
      expect(canAccessBike(driverId, bikeId, "read", db)).toBe(true);

      const res = admin.removeMember(db, orgId, driverId);
      expect(res).toEqual({ removed: true, assignmentsClosed: 1 });
      expect(canAccessBike(driverId, bikeId, "read", db)).toBe(false);
      expect(roleInOrg(driverId, orgId, db)).toBeNull();
      // The row survives so "who was holding this van in June" still resolves.
      expect(
        db.prepare("SELECT status FROM org_member WHERE org_id = ? AND user_id = ?").get(orgId, driverId),
      ).toEqual({ status: "removed" });
    });

    it("is a no-op on someone who is not an active member", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "fleet" });
      const outsider = makeUser("nope@example.com");
      expect(admin.removeMember(db, orgId, outsider)).toEqual({ removed: false, assignmentsClosed: 0 });
    });
  });

  describe("org:delete", () => {
    it("takes the fleet, the customers and the org's uploads directory with it", () => {
      const db = getDb();
      const uploadsDir = fs.mkdtempSync(path.join(tmpRoot, "uploads-"));
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "rental", maxVehicles: 5 });
      const ownerId = makeUser("o@example.com");
      admin.upsertMember(db, orgId, ownerId, "owner");

      const bikeId = newId();
      db.prepare("INSERT INTO bike (id, user_id, org_id, nickname) VALUES (?, ?, ?, 'Van')").run(
        bikeId,
        ownerId,
        orgId,
      );
      const customerId = newId();
      db.prepare("INSERT INTO fleet_customer (id, org_id, name) VALUES (?, ?, 'Ahmet Yılmaz')").run(
        customerId,
        orgId,
      );
      db.prepare(
        "INSERT INTO rental_contract (id, org_id, bike_id, customer_id) VALUES (?, ?, ?, ?)",
      ).run(newId(), orgId, bikeId, customerId);

      // A scan of that vehicle, written where routes/documents.ts puts org scans.
      const orgUploads = path.join(uploadsDir, "org", orgId);
      fs.mkdirSync(orgUploads, { recursive: true });
      const file = path.join(orgUploads, "scan.jpg");
      fs.writeFileSync(file, "jpeg");
      db.prepare(
        `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, 'image/jpeg', 4)`,
      ).run(newId(), ownerId, bikeId, file);

      const res = admin.deleteOrganization(db, orgId, { uploadsDir });
      expect(res.vehicles).toBe(1);
      expect(res.customers).toBe(1);
      expect(res.documents).toBe(1);
      expect(res.uploadsRemoved).toBe(orgUploads);

      expect(db.prepare("SELECT COUNT(*) n FROM organization").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) n FROM bike").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) n FROM rental_contract").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) n FROM fleet_customer").get()).toEqual({ n: 0 });
      // The DB cascade would have left this row orphaned onto the member
      // (document.bike_id is ON DELETE SET NULL) pointing at a deleted file.
      expect(db.prepare("SELECT COUNT(*) n FROM document").get()).toEqual({ n: 0 });
      expect(fs.existsSync(orgUploads)).toBe(false);
      // The member's own account is untouched: dissolving an org is not
      // deleting the people in it.
      expect(db.prepare("SELECT COUNT(*) n FROM user").get()).toEqual({ n: 1 });
    });

    it("refuses an unknown organization", () => {
      expect(() => admin.deleteOrganization(getDb(), "nope", {})).toThrow(/No organization/);
    });
  });

  describe("argument parsing", () => {
    it("handles --key value, --key=value and bare flags", () => {
      const { opts, rest } = admin.parseArgs([
        "org:create",
        "--name",
        "Akdeniz Filo",
        "--mode=rental",
        "--max-vehicles",
        "25",
        "--json",
      ]);
      expect(rest).toEqual(["org:create"]);
      expect(opts).toMatchObject({ name: "Akdeniz Filo", mode: "rental", maxVehicles: "25", json: true });
      expect(admin.intOpt(opts, "max-vehicles")).toBe(25);
    });

    it("rejects a non-integer ceiling before it reaches the database", () => {
      const { opts } = admin.parseArgs(["--max-vehicles", "lots"]);
      expect(() => admin.intOpt(opts, "max-vehicles")).toThrow(/must be an integer/);
    });
  });

  describe("list", () => {
    it("reports member count and vehicle usage against the ceiling", () => {
      const db = getDb();
      const orgId = admin.createOrganization(db, { name: "Filo", mode: "rental", maxVehicles: 3 });
      const u = makeUser("a@example.com");
      admin.upsertMember(db, orgId, u, "owner");
      db.prepare("INSERT INTO bike (id, user_id, org_id, nickname) VALUES (?, ?, ?, 'V1')").run(
        newId(),
        u,
        orgId,
      );
      db.prepare(
        "INSERT INTO bike (id, user_id, org_id, nickname, archived) VALUES (?, ?, ?, 'V2', 1)",
      ).run(newId(), u, orgId);
      admin.createInvite(db, { orgId, email: "next@example.com", role: "staff" });

      const [row] = admin.listOrganizations(db);
      expect(row).toMatchObject({ name: "Filo", mode: "rental", members: 1, max_vehicles: 3, pending_invites: 1 });
      // Archived vehicles do not consume the ceiling, exactly as
      // countActiveOrgBikes decides it.
      expect(row.vehicles).toBe(1);
      expect(row.vehicles).toBe(countActiveOrgBikes(orgId, db));
    });
  });
});
