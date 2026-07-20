import { describe, it, expect } from "vitest";
import request from "supertest";
import { buildTestApp } from "./helpers/buildApp.js";
import { signUpAndSignIn } from "./helpers/authedRequest.js";

async function makeBike(app: ReturnType<typeof buildTestApp>, cookie: string) {
  const res = await request(app)
    .post("/api/bikes")
    .set("Cookie", cookie)
    .set("Content-Type", "application/json")
    .send({ nickname: "Monster" });
  return res.body.id as string;
}

const trip = (bikeId: string, distanceKm: number) => ({
  bikeId,
  distanceKm,
  startedAt: "2026-06-29T08:00:00.000Z",
  endedAt: "2026-06-29T08:40:00.000Z",
  pointCount: 120,
});

describe("/api/trips", () => {
  it("requires auth", async () => {
    const app = buildTestApp();
    expect((await request(app).get("/api/trips")).status).toBe(401);
  });

  it("creates a ≥15km trip and lists it (filtered by bike)", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);

    const create = await request(app)
      .post("/api/trips")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send(trip(bikeId, 18.4));
    expect(create.status).toBe(201);
    expect(create.body.bikeId).toBe(bikeId);
    expect(create.body.distanceKm).toBe(18.4);

    const list = await request(app).get(`/api/trips?bikeId=${bikeId}`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(create.body.id);
  });

  it("rejects trips shorter than 15km", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    const res = await request(app)
      .post("/api/trips")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send(trip(bikeId, 9));
    expect(res.status).toBe(400);
  });

  it("rejects a trip for a vehicle the user does not own", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const res = await request(app)
      .post("/api/trips")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send(trip("nonexistent-bike", 20));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("bike_not_found");
  });
});

describe("/api/trips — routes", () => {
  it("stores a route; list carries only hasRoute, detail carries the polyline", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

    const create = await request(app)
      .post("/api/trips")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send({ ...trip(bikeId, 18.4), route: encoded });
    expect(create.status).toBe(201);
    const id = create.body.id as string;

    const list = await request(app).get("/api/trips").set("Cookie", cookie);
    expect(list.body[0].hasRoute).toBe(true);
    expect(list.body[0].route).toBeUndefined();

    const detail = await request(app).get(`/api/trips/${id}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.route).toBe(encoded);
  });

  it("routeless trips report hasRoute=false and a null detail route", async () => {
    const app = buildTestApp();
    const { cookie } = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, cookie);
    const create = await request(app)
      .post("/api/trips")
      .set("Cookie", cookie)
      .set("Content-Type", "application/json")
      .send(trip(bikeId, 20));
    const detail = await request(app).get(`/api/trips/${create.body.id}`).set("Cookie", cookie);
    expect(detail.body.hasRoute).toBe(false);
    expect(detail.body.route).toBeNull();
  });

  it("does not leak another user's trip detail", async () => {
    const app = buildTestApp();
    const a = await signUpAndSignIn(app);
    const bikeId = await makeBike(app, a.cookie);
    const create = await request(app)
      .post("/api/trips")
      .set("Cookie", a.cookie)
      .set("Content-Type", "application/json")
      .send(trip(bikeId, 20));
    const b = await signUpAndSignIn(app);
    const res = await request(app).get(`/api/trips/${create.body.id}`).set("Cookie", b.cookie);
    expect(res.status).toBe(404);
  });
});
