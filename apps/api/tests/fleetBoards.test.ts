import { describe, it, expect } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createOrgBike, fleetFixture, isoInDays } from "./helpers/fleetFixture.js";
import { getDb } from "../src/db/index.js";

/**
 * The three screens a fleet manager actually looks at: the triage board, the
 * inventory table and the cost rollup.
 *
 * All three answer FLEET-WIDE questions, which makes them the most tempting
 * enumeration surface in the product — so every describe block below ends by
 * pointing a driver and a rival at the same URL.
 */

async function dated(
  app: Express,
  cookie: string,
  bikeId: string,
  type: string,
  expiresOn: string,
) {
  const res = await request(app)
    .post(`/api/bikes/${bikeId}/dated-items`)
    .set("Cookie", cookie)
    .send({ type, expiresOn });
  if (res.status !== 201) throw new Error(`dated: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

describe("triage board", () => {
  it("splits overdue from the horizon and sorts by urgency", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.van, "sigorta", isoInDays(-10));
    await dated(f.app, f.owner.cookie, f.van, "muayene", isoInDays(3));
    await dated(f.app, f.owner.cookie, f.truck, "kasko", isoInDays(-40));
    await dated(f.app, f.owner.cookie, f.truck, "mtv", isoInDays(400)); // beyond horizon

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.overdue.map((r: { kind: string }) => r.kind)).toEqual(["kasko", "sigorta"]);
    expect(res.body.overdue[0].daysRemaining).toBe(-40);
    expect(res.body.overdue[0].status).toBe("expired");
    expect(res.body.upcoming).toHaveLength(1);
    expect(res.body.upcoming[0]).toMatchObject({ kind: "muayene", daysRemaining: 3, status: "danger" });
    expect(res.body.summary).toMatchObject({ overdueCount: 2, dueSoonCount: 1 });
  });

  it("uses the LATEST policy per type, so a renewal clears the row", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.van, "sigorta", isoInDays(-5));
    const board = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(board.body.overdue).toHaveLength(1);

    // The renewal is filed; last year's policy stays in history.
    await dated(f.app, f.owner.cookie, f.van, "sigorta", isoInDays(300));
    const after = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(after.body.overdue).toHaveLength(0);
    expect(after.body.upcoming).toHaveLength(0);
  });

  it("is a success state, not an empty state, when nothing is due", async () => {
    const f = await fleetFixture("fleet");
    const res = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(res.body.overdue).toEqual([]);
    expect(res.body.upcoming).toEqual([]);
    // The strip is still populated, so the page has something to say.
    expect(res.body.summary).toMatchObject({ totalVehicles: 2, inUse: 0, idle: 2, archived: 0 });
  });

  it("counts in-use, idle, archived and documents pending OCR", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });
    const spare = await createOrgBike(f.app, f.owner.cookie, f.orgId, "Yedek", "01AAA111");
    await request(f.app).delete(`/api/bikes/${spare}`).set("Cookie", f.owner.cookie);
    getDb()
      .prepare(
        `INSERT INTO document (id, user_id, bike_id, file_path, mime_type, size_bytes, ocr_status)
         VALUES ('d1', ?, ?, '/tmp/x', 'image/jpeg', 10, 'pending')`,
      )
      .run(f.owner.user.id, f.van);

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.manager.cookie);
    expect(res.body.summary).toMatchObject({
      totalVehicles: 2,
      inUse: 1,
      idle: 1,
      archived: 1,
      documentsPendingOcr: 1,
    });
  });

  it("names the holder on each row, in both modes", async () => {
    const fleetOrg = await fleetFixture("fleet");
    await dated(fleetOrg.app, fleetOrg.owner.cookie, fleetOrg.van, "sigorta", isoInDays(-1));
    await request(fleetOrg.app)
      .post(`/api/orgs/${fleetOrg.orgId}/assignments`)
      .set("Cookie", fleetOrg.owner.cookie)
      .send({ bikeId: fleetOrg.van, userId: fleetOrg.driver.user.id });
    const a = await request(fleetOrg.app)
      .get(`/api/orgs/${fleetOrg.orgId}/triage`)
      .set("Cookie", fleetOrg.owner.cookie);
    expect(a.body.overdue[0].holder).toMatchObject({ type: "driver", id: fleetOrg.driver.user.id });

    const rentalOrg = await fleetFixture("rental");
    await dated(rentalOrg.app, rentalOrg.owner.cookie, rentalOrg.van, "sigorta", isoInDays(-1));
    const cust = await request(rentalOrg.app)
      .post(`/api/orgs/${rentalOrg.orgId}/customers`)
      .set("Cookie", rentalOrg.owner.cookie)
      .send({ name: "Ayşe" });
    await request(rentalOrg.app)
      .post(`/api/orgs/${rentalOrg.orgId}/contracts`)
      .set("Cookie", rentalOrg.owner.cookie)
      .send({ customerId: cust.body.id, bikeId: rentalOrg.van, endsAt: isoInDays(2) });

    const b = await request(rentalOrg.app)
      .get(`/api/orgs/${rentalOrg.orgId}/triage`)
      .set("Cookie", rentalOrg.owner.cookie);
    const insurance = b.body.overdue[0];
    expect(insurance.holder).toMatchObject({ type: "customer", name: "Ayşe" });
    // A rental due back is itself a deadline in rental mode.
    expect(b.body.upcoming.map((r: { kind: string }) => r.kind)).toContain("contract_due");
  });

  it("surfaces a maintenance interval that has come due", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post(`/api/bikes/${f.van}/maintenance-items`)
      .set("Cookie", f.owner.cookie)
      .send({ kind: "engine_oil", lastDoneOn: isoInDays(-400), intervalMonths: 6 });

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(res.body.overdue).toHaveLength(1);
    expect(res.body.overdue[0]).toMatchObject({ kind: "maintenance", label: "engine_oil" });
  });

  it("honours the horizon and ignores archived vehicles", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.van, "sigorta", isoInDays(60));
    await dated(f.app, f.owner.cookie, f.truck, "sigorta", isoInDays(2));
    await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", f.owner.cookie);

    const short = await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", f.owner.cookie);
    expect(short.body.upcoming).toHaveLength(0); // 60 days out, truck archived
    const long = await request(f.app)
      .get(`/api/orgs/${f.orgId}/triage?horizonDays=90`)
      .set("Cookie", f.owner.cookie);
    expect(long.body.upcoming.map((r: { bikeId: string }) => r.bikeId)).toEqual([f.van]);
  });

  it("NEVER answers a driver, and never leaks across tenants", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.truck, "sigorta", isoInDays(-3));
    // The driver holds the van, and still may not see the board.
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const asDriver = await request(f.app)
      .get(`/api/orgs/${f.orgId}/triage`)
      .set("Cookie", f.driver.cookie);
    expect(asDriver.status).toBe(403);
    expect(JSON.stringify(asDriver.body)).not.toContain(f.truck);

    for (const c of [f.rival, f.outsider]) {
      expect((await request(f.app).get(`/api/orgs/${f.orgId}/triage`).set("Cookie", c.cookie)).status).toBe(404);
    }
    const rivalBoard = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/triage`)
      .set("Cookie", f.rival.cookie);
    expect(rivalBoard.body.summary.totalVehicles).toBe(1);
    expect(JSON.stringify(rivalBoard.body)).not.toContain(f.van);
  });
});

describe("inventory", () => {
  it("carries next expiry, km, status and holder for every vehicle", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.van, "muayene", isoInDays(4));
    await request(f.app)
      .patch(`/api/bikes/${f.van}`)
      .set("Cookie", f.owner.cookie)
      .send({ currentKm: 55000 });
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.staff.cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const van = res.body.items.find((r: { bikeId: string }) => r.bikeId === f.van);
    expect(van).toMatchObject({ currentKm: 55000, status: "danger" });
    expect(van.nextDue).toMatchObject({ kind: "muayene", daysRemaining: 4 });
    expect(van.holder.type).toBe("driver");
    const truck = res.body.items.find((r: { bikeId: string }) => r.bikeId === f.truck);
    expect(truck.nextDue).toBeNull();
    expect(truck.status).toBe("unset");
  });

  it("carries a km-based service interval, which has no due date at all", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .patch(`/api/bikes/${f.van}`)
      .set("Cookie", f.owner.cookie)
      .send({ currentKm: 19_200 });
    await request(f.app)
      .post(`/api/bikes/${f.van}/maintenance-items`)
      .set("Cookie", f.owner.cookie)
      .send({ kind: "engine_oil", lastDoneKm: 10_000, intervalKm: 10_000 });

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.owner.cookie);
    const van = res.body.items.find((r: { bikeId: string }) => r.bikeId === f.van);
    expect(van.kmDue).toEqual({ label: "engine_oil", kmRemaining: 800 });
    // It is a km deadline, so it never masquerades as a dated one.
    expect(van.nextDue).toBeNull();
    expect(van.status).toBe("unset");
    const truck = res.body.items.find((r: { bikeId: string }) => r.bikeId === f.truck);
    expect(truck.kmDue).toBeNull();
  });

  it("finds a plate however the spacing is typed", async () => {
    const f = await fleetFixture("fleet");
    for (const q of ["34ABC123", "34 ABC 123", "34-abc-123", "abc123", " 34abc "]) {
      const res = await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles?q=${encodeURIComponent(q)}`)
        .set("Cookie", f.owner.cookie);
      expect(res.body.items.map((r: { bikeId: string }) => r.bikeId), q).toEqual([f.van]);
    }
    // …and the stored plate itself is normalised for comparison, not mangled.
    const all = await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.owner.cookie);
    expect(all.body.items.find((r: { bikeId: string }) => r.bikeId === f.van).plate).toBe("34 ABC 123");
  });

  it("searches make, model and nickname with Turkish letters folded", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .patch(`/api/bikes/${f.truck}`)
      .set("Cookie", f.owner.cookie)
      .send({ nickname: "Şoför Aracı", make: "Peugeot" });
    for (const q of ["sofor", "ŞOFÖR", "peugeot"]) {
      const res = await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles?q=${encodeURIComponent(q)}`)
        .set("Cookie", f.owner.cookie);
      expect(res.body.items.map((r: { bikeId: string }) => r.bikeId), q).toEqual([f.truck]);
    }
  });

  it("filters by status and holder, and sorts by expiry with unknowns last", async () => {
    const f = await fleetFixture("fleet");
    await dated(f.app, f.owner.cookie, f.van, "sigorta", isoInDays(-2));
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const expired = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?status=expired`)
      .set("Cookie", f.owner.cookie);
    expect(expired.body.items.map((r: { bikeId: string }) => r.bikeId)).toEqual([f.van]);

    const idle = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?holder=idle`)
      .set("Cookie", f.owner.cookie);
    expect(idle.body.items.map((r: { bikeId: string }) => r.bikeId)).toEqual([f.truck]);

    const byDriver = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?holder=${f.driver.user.id}`)
      .set("Cookie", f.owner.cookie);
    expect(byDriver.body.items.map((r: { bikeId: string }) => r.bikeId)).toEqual([f.van]);

    // The truck has no deadline: last, whichever way the column is pointed.
    for (const dir of ["asc", "desc"]) {
      const sorted = await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles?sort=expiry&dir=${dir}`)
        .set("Cookie", f.owner.cookie);
      expect(sorted.body.items.at(-1).bikeId, dir).toBe(f.truck);
    }
  });

  it("paginates without losing the true total", async () => {
    const f = await fleetFixture("fleet");
    const res = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?limit=1&offset=1&sort=plate`)
      .set("Cookie", f.owner.cookie);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].plate).toBe("34 ABC 123"); // 06… sorts first
  });

  it("hides archived vehicles unless asked", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app).delete(`/api/bikes/${f.truck}`).set("Cookie", f.owner.cookie);
    const plain = await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.owner.cookie);
    expect(plain.body.total).toBe(1);
    const all = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?includeArchived=true`)
      .set("Cookie", f.owner.cookie);
    expect(all.body.total).toBe(2);
    // `includeArchived=false` must actually mean false.
    const explicit = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?includeArchived=false`)
      .set("Cookie", f.owner.cookie);
    expect(explicit.body.total).toBe(1);
  });

  it("NEVER answers a driver, and never lists another tenant's vehicles", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const asDriver = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles`)
      .set("Cookie", f.driver.cookie);
    expect(asDriver.status).toBe(403);
    // Not even with a filter that would match only the vehicle they hold.
    const narrowed = await request(f.app)
      .get(`/api/orgs/${f.orgId}/vehicles?holder=${f.driver.user.id}`)
      .set("Cookie", f.driver.cookie);
    expect(narrowed.status).toBe(403);

    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/vehicles`).set("Cookie", f.rival.cookie)).status,
    ).toBe(404);
    const theirs = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/vehicles`)
      .set("Cookie", f.rival.cookie);
    expect(theirs.body.items.map((r: { bikeId: string }) => r.bikeId)).toEqual([f.rivalVan]);
  });

  it("rejects nonsense query parameters instead of guessing", async () => {
    const f = await fleetFixture("fleet");
    for (const qs of ["sort=colour", "status=maybe", "limit=0", "limit=9999", "offset=-1"]) {
      const res = await request(f.app)
        .get(`/api/orgs/${f.orgId}/vehicles?${qs}`)
        .set("Cookie", f.owner.cookie);
      expect(res.status, qs).toBe(400);
    }
  });
});

describe("costs", () => {
  /** A fill-up: cost in the month, odometer for the distance. */
  async function fuel(
    f: Awaited<ReturnType<typeof fleetFixture>>,
    bikeId: string,
    filledOn: string,
    liters: number,
    totalCost: number,
    odometerKm: number,
  ) {
    const res = await request(f.app)
      .post("/api/fuel-logs")
      .set("Cookie", f.owner.cookie)
      .send({ bikeId, filledOn, liters, totalCost, odometerKm });
    if (res.status !== 201) throw new Error(`fuel: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const thisMonth = () => isoInDays(0).slice(0, 7);

  it("rolls fuel, service and compliance up per vehicle and per month with ₺/km", async () => {
    const f = await fleetFixture("fleet");
    const day = isoInDays(-1);
    await fuel(f, f.van, day, 40, 2000, 10000);
    await fuel(f, f.van, day, 40, 2000, 11000); // 1000 km on 4000 ₺ of fuel
    // Service and compliance are recorded straight in the database: the capture
    // routes for a cost field are another agent's, and this asserts the rollup.
    getDb()
      .prepare(
        `INSERT INTO maintenance_item (id, bike_id, user_id, kind, last_done_on, cost)
         VALUES ('m1', ?, ?, 'engine_oil', ?, 500)`,
      )
      .run(f.van, f.owner.user.id, day);
    await request(f.app)
      .post(`/api/bikes/${f.van}/dated-items`)
      .set("Cookie", f.owner.cookie)
      .send({ type: "sigorta", expiresOn: isoInDays(300), cost: 1500 });

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.owner.cookie);
    expect(res.status).toBe(200);
    const van = res.body.vehicles.find((v: { bikeId: string }) => v.bikeId === f.van);
    expect(van).toMatchObject({
      fuelCost: 4000,
      fuelLiters: 80,
      maintenanceCost: 500,
      complianceCost: 1500,
      totalCost: 6000,
      distanceKm: 1000,
      costPerKm: 6,
    });
    const month = van.months.find((m: { month: string }) => m.month === thisMonth());
    expect(month).toMatchObject({ fuelCost: 4000, totalCost: 6000 });
    expect(res.body.fleet.totalCost).toBe(6000);
    expect(res.body.currency).toBe("TRY");
  });

  it("reports null ₺/km rather than inventing a distance", async () => {
    const f = await fleetFixture("fleet");
    await fuel(f, f.van, isoInDays(-1), 40, 2000, 10000); // one reading only
    const res = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.owner.cookie);
    const van = res.body.vehicles.find((v: { bikeId: string }) => v.bikeId === f.van);
    expect(van.fuelCost).toBe(2000);
    expect(van.distanceKm).toBe(0);
    expect(van.costPerKm).toBeNull();
  });

  it("falls back to GPS trips when no odometer was ever written down", async () => {
    const f = await fleetFixture("fleet");
    await request(f.app)
      .post("/api/trips")
      .set("Cookie", f.owner.cookie)
      .send({
        bikeId: f.van,
        distanceKm: 200,
        startedAt: `${isoInDays(-1)}T08:00:00Z`,
        endedAt: `${isoInDays(-1)}T11:00:00Z`,
        pointCount: 50,
      });
    await fuel(f, f.van, isoInDays(-1), 20, 1000, 0);

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.owner.cookie);
    const van = res.body.vehicles.find((v: { bikeId: string }) => v.bikeId === f.van);
    expect(van.distanceKm).toBe(200);
    expect(van.costPerKm).toBe(5);
  });

  it("flags the vehicle well above the fleet median", async () => {
    const f = await fleetFixture("fleet");
    const day = isoInDays(-1);
    const others = [f.van, f.truck];
    for (const b of others) {
      await fuel(f, b, day, 40, 1000, 1000);
      await fuel(f, b, day, 40, 1000, 2000); // 2 ₺/km
    }
    const thirsty = await createOrgBike(f.app, f.owner.cookie, f.orgId, "Susamış", "01AAA111");
    await fuel(f, thirsty, day, 40, 5000, 1000);
    await fuel(f, thirsty, day, 40, 5000, 2000); // 10 ₺/km

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.manager.cookie);
    expect(res.body.fleet.medianCostPerKm).toBe(2);
    const flagged = res.body.vehicles.filter((v: { outlier: boolean }) => v.outlier);
    expect(flagged.map((v: { bikeId: string }) => v.bikeId)).toEqual([thirsty]);
    expect(flagged[0].ratioToMedian).toBe(5);
    // Dearest first, so the insight is at the top of the table.
    expect(res.body.vehicles[0].bikeId).toBe(thirsty);
  });

  it("respects the requested month window", async () => {
    const f = await fleetFixture("fleet");
    await fuel(f, f.van, "2020-03-15", 40, 2000, 10000);
    const inside = await request(f.app)
      .get(`/api/orgs/${f.orgId}/costs?from=2020-01&to=2020-12`)
      .set("Cookie", f.owner.cookie);
    expect(inside.body.fleet.fuelCost).toBe(2000);
    expect(inside.body.months).toHaveLength(12);

    const outside = await request(f.app)
      .get(`/api/orgs/${f.orgId}/costs?from=2021-01&to=2021-03`)
      .set("Cookie", f.owner.cookie);
    expect(outside.body.fleet.fuelCost).toBe(0);
    expect(
      (await request(f.app)
        .get(`/api/orgs/${f.orgId}/costs?from=nonsense`)
        .set("Cookie", f.owner.cookie)).status,
    ).toBe(400);
  });

  it("NEVER answers a driver, and never mixes tenants", async () => {
    const f = await fleetFixture("fleet");
    await fuel(f, f.truck, isoInDays(-1), 40, 2000, 10000);
    await request(f.app)
      .post(`/api/orgs/${f.orgId}/assignments`)
      .set("Cookie", f.owner.cookie)
      .send({ bikeId: f.van, userId: f.driver.user.id });

    const asDriver = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.driver.cookie);
    expect(asDriver.status).toBe(403);
    expect(JSON.stringify(asDriver.body)).not.toContain(f.truck);

    expect(
      (await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.rival.cookie)).status,
    ).toBe(404);
    const theirs = await request(f.app)
      .get(`/api/orgs/${f.rivalOrgId}/costs`)
      .set("Cookie", f.rival.cookie);
    expect(theirs.body.vehicles.map((v: { bikeId: string }) => v.bikeId)).toEqual([f.rivalVan]);
    expect(theirs.body.fleet.totalCost).toBe(0);
  });

  it("never counts a member's personal vehicle as fleet cost", async () => {
    const f = await fleetFixture("fleet");
    const personal = await request(f.app)
      .post("/api/bikes")
      .set("Cookie", f.manager.cookie)
      .send({ nickname: "Kendi arabam" });
    await request(f.app)
      .post("/api/fuel-logs")
      .set("Cookie", f.manager.cookie)
      .send({ bikeId: personal.body.id, filledOn: isoInDays(-1), liters: 30, totalCost: 9999, odometerKm: 100 });

    const res = await request(f.app).get(`/api/orgs/${f.orgId}/costs`).set("Cookie", f.owner.cookie);
    expect(res.body.vehicles.map((v: { bikeId: string }) => v.bikeId).sort()).toEqual(
      [f.van, f.truck].sort(),
    );
    expect(res.body.fleet.fuelCost).toBe(0);
  });
});
