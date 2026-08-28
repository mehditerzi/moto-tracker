import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn, type AuthedClient } from "./helpers/authedRequest.js";
import { grantEntitlement } from "./helpers/grantEntitlement.js";
import { addMember, createOrg } from "./helpers/org.js";
import { getDb } from "../src/db/index.js";

/**
 * Adding ONE vehicle to a fleet — the request the manager-facing form makes.
 *
 * Until now the only way a vehicle could end up owned by an organization was the
 * CSV bulk import, so a manager who bought one more van had to fake a one-row
 * spreadsheet. `/fleet/vehicles` → "Add vehicle" → `/bikes/new?orgId=…` closes
 * that, and this file pins the contract that entry point relies on: who may
 * make the request, which garage the vehicle lands in, which ceiling refuses it,
 * and that the consumer path is untouched by any of it.
 *
 * orgScoping.test.ts covers the access model as a whole; this is deliberately
 * the narrow "add one vehicle" story, told the way the UI tells it.
 */

interface Fixture {
  app: ReturnType<typeof buildTestApp>;
  owner: AuthedClient;
  manager: AuthedClient;
  staff: AuthedClient;
  driver: AuthedClient;
  stranger: AuthedClient;
  orgId: string;
}

/** Everything the form sends: the vehicle's attributes, plus which garage. */
const FORM_PAYLOAD = {
  vehicleType: "car",
  nickname: "Kargo 3",
  plate: "34 ABC 123",
  make: "Fiat",
  model: "Doblo",
  year: 2022,
  currentKm: 41000,
  color: "Beyaz",
  fuelType: "Dizel",
} as const;

async function setup(): Promise<Fixture> {
  const app = buildTestApp();
  const owner = await signUpAndSignIn(app);
  const manager = await signUpAndSignIn(app);
  const staff = await signUpAndSignIn(app);
  const driver = await signUpAndSignIn(app);
  const stranger = await signUpAndSignIn(app);
  const orgId = createOrg("Kervan Filo", "fleet", 3);
  addMember(orgId, owner.user.id, "owner");
  addMember(orgId, manager.user.id, "manager");
  addMember(orgId, staff.user.id, "staff");
  addMember(orgId, driver.user.id, "driver");
  return { app, owner, manager, staff, driver, stranger, orgId };
}

function addVehicle(f: Fixture, who: AuthedClient, body: Record<string, unknown>) {
  return request(f.app).post("/api/bikes").set("Cookie", who.cookie).send(body);
}

describe("adding one vehicle to a fleet", () => {
  it("files it in the organization's garage, not the manager's own", async () => {
    const f = await setup();
    const res = await addVehicle(f, f.manager, { ...FORM_PAYLOAD, orgId: f.orgId });

    expect(res.status).toBe(201);
    expect(res.body.orgId).toBe(f.orgId);
    expect(res.body.nickname).toBe("Kargo 3");
    expect(res.body.plate).toBe("34 ABC 123");

    // `bike.user_id` is the CUSTODIAN (who registered it) and grants nothing on
    // its own — the vehicle is the org's, so a colleague sees it…
    const row = getDb().prepare("SELECT user_id, org_id FROM bike WHERE id = ?").get(res.body.id) as {
      user_id: string;
      org_id: string;
    };
    expect(row.user_id).toBe(f.manager.user.id);
    expect(row.org_id).toBe(f.orgId);

    const asOwner = await request(f.app).get(`/api/bikes/${res.body.id}`).set("Cookie", f.owner.cookie);
    expect(asOwner.status).toBe(200);

    // …and it shows up on the fleet inventory the manager came from.
    const inventory = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?sort=plate&dir=asc`)
      .set("Cookie", f.manager.cookie);
    expect(inventory.body.items.map((r: { bikeId: string }) => r.bikeId)).toContain(res.body.id);
  });

  it("does not consume the personal garage the manager pays for", async () => {
    const f = await setup();
    await addVehicle(f, f.manager, { ...FORM_PAYLOAD, orgId: f.orgId });
    await addVehicle(f, f.manager, { nickname: "İkinci van", orgId: f.orgId });

    // Two company vans registered, and the free consumer tier is still intact.
    const ent = await request(f.app).get("/api/entitlement").set("Cookie", f.manager.cookie);
    expect(ent.body.activeVehicles).toBe(0);
    expect(ent.body.maxVehicles).toBe(1);
    expect(ent.body.canAddVehicle).toBe(true);

    // Which the personal path can still spend, exactly as before.
    const mine = await addVehicle(f, f.manager, { nickname: "Kendi motorum" });
    expect(mine.status).toBe(201);
    expect(mine.body.orgId).toBeNull();
  });

  it("is refused for staff and drivers, and invisible to a stranger", async () => {
    const f = await setup();

    // Staff run the fleet day to day; its size is a billing decision.
    const asStaff = await addVehicle(f, f.staff, { ...FORM_PAYLOAD, orgId: f.orgId });
    expect(asStaff.status).toBe(403);
    expect(asStaff.body.error).toBe("forbidden");

    const asDriver = await addVehicle(f, f.driver, { ...FORM_PAYLOAD, orgId: f.orgId });
    expect(asDriver.status).toBe(403);

    // 404, not 403: the existence of an organization is not public information.
    const asStranger = await addVehicle(f, f.stranger, { ...FORM_PAYLOAD, orgId: f.orgId });
    expect(asStranger.status).toBe(404);

    expect(
      (getDb().prepare("SELECT COUNT(*) c FROM bike WHERE org_id = ?").get(f.orgId) as { c: number }).c,
    ).toBe(0);

    // A refused staff member is not locked out of the fleet — they still keep
    // the day-to-day records on a vehicle someone else added.
    const van = await addVehicle(f, f.owner, { nickname: "Van", orgId: f.orgId });
    const edit = await request(f.app)
      .patch(`/api/bikes/${van.body.id}`)
      .set("Cookie", f.staff.cookie)
      .send({ currentKm: 52000 });
    expect(edit.status).toBe(200);
  });

  it("enforces the ORG's ceiling — and that refusal is not the consumer cap", async () => {
    const f = await setup();
    for (const nickname of ["Van 1", "Van 2", "Van 3"]) {
      expect((await addVehicle(f, f.manager, { nickname, orgId: f.orgId })).status).toBe(201);
    }

    const full = await addVehicle(f, f.manager, { ...FORM_PAYLOAD, orgId: f.orgId });
    expect(full.status).toBe(403);
    expect(full.body.error).toBe("vehicle_limit_reached");

    // The same machine code the consumer paywall keys on — but here it means
    // `organization.max_vehicles`, and the caller's own entitlement is nowhere
    // near its cap. Showing the IAP paywall on this refusal would be a lie, and
    // it would put a fleet acquisition affordance in the app
    // (docs/fleet-design.md §1, App Store Guideline 3.1.1).
    const ent = await request(f.app).get("/api/entitlement").set("Cookie", f.manager.cookie);
    expect(ent.body.canAddVehicle).toBe(true);
    expect(ent.body.activeVehicles).toBe(0);

    // And buying the biggest consumer pack changes nothing about the fleet —
    // there is no in-app purchase that would clear this error.
    grantEntitlement(f.manager.user.id);
    const stillFull = await addVehicle(f, f.manager, { ...FORM_PAYLOAD, orgId: f.orgId });
    expect(stillFull.status).toBe(403);
    expect(stillFull.body.error).toBe("vehicle_limit_reached");

    // Only the org's own numbers move it: archive one, or the operator raises
    // the ceiling. Both are what the copy tells the manager.
    const inventory = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?sort=plate&dir=asc`)
      .set("Cookie", f.manager.cookie);
    const victim = inventory.body.items[0].bikeId;
    expect(
      (await request(f.app).delete(`/api/bikes/${victim}`).set("Cookie", f.manager.cookie)).status,
    ).toBe(204);
    expect((await addVehicle(f, f.manager, { ...FORM_PAYLOAD, orgId: f.orgId })).status).toBe(201);
  });

  it("never moves a vehicle between garages on edit", async () => {
    const f = await setup();
    const orgVan = await addVehicle(f, f.owner, { nickname: "Van", orgId: f.orgId });
    const personal = await addVehicle(f, f.owner, { nickname: "Kendi motorum" });

    // The form has no garage picker, and the API would ignore one anyway:
    // moving a vehicle changes both who can see it and which subscription pays
    // for it, so `bikeUpdateSchema` omits orgId and PATCH drops it.
    const out = await request(f.app)
      .patch(`/api/bikes/${orgVan.body.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ nickname: "Van (yeni ad)", orgId: null });
    expect(out.status).toBe(200);
    expect(out.body.orgId).toBe(f.orgId);
    expect(out.body.nickname).toBe("Van (yeni ad)");

    const into = await request(f.app)
      .patch(`/api/bikes/${personal.body.id}`)
      .set("Cookie", f.owner.cookie)
      .send({ currentKm: 1200, orgId: f.orgId });
    expect(into.status).toBe(200);
    expect(into.body.orgId).toBeNull();

    // Nobody else in the org gained sight of the personal vehicle.
    expect(
      (await request(f.app).get(`/api/bikes/${personal.body.id}`).set("Cookie", f.manager.cookie))
        .status,
    ).toBe(404);
  });

  it("leaves the consumer path exactly as it was", async () => {
    const f = await setup();

    // Someone with no membership at all: one free vehicle, then the cap — the
    // refusal the IAP paywall exists for.
    const first = await addVehicle(f, f.stranger, FORM_PAYLOAD);
    expect(first.status).toBe(201);
    expect(first.body.orgId).toBeNull();

    const second = await addVehicle(f, f.stranger, { nickname: "İkinci" });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("vehicle_limit_reached");
    const ent = await request(f.app).get("/api/entitlement").set("Cookie", f.stranger.cookie);
    expect(ent.body.canAddVehicle).toBe(false);

    // And a fleet manager who submits the form with no org in play gets a
    // personal vehicle, on the personal ceiling — the default is never the org.
    const own = await addVehicle(f, f.manager, { nickname: "Kendi motorum" });
    expect(own.body.orgId).toBeNull();
    const another = await addVehicle(f, f.manager, { nickname: "Bir daha" });
    expect(another.status).toBe(403);
    expect(another.body.error).toBe("vehicle_limit_reached");
  });
});
