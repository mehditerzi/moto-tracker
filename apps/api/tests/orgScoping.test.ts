import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { addMember, assignVehicle, createOrg, endAssignment } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * The organization rules as the HTTP surface enforces them. orgAccess.test.ts
 * pins the model; this file makes sure every route actually funnels through it —
 * a rule that is right in the library and forgotten in one endpoint is worth
 * nothing.
 *
 * The vehicle a driver is NOT holding is the recurring subject: it must be
 * indistinguishable from a vehicle that does not exist, through every route.
 */

interface Fixture {
  app: ReturnType<typeof buildTestApp>;
  owner: AuthedClient;
  manager: AuthedClient;
  staff: AuthedClient;
  driver: AuthedClient;
  rival: AuthedClient;
  orgId: string;
  rivalOrgId: string;
  /** Org vehicle currently assigned to `driver`. */
  van: string;
  /** Org vehicle nobody is holding — the driver must never see this one. */
  truck: string;
  /** The owner's own vehicle, which the org must never see. */
  personal: string;
  rivalVan: string;
  assignmentId: string;
}

async function setup(): Promise<Fixture> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app, "owner@fleet.test");
  const manager = await signUpAndSignIn(app, "manager@fleet.test");
  const staff = await signUpAndSignIn(app, "staff@fleet.test");
  const driver = await signUpAndSignIn(app, "driver@fleet.test");
  const rival = await signUpAndSignIn(app, "rival@fleet.test");

  const orgId = createOrg("Kervan Filo", "fleet");
  addMember(orgId, owner.user.id, "owner");
  addMember(orgId, manager.user.id, "manager");
  addMember(orgId, staff.user.id, "staff");
  addMember(orgId, driver.user.id, "driver");

  const rivalOrgId = createOrg("Rakip Filo", "fleet");
  addMember(rivalOrgId, rival.user.id, "owner");

  const van = await createBike(app, owner.cookie, "Van", orgId);
  const truck = await createBike(app, owner.cookie, "Truck", orgId);
  const personal = await createBike(app, owner.cookie, "Owner's own");
  const rivalVan = await createBike(app, rival.cookie, "Rival van", rivalOrgId);
  const assignmentId = assignVehicle(orgId, van, driver.user.id);

  return { app, owner, manager, staff, driver, rival, orgId, rivalOrgId, van, truck, personal, rivalVan, assignmentId };
}

async function createBike(
  app: ReturnType<typeof buildTestApp>,
  cookie: string,
  nickname: string,
  orgId?: string,
): Promise<string> {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname, ...(orgId ? { orgId } : {}) });
  if (res.status !== 201) throw new Error(`createBike failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/** Every read path that takes a vehicle id, so none of them can be forgotten. */
function readPaths(bikeId: string): string[] {
  return [
    `/api/bikes/${bikeId}`,
    `/api/bikes/${bikeId}/photo`,
    `/api/bikes/${bikeId}/dated-items`,
    `/api/bikes/${bikeId}/maintenance-items`,
    `/api/documents?bikeId=${bikeId}`,
    `/api/fuel-logs?bikeId=${bikeId}`,
    `/api/trips?bikeId=${bikeId}`,
  ];
}

describe("organization scoping", () => {
  describe("a driver and the vehicle they are not holding", () => {
    it("cannot read it through ANY route", async () => {
      const f = await setup();
      for (const p of readPaths(f.truck)) {
        const res = await request(f.app).get(p).set("Cookie", f.driver.cookie);
        expect(res.status, `GET ${p}`).toBe(404);
      }
    });

    it("cannot write to it through any route", async () => {
      const f = await setup();
      const cookie = f.driver.cookie;
      const writes: [string, string, object][] = [
        ["patch", `/api/bikes/${f.truck}`, { nickname: "mine now" }],
        ["delete", `/api/bikes/${f.truck}`, {}],
        ["post", `/api/bikes/${f.truck}/dated-items`, { type: "sigorta", expiresOn: "2027-01-01" }],
        ["post", `/api/bikes/${f.truck}/maintenance-items`, { kind: "engine_oil" }],
        ["post", `/api/fuel-logs`, { bikeId: f.truck, filledOn: "2026-07-01", liters: 20 }],
        [
          "post",
          `/api/trips`,
          { bikeId: f.truck, distanceKm: 40, startedAt: "2026-07-01T08:00:00Z", endedAt: "2026-07-01T09:00:00Z", pointCount: 10 },
        ],
      ];
      for (const [method, path, body] of writes) {
        const res = await (request(f.app) as never as Record<string, (p: string) => request.Test>)
          [method]!(path)
          .set("Cookie", cookie)
          .set("Content-Type", "application/json")
          .send(body);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      }
    });

    it("gets the same machine codes the pre-organization API used", async () => {
      const f = await setup();
      const cookie = f.driver.cookie;
      // The client translates these codes (DocumentCapturePage maps
      // bike_not_found to its own message), so they are part of the contract.
      for (const p of [
        `/api/documents?bikeId=${f.truck}`,
        `/api/fuel-logs?bikeId=${f.truck}`,
        `/api/trips?bikeId=${f.truck}`,
      ]) {
        expect((await request(f.app).get(p).set("Cookie", cookie)).body.error, p).toBe(
          "bike_not_found",
        );
      }
      const upload = await request(f.app)
        .post(`/api/documents?bikeId=${f.truck}`)
        .set("Cookie", cookie)
        .attach("file", Buffer.from("x"), { filename: "x.jpg", contentType: "image/jpeg" });
      expect(upload.body.error).toBe("bike_not_found");
      const bike = await request(f.app).get(`/api/bikes/${f.truck}`).set("Cookie", cookie);
      expect(bike.body.error).toBe("not_found");
    });

    it("cannot see it in the list, the dashboard, or the unfiltered record feeds", async () => {
      const f = await setup();
      // The manager logs a fill-up and a trip on the truck the driver can't see.
      await request(f.app)
        .post("/api/fuel-logs")
        .set("Cookie", f.manager.cookie)
        .send({ bikeId: f.truck, filledOn: "2026-07-01", liters: 30 });
      await request(f.app)
        .post("/api/trips")
        .set("Cookie", f.manager.cookie)
        .send({
          bikeId: f.truck,
          distanceKm: 80,
          startedAt: "2026-07-01T08:00:00Z",
          endedAt: "2026-07-01T10:00:00Z",
          pointCount: 20,
        });

      const bikes = await request(f.app).get("/api/bikes").set("Cookie", f.driver.cookie);
      expect(bikes.body.map((b: { id: string }) => b.id)).toEqual([f.van]);

      const archived = await request(f.app)
        .get("/api/bikes?archived=true")
        .set("Cookie", f.driver.cookie);
      expect(archived.body.map((b: { id: string }) => b.id)).toEqual([f.van]);

      const dash = await request(f.app).get("/api/dashboard").set("Cookie", f.driver.cookie);
      expect(dash.body).toHaveLength(1);
      expect(dash.body[0].bike.id).toBe(f.van);

      const fuel = await request(f.app).get("/api/fuel-logs").set("Cookie", f.driver.cookie);
      expect(fuel.body).toHaveLength(0);
      const trips = await request(f.app).get("/api/trips").set("Cookie", f.driver.cookie);
      expect(trips.body).toHaveLength(0);
      const docs = await request(f.app).get("/api/documents").set("Cookie", f.driver.cookie);
      expect(docs.body).toHaveLength(0);
    });

    it("cannot reach its records by record id either", async () => {
      const f = await setup();
      const dated = await request(f.app)
        .post(`/api/bikes/${f.truck}/dated-items`)
        .set("Cookie", f.manager.cookie)
        .send({ type: "sigorta", expiresOn: "2027-01-01" });
      const maint = await request(f.app)
        .post(`/api/bikes/${f.truck}/maintenance-items`)
        .set("Cookie", f.manager.cookie)
        .send({ kind: "engine_oil" });
      const trip = await request(f.app)
        .post("/api/trips")
        .set("Cookie", f.manager.cookie)
        .send({
          bikeId: f.truck,
          distanceKm: 60,
          startedAt: "2026-07-01T08:00:00Z",
          endedAt: "2026-07-01T09:30:00Z",
          pointCount: 15,
        });
      expect(dated.status).toBe(201);

      const cookie = f.driver.cookie;
      expect((await request(f.app).get(`/api/dated-items/${dated.body.id}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).patch(`/api/dated-items/${dated.body.id}`).set("Cookie", cookie).send({ cost: 1 })).status).toBe(404);
      expect((await request(f.app).delete(`/api/dated-items/${dated.body.id}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).get(`/api/maintenance-items/${maint.body.id}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).delete(`/api/maintenance-items/${maint.body.id}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).get(`/api/trips/${trip.body.id}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).delete(`/api/trips/${trip.body.id}`).set("Cookie", cookie)).status).toBe(404);

      // …and the record really is still there afterwards.
      const stillThere = await request(f.app)
        .get(`/api/dated-items/${dated.body.id}`)
        .set("Cookie", f.manager.cookie);
      expect(stillThere.status).toBe(200);
    });
  });

  describe("a driver and the vehicle they ARE holding", () => {
    it("may read it and log day-to-day records on it", async () => {
      const f = await setup();
      const cookie = f.driver.cookie;

      expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", cookie)).status).toBe(200);

      const dated = await request(f.app)
        .post(`/api/bikes/${f.van}/dated-items`)
        .set("Cookie", cookie)
        .send({ type: "muayene", expiresOn: "2027-03-01" });
      expect(dated.status).toBe(201);

      const fuel = await request(f.app)
        .post("/api/fuel-logs")
        .set("Cookie", cookie)
        .send({ bikeId: f.van, filledOn: "2026-07-02", liters: 42 });
      expect(fuel.status).toBe(201);

      const trip = await request(f.app)
        .post("/api/trips")
        .set("Cookie", cookie)
        .send({
          bikeId: f.van,
          distanceKm: 55,
          startedAt: "2026-07-02T07:00:00Z",
          endedAt: "2026-07-02T08:00:00Z",
          pointCount: 12,
        });
      expect(trip.status).toBe(201);

      // The manager sees what the driver recorded — that is the point of a fleet.
      const managerFuel = await request(f.app)
        .get(`/api/fuel-logs?bikeId=${f.van}`)
        .set("Cookie", f.manager.cookie);
      expect(managerFuel.body).toHaveLength(1);
      const managerDash = await request(f.app).get("/api/dashboard").set("Cookie", f.manager.cookie);
      const vanCard = managerDash.body.find((c: { bike: { id: string } }) => c.bike.id === f.van);
      expect(vanCard.items.muayene.expiresOn).toBe("2027-03-01");
    });

    it("may not rename, re-plate or archive it", async () => {
      const f = await setup();
      const cookie = f.driver.cookie;
      const patch = await request(f.app)
        .patch(`/api/bikes/${f.van}`)
        .set("Cookie", cookie)
        .send({ nickname: "My van", plate: "34XYZ99" });
      expect(patch.status).toBe(403);

      const del = await request(f.app).delete(`/api/bikes/${f.van}`).set("Cookie", cookie);
      expect(del.status).toBe(403);

      const photo = await request(f.app).delete(`/api/bikes/${f.van}/photo`).set("Cookie", cookie);
      expect(photo.status).toBe(403);

      const after = await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.manager.cookie);
      expect(after.body.nickname).toBe("Van");
      expect(after.body.archived).toBe(false);
    });

    it("loses access the instant the assignment ends", async () => {
      const f = await setup();
      const cookie = f.driver.cookie;
      expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", cookie)).status).toBe(200);

      endAssignment(f.assignmentId);

      expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", cookie)).status).toBe(404);
      expect((await request(f.app).get("/api/bikes").set("Cookie", cookie)).body).toHaveLength(0);
      expect((await request(f.app).get("/api/dashboard").set("Cookie", cookie)).body).toHaveLength(0);
      for (const p of readPaths(f.van)) {
        const res = await request(f.app).get(p).set("Cookie", cookie);
        expect(res.status, `GET ${p}`).toBe(404);
      }
      const fuel = await request(f.app)
        .post("/api/fuel-logs")
        .set("Cookie", cookie)
        .send({ bikeId: f.van, filledOn: "2026-07-03", liters: 10 });
      expect(fuel.status).toBe(404);
    });
  });

  describe("staff", () => {
    it("runs the fleet: reads everything, writes records, edits the vehicle", async () => {
      const f = await setup();
      const cookie = f.staff.cookie;
      const list = await request(f.app).get("/api/bikes").set("Cookie", cookie);
      expect(list.body.map((b: { id: string }) => b.id).sort()).toEqual([f.van, f.truck].sort());

      expect(
        (await request(f.app).patch(`/api/bikes/${f.truck}`).set("Cookie", cookie).send({ currentKm: 90210 })).status,
      ).toBe(200);
      expect(
        (await request(f.app)
          .post(`/api/bikes/${f.truck}/maintenance-items`)
          .set("Cookie", cookie)
          .send({ kind: "brakes" })).status,
      ).toBe(201);
    });

    it("cannot archive a vehicle — that is a billing decision", async () => {
      const f = await setup();
      const del = await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", f.staff.cookie);
      expect(del.status).toBe(403);
      expect(del.body.error).toBe("forbidden");

      const still = await request(f.app).get(`/api/bikes/${f.truck}`).set("Cookie", f.staff.cookie);
      expect(still.body.archived).toBe(false);
    });

    it("cannot add a vehicle to the fleet, and cannot manage members", async () => {
      const f = await setup();
      const create = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.staff.cookie)
        .send({ nickname: "Sneaky", orgId: f.orgId });
      expect(create.status).toBe(403);

      // Member management has no route yet; the guard that will protect it is
      // covered directly in orgAccess.test.ts (requireOrgRole rejects staff).
      const members = getDb()
        .prepare("SELECT COUNT(*) c FROM org_member WHERE org_id = ?")
        .get(f.orgId) as { c: number };
      expect(members.c).toBe(4);
    });
  });

  describe("across organizations", () => {
    it("a rival org's owner cannot touch this fleet through any route", async () => {
      const f = await setup();
      const cookie = f.rival.cookie;
      for (const p of [...readPaths(f.van), ...readPaths(f.truck)]) {
        expect((await request(f.app).get(p).set("Cookie", cookie)).status, `GET ${p}`).toBe(404);
      }
      expect((await request(f.app).patch(`/api/bikes/${f.van}`).set("Cookie", cookie).send({ nickname: "x" })).status).toBe(404);
      expect((await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", cookie)).status).toBe(404);
      expect(
        (await request(f.app)
          .post("/api/fuel-logs")
          .set("Cookie", cookie)
          .send({ bikeId: f.van, filledOn: "2026-07-01", liters: 5 })).status,
      ).toBe(404);

      // And their own list is untouched by ours.
      const list = await request(f.app).get("/api/bikes").set("Cookie", cookie);
      expect(list.body.map((b: { id: string }) => b.id)).toEqual([f.rivalVan]);
    });

    it("cannot register a vehicle into an org they do not belong to", async () => {
      const f = await setup();
      const res = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.rival.cookie)
        .send({ nickname: "Trojan", orgId: f.orgId });
      // 404, not 403: the existence of someone else's org is not their business.
      expect(res.status).toBe(404);
    });
  });

  describe("personal vehicles", () => {
    it("stay invisible to every member of the owner's own organization", async () => {
      const f = await setup();
      for (const client of [f.manager, f.staff, f.driver, f.rival]) {
        for (const p of readPaths(f.personal)) {
          const res = await request(f.app).get(p).set("Cookie", client.cookie);
          expect(res.status, `GET ${p}`).toBe(404);
        }
        const list = await request(f.app).get("/api/bikes").set("Cookie", client.cookie);
        expect(list.body.map((b: { id: string }) => b.id)).not.toContain(f.personal);
      }
    });

    it("are still the owner's own, alongside the fleet", async () => {
      const f = await setup();
      const list = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
      expect(list.body.map((b: { id: string }) => b.id).sort()).toEqual(
        [f.van, f.truck, f.personal].sort(),
      );
      expect(
        (await request(f.app).delete(`/api/bikes/${f.personal}`).set("Cookie", f.owner.cookie)).status,
      ).toBe(204);
    });
  });

  describe("entitlement", () => {
    it("bills org vehicles to the org, not to the member who registers them", async () => {
      const f = await setup();
      // The owner is on the free tier (1 personal vehicle) yet registered two
      // org vehicles plus one personal one.
      const ent = await request(f.app).get("/api/entitlement").set("Cookie", f.owner.cookie);
      expect(ent.body.maxVehicles).toBe(1);
      expect(ent.body.activeVehicles).toBe(1); // the personal one only
      expect(ent.body.canAddVehicle).toBe(false);

      // A personal vehicle is still refused…
      const personal = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.owner.cookie)
        .send({ nickname: "Second personal" });
      expect(personal.status).toBe(403);
      expect(personal.body.error).toBe("vehicle_limit_reached");

      // …while the fleet keeps growing on the org's own ceiling.
      const orgOne = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.owner.cookie)
        .send({ nickname: "Third van", orgId: f.orgId });
      expect(orgOne.status).toBe(201);
      expect(orgOne.body.orgId).toBe(f.orgId);
    });

    it("enforces the organization's own ceiling", async () => {
      const f = await setup();
      getDb().prepare("UPDATE organization SET max_vehicles = 2 WHERE id = ?").run(f.orgId);
      const res = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.manager.cookie)
        .send({ nickname: "One too many", orgId: f.orgId });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("vehicle_limit_reached");

      // A personal subscription does NOT buy fleet slots.
      grantEntitlement(f.manager.user.id);
      const again = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.manager.cookie)
        .send({ nickname: "Still too many", orgId: f.orgId });
      expect(again.status).toBe(403);

      // Archiving one frees a slot, because the ceiling counts active vehicles.
      await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", f.owner.cookie);
      const now = await request(f.app)
        .post("/api/bikes")
        .set("Cookie", f.manager.cookie)
        .send({ nickname: "Replacement", orgId: f.orgId });
      expect(now.status).toBe(201);
    });
  });

  describe("existing single-user behaviour", () => {
    it("is unchanged for someone with no organization", async () => {
      const f = await setup();
      const solo = await signUpAndSignIn(f.app, "solo@test.com");
      const bikeId = await createBike(f.app, solo.cookie, "Solo bike");

      const list = await request(f.app).get("/api/bikes").set("Cookie", solo.cookie);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(bikeId);
      expect(list.body[0].orgId).toBeNull();

      const dash = await request(f.app).get("/api/dashboard").set("Cookie", solo.cookie);
      expect(dash.body).toHaveLength(1);

      // Everything in the fleet is invisible to them, and vice versa.
      for (const p of readPaths(f.van)) {
        expect((await request(f.app).get(p).set("Cookie", solo.cookie)).status, p).toBe(404);
      }
      const ownerList = await request(f.app).get("/api/bikes").set("Cookie", f.owner.cookie);
      expect(ownerList.body.map((b: { id: string }) => b.id)).not.toContain(bikeId);
    });
  });

  describe("account deletion", () => {
    it("does not take the fleet with the owner who registered it", async () => {
      const f = await setup();
      await request(f.app)
        .post(`/api/bikes/${f.truck}/dated-items`)
        .set("Cookie", f.owner.cookie)
        .send({ type: "sigorta", expiresOn: "2027-05-05" });

      const del = await request(f.app)
        .delete("/api/me")
        .set("Cookie", f.owner.cookie)
        .send({ password: "supersecret123" });
      expect(del.status).toBe(204);

      // The org and its vehicles survive; custody moved to the manager.
      const list = await request(f.app).get("/api/bikes").set("Cookie", f.manager.cookie);
      expect(list.body.map((b: { id: string }) => b.id).sort()).toEqual([f.van, f.truck].sort());
      expect(list.body.every((b: { userId: string }) => b.userId === f.manager.user.id)).toBe(true);

      // The service history survives too, re-attributed to the custodian.
      const dated = await request(f.app)
        .get(`/api/bikes/${f.truck}/dated-items`)
        .set("Cookie", f.manager.cookie);
      expect(dated.body).toHaveLength(1);

      // …but the owner's personal vehicle is gone, as promised.
      expect(
        (getDb().prepare("SELECT COUNT(*) c FROM bike WHERE id = ?").get(f.personal) as { c: number }).c,
      ).toBe(0);
      // …and so is every trace of the user.
      expect(getDb().prepare("SELECT 1 FROM user WHERE id = ?").get(f.owner.user.id)).toBeUndefined();
    });

    it("dissolves an organization whose last member deletes their account", async () => {
      const f = await setup();
      const solo = await signUpAndSignIn(f.app, "solo-owner@fleet.test");
      const soloOrg = createOrg("Tek Kişilik", "rental");
      addMember(soloOrg, solo.user.id, "owner");
      const soloBike = await createBike(f.app, solo.cookie, "Only van", soloOrg);
      getDb()
        .prepare("INSERT INTO fleet_customer (id, org_id, name, phone) VALUES ('cust1', ?, 'Renter', '555')")
        .run(soloOrg);

      const del = await request(f.app)
        .delete("/api/me")
        .set("Cookie", solo.cookie)
        .send({ password: "supersecret123" });
      expect(del.status).toBe(204);

      const count = (sql: string, ...args: unknown[]) =>
        (getDb().prepare(sql).get(...args) as { c: number }).c;
      expect(count("SELECT COUNT(*) c FROM organization WHERE id = ?", soloOrg)).toBe(0);
      expect(count("SELECT COUNT(*) c FROM bike WHERE id = ?", soloBike)).toBe(0);
      // Renter personal data goes with the org that collected it.
      expect(count("SELECT COUNT(*) c FROM fleet_customer WHERE org_id = ?", soloOrg)).toBe(0);
      // The unrelated org is untouched.
      expect(count("SELECT COUNT(*) c FROM organization WHERE id = ?", f.orgId)).toBe(1);
    });

    it("releases a departing driver's assignment without harming the vehicle", async () => {
      const f = await setup();
      await request(f.app)
        .post("/api/fuel-logs")
        .set("Cookie", f.driver.cookie)
        .send({ bikeId: f.van, filledOn: "2026-07-02", liters: 42 });

      const del = await request(f.app)
        .delete("/api/me")
        .set("Cookie", f.driver.cookie)
        .send({ password: "supersecret123" });
      expect(del.status).toBe(204);

      const count = (sql: string, ...args: unknown[]) =>
        (getDb().prepare(sql).get(...args) as { c: number }).c;
      // The assignment is a fact about the person: it goes with them.
      expect(count("SELECT COUNT(*) c FROM vehicle_assignment WHERE bike_id = ?", f.van)).toBe(0);
      // The vehicle and the fill-up it recorded stay with the org.
      const fuel = await request(f.app)
        .get(`/api/fuel-logs?bikeId=${f.van}`)
        .set("Cookie", f.manager.cookie);
      expect(fuel.body).toHaveLength(1);
      expect(fuel.body[0].userId).not.toBe(f.driver.user.id);
    });
  });
});
