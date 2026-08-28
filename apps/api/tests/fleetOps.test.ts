import { describe, it, expect } from "vitest";
import request from "supertest";
import { createOrgBike, fleetFixture, isoInDays } from "./helpers/fleetFixture.js";
import { getDb } from "../src/db/index.js";

/**
 * Assignments (fleet mode) and customers + contracts (rental mode).
 *
 * The recurring theme is that a vehicle can be in exactly one pair of hands.
 * The schema guarantees it with partial unique indexes; these tests check the
 * API turns that guarantee into a code the client can act on rather than a
 * constraint failure, and that neither half of the product leaks across tenants.
 */

describe("assignments", () => {
  it("hands a vehicle to a driver and grants them exactly that vehicle", async () => {
    const f = await fleetFixture("fleet");
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.manager.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id, startKm: 12000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ bikeId: f.van, userId: f.driver.user.id, startKm: 12000, endedAt: null });
    expect(res.body.user.email).toBe("driver@filo.test");

    const bikes = await request(f.app).get("/api/bikes").set("Cookie", f.driver.cookie);
    expect(bikes.body.map((b: { id: string }) => b.id)).toEqual([f.van]);
  });

  it("refuses a second open assignment for the same vehicle", async () => {
    const f = await fleetFixture("fleet");
    const first = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    expect(first.status).toBe(201);

    const second = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.staff.user.id });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("vehicle_already_assigned");
    // Not a raw constraint failure, and nothing was written.
    expect(
      (getDb()
        .prepare("SELECT COUNT(*) c FROM vehicle_assignment WHERE bike_id = ?")
        .get(f.van) as { c: number }).c,
    ).toBe(1);
  });

  it("frees the vehicle when the assignment ends, and rolls the odometer forward", async () => {
    const f = await fleetFixture("fleet");
    const a = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id, startKm: 1000 });

    const end = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments/${a.body.id}/end`)
      .set("Cookie", f.owner.cookie)
      .send({ endKm: 4200 });
    expect(end.status).toBe(200);
    expect(end.body.endedAt).not.toBeNull();

    const bike = await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.owner.cookie);
    expect(bike.body.currentKm).toBe(4200);
    // The driver's access disappeared with the assignment.
    expect((await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.driver.cookie)).status).toBe(404);
  });

  it("refuses to end an assignment twice, or with a backwards odometer", async () => {
    const f = await fleetFixture("fleet");
    const a = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id, startKm: 5000 });

    const bad = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments/${a.body.id}/end`)
      .set("Cookie", f.owner.cookie)
      .send({ endKm: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("end_km_before_start_km");

    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments/${a.body.id}/end`)
      .set("Cookie", f.owner.cookie)
      .send({});
    const again = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments/${a.body.id}/end`)
      .set("Cookie", f.owner.cookie)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("assignment_already_ended");
  });

  it("only owner and manager may assign; staff read but cannot", async () => {
    const f = await fleetFixture("fleet");
    const staffTry = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.staff.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    expect(staffTry.status).toBe(403);
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/assignments`).set("Cookie", f.staff.cookie)).status,
    ).toBe(200);
  });

  it("a driver can neither list assignments nor assign anything to themselves", async () => {
    const f = await fleetFixture("fleet");
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/assignments`).set("Cookie", f.driver.cookie)).status,
    ).toBe(403);
    const grab = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.driver.cookie)
      .send({ bikeId: f.truck, userId: f.driver.user.id });
    expect(grab.status).toBe(403);
    expect((await request(f.app).get(`/api/bikes/${f.truck}`).set("Cookie", f.driver.cookie)).status).toBe(404);
  });

  it("cannot assign another tenant's vehicle, or to a non-member", async () => {
    const f = await fleetFixture("fleet");
    const foreignBike = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.rivalVan, userId: f.driver.user.id });
    expect(foreignBike.status).toBe(404);
    expect(foreignBike.body.error).toBe("bike_not_found");

    const foreignUser = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.outsider.user.id });
    expect(foreignUser.status).toBe(404);
    expect(foreignUser.body.error).toBe("member_not_found");

    // And our owner cannot drive the rival's ledger at all.
    const across = await request(f.app)
      .post(`/api/orgs/${f.rivalOrgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.rivalVan, userId: f.owner.user.id });
    expect(across.status).toBe(404);
  });

  it("cannot assign to a member who has been removed", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .delete(`/api/orgs/${f.orgId}/members/${f.driver.user.id}`)
      .set("Cookie", f.owner.cookie);
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("member_not_found");
  });

  it("is refused entirely in a rental-mode organization", async () => {
    const f = await fleetFixture("rental");
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("mode_mismatch");
  });

  it("lists current and past assignments, and never another org's", async () => {
    const f = await fleetFixture("fleet");
    const a = await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments/${a.body.id}/end`)
      .set("Cookie", f.owner.cookie)
      .send({});
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.staff.user.id });

    const all = await request(f.app)
      .get(`/api/orgs/${f.orgId}/assignments?bikeId=${f.van}`)
      .set("Cookie", f.owner.cookie);
    expect(all.body).toHaveLength(2);
    const open = await request(f.app)
      .get(`/api/orgs/${f.orgId}/assignments?open=true`)
      .set("Cookie", f.owner.cookie);
    expect(open.body).toHaveLength(1);
    expect(open.body[0].userId).toBe(f.staff.user.id);

    const rivalView = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/assignments`)
      .set("Cookie", f.rival.cookie);
    expect(rivalView.body).toEqual([]);
  });

  it("exposes a vehicle's holder history to the fleet, but not across tenants", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const hist = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles/${f.van}/history`)
      .set("Cookie", f.staff.cookie);
    expect(hist.status).toBe(200);
    expect(hist.body.assignments).toHaveLength(1);
    expect(hist.body.assignments[0].userEmail).toBe("driver@filo.test");

    expect(
      (await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles/${f.rivalVan}/history`)
        .set("Cookie", f.owner.cookie)).status,
    ).toBe(404);
    expect(
      (await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles/${f.van}/history`)
        .set("Cookie", f.driver.cookie)).status,
    ).toBe(403);
  });
});

describe("customers", () => {
  async function customer(f: Awaited<ReturnType<typeof fleetFixture>>, name = "Ayşe Yılmaz") {
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/customers`)
      .set("Cookie", f.owner.cookie)
      .send({ name, phone: "0555 111 2233", email: "ayse@example.com" });
    return res;
  }

  it("round-trips create, read, update and search", async () => {
    const f = await fleetFixture("rental");
    const created = await customer(f);
    expect(created.status).toBe(201);

    const patched = await request(f.app)
      .patch(`/api/orgs/${f.orgId}/customers/${created.body.id}`)
      .set("Cookie", f.manager.cookie)
      .send({ notes: "VIP" });
    expect(patched.body.notes).toBe("VIP");

    // Turkish letters fold: `ayse` finds `Ayşe`.
    const found = await request(f.app)
      .get(`/api/orgs/${f.orgId}/customers?q=ayse`)
      .set("Cookie", f.staff.cookie);
    expect(found.body).toHaveLength(1);
    const missed = await request(f.app)
      .get(`/api/orgs/${f.orgId}/customers?q=zzz`)
      .set("Cookie", f.staff.cookie);
    expect(missed.body).toHaveLength(0);
  });

  it("is invisible to a driver and to another tenant", async () => {
    const f = await fleetFixture("rental");
    await customer(f);
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/customers`).set("Cookie", f.driver.cookie)).status,
    ).toBe(403);
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/customers`).set("Cookie", f.rival.cookie)).status,
    ).toBe(404);
    expect(
      (await request(f.app).get(`/api/orgs/${f.rivalOrgId}/customers`).set("Cookie", f.rival.cookie)).body,
    ).toEqual([]);
  });

  it("cannot be read or edited through another org's path", async () => {
    const f = await fleetFixture("rental");
    const created = await customer(f);
    const res = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/customers/${created.body.id}`)
      .set("Cookie", f.rival.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("customer_not_found");
  });

  it("DELETE erases the renter and cascades their contracts — even an open one", async () => {
    const f = await fleetFixture("rental");
    const c = await customer(f);
    const contract = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, customerId: c.body.id, handoverKm: 1000 });
    expect(contract.status).toBe(201);

    const del = await request(f.app)
      .delete(`/api/orgs/${f.orgId}/customers/${c.body.id}`)
      .set("Cookie", f.owner.cookie);
    expect(del.status).toBe(204);

    const db = getDb();
    expect(
      (db.prepare("SELECT COUNT(*) c FROM fleet_customer WHERE id = ?").get(c.body.id) as { c: number }).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM rental_contract WHERE id = ?").get(contract.body.id) as {
        c: number;
      }).c,
    ).toBe(0);
    // The vehicle is free again, because the open contract went with them.
    const c2 = await customer(f, "Mehmet");
    const again = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, customerId: c2.body.id });
    expect(again.status).toBe(201);
  });

  it("erasure still works after the org is switched to fleet mode", async () => {
    const f = await fleetFixture("rental");
    const c = await customer(f);
    await request(f.app)
      .patch(`/api/orgs/${f.orgId}`)
      .set("Cookie", f.owner.cookie)
      .send({ mode: "fleet" });
    const del = await request(f.app)
      .delete(`/api/orgs/${f.orgId}/customers/${c.body.id}`)
      .set("Cookie", f.owner.cookie);
    expect(del.status).toBe(204);
  });

  it("staff and drivers cannot create or delete a customer", async () => {
    const f = await fleetFixture("rental");
    const c = await customer(f);
    for (const cl of [f.staff, f.driver]) {
      expect(
        (await request(f.app)
          .post(`/api/orgs/${f.orgId}/customers`)
          .set("Cookie", cl.cookie)
          .send({ name: "Gizli" })).status,
      ).toBe(403);
      expect(
        (await request(f.app)
          .delete(`/api/orgs/${f.orgId}/customers/${c.body.id}`)
          .set("Cookie", cl.cookie)).status,
      ).toBe(403);
    }
  });

  it("cannot be created in a fleet-mode organization", async () => {
    const f = await fleetFixture("fleet");
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/customers`)
      .set("Cookie", f.owner.cookie)
      .send({ name: "Kiracı" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("mode_mismatch");
  });
});

describe("contracts", () => {
  async function rentalSetup() {
    const f = await fleetFixture("rental");
    const c = await request(f.app)
      .post(`/api/orgs/${f.orgId}/customers`)
      .set("Cookie", f.owner.cookie)
      .send({ name: "Ayşe" });
    return { f, customerId: c.body.id as string };
  }

  it("opens a contract with the vehicle's odometer as the default handover km", async () => {
    const { f, customerId } = await rentalSetup();
    await request(f.app)
      .patch(`/api/bikes/${f.van}`)
      .set("Cookie", f.owner.cookie)
      .send({ currentKm: 8000 });

    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van, endsAt: isoInDays(5), dailyRate: 1200 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ handoverKm: 8000, status: "open", currency: "TRY" });
    expect(res.body.customer.name).toBe("Ayşe");
  });

  it("refuses to double-book a vehicle", async () => {
    const { f, customerId } = await rentalSetup();
    const first = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });
    expect(first.status).toBe(201);
    const second = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("vehicle_already_rented");
    expect(
      (getDb().prepare("SELECT COUNT(*) c FROM rental_contract WHERE bike_id = ?").get(f.van) as {
        c: number;
      }).c,
    ).toBe(1);
  });

  it("closes with a return odometer and frees the vehicle", async () => {
    const { f, customerId } = await rentalSetup();
    const open = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van, handoverKm: 1000 });

    const bad = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts/${open.body.id}/close`)
      .set("Cookie", f.owner.cookie)
      .send({ returnKm: 500 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("return_km_before_handover");

    const closed = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts/${open.body.id}/close`)
      .set("Cookie", f.manager.cookie)
      .send({ returnKm: 1750 });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: "returned", returnKm: 1750, distanceKm: 750 });
    expect(closed.body.returnedAt).not.toBeNull();

    const bike = await request(f.app).get(`/api/bikes/${f.van}`).set("Cookie", f.owner.cookie);
    expect(bike.body.currentKm).toBe(1750);

    const again = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts/${open.body.id}/close`)
      .set("Cookie", f.owner.cookie)
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("contract_not_open");
  });

  it("cancelling releases the vehicle without claiming a return", async () => {
    const { f, customerId } = await rentalSetup();
    const open = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });
    const cancelled = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts/${open.body.id}/cancel`)
      .set("Cookie", f.owner.cookie)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.returnedAt).toBeNull();

    const reopened = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });
    expect(reopened.status).toBe(201);
  });

  it("refuses a vehicle or customer belonging to another organization", async () => {
    const { f, customerId } = await rentalSetup();
    const foreignBike = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.rivalVan });
    expect(foreignBike.status).toBe(404);
    expect(foreignBike.body.error).toBe("bike_not_found");

    const rivalCustomer = await request(f.app)
      .post(`/api/orgs/${f.rivalOrgId}/customers`)
      .set("Cookie", f.rival.cookie)
      .send({ name: "Rakip Kiracı" });
    const foreignCustomer = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId: rivalCustomer.body.id, bikeId: f.van });
    expect(foreignCustomer.status).toBe(404);
    expect(foreignCustomer.body.error).toBe("customer_not_found");
  });

  it("refuses an archived vehicle, and validates the dates", async () => {
    const { f, customerId } = await rentalSetup();
    const spare = await createOrgBike(f.app, f.owner.cookie, f.orgId, "Yedek", "01AAA111");
    await request(f.app).delete(`/api/bikes/${spare}`).set("Cookie", f.owner.cookie);

    const archived = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: spare });
    expect(archived.status).toBe(409);
    expect(archived.body.error).toBe("bike_archived");

    const backwards = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van, startedAt: isoInDays(5), endsAt: isoInDays(1) });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error).toBe("ends_before_start");
  });

  it("staff may read contracts but not open or close them; a driver sees none", async () => {
    const { f, customerId } = await rentalSetup();
    const open = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });

    const staffRead = await request(f.app)
      .get(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.staff.cookie);
    expect(staffRead.status).toBe(200);
    expect(staffRead.body).toHaveLength(1);

    expect(
      (await request(f.app)
        .post(`/api/orgs/${f.orgId}/contracts`)
        .set("Cookie", f.staff.cookie)
        .send({ customerId, bikeId: f.truck })).status,
    ).toBe(403);
    expect(
      (await request(f.app)
        .post(`/api/orgs/${f.orgId}/contracts/${open.body.id}/close`)
        .set("Cookie", f.staff.cookie)
        .send({})).status,
    ).toBe(403);
    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/contracts`).set("Cookie", f.driver.cookie)).status,
    ).toBe(403);
  });

  it("cannot be opened in a fleet-mode organization", async () => {
    const f = await fleetFixture("fleet");
    getDb()
      .prepare("INSERT INTO fleet_customer (id, org_id, name) VALUES ('c-fleet', ?, 'Kiracı')")
      .run(f.orgId);
    const res = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId: "c-fleet", bikeId: f.van });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("mode_mismatch");
  });

  it("cannot be closed through another organization's path", async () => {
    const { f, customerId } = await rentalSetup();
    const open = await request(f.app)
      .post(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie)
      .send({ customerId, bikeId: f.van });
    const res = await request(f.app)
      .post(`/api/orgs/${f.rivalOrgId}/contracts/${open.body.id}/close`)
      .set("Cookie", f.rival.cookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("contract_not_found");
    const still = await request(f.app)
      .get(`/api/orgs/${f.orgId}/contracts`)
      .set("Cookie", f.owner.cookie);
    expect(still.body[0].status).toBe("open");
  });
});
