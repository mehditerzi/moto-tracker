import { describe, it, expect } from "vitest";
import request from "supertest";
import { fleetFixture } from "./helpers/fleetFixture.js";
import { addMember, createOrg } from "./helpers/org.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";

/**
 * The organization itself, and the two boundaries every fleet route inherits:
 * a driver must not read fleet-wide data, and a member of one org must not be
 * able to name, read or touch another.
 */
describe("GET /api/orgs", () => {
  it("is empty for a consumer with no membership", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get("/api/orgs").set("Cookie", f.outsider.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns exactly { orgId, role, mode, name } for each membership", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get("/api/orgs").set("Cookie", f.manager.cookie);
    expect(res.body).toEqual([
      { orgId: f.orgId, role: "manager", mode: "fleet", name: "Kervan Filo" },
    ]);
  });

  it("includes a driver's own org, so the client can gate on role", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get("/api/orgs").set("Cookie", f.driver.cookie);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe("driver");
  });

  it("never names another tenant's organization", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get("/api/orgs").set("Cookie", f.rival.cookie);
    expect(res.body.map((o: { orgId: string }) => o.orgId)).toEqual([f.rivalOrgId]);
  });

  it("drops a membership the moment it is set to removed", async () => {
    const f = await fleetFixture();
    getDb()
      .prepare("UPDATE org_member SET status = 'removed' WHERE org_id = ? AND user_id = ?")
      .run(f.orgId, f.staff.user.id);
    const res = await request(f.app).get("/api/orgs").set("Cookie", f.staff.cookie);
    expect(res.body).toEqual([]);
  });

  it("requires a session", async () => {
    const f = await fleetFixture();
    expect((await request(f.app).get("/api/orgs")).status).toBe(401);
  });
});

describe("GET /api/orgs/:orgId", () => {
  it("is readable by owner, manager and staff", async () => {
    const f = await fleetFixture();
    for (const c of [f.owner, f.manager, f.staff]) {
      const res = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", c.cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: f.orgId,
        name: "Kervan Filo",
        mode: "fleet",
        maxVehicles: 10,
        activeVehicles: 2,
        memberCount: 4,
      });
    }
  });

  it("carries the CALLER's role, not the org's", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", f.staff.cookie);
    expect(res.body.role).toBe("staff");
  });

  it("refuses a driver — fleet size is exactly what they must not learn", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", f.driver.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("is a 404, not a 403, for a non-member: an org's existence is not public", async () => {
    const f = await fleetFixture();
    for (const c of [f.outsider, f.rival]) {
      const res = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", c.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
    }
  });

  it("is a 404 for an id that does not exist at all", async () => {
    const f = await fleetFixture();
    const res = await request(f.app).get("/api/orgs/nope").set("Cookie", f.owner.cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/orgs/:orgId", () => {
  it("lets an owner rename the org", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.owner.cookie)
      .send({ name: "Kervan Lojistik" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Kervan Lojistik");
  });

  it("refuses staff and drivers", async () => {
    const f = await fleetFixture();
    for (const c of [f.staff, f.driver]) {
      const res = await request(f.app)
        .patch(`/api/orgs/${f.orgId}`)
        .set("Cookie", c.cookie)
        .send({ name: "Benim Filom" });
      expect(res.status).toBe(403);
    }
    const after = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", f.owner.cookie);
    expect(after.body.name).toBe("Kervan Filo");
  });

  it("refuses a member of another org with 404", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.rival.cookie)
      .send({ name: "Ele geçirildi" });
    expect(res.status).toBe(404);
  });

  it("rejects an empty body and an over-long name", async () => {
    const f = await fleetFixture();
    for (const body of [{}, { name: "" }, { name: "x".repeat(200) }, { mode: "hybrid" }]) {
      const res = await request(f.app)
        .patch(`/api/orgs/${f.orgId}`)
        .set("Cookie", f.owner.cookie)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe("validation_error");
    }
  });

  it("cannot change mode while a vehicle is still out", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const blocked = await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.owner.cookie)
      .send({ mode: "rental" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("mode_change_blocked");
  });

  it("allows the mode change once nothing is open", async () => {
    const f = await fleetFixture("fleet");
    const res = await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.owner.cookie)
      .send({ mode: "rental" });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("rental");
    // …and the switch is visible everywhere the mode is consumed.
    const orgs = await request(f.app).get("/api/orgs").set("Cookie", f.owner.cookie);
    expect(orgs.body[0].mode).toBe("rental");
  });

  it("never lets a customer raise their own vehicle ceiling", async () => {
    const f = await fleetFixture();
    const res = await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.owner.cookie)
      .send({ name: "Kervan", maxVehicles: 999 });
    expect(res.status).toBe(200);
    const after = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", f.owner.cookie);
    expect(after.body.maxVehicles).toBe(10);
  });
});

describe("there is no way to create or delete an organization", () => {
  it("POST /api/orgs and DELETE /api/orgs/:id do not exist", async () => {
    const f = await fleetFixture();
    const post = await request(f.app)
      .post("/api/orgs")
      .set("Cookie", f.owner.cookie)
      .send({ name: "Kendi Filom", mode: "fleet" });
    expect(post.status).toBe(404);

    const del = await request(f.app).delete(`/api/orgs/${f.orgId}`).set("Cookie", f.owner.cookie);
    expect(del.status).toBe(404);
    expect(
      (getDb().prepare("SELECT COUNT(*) c FROM organization").get() as { c: number }).c,
    ).toBe(2);
  });
});

describe("several memberships", () => {
  it("keeps each org's data behind its own membership", async () => {
    const f = await fleetFixture();
    const second = createOrg("İkinci Filo", "rental", 5);
    addMember(second, f.manager.user.id, "owner");

    const orgs = await request(f.app).get("/api/orgs").set("Cookie", f.manager.cookie);
    expect(orgs.body).toHaveLength(2);
    expect(
      orgs.body.find((o: { orgId: string }) => o.orgId === second).role,
    ).toBe("owner");
    // Being an owner over there grants nothing extra over here.
    const here = await request(f.app).get(`/api/orgs/${f.orgId}`).set("Cookie", f.manager.cookie);
    expect(here.body.role).toBe("manager");
  });

  it("a brand-new user sees no fleet at all", async () => {
    const f = await fleetFixture();
    const fresh = await signUpAndSignIn(f.app, "fresh@test.com");
    expect((await request(f.app).get("/api/orgs").set("Cookie", fresh.cookie)).body).toEqual([]);
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", fresh.cookie)).status,
    ).toBe(404);
  });
});
