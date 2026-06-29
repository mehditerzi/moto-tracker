import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

async function makeBike(app: ReturnType<typeof buildTestApp>, cookie: string) {
  const res = await request(app).post("/api/bikes").set("Cookie", cookie).send({ nickname: "B" });
  return res.body.id as string;
}

describe("/api/fuel-logs", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/fuel-logs")).status).toBe(401);
  });

  it("create + list + delete", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);

    const create = await request(app)
      .post("/api/fuel-logs")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ bikeId, filledOn: "2026-06-01", liters: 35.2, totalCost: 1500, odometerKm: 12500 });
    expect(create.status).toBe(201);
    expect(create.body.liters).toBe(35.2);
    expect(create.body.isFull).toBe(true);

    const list = await request(app).get(`/api/fuel-logs?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app).delete(`/api/fuel-logs/${create.body.id}`).set("Cookie", cookie);
    expect(del.status).toBe(204);
  });

  it("rejects a fuel-up for a vehicle you do not own", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/fuel-logs")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ bikeId: "nope", filledOn: "2026-06-01", liters: 10 });
    expect(res.status).toBe(404);
  });
});
