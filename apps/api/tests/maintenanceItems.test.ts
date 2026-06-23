import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

describe("/api/maintenance-items", () => {
  it("create + list + patch + delete with isolation", async () => {
    const app = buildTestApp();
    const u1 = await signUpAndSignIn(app, "alice@test.com");
    const u2 = await signUpAndSignIn(app, "bob@test.com");

    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", u1.cookie)
      .send({ nickname: "B1" });
    const bikeId = bike.body.id;

    const create = await request(app)
      .post(`/api/bikes/${bikeId}/maintenance-items`)
      .set("Cookie", u1.cookie)
      .send({
        kind: "engine_oil",
        lastDoneOn: "2026-01-01",
        lastDoneKm: 1000,
        intervalMonths: 6,
        intervalKm: 6000,
      });
    expect(create.status).toBe(201);
    const id = create.body.id;
    expect(create.body.kind).toBe("engine_oil");

    const list = await request(app)
      .get(`/api/bikes/${bikeId}/maintenance-items`)
      .set("Cookie", u1.cookie);
    expect(list.body).toHaveLength(1);

    const patch = await request(app)
      .patch(`/api/maintenance-items/${id}`)
      .set("Cookie", u1.cookie)
      .send({ lastDoneKm: 1500 });
    expect(patch.body.lastDoneKm).toBe(1500);

    const cross = await request(app)
      .get(`/api/maintenance-items/${id}`)
      .set("Cookie", u2.cookie);
    expect(cross.status).toBe(404);

    const del = await request(app)
      .delete(`/api/maintenance-items/${id}`)
      .set("Cookie", u1.cookie);
    expect(del.status).toBe(204);
  });

  it("accepts every maintenance kind allowed by the shared schema", async () => {
    // Regression: the DB CHECK constraint once lagged the zod schema, so
    // 'battery' and 'air_filter' passed validation but 500'd at insert.
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "all-kinds" });
    const bikeId = bike.body.id;
    const kinds = [
      "engine_oil",
      "brakes",
      "tires",
      "battery",
      "coolant",
      "air_filter",
      "chain",
      "custom",
    ];
    for (const kind of kinds) {
      const res = await request(app)
        .post(`/api/bikes/${bikeId}/maintenance-items`)
        .set("Cookie", cookie)
        .send({ kind, ...(kind === "custom" ? { customLabel: "Fren hidroliği" } : {}) });
      expect(res.status, `kind=${kind}`).toBe(201);
      expect(res.body.kind).toBe(kind);
    }
  });

  it("rejects bad date format", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bike = await request(app)
      .post("/api/bikes")
      .set("Cookie", cookie)
      .send({ nickname: "x" });
    const res = await request(app)
      .post(`/api/bikes/${bike.body.id}/maintenance-items`)
      .set("Cookie", cookie)
      .send({ kind: "chain", lastDoneOn: "1.6.2026" });
    expect(res.status).toBe(400);
  });
});
