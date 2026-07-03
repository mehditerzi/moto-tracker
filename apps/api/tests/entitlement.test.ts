import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";
import { getDb } from "../src/db/index.js";

function addBike(app: ReturnType<typeof buildTestApp>, cookie: string, nickname: string) {
  return request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname });
}

describe("vehicle cap / entitlement", () => {
  it("requires auth on /api/entitlement", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/entitlement");
    expect(res.status).toBe(401);
  });

  it("allows the first (free) vehicle and blocks the second", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);

    const first = await addBike(app, cookie, "Free One");
    expect(first.status).toBe(201);

    const second = await addBike(app, cookie, "Should Fail");
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("vehicle_limit_reached");
  });

  it("summarizes entitlement for the free tier", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    await addBike(app, cookie, "Free One");

    const res = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tier: "free",
      maxVehicles: 1,
      activeVehicles: 1,
      canAddVehicle: false,
      expiresAt: null,
    });
  });

  it("raises the cap when an active subscription grants a higher tier", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    await addBike(app, cookie, "Free One");

    // Simulate a verified purchase of the 3-vehicle tier (bypassing StoreKit).
    const oneYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO entitlement (user_id, product_id, tier, max_vehicles, status, original_transaction_id, expires_at, environment)
         VALUES (?, 'com.medhiterzi.mototracker.garage.3.yearly', 'garage3', 3, 'active', 'otx_1', ?, 'Sandbox')`,
      )
      .run(user.id, oneYear);

    const summary = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(summary.body).toMatchObject({ tier: "garage3", maxVehicles: 3, canAddVehicle: true });

    const second = await addBike(app, cookie, "Paid Two");
    expect(second.status).toBe(201);
    const third = await addBike(app, cookie, "Paid Three");
    expect(third.status).toBe(201);
    const fourth = await addBike(app, cookie, "Over Limit");
    expect(fourth.status).toBe(403);
  });

  it("collapses to the free tier once the subscription has expired", async () => {
    const app = buildTestApp();
    const { cookie, user } = await signUpAndSignIn(app);
    await addBike(app, cookie, "Free One");

    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO entitlement (user_id, product_id, tier, max_vehicles, status, original_transaction_id, expires_at, environment)
         VALUES (?, 'com.medhiterzi.mototracker.garage.3.yearly', 'garage3', 3, 'active', 'otx_2', ?, 'Sandbox')`,
      )
      .run(user.id, yesterday);

    const summary = await request(app).get("/api/entitlement").set("Cookie", cookie);
    expect(summary.body).toMatchObject({ tier: "free", maxVehicles: 1, status: "expired" });

    const second = await addBike(app, cookie, "Should Fail");
    expect(second.status).toBe(403);
  });
});
