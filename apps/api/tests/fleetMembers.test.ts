import { describe, it, expect } from "vitest";
import request from "supertest";
import { fleetFixture } from "./helpers/fleetFixture.js";
import { addMember } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * `/fleet/people`. The two invariants worth breaking things over:
 *
 *   * an organization always has at least one owner, and
 *   * a manager can neither make nor unmake one.
 *
 * Both are tested from every angle a determined manager would try.
 */

const membersUrl = (orgId: string) => `/api/orgs/${orgId}/members`;

describe("GET members", () => {
  it("lists active members ranked by seniority, with e-mail and name", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get(membersUrl(f.orgId)).set("Cookie", f.owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.map((m: { role: string }) => m.role)).toEqual([
      "owner",
      "manager",
      "staff",
      "driver",
    ]);
    expect(res.body[0].email).toBe("owner@filo.test");
    expect(res.body[0].isSelf).toBe(true);
  });

  it("is closed to staff and drivers — it is a management screen", async () => {
    const f = await fleetFixture();
    for (const c of [f.staff, f.driver]) {
      expect((await request(f.app).get(membersUrl(f.orgId)).set("Cookie", c.cookie)).status).toBe(403);
    }
  });

  it("is a 404 across tenants", async () => {
    const f = await fleetFixture();
    for (const c of [f.rival, f.outsider]) {
      expect((await request(f.app).get(membersUrl(f.orgId)).set("Cookie", c.cookie)).status).toBe(404);
    }
  });

  it("shows what each member is currently holding", async () => {
    const f = await fleetFixture();
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const res = await request(f.app).get(membersUrl(f.orgId)).set("Cookie", f.manager.cookie);
    const driver = res.body.find((m: { userId: string }) => m.userId === f.driver.user.id);
    expect(driver.assignments).toHaveLength(1);
    expect(driver.assignments[0].bikeId).toBe(f.van);
    const staff = res.body.find((m: { userId: string }) => m.userId === f.staff.user.id);
    expect(staff.assignments).toEqual([]);
  });

  it("hides removed members unless asked for them", async () => {
    const f = await fleetFixture();
    await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.staff.user.id}`)
      .set("Cookie", f.owner.cookie);

    const plain = await request(f.app).get(membersUrl(f.orgId)).set("Cookie", f.owner.cookie);
    expect(plain.body).toHaveLength(3);
    const all = await request(f.app)
      .get(`${membersUrl(f.orgId)}?includeRemoved=true`)
      .set("Cookie", f.owner.cookie);
    expect(all.body).toHaveLength(4);
    expect(all.body.find((m: { userId: string }) => m.userId === f.staff.user.id).status).toBe(
      "removed",
    );
  });
});

describe("PATCH a member's role", () => {
  it("an owner may promote staff to manager", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.staff.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "manager" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("manager");
    const orgs = await request(f.app).get("/api/orgs").set("Cookie", f.staff.cookie);
    expect(orgs.body[0].role).toBe("manager");
  });

  it("REFUSES to demote the last owner", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.owner.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "driver" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_owner");
    const orgs = await request(f.app).get("/api/orgs").set("Cookie", f.owner.cookie);
    expect(orgs.body[0].role).toBe("owner");
  });

  it("allows the demotion once a second owner exists", async () => {
    const f = await fleetFixture();
    addMember(f.orgId, f.owner2.user.id, "owner");
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.owner.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "staff" });
    expect(res.status).toBe(200);
    // …and the same protection now applies to the survivor.
    const again = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.owner2.user.id}`)
      .set("Cookie", f.owner2.cookie)
      .send({ role: "staff" });
    expect(again.status).toBe(409);
  });

  it("a manager cannot promote anyone (including themselves) to owner", async () => {
    const f = await fleetFixture();
    for (const target of [f.manager.user.id, f.staff.user.id]) {
      const res = await request(f.app)
        .patch(`${membersUrl(f.orgId)}/${target}`)
        .set("Cookie", f.manager.cookie)
        .send({ role: "owner" });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("owner_role_required");
    }
    expect(
      (getDb()
        .prepare("SELECT COUNT(*) c FROM org_member WHERE org_id = ? AND role = 'owner'")
        .get(f.orgId) as { c: number }).c,
    ).toBe(1);
  });

  it("a manager cannot demote an owner", async () => {
    const f = await fleetFixture();
    addMember(f.orgId, f.owner2.user.id, "owner");
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.owner.user.id}`)
      .set("Cookie", f.manager.cookie)
      .send({ role: "driver" });
    expect(res.status).toBe(403);
  });

  it("staff and drivers cannot change anybody's role", async () => {
    const f = await fleetFixture();
    for (const c of [f.staff, f.driver]) {
      const res = await request(f.app)
        .patch(`${membersUrl(f.orgId)}/${c.user.id}`)
        .set("Cookie", c.cookie)
        .send({ role: "owner" });
      expect(res.status).toBe(403);
    }
  });

  it("cannot be aimed at a member of another organization", async () => {
    const f = await fleetFixture();
    // The rival's own owner, addressed through OUR org: not a member here.
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.rival.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "owner" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("member_not_found");

    // …and our owner cannot reach into theirs.
    const across = await request(f.app)
      .patch(`${membersUrl(f.rivalOrgId)}/${f.rival.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "driver" });
    expect(across.status).toBe(404);
  });

  it("rejects an unknown role", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.staff.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "superuser" });
    expect(res.status).toBe(400);
  });

  it("demoting a manager to driver revokes their view of the fleet immediately", async () => {
    const f = await fleetFixture();
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.manager.cookie))
        .status,
    ).toBe(200);

    await request(f.app)
      .patch(`${membersUrl(f.orgId)}/${f.manager.user.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ role: "driver" });

    const after = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles`)
      .set("Cookie", f.manager.cookie);
    expect(after.status).toBe(403);
    const bikes = await request(f.app).get("/api/bikes").set("Cookie", f.manager.cookie);
    expect(bikes.body).toEqual([]);
  });
});

describe("DELETE a member", () => {
  it("revokes access and closes what they were holding", async () => {
    const f = await fleetFixture();
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.driver.cookie)).status).toBe(200);

    const res = await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.driver.user.id}`)
      .set("Cookie", f.manager.cookie);
    expect(res.status).toBe(204);

    expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.driver.cookie)).status).toBe(404);
    expect((await request(f.app).get("/api/orgs").set("Cookie", f.driver.cookie)).body).toEqual([]);
    // The vehicle is free again — a stale open assignment would hold its only
    // slot through the partial unique index and make it unassignable.
    const reassign = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.staff.user.id });
    expect(reassign.status).toBe(201);
  });

  it("keeps the membership row so history still resolves to a name", async () => {
    const f = await fleetFixture();
    await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.driver.user.id}`)
      .set("Cookie", f.owner.cookie);
    const row = getDb()
      .prepare("SELECT status FROM org_member WHERE org_id = ? AND user_id = ?")
      .get(f.orgId, f.driver.user.id) as { status: string };
    expect(row.status).toBe("removed");
  });

  it("REFUSES to remove the last owner", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.owner.user.id}`)
      .set("Cookie", f.owner.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("last_owner");
    expect((await request(f.app).get("/api/orgs").set("Cookie", f.owner.cookie)).body).toHaveLength(1);
  });

  it("a manager cannot remove an owner", async () => {
    const f = await fleetFixture();
    addMember(f.orgId, f.owner2.user.id, "owner");
    const res = await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.owner.user.id}`)
      .set("Cookie", f.manager.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("owner_role_required");
  });

  it("staff and drivers cannot remove anybody", async () => {
    const f = await fleetFixture();
    for (const c of [f.staff, f.driver]) {
      expect(
        (await request(f.app)
          .delete(`${membersUrl(f.orgId)}/${f.manager.user.id}`)
          .set("Cookie", c.cookie)).status,
      ).toBe(403);
    }
  });

  it("cannot reach into another organization", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .delete(`${membersUrl(f.rivalOrgId)}/${f.rival.user.id}`)
      .set("Cookie", f.owner.cookie);
    expect(res.status).toBe(404);
    expect((await request(f.app).get("/api/orgs").set("Cookie", f.rival.cookie))).toBeTruthy();
    expect(
      (getDb()
        .prepare("SELECT status FROM org_member WHERE org_id = ? AND user_id = ?")
        .get(f.rivalOrgId, f.rival.user.id) as { status: string }).status,
    ).toBe("active");
  });

  it("is a 404 for someone who was never a member, and for one already removed", async () => {
    const f = await fleetFixture();
    expect(
      (await request(f.app)
        .delete(`${membersUrl(f.orgId)}/${f.outsider.user.id}`)
        .set("Cookie", f.owner.cookie)).status,
    ).toBe(404);
    await request(f.app)
      .delete(`${membersUrl(f.orgId)}/${f.staff.user.id}`)
      .set("Cookie", f.owner.cookie);
    expect(
      (await request(f.app)
        .delete(`${membersUrl(f.orgId)}/${f.staff.user.id}`)
        .set("Cookie", f.owner.cookie)).status,
    ).toBe(404);
  });
});
